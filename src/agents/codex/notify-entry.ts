/**
 * Bridge invoked by Codex CLI's documented `notify` command.
 *
 * Codex provides a reliable turn-complete signal only. The bridge forwards it
 * over local IPC and forwards the untouched payload to any command PingBack
 * replaced during setup, so existing user configuration keeps working.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { createPlatform } from '../../platform/platform.js';
import { DaemonClient } from '../../core/daemon-client.js';
import { readJsonFile } from '../../utils/json-file.js';
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

function originalNotifyCommand(): string[] | undefined {
  const statePath = path.join(homedir(), '.codex', 'pingback-notify.json');
  const result = readJsonFile(statePath);
  if (!result.ok || typeof result.value !== 'object' || result.value === null)
    return undefined;

  const command = (result.value as { originalNotify?: unknown }).originalNotify;
  return Array.isArray(command) &&
    command.length > 0 &&
    command.every((part) => typeof part === 'string')
    ? command
    : undefined;
}

function forwardOriginalNotify(raw: string): void {
  const command = originalNotifyCommand();
  if (command === undefined) return;
  const [executable, ...args] = command;
  if (executable === undefined || executable.length === 0) return;

  try {
    const child = spawn(executable, args, {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
    child.stdin.end(raw);
    child.unref();
  } catch {
    // Existing notifications are best-effort; never interrupt Codex itself.
  }
}

function codexProcessId(): number | undefined {
  const ppid = process.ppid;
  return typeof ppid === 'number' && Number.isInteger(ppid) && ppid > 0
    ? ppid
    : undefined;
}

export async function runCodexNotify(): Promise<void> {
  const raw = await readStdin();
  if (raw.trim().length === 0) return;

  try {
    const payload = JSON.parse(raw) as CodexHookPayload;
    const normalized = normalizeCodexHookPayload(payload);
    if (normalized.kind === 'event') {
      const client = new DaemonClient(createPlatform(), IPC_TIMEOUT_MS);
      await client.sendEvent({ ...normalized.event, pid: codexProcessId() });
    }
  } finally {
    forwardOriginalNotify(raw);
  }
}

runCodexNotify()
  .catch(() => {
    // Never surface failures to Codex CLI.
  })
  .finally(() => {
    process.exitCode = 0;
  });
