import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DaemonClient } from './daemon-client.js';
import { createPlatform } from '../platform/platform.js';
import { PingBackError } from '../utils/errors.js';

const READY_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;

function daemonEntryPoint(): string {
  const entry = fileURLToPath(new URL('../daemon/main.js', import.meta.url));
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

/** Starts the detached daemon and waits until it accepts local IPC requests. */
export async function startDaemon(): Promise<boolean> {
  const platform = createPlatform();
  const client = new DaemonClient(platform, 1500);

  if (await client.isRunning()) return false;

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
    if (await client.isRunning()) return true;
  }

  throw new PingBackError('PingBack daemon did not start in time.', {
    code: 'DAEMON_START_FAILED',
    hint: 'Check the daemon log, then try `pingback start` again.',
  });
}
