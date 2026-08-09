import { DaemonClient } from '../../core/daemon-client.js';
import { createPlatform } from '../../platform/platform.js';
import { line } from '../output.js';
import { formatNotRunning, formatRunningStatus } from '../status-view.js';

export async function runStatus(): Promise<void> {
  const platform = createPlatform();
  const client = new DaemonClient(platform, 2000);

  try {
    const status = await client.status();
    line(formatRunningStatus(status, Date.now()));
  } catch {
    // Any failure to reach the daemon means "not running" from the user's
    // point of view; diagnostics live in the daemon log.
    line(formatNotRunning(platform.displayName));
  }
}
