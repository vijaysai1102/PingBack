import { homedir, tmpdir, userInfo } from 'node:os';
import { UnsupportedPlatformError } from '../utils/errors.js';
import { createWindowsPlatform } from './windows/index.js';
import { createMacosPlatform } from './macos/index.js';

export type PlatformId = 'windows' | 'macos';

export interface PlatformPaths {
  /** User configuration (config.json). */
  configDir: string;
  /** Mutable state such as the session store and daemon pid file. */
  dataDir: string;
  /** Local log files. */
  logDir: string;
}

export interface SoundCommand {
  command: string;
  args: string[];
}

export interface Platform {
  readonly id: PlatformId;
  readonly displayName: string;
  readonly paths: PlatformPaths;
  /**
   * Address passed to `net.connect` / `net.Server.listen`.
   * A named pipe on Windows, a Unix domain socket path on macOS.
   */
  readonly ipcEndpoint: string;
  /**
   * How to play a WAV file using only what ships with the OS, so users never
   * have to install an audio helper.
   */
  buildSoundCommand(filePath: string, volume: number): SoundCommand;
}

/**
 * Injectable view of the host so platform behavior is testable from either OS.
 */
export interface HostInfo {
  platform: string;
  env: Record<string, string | undefined>;
  homedir: string;
  tmpdir: string;
  uid: string;
}

function readUid(): string {
  try {
    const info = userInfo();
    return typeof info.uid === 'number' && info.uid >= 0
      ? String(info.uid)
      : info.username;
  } catch {
    return 'user';
  }
}

export function readHostInfo(): HostInfo {
  return {
    platform: process.platform,
    env: process.env,
    homedir: homedir(),
    tmpdir: tmpdir(),
    uid: readUid(),
  };
}

export function isSupportedPlatform(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin';
}

export function createPlatform(host: HostInfo = readHostInfo()): Platform {
  switch (host.platform) {
    case 'win32':
      return createWindowsPlatform(host);
    case 'darwin':
      return createMacosPlatform(host);
    default:
      throw new UnsupportedPlatformError(host.platform);
  }
}
