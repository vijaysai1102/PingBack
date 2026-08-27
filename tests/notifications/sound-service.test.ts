import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NullSoundPlayer,
  SoundService,
  defaultSoundFile,
  scalePcm16Wave,
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

function pcmWave(sample: number): Buffer {
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0, 'ascii');
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(2, 40);
  wav.writeInt16LE(sample, 44);
  return wav;
}

describe('platform sound commands', () => {
  it('uses PowerShell SoundPlayer on Windows', () => {
    const command = createPlatform(windowsHost).buildSoundCommand(
      'C:\\a\\attention.wav',
      1,
    );

    expect(command.command.toLowerCase()).toMatch(/powershell\.exe$/);
    expect(command.command).toMatch(/WindowsPowerShell/i);
    expect(command.args.join(' ')).toContain('Media.SoundPlayer');
    expect(command.args.join(' ')).toContain('C:\\a\\attention.wav');
  });

  it('escapes single quotes in a Windows path', () => {
    const command = createPlatform(windowsHost).buildSoundCommand("C:\\it's\\a.wav", 1);
    expect(command.args.join(' ')).toContain("it''s");
  });

  it('passes the configured volume to afplay on macOS', () => {
    const command = createPlatform(macosHost).buildSoundCommand('/a/attention.wav', 0.4);

    expect(command.command).toBe('/usr/bin/afplay');
    expect(command.args).toEqual(['-v', '0.4', '/a/attention.wav']);
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
  it('scales generated 16-bit PCM WAV samples for Windows volume control', () => {
    const wav = Buffer.alloc(48);
    wav.write('RIFF', 0, 'ascii');
    wav.write('WAVE', 8, 'ascii');
    wav.write('fmt ', 12, 'ascii');
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'ascii');
    wav.writeUInt32LE(4, 40);
    wav.writeInt16LE(10_000, 44);
    wav.writeInt16LE(-10_000, 46);

    const adjusted = scalePcm16Wave(wav, 0.5);

    expect(adjusted.readInt16LE(44)).toBe(5_000);
    expect(adjusted.readInt16LE(46)).toBe(-5_000);
  });

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

  it('uses a scaled temporary WAV for a reduced Windows volume', async () => {
    const source = path.join(dir, 'attention.wav');
    writeFileSync(source, pcmWave(10_000));
    let playedSample: number | undefined;
    const platform = {
      ...createPlatform(windowsHost),
      buildSoundCommand(filePath: string) {
        playedSample = readFileSync(filePath).readInt16LE(44);
        return { command: process.execPath, args: ['-e', ''] };
      },
    };
    const service = new SoundService({ platform, resolveFile: () => source });

    await service.play('attention', 0.5);

    expect(playedSample).toBe(5_000);
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
    await expect(player.play('attention', 1)).resolves.toBeUndefined();
  });
});
