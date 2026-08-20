import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  codexConfigPath,
  codexHomeDir,
  codexHooksPath,
  detectCodex,
  findCodexExecutable,
} from '../../../src/agents/codex/detector.js';
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
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-codex-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('codex paths', () => {
  it('points at ~/.codex directory and files', () => {
    expect(codexHomeDir('/Users/dev')).toBe(path.join('/Users/dev', '.codex'));
    expect(codexHooksPath('/Users/dev')).toBe(
      path.join('/Users/dev', '.codex', 'hooks.json'),
    );
    expect(codexConfigPath('/Users/dev')).toBe(
      path.join('/Users/dev', '.codex', 'config.toml'),
    );
  });
});

describe('findCodexExecutable', () => {
  it('finds the codex launcher on PATH', () => {
    const binDir = path.join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const name = process.platform === 'win32' ? 'codex.cmd' : 'codex';
    writeFileSync(path.join(binDir, name), '');

    const separator = process.platform === 'win32' ? ';' : ':';
    const found = findCodexExecutable(
      host({ env: { PATH: [path.join(dir, 'other'), binDir].join(separator) } }),
    );

    expect(found).toBe(path.join(binDir, name));
  });

  it('returns undefined when PATH is unset', () => {
    expect(findCodexExecutable(host({ env: {} }))).toBeUndefined();
  });

  it('returns undefined when the launcher is absent', () => {
    expect(findCodexExecutable(host({ env: { PATH: dir } }))).toBeUndefined();
  });
});

describe('detectCodex', () => {
  it('detects Codex via its home directory ~/.codex', () => {
    mkdirSync(path.join(dir, '.codex'), { recursive: true });
    const detection = detectCodex(host());

    expect(detection.installed).toBe(true);
    expect(detection.location).toContain('.codex');
  });

  it('reports not installed when neither executable nor home exists', () => {
    expect(detectCodex(host()).installed).toBe(false);
  });
});
