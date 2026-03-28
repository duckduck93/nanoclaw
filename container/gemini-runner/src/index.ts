/**
 * NanoClaw Gemini Runner
 * Runs inside a container, wraps gemini-cli.
 * Same IPC protocol as agent-runner.
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
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  senderName?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface GeminiJsonOutput {
  session_id: string;
  response: string;
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
  console.error(`[gemini-runner] ${msg}`);
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

async function runGemini(
  prompt: string,
  sessionId?: string,
): Promise<{ response: string; sessionId: string } | null> {
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const args = ['--yolo', '--output-format', 'json', '--model', model, '-p', prompt];
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  log(`Running gemini (session: ${sessionId || 'new'}, model: ${model})`);

  return new Promise((resolve) => {
    const proc = spawn('gemini', args, {
      cwd: '/workspace/group',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (stderr.trim()) log(`gemini stderr: ${stderr.slice(0, 500)}`);

      if (code !== 0) {
        log(`gemini exited with code ${code}`);
        resolve(null);
        return;
      }

      try {
        // gemini may emit non-JSON lines; find the JSON object
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          log(`No JSON in gemini output: ${stdout.slice(0, 200)}`);
          resolve(null);
          return;
        }
        const parsed = JSON.parse(jsonMatch[0]) as GeminiJsonOutput;
        resolve({ response: parsed.response || '', sessionId: parsed.session_id });
      } catch (err) {
        log(`Failed to parse gemini output: ${err}`);
        resolve(null);
      }
    });

    proc.on('error', (err: Error) => {
      log(`gemini spawn error: ${err.message}`);
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

  let sessionId = input.sessionId;
  let prompt = input.prompt;

  // Drain any pre-queued IPC messages into initial prompt
  const pending = drainIpcInput();
  if (pending.length > 0) {
    prompt += '\n' + pending.join('\n');
  }

  while (true) {
    const result = await runGemini(prompt, sessionId);

    if (!result) {
      writeOutput({ status: 'error', result: null, error: 'gemini-cli failed' });
      process.exit(1);
    }

    sessionId = result.sessionId;

    writeOutput({ status: 'success', result: result.response, newSessionId: sessionId });

    log(`Response sent (${result.response.length} chars). Waiting for next IPC message...`);

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
  console.error('[gemini-runner] Fatal error:', err);
  process.exit(1);
});
