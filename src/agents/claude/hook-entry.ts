/**
 * Bridge invoked by Claude Code hooks.
 *
 * Contract with Claude Code:
 *  - reads the hook payload as JSON on stdin
 *  - forwards it to the PingBack daemon over local IPC
 *  - always exits 0 and prints nothing
 *
 * Exiting non-zero or writing to stdout could block or disturb the user's
 * session, so every failure path here is swallowed. If the daemon is not
 * running, the hook is a silent no-op.
 */
import { createPlatform } from '../../platform/platform.js';
import { DaemonClient } from '../../core/daemon-client.js';
import { normalizeHookPayload } from './normalize.js';
import type { ClaudeHookPayload } from './types.js';

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

export async function runHook(): Promise<void> {
  const raw = await readStdin();
  if (raw.trim().length === 0) return;

  let payload: ClaudeHookPayload;
  try {
    payload = JSON.parse(raw) as ClaudeHookPayload;
  } catch {
    return;
  }

  const normalized = normalizeHookPayload(payload);
  if (normalized.kind === 'ignored') return;

  const platform = createPlatform();
  const client = new DaemonClient(platform, IPC_TIMEOUT_MS);

  // Hook payloads carry no process id. Claude Code spawns this bridge directly
  // (exec form, no intervening shell), so the parent process is the Claude
  // session itself. Treated as best-effort diagnostic data only: session
  // identity always comes from session_id.
  const pid = claudeProcessId();
  if (normalized.kind === 'session') {
    await client.sendSessionUpdate({ ...normalized.update, pid });
    return;
  }

  await client.sendEvent({ ...normalized.event, pid });
}

function claudeProcessId(): number | undefined {
  const ppid = process.ppid;
  return typeof ppid === 'number' && Number.isInteger(ppid) && ppid > 0
    ? ppid
    : undefined;
}

runHook()
  .catch(() => {
    // Never surface an error to Claude Code.
  })
  .finally(() => {
    process.exitCode = 0;
  });
