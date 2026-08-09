import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DaemonClient } from '../../core/daemon-client.js';
import { createPlatform } from '../../platform/platform.js';
import { PingBackError } from '../../utils/errors.js';
import { line, success } from '../output.js';

const READY_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;

function daemonEntryPoint(): string {
  const entry = fileURLToPath(new URL('../../daemon/main.js', import.meta.url));
  if (!existsSync(entry)) {
    throw new PingBackError('The PingBack daemon build is missing.', {
      code: 'DAEMON_START_FAILED',
      hint: 'Reinstall PingBack with `npm install -g pingback-cli`.',
    });
  }
  return entry;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Launches the daemon detached from the current terminal so it keeps running
 * after the shell exits, then waits until it answers on the socket.
 */
export async function startDaemon(options: { quiet?: boolean } = {}): Promise<boolean> {
  const platform = createPlatform();
  const client = new DaemonClient(platform, 1500);

  if (await client.isRunning()) {
    if (options.quiet !== true) line('PingBack is already running.');
    return false;
  }

  // A dead daemon leaves its record behind; clear it so status stays truthful.
  client.state.clearRecord();

  const child = spawn(process.execPath, [daemonEntryPoint()], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    if (await client.isRunning()) {
      if (options.quiet !== true) success('PingBack is running.');
      return true;
    }
  }

  throw new PingBackError('PingBack daemon did not start in time.', {
    code: 'DAEMON_START_FAILED',
    hint: 'Check the daemon log, then try `pingback start` again.',
  });
}

export async function runStart(): Promise<void> {
  await startDaemon();
}
