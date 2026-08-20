import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agyConfigDir,
  agyHomeDir,
  agyHooksPath,
  detectAGY,
  findAGYExecutable,
} from '../../../src/agents/agy/detector.js';
import type { HostInfo } from '../../../src/platform/platform.js';

let dir: string;

function host(overrides: Partial<HostInfo> = {}): HostInfo {
  return {
    platform: process.platform,
    env: {},
    homedir: dir,
    tmpdir: dir,
    uid: 'dev',
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-agy-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('agy paths', () => {
  it('points at config and hooks paths', () => {
    expect(agyHomeDir(dir)).toBe(path.join(dir, '.gemini'));
    expect(agyConfigDir(dir)).toBe(path.join(dir, '.gemini', 'config'));
    expect(agyHooksPath(dir)).toBe(path.join(dir, '.gemini', 'config', 'hooks.json'));
  });

  it('prefers existing .agy directory if present', () => {
    const agyDir = path.join(dir, '.agy');
    mkdirSync(agyDir, { recursive: true });
    expect(agyHomeDir(dir)).toBe(agyDir);
  });
});

describe('findAGYExecutable', () => {
  it('finds agy launcher on PATH', () => {
    const binDir = path.join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const name = process.platform === 'win32' ? 'agy.exe' : 'agy';
    writeFileSync(path.join(binDir, name), '');

    const separator = process.platform === 'win32' ? ';' : ':';
    const found = findAGYExecutable(
      host({ env: { PATH: [path.join(dir, 'other'), binDir].join(separator) } }),
    );

    expect(found).toBe(path.join(binDir, name));
  });

  it('finds legacy gemini launcher on PATH', () => {
    const binDir = path.join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const name = process.platform === 'win32' ? 'gemini.cmd' : 'gemini';
    writeFileSync(path.join(binDir, name), '');

    const separator = process.platform === 'win32' ? ';' : ':';
    const found = findAGYExecutable(host({ env: { PATH: [binDir].join(separator) } }));

    expect(found).toBe(path.join(binDir, name));
  });

  it('returns undefined when launcher is absent', () => {
    expect(findAGYExecutable(host({ env: { PATH: dir } }))).toBeUndefined();
  });
});

describe('detectAGY', () => {
  it('detects AGY via home directory', () => {
    mkdirSync(path.join(dir, '.gemini'), { recursive: true });
    const detection = detectAGY(host());

    expect(detection.installed).toBe(true);
    expect(detection.location).toContain('.gemini');
  });

  it('reports not installed when neither executable nor home exists', () => {
    expect(detectAGY(host()).installed).toBe(false);
  });
});
