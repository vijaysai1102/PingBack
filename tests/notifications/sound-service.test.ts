import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NullSoundPlayer,
  SoundService,
  defaultSoundFile,
  type SoundName,
} from '../../src/notifications/sound-service.js';
import { createPlatform, type HostInfo } from '../../src/platform/platform.js';

const windowsHost: HostInfo = {
  platform: 'win32',
  env: { APPDATA: 'C:\\r', LOCALAPPDATA: 'C:\\l' },
  homedir: 'C:\\Users\\dev',
  tmpdir: 'C:\\Temp',
  uid: 'dev',
};

const macosHost: HostInfo = {
  platform: 'darwin',
  env: {},
  homedir: '/Users/dev',
  tmpdir: '/tmp',
  uid: '501',
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-sound-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFakeSound(name: SoundName): string {
  const file = path.join(dir, `${name}.wav`);
  writeFileSync(file, 'RIFF');
  return file;
}

describe('platform sound commands', () => {
  it('uses PowerShell SoundPlayer on Windows', () => {
    const command = createPlatform(windowsHost).buildSoundCommand('C:\\a\\attention.wav');

    expect(command.command).toBe('powershell.exe');
    expect(command.args.join(' ')).toContain('Media.SoundPlayer');
    expect(command.args.join(' ')).toContain('C:\\a\\attention.wav');
  });

  it('escapes single quotes in a Windows path', () => {
    const command = createPlatform(windowsHost).buildSoundCommand("C:\\it's\\a.wav");
    expect(command.args.join(' ')).toContain("it''s");
  });

  it('uses afplay on macOS', () => {
    const command = createPlatform(macosHost).buildSoundCommand('/a/attention.wav');

    expect(command.command).toBe('/usr/bin/afplay');
    expect(command.args).toEqual(['/a/attention.wav']);
  });
});

describe('defaultSoundFile', () => {
  it('resolves each bundled sound under assets/sounds', () => {
    for (const name of ['attention', 'completion', 'error'] as SoundName[]) {
      const file = defaultSoundFile(name);
      expect(file).toContain(path.join('assets', 'sounds'));
      expect(file.endsWith(`${name}.wav`)).toBe(true);
    }
  });
});

describe('SoundService', () => {
  it('reports availability from the attention asset', () => {
    const platform = createPlatform(macosHost);

    const missing = new SoundService({
      platform,
      resolveFile: () => path.join(dir, 'nope.wav'),
    });
    expect(missing.isAvailable()).toBe(false);

    writeFakeSound('attention');
    const present = new SoundService({
      platform,
      resolveFile: (name) => path.join(dir, `${name}.wav`),
    });
    expect(present.isAvailable()).toBe(true);
  });

  it('resolves quietly when the asset is missing', async () => {
    const service = new SoundService({
      platform: createPlatform(macosHost),
      resolveFile: () => path.join(dir, 'missing.wav'),
    });

    await expect(service.play('attention')).resolves.toBeUndefined();
  });

  it('resolves even when the player binary does not exist', async () => {
    writeFakeSound('attention');
    const platform = {
      ...createPlatform(macosHost),
      buildSoundCommand: () => ({
        command: path.join(dir, 'definitely-not-a-real-binary'),
        args: [],
      }),
    };

    const service = new SoundService({
      platform,
      resolveFile: (name) => path.join(dir, `${name}.wav`),
    });

    await expect(service.play('attention')).resolves.toBeUndefined();
  });

  it('plays a real bundled sound through the host player', async () => {
    // Uses the actual OS player, so it only runs on the supported platforms.
    if (process.platform !== 'win32' && process.platform !== 'darwin') return;

    const service = new SoundService({ platform: createPlatform(), timeoutMs: 8000 });
    expect(service.isAvailable()).toBe(true);
    await expect(service.play('attention')).resolves.toBeUndefined();
  }, 15_000);
});

describe('NullSoundPlayer', () => {
  it('is never available and never plays', async () => {
    const player = new NullSoundPlayer();

    expect(player.isAvailable()).toBe(false);
    await expect(player.play()).resolves.toBeUndefined();
  });
});
