import path from 'node:path';
import type { HostInfo, Platform, SoundCommand } from '../platform.js';

const APP_DIR = 'PingBack';

/** `afplay` ships with macOS, so no extra dependency is needed for sound. */
function buildSoundCommand(filePath: string): SoundCommand {
  return { command: '/usr/bin/afplay', args: [filePath] };
}

export function createMacosPlatform(host: HostInfo): Platform {
  const join = path.posix.join;

  const base = join(host.homedir, 'Library', 'Application Support', APP_DIR);

  return {
    id: 'macos',
    displayName: 'macOS',
    paths: {
      configDir: base,
      dataDir: base,
      logDir: join(host.homedir, 'Library', 'Logs', APP_DIR),
    },
    // Kept in the temp dir: Unix socket paths are limited to ~104 bytes on macOS,
    // and the socket is recreated by the daemon on every start.
    ipcEndpoint: join(host.tmpdir, `pingback-${host.uid}.sock`),
    buildSoundCommand,
  };
}
