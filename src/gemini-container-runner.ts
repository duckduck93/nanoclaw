/**
 * Gemini Container Runner for NanoClaw
 * Spawns nanoclaw-gemini-agent containers per channel, mirrors container-runner.ts interface.
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

const GEMINI_CONTAINER_IMAGE =
  process.env.GEMINI_CONTAINER_IMAGE || 'nanoclaw-gemini-agent:latest';

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

export interface GeminiContainerInput {
  prompt: string;
  sessionId?: string;
  channelName: string; // human-readable, used for group dir name
  channelId: string;
  senderName?: string;
}

export interface GeminiContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
  rateLimit?: boolean;
}

function sanitizeChannelName(name: string): string {
  return name.replace(/[^\w가-힣]/g, '_');
}

export function getGeminiGroupDir(channelName: string): string {
  return path.join(GROUPS_DIR, `gemini_${sanitizeChannelName(channelName)}`);
}

function getGeminiSessionsDir(channelName: string): string {
  return path.join(
    DATA_DIR,
    'sessions',
    `gemini_${sanitizeChannelName(channelName)}`,
    '.gemini',
  );
}

function getGeminiIpcDir(channelName: string): string {
  return path.join(
    DATA_DIR,
    'ipc',
    `gemini_${sanitizeChannelName(channelName)}`,
  );
}

function getGeminiSessionIdPath(channelName: string): string {
  return path.join(
    DATA_DIR,
    'sessions',
    `gemini_${sanitizeChannelName(channelName)}`,
    'session_id',
  );
}

export function loadGeminiSessionId(channelName: string): string | undefined {
  try {
    return (
      fs.readFileSync(getGeminiSessionIdPath(channelName), 'utf-8').trim() ||
      undefined
    );
  } catch {
    return undefined;
  }
}

export function saveGeminiSessionId(
  channelName: string,
  sessionId: string,
): void {
  const p = getGeminiSessionIdPath(channelName);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, sessionId, 'utf-8');
}

async function buildArgs(
  channelName: string,
  containerName: string,
  geminiModel: string,
  agentIdentifier: string,
): Promise<string[]> {
  const groupDir = getGeminiGroupDir(channelName);
  const sessionsDir = getGeminiSessionsDir(channelName);
  const ipcDir = getGeminiIpcDir(channelName);

  fs.mkdirSync(groupDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(path.join(ipcDir, 'input'), { recursive: true });

  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  args.push('-e', `TZ=${TIMEZONE}`);
  // Dummy value so gemini-cli passes startup validation; OneCLI proxy injects the real key.
  args.push('-e', 'GEMINI_API_KEY=onecli-managed');
  args.push('-e', `GEMINI_MODEL=${geminiModel}`);
  // npm cache must be writable by the host uid (not /home/node/.npm which is owned by node:1000)
  args.push('-e', 'NPM_CONFIG_CACHE=/tmp/.npm');

  // OneCLI gateway injects x-goog-api-key header for generativelanguage.googleapis.com
  const onecliApplied = await onecli.applyContainerConfig(args, {
    addHostMapping: false,
    agent: agentIdentifier,
  });
  if (onecliApplied) {
    logger.info({ containerName }, 'OneCLI gateway config applied (Gemini)');
  } else {
    logger.warn({ containerName }, 'OneCLI gateway not reachable — Gemini container will use env key directly');
    // Fallback: use real key from env
    const envVars = readEnvFile(['GEMINI_API_KEY']);
    const realKey = process.env.GEMINI_API_KEY || envVars.GEMINI_API_KEY || '';
    if (realKey) {
      // Replace dummy with real key
      const idx = args.indexOf('GEMINI_API_KEY=onecli-managed');
      if (idx !== -1) args[idx] = `GEMINI_API_KEY=${realKey}`;
    }
  }

  // Runtime-specific args for host gateway resolution
  args.push(...hostGatewayArgs());

  // Run as host user
  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
    args.push('--user', `${hostUid}:${hostGid}`);
    args.push('-e', 'HOME=/home/node');
  }

  // SECURITY NOTE: Docker socket is mounted to allow the agent to build and deploy
  // service containers directly on the host. This gives the container full Docker
  // control (root-equivalent on the host Docker daemon).
  // TODO: Replace with an MCP deploy tool when tighter access control is needed
  //       (e.g. multi-user, production environment, or restricted deploy targets).
  const dockerSocket = '/var/run/docker.sock';
  if (fs.existsSync(dockerSocket)) {
    args.push('-v', `${dockerSocket}:${dockerSocket}`);
  }

  // Group workspace (CWD inside container — gemini-cli reads GEMINI.md from here)
  args.push('-v', `${groupDir}:/workspace/group`);

  // Per-channel gemini sessions (isolated)
  args.push('-v', `${sessionsDir}:/home/node/.gemini`);

  // IPC directory
  args.push('-v', `${ipcDir}:/workspace/ipc`);

  args.push(GEMINI_CONTAINER_IMAGE);

  return args;
}

export async function runGeminiContainerAgent(
  input: GeminiContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput: (output: GeminiContainerOutput) => Promise<void>,
): Promise<GeminiContainerOutput> {
  const { channelName } = input;
  const startTime = Date.now();

  const envVars = readEnvFile(['GEMINI_MODEL']);
  const geminiModel =
    process.env.GEMINI_MODEL || envVars.GEMINI_MODEL || 'gemini-2.0-flash';

  const safeName = `gemini_${sanitizeChannelName(channelName)}`.replace(
    /[^a-zA-Z0-9-]/g,
    '-',
  );
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const agentIdentifier = `gemini-${sanitizeChannelName(channelName).toLowerCase().replace(/_/g, '-')}`;

  const containerArgs = await buildArgs(
    channelName,
    containerName,
    geminiModel,
    agentIdentifier,
  );

  const containerInput = {
    prompt: input.prompt,
    sessionId: input.sessionId,
    groupFolder: `gemini_${sanitizeChannelName(channelName)}`,
    chatJid: input.channelId,
    isMain: false,
    senderName: input.senderName,
  };

  const logsDir = path.join(getGeminiGroupDir(channelName), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  logger.info(
    { channelName, containerName },
    'Spawning Gemini container agent',
  );

  return new Promise((resolve) => {
    const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let newSessionId: string | undefined;
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
          const parsed: GeminiContainerOutput = JSON.parse(jsonStr);
          if (parsed.newSessionId) newSessionId = parsed.newSessionId;
          resetTimeout();
          outputChain = outputChain.then(() => onOutput(parsed));
        } catch (err) {
          logger.warn(
            { channelName, err },
            'Failed to parse Gemini output chunk',
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
      logger.error({ channelName, containerName }, 'Gemini container timeout');
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
          error: `Gemini container timed out after ${timeoutMs}ms`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(
        path.join(logsDir, `container-${timestamp}.log`),
        `Group: gemini_${channelName}\nDuration: ${duration}ms\nExit: ${code}\n\nStderr:\n${stderr}`,
      );

      if (code !== 0) {
        if (isRateLimitError(stderr)) {
          logger.warn({ channelName }, 'Gemini rate limit detected');
          resolve({ status: 'error', result: null, rateLimit: true, error: 'Rate limited by API' });
          return;
        }

        logger.error(
          { channelName, code, duration },
          'Gemini container exited with error',
        );
        resolve({
          status: 'error',
          result: null,
          error: `Container exited with code ${code}`,
        });
        return;
      }

      outputChain.then(() => {
        logger.info(
          { channelName, duration, newSessionId },
          'Gemini container completed',
        );
        resolve({ status: 'success', result: null, newSessionId });
      });
    });

    container.on('error', (err: Error) => {
      clearTimeout(timeout);
      logger.error(
        { channelName, containerName, err },
        'Gemini container spawn error',
      );
      resolve({ status: 'error', result: null, error: err.message });
    });
  });
}

/**
 * Send a follow-up IPC message to a running Gemini container.
 */
export function sendGeminiIpcMessage(channelName: string, text: string): void {
  const ipcDir = path.join(getGeminiIpcDir(channelName), 'input');
  fs.mkdirSync(ipcDir, { recursive: true });
  const filename = `${Date.now()}.json`;
  fs.writeFileSync(
    path.join(ipcDir, filename),
    JSON.stringify({ type: 'message', text }),
  );
}

/**
 * Send a close sentinel to stop a running Gemini container's IPC loop.
 */
export function sendGeminiIpcClose(channelName: string): void {
  const ipcDir = path.join(getGeminiIpcDir(channelName), 'input');
  fs.mkdirSync(ipcDir, { recursive: true });
  fs.writeFileSync(path.join(ipcDir, '_close'), '');
}
