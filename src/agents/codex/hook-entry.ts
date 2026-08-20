/**
 * Bridge invoked by Codex CLI hooks.
 *
 * Contract with Codex CLI:
 *  - reads the hook payload as JSON on stdin
 *  - forwards it to the PingBack daemon over local IPC
 *  - always exits 0 and prints nothing to stdout
 *
 * Exiting non-zero or writing to stdout could disturb the user's interactive
 * session, so every failure path here is caught and swallowed.
 */
import { createPlatform } from '../../platform/platform.js';
import { DaemonClient } from '../../core/daemon-client.js';
import { normalizeCodexHookPayload } from './normalize.js';
import type { CodexHookPayload } from './types.js';

const STDIN_TIMEOUT_MS = 800;
const IPC_TIMEOUT_MS = 1200;

async function readStdin(): Promise<string> {
  return new Promise<string>((resolve) => {
    let data = '';
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(data);
    };

    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

export async function runCodexHook(): Promise<void> {
  const raw = await readStdin();
  if (raw.trim().length === 0) return;

  let payload: CodexHookPayload;
  try {
    payload = JSON.parse(raw) as CodexHookPayload;
  } catch {
    return;
  }

  const normalized = normalizeCodexHookPayload(payload);
  if (normalized.kind === 'ignored') return;

  const client = new DaemonClient(createPlatform(), IPC_TIMEOUT_MS);
  const pid = codexProcessId();

  if (normalized.kind === 'session') {
    await client.sendSessionUpdate({ ...normalized.update, pid });
    return;
  }

  await client.sendEvent({ ...normalized.event, pid });
}

function codexProcessId(): number | undefined {
  const ppid = process.ppid;
  return typeof ppid === 'number' && Number.isInteger(ppid) && ppid > 0
    ? ppid
    : undefined;
}

runCodexHook()
  .catch(() => {
    // Never surface an error to Codex CLI.
  })
  .finally(() => {
    process.exitCode = 0;
  });
