import path from 'node:path';
import type { HostInfo, Platform, SoundCommand } from '../platform.js';

const APP_DIR = 'PingBack';

/**
 * Windows has no bundled CLI audio player, but PowerShell's SoundPlayer is
 * always present and plays a WAV without any extra install.
 *
 * Use an absolute path: the daemon may start with a thin PATH (service-like
 * launches, some IDE terminals) where bare `powershell.exe` resolves to ENOENT.
 */
function buildSoundCommand(filePath: string): SoundCommand {
  // Single quotes are the PowerShell literal-string delimiter; doubling
  // escapes any quote inside the path.
  const quoted = filePath.replace(/'/g, "''");
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
  const powershell = path.win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return {
    command: powershell,
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-Command',
      `(New-Object Media.SoundPlayer '${quoted}').PlaySync()`,
    ],
  };
}

export function createWindowsPlatform(host: HostInfo): Platform {
  const join = path.win32.join;

  const roaming = host.env.APPDATA ?? join(host.homedir, 'AppData', 'Roaming');
  const local = host.env.LOCALAPPDATA ?? join(host.homedir, 'AppData', 'Local');

  const configDir = join(roaming, APP_DIR);
  const dataDir = join(local, APP_DIR);

  return {
    id: 'windows',
    displayName: 'Windows',
    paths: {
      configDir,
      dataDir,
      logDir: join(dataDir, 'logs'),
    },
    // Named pipes are machine-global, so scope the name to the current user.
    ipcEndpoint: `\\\\.\\pipe\\pingback-${host.uid}`,
    buildSoundCommand,
  };
}
