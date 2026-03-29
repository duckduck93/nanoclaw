/**
 * Codex Container Runner for NanoClaw
 * Spawns nanoclaw-codex-agent containers per channel, mirrors gemini-container-runner.ts interface.
 */
import { ChildProcess, exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  GROUPS_DIR,
  CONTAINER_TIMEOUT,
  CONTAINER_MAX_OUTPUT_SIZE,
  TIMEZONE,
  ONECLI_URL,
} from './config.js';
import { logger } from './logger.js';
import {
  CONTAINER_RUNTIME_BIN,
  hostGatewayArgs,
  stopContainer,
} from './container-runtime.js';
import { readEnvFile } from './env.js';
import { OneCLI } from '@onecli-sh/sdk';
import { isRateLimitError } from './rate-limit.js';

const onecli = new OneCLI({ url: ONECLI_URL });

const CODEX_CONTAINER_IMAGE =
  process.env.CODEX_CONTAINER_IMAGE || 'nanoclaw-codex-agent:latest';

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

export interface CodexContainerInput {
  prompt: string;
  channelName: string;
  channelId: string;
  senderName?: string;
}

export interface CodexContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  error?: string;
  rateLimit?: boolean;
}

function sanitizeChannelName(name: string): string {
  return name.replace(/[^\w가-힣]/g, '_');
}

export function getCodexGroupDir(channelName: string): string {
  return path.join(GROUPS_DIR, `codex_${sanitizeChannelName(channelName)}`);
}

function getCodexIpcDir(channelName: string): string {
  return path.join(
    DATA_DIR,
    'ipc',
    `codex_${sanitizeChannelName(channelName)}`,
  );
}

async function buildArgs(
  channelName: string,
  containerName: string,
  codexModel: string,
  agentIdentifier: string,
): Promise<string[]> {
  const groupDir = getCodexGroupDir(channelName);
  const ipcDir = getCodexIpcDir(channelName);

  fs.mkdirSync(groupDir, { recursive: true });
  fs.mkdirSync(path.join(ipcDir, 'input'), { recursive: true });

  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  args.push('-e', `TZ=${TIMEZONE}`);
  // Dummy value so codex passes startup validation; OneCLI proxy injects the real key.
  args.push('-e', 'OPENAI_API_KEY=onecli-managed');
  args.push('-e', `CODEX_MODEL=${codexModel}`);
  args.push('-e', 'NPM_CONFIG_CACHE=/tmp/.npm');

  // OneCLI gateway injects Authorization: Bearer header for api.openai.com
  const onecliApplied = await onecli.applyContainerConfig(args, {
    addHostMapping: false,
    agent: agentIdentifier,
  });
  if (onecliApplied) {
    logger.info({ containerName }, 'OneCLI gateway config applied (Codex)');
  } else {
    logger.warn({ containerName }, 'OneCLI gateway not reachable — Codex container will use env key directly');
    // Fallback: use real key from env
    const envVars = readEnvFile(['CODEX_API_KEY']);
    const realKey = process.env.CODEX_API_KEY || envVars.CODEX_API_KEY || '';
    if (realKey) {
      const idx = args.indexOf('OPENAI_API_KEY=onecli-managed');
      if (idx !== -1) args[idx] = `OPENAI_API_KEY=${realKey}`;
    }
  }

  args.push(...hostGatewayArgs());

  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
    args.push('--user', `${hostUid}:${hostGid}`);
    args.push('-e', 'HOME=/home/node');
  }

  const dockerSocket = '/var/run/docker.sock';
  if (fs.existsSync(dockerSocket)) {
    args.push('-v', `${dockerSocket}:${dockerSocket}`);
  }

  args.push('-v', `${groupDir}:/workspace/group`);
  args.push('-v', `${ipcDir}:/workspace/ipc`);

  args.push(CODEX_CONTAINER_IMAGE);

  return args;
}

