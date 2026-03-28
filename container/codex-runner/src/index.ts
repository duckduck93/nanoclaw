/**
 * NanoClaw Codex Runner
 * Runs inside a container, wraps @openai/codex CLI.
 * Same IPC protocol as gemini-runner.
 *
 * Input:  ContainerInput JSON via stdin
 * IPC:    Follow-up messages as JSON files in /workspace/ipc/input/
 *         Sentinel: /workspace/ipc/input/_close
 * Output: NANOCLAW_OUTPUT_START/END markers on stdout
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

interface ContainerInput {
  prompt: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  senderName?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  error?: string;
}

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(msg: string): void {
  console.error(`[codex-runner] ${msg}`);
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function shouldClose(): boolean {
  if (fs.existsSync(IPC_CLOSE_SENTINEL)) {
    try { fs.unlinkSync(IPC_CLOSE_SENTINEL); } catch { /* ignore */ }
    return true;
  }
  return false;
}

function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs.readdirSync(IPC_INPUT_DIR).filter(f => f.endsWith('.json')).sort();
    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { type: string; text: string };
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) { resolve(null); return; }
      const messages = drainIpcInput();
      if (messages.length > 0) { resolve(messages.join('\n')); return; }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

async function runCodex(prompt: string): Promise<string | null> {
  const model = process.env.CODEX_MODEL || 'codex-mini-latest';
  const resultFile = '/tmp/codex_result.txt';
  // codex exec: non-interactive, full-auto sandboxed mode
  // -o writes the final agent message to a file for clean extraction
  const args = ['exec', '--full-auto', '-m', model, '-o', resultFile, prompt];

  log(`Running codex exec (model: ${model})`);

  return new Promise((resolve) => {
    const proc = spawn('codex', args, {
      cwd: '/workspace/group',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line) log(`codex stdout: ${line.slice(0, 200)}`);
    });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (stderr.trim()) log(`codex stderr: ${stderr.slice(0, 500)}`);

      if (code !== 0) {
        log(`codex exited with code ${code}`);
        resolve(null);
        return;
      }

      try {
        const result = fs.readFileSync(resultFile, 'utf-8').trim();
        resolve(result || null);
      } catch (err) {
        log(`Failed to read result file: ${err}`);
        resolve(null);
      }
    });

    proc.on('error', (err: Error) => {
      log(`codex spawn error: ${err.message}`);
      resolve(null);
    });
  });
}

async function main(): Promise<void> {
  const stdinData = await readStdin();
  const input: ContainerInput = JSON.parse(stdinData);
  log(`Received input for group: ${input.groupFolder}`);

  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
  try { fs.unlinkSync(IPC_CLOSE_SENTINEL); } catch { /* ignore */ }

  let prompt = input.prompt;

  // Drain any pre-queued IPC messages into initial prompt
  const pending = drainIpcInput();
  if (pending.length > 0) {
    prompt += '\n' + pending.join('\n');
  }

  while (true) {
    const result = await runCodex(prompt);

    if (result === null) {
      writeOutput({ status: 'error', result: null, error: 'codex CLI failed' });
      process.exit(1);
    }

    writeOutput({ status: 'success', result });

    log(`Response sent (${result.length} chars). Waiting for next IPC message...`);

    const nextMessage = await waitForIpcMessage();
    if (nextMessage === null) {
      log('Close sentinel received, exiting');
      break;
    }

    log(`Got follow-up message (${nextMessage.length} chars)`);
    prompt = nextMessage;
  }
}

main().catch((err: Error) => {
  console.error('[codex-runner] Fatal error:', err);
  process.exit(1);
});
