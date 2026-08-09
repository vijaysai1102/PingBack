import { DaemonClient } from '../../core/daemon-client.js';
import { isProcessAlive } from '../../core/daemon-state.js';
import { createPlatform } from '../../platform/platform.js';
import { line, success } from '../output.js';

const STOP_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 100;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runStop(): Promise<void> {
  const platform = createPlatform();
  const client = new DaemonClient(platform, 1500);
  const record = client.state.readLiveRecord();

  if (!(await client.isRunning())) {
    client.state.clearRecord();
    line('PingBack daemon is not running.');
    return;
  }

  try {
    await client.shutdown();
  } catch {
    // The daemon may close the socket before acknowledging; fall through to
    // the liveness check below rather than reporting a failure.
  }

  const pid = record?.pid;
  const deadline = Date.now() + STOP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    const stillRunning =
      pid === undefined ? await client.isRunning() : isProcessAlive(pid);
    if (!stillRunning) {
      client.state.clearRecord();
      success('PingBack stopped.');
      return;
    }
  }

  // Graceful shutdown did not take effect; terminate the recorded process.
  if (pid !== undefined && isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone between the check and the signal.
    }
  }

  client.state.clearRecord();
  success('PingBack stopped.');
}
