/**
 * Bridge invoked by AGY / Antigravity CLI hooks.
 *
 * Contract with AGY CLI:
 *  - reads hook payload as camelCase JSON on stdin
 *  - forwards it to the PingBack daemon over local IPC
 *  - always outputs valid JSON ({}) to stdout
 *  - always exits 0 and never surfaces errors
 */
import { createPlatform } from '../../platform/platform.js';
import { DaemonClient } from '../../core/daemon-client.js';
import { normalizeAGYHookPayload } from './normalize.js';
import type { AGYHookPayload } from './types.js';

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

function agyProcessId(): number | undefined {
  const ppid = process.ppid;
  return typeof ppid === 'number' && Number.isInteger(ppid) && ppid > 0
    ? ppid
    : undefined;
}

export async function runAGYHook(): Promise<void> {
  const raw = await readStdin();
  if (raw.trim().length === 0) return;

  let payload: AGYHookPayload;
  try {
    payload = JSON.parse(raw) as AGYHookPayload;
  } catch {
    return;
  }

  const normalized = normalizeAGYHookPayload(payload);
  if (normalized.kind === 'ignored') return;

  const client = new DaemonClient(createPlatform(), IPC_TIMEOUT_MS);
  const pid = agyProcessId();

  if (normalized.kind === 'session') {
    await client.sendSessionUpdate({ ...normalized.update, pid });
    return;
  }

  await client.sendEvent({ ...normalized.event, pid });
}

runAGYHook()
  .catch(() => {
    // Never surface errors to AGY CLI
  })
  .finally(() => {
    try {
      process.stdout.write('{}\n');
    } catch {
      // Ignore broken pipe on stdout
    }
    process.exitCode = 0;
  });
