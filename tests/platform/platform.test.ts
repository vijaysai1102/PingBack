import { describe, expect, it } from 'vitest';
import {
  createPlatform,
  isSupportedPlatform,
  readHostInfo,
  type HostInfo,
} from '../../src/platform/platform.js';
import { UnsupportedPlatformError } from '../../src/utils/errors.js';

function windowsHost(overrides: Partial<HostInfo> = {}): HostInfo {
  return {
    platform: 'win32',
    env: {
      APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
    },
    homedir: 'C:\\Users\\dev',
    tmpdir: 'C:\\Temp',
    uid: 'dev',
    ...overrides,
  };
}

function macosHost(overrides: Partial<HostInfo> = {}): HostInfo {
  return {
    platform: 'darwin',
    env: {},
    homedir: '/Users/dev',
    tmpdir: '/var/folders/t1',
    uid: '501',
    ...overrides,
  };
}

describe('isSupportedPlatform', () => {
  it('accepts only Windows and macOS', () => {
    expect(isSupportedPlatform('win32')).toBe(true);
    expect(isSupportedPlatform('darwin')).toBe(true);
    expect(isSupportedPlatform('linux')).toBe(false);
    expect(isSupportedPlatform('freebsd')).toBe(false);
  });
});

describe('createPlatform on Windows', () => {
  it('derives config and data directories from the standard env vars', () => {
    const platform = createPlatform(windowsHost());

    expect(platform.id).toBe('windows');
    expect(platform.displayName).toBe('Windows');
    expect(platform.paths.configDir).toBe('C:\\Users\\dev\\AppData\\Roaming\\PingBack');
    expect(platform.paths.dataDir).toBe('C:\\Users\\dev\\AppData\\Local\\PingBack');
    expect(platform.paths.logDir).toBe('C:\\Users\\dev\\AppData\\Local\\PingBack\\logs');
  });

  it('falls back to the home directory when APPDATA is missing', () => {
    const platform = createPlatform(windowsHost({ env: {} }));

    expect(platform.paths.configDir).toBe('C:\\Users\\dev\\AppData\\Roaming\\PingBack');
    expect(platform.paths.dataDir).toBe('C:\\Users\\dev\\AppData\\Local\\PingBack');
  });

  it('scopes the named pipe to the current user', () => {
    const platform = createPlatform(windowsHost());
    expect(platform.ipcEndpoint).toBe('\\\\.\\pipe\\pingback-dev');
  });
});

describe('createPlatform on macOS', () => {
  it('uses Application Support and Logs directories', () => {
    const platform = createPlatform(macosHost());

    expect(platform.id).toBe('macos');
    expect(platform.displayName).toBe('macOS');
    expect(platform.paths.configDir).toBe(
      '/Users/dev/Library/Application Support/PingBack',
    );
    expect(platform.paths.dataDir).toBe(
      '/Users/dev/Library/Application Support/PingBack',
    );
    expect(platform.paths.logDir).toBe('/Users/dev/Library/Logs/PingBack');
  });

  it('places the Unix socket in the temp directory to stay within the length limit', () => {
    const platform = createPlatform(macosHost());

    expect(platform.ipcEndpoint).toBe('/var/folders/t1/pingback-501.sock');
    expect(platform.ipcEndpoint.length).toBeLessThan(104);
  });

  it('never emits Windows path separators', () => {
    const platform = createPlatform(macosHost());
    expect(platform.paths.configDir).not.toContain('\\');
  });
});

describe('createPlatform on unsupported platforms', () => {
  it('throws a typed error for Linux', () => {
    expect(() => createPlatform(macosHost({ platform: 'linux' }))).toThrow(
      UnsupportedPlatformError,
    );
  });

  it('names the offending platform in the message', () => {
    expect(() => createPlatform(macosHost({ platform: 'linux' }))).toThrow(/linux/);
  });
});

describe('readHostInfo', () => {
  it('reports the real host without throwing', () => {
    const host = readHostInfo();
    expect(host.platform).toBe(process.platform);
    expect(host.homedir.length).toBeGreaterThan(0);
    expect(host.uid.length).toBeGreaterThan(0);
  });
});