export async function runCodexContainerAgent(
  input: CodexContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput: (output: CodexContainerOutput) => Promise<void>,
): Promise<CodexContainerOutput> {
  const { channelName } = input;
  const startTime = Date.now();

  const envVars = readEnvFile(['CODEX_MODEL']);
  const codexModel =
    process.env.CODEX_MODEL || envVars.CODEX_MODEL || 'codex-mini-latest';

  const safeName = `codex_${sanitizeChannelName(channelName)}`.replace(
    /[^a-zA-Z0-9-]/g,
    '-',
  );
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const agentIdentifier = `codex-${sanitizeChannelName(channelName).toLowerCase().replace(/_/g, '-')}`;

  const containerArgs = await buildArgs(
    channelName,
    containerName,
    codexModel,
    agentIdentifier,
  );

  const containerInput = {
    prompt: input.prompt,
    groupFolder: `codex_${sanitizeChannelName(channelName)}`,
    chatJid: input.channelId,
    isMain: false,
    senderName: input.senderName,
  };

  const logsDir = path.join(getCodexGroupDir(channelName), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  logger.info({ channelName, containerName }, 'Spawning Codex container agent');

  return new Promise((resolve) => {
    const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let outputChain = Promise.resolve();

    container.stdin.write(JSON.stringify(containerInput));
    container.stdin.end();

    let parseBuffer = '';

    container.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();

      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
        } else {
          stdout += chunk;
        }
      }

      parseBuffer += chunk;
      let startIdx: number;
      while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
        const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
        if (endIdx === -1) break;

        const jsonStr = parseBuffer
          .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
          .trim();
        parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

        try {
          const parsed: CodexContainerOutput = JSON.parse(jsonStr);
          resetTimeout();
          outputChain = outputChain.then(() => onOutput(parsed));
        } catch (err) {
          logger.warn(
            { channelName, err },
            'Failed to parse Codex output chunk',
          );
        }
      }
    });

    container.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      for (const line of chunk.trim().split('\n')) {
        if (line) logger.debug({ container: channelName }, line);
      }
      stderr += chunk.slice(0, CONTAINER_MAX_OUTPUT_SIZE - stderr.length);
    });

    let timedOut = false;
    const timeoutMs = CONTAINER_TIMEOUT;

    const killOnTimeout = () => {
      timedOut = true;
      logger.error({ channelName, containerName }, 'Codex container timeout');
      exec(stopContainer(containerName), { timeout: 15000 }, (err) => {
        if (err) container.kill('SIGKILL');
      });
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    container.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        resolve({
          status: 'error',
          result: null,
          error: `Codex container timed out after ${timeoutMs}ms`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(
        path.join(logsDir, `container-${timestamp}.log`),
        `Group: codex_${channelName}\nDuration: ${duration}ms\nExit: ${code}\n\nStderr:\n${stderr}`,
      );

      if (code !== 0) {
        if (isRateLimitError(stderr)) {
          logger.warn({ channelName }, 'Codex rate limit detected');
          resolve({ status: 'error', result: null, rateLimit: true, error: 'Rate limited by API' });
          return;
        }

        logger.error(
          { channelName, code, duration },
          'Codex container exited with error',
        );
        resolve({
          status: 'error',
          result: null,
          error: `Container exited with code ${code}`,
        });
        return;
      }

      outputChain.then(() => {
        logger.info({ channelName, duration }, 'Codex container completed');
        resolve({ status: 'success', result: null });
      });
    });

    container.on('error', (err: Error) => {
      clearTimeout(timeout);
      logger.error(
        { channelName, containerName, err },
        'Codex container spawn error',
      );
      resolve({ status: 'error', result: null, error: err.message });
    });
  });
}

/**
 * Send a follow-up IPC message to a running Codex container.
 */
export function sendCodexIpcMessage(channelName: string, text: string): void {
  const ipcDir = path.join(getCodexIpcDir(channelName), 'input');
  fs.mkdirSync(ipcDir, { recursive: true });
  const filename = `${Date.now()}.json`;
  fs.writeFileSync(
    path.join(ipcDir, filename),
    JSON.stringify({ type: 'message', text }),
  );
}

/**
 * Send a close sentinel to stop a running Codex container's IPC loop.
 */
export function sendCodexIpcClose(channelName: string): void {
  const ipcDir = path.join(getCodexIpcDir(channelName), 'input');
  fs.mkdirSync(ipcDir, { recursive: true });
  fs.writeFileSync(path.join(ipcDir, '_close'), '');
}
