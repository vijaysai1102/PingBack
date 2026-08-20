/**
 * Silent observer for Codex lifecycle hooks. In particular, PermissionRequest
 * must not receive a decision or stdout from this bridge: Codex keeps its
 * normal approval prompt when the hook produces no decision.
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

function codexProcessId(): number | undefined {
  const ppid = process.ppid;
  return typeof ppid === 'number' && Number.isInteger(ppid) && ppid > 0
    ? ppid
    : undefined;
}

export async function runCodexLifecycleHook(): Promise<void> {
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

runCodexLifecycleHook()
  .catch(() => {
    // Hooks are observers; failures must never interrupt Codex.
  })
  .finally(() => {
    process.exitCode = 0;
  });
