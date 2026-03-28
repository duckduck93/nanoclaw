/**
 * Deploy Handler
 * Executes docker build/run on the host on behalf of container agents.
 * Agents write a request to /workspace/ipc/deploy/{id}.json and poll
 * /workspace/ipc/deploy/{id}.response.json for the result.
 */
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';
import { resolveGroupFolderPath } from './group-folder.js';

export interface DeployRequest {
  id: string;
  image: string;
  // Path relative to /workspace/group (i.e. relative to the group folder on host).
  // Example: "myapp" → groups/{folder}/myapp/
  contextPath: string;
  dockerfile?: string; // relative to contextPath, default: Dockerfile
  ports?: string[]; // ["3000:3000"]
  env?: Record<string, string>;
  containerName?: string; // docker run --name
}

export interface DeployResult {
  id: string;
  status: 'success' | 'error';
  output: string;
  error?: string;
}

function runCommand(
  cmd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as Error & { stdout?: string; stderr?: string };
          e.stdout = stdout;
          e.stderr = stderr;
          reject(e);
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });
}

export async function handleDeployRequest(
  request: DeployRequest,
  groupFolder: string,
  ipcDir: string,
): Promise<void> {
  const deployDir = path.join(ipcDir, 'deploy');
  const responseFile = path.join(deployDir, `${request.id}.response.json`);

  const writeResult = (result: DeployResult) => {
    fs.writeFileSync(responseFile, JSON.stringify(result, null, 2));
  };

  // Resolve and validate context path — must stay within group folder
  const groupDir = resolveGroupFolderPath(groupFolder);
  const contextPath = path.resolve(groupDir, request.contextPath);
  if (
    !contextPath.startsWith(groupDir + path.sep) &&
    contextPath !== groupDir
  ) {
    writeResult({
      id: request.id,
      status: 'error',
      output: '',
      error: `contextPath "${request.contextPath}" escapes group folder`,
    });
    return;
  }

  if (!fs.existsSync(contextPath)) {
    writeResult({
      id: request.id,
      status: 'error',
      output: '',
      error: `contextPath "${request.contextPath}" does not exist`,
    });
    return;
  }

  logger.info(
    { groupFolder, image: request.image, contextPath },
    'Deploy requested',
  );

  let buildOutput = '';

  try {
    // docker build
    const dockerfileArg = request.dockerfile
      ? `-f "${path.join(contextPath, request.dockerfile)}"`
      : '';
    const buildCmd = `docker build ${dockerfileArg} -t "${request.image}" "${contextPath}" 2>&1`;
    logger.info({ cmd: buildCmd }, 'Running docker build');
    const { stdout: buildStdout } = await runCommand(buildCmd, 300_000);
    buildOutput = buildStdout.trim();
    logger.info(
      { groupFolder, image: request.image },
      'docker build succeeded',
    );

    // Stop existing container with same name before re-running
    if (request.containerName) {
      await runCommand(
        `docker rm -f "${request.containerName}" 2>/dev/null; true`,
        15_000,
      ).catch(() => {});
    }

    // docker run -d
    const portArgs = (request.ports ?? []).map((p) => `-p ${p}`).join(' ');
    const envArgs = Object.entries(request.env ?? {})
      .map(([k, v]) => `-e ${k}="${v}"`)
      .join(' ');
    const nameArg = request.containerName
      ? `--name "${request.containerName}"`
      : '';
    const runCmd = `docker run -d ${nameArg} ${portArgs} ${envArgs} "${request.image}" 2>&1`;
    logger.info({ cmd: runCmd }, 'Running docker run');
    const { stdout: runStdout } = await runCommand(runCmd, 60_000);
    const runOutput = runStdout.trim();

    writeResult({
      id: request.id,
      status: 'success',
      output: `=== docker build ===\n${buildOutput}\n\n=== docker run ===\n${runOutput}`,
    });
    logger.info(
      { groupFolder, image: request.image, container: runOutput.slice(0, 12) },
      'Deploy succeeded',
    );
  } catch (err: unknown) {
    const e = err as Error & { stdout?: string; stderr?: string };
    const extra = [e.stdout, e.stderr].filter(Boolean).join('\n');
    const output = [buildOutput, extra].filter(Boolean).join('\n');
    writeResult({
      id: request.id,
      status: 'error',
      output,
      error: e.message,
    });
    logger.error({ groupFolder, image: request.image, err }, 'Deploy failed');
  }
}
