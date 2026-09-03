import { DaemonClient } from '../../core/daemon-client.js';
import { startDaemon as startDetachedDaemon } from '../../core/daemon-starter.js';
import { createPlatform } from '../../platform/platform.js';
import { line, success } from '../output.js';

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

  const started = await startDetachedDaemon();
  if (started && options.quiet !== true) success('PingBack is running.');
  return started;
}

export async function runStart(): Promise<void> {
  await startDaemon();
}
