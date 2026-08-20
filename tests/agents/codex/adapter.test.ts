import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodexAdapter } from '../../../src/agents/codex/adapter.js';
import type { HostInfo } from '../../../src/platform/platform.js';

let dir: string;

const spec = {
  command: 'node',
  scriptPath: '/opt/pingback/dist/agents/codex/hook-entry.js',
};

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

function adapter(hooksPath?: string, configPath?: string): CodexAdapter {
  return new CodexAdapter({
    host: host(),
    hooksPath: hooksPath ?? path.join(dir, 'hooks.json'),
    configPath: configPath ?? path.join(dir, 'config.toml'),
    hookSpec: spec,
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-codex-adapter-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('CodexAdapter setup and uninstall', () => {
  it('exposes agent name and display name', () => {
    const instance = adapter();
    expect(instance.name).toBe('codex');
    expect(instance.displayName).toBe('Codex CLI');
  });

  it('creates hooks.json when none exists', () => {
    const hooksPath = path.join(dir, 'hooks.json');
    const instance = adapter(hooksPath);

    expect(instance.isConfigured()).toBe(false);
    instance.setup();
    expect(instance.isConfigured()).toBe(true);

    const written = JSON.parse(readFileSync(hooksPath, 'utf8')) as {
      hooks: Record<string, unknown>;
    };
    expect(written.hooks.UserPromptSubmit).toBeDefined();
    expect(written.hooks.Stop).toBeDefined();
  });

  it('creates a backup of hooks.json before first modification', () => {
    const hooksPath = path.join(dir, 'hooks.json');
    const original = { hooks: { Custom: [] } };
    writeFileSync(hooksPath, JSON.stringify(original), 'utf8');

    const instance = adapter(hooksPath);
    instance.setup();

    const backupPath = path.join(dir, 'hooks.json.pingback-backup');
    expect(existsSync(backupPath)).toBe(true);
    expect(JSON.parse(readFileSync(backupPath, 'utf8'))).toEqual(original);
  });

  it('restores hooks on uninstall', () => {
    const hooksPath = path.join(dir, 'hooks.json');
    const original = {
      hooks: { Custom: [{ matcher: '', hooks: [{ type: 'command', command: 'log' }] }] },
    };
    writeFileSync(hooksPath, JSON.stringify(original), 'utf8');

    const instance = adapter(hooksPath);
    instance.setup();
    expect(instance.isConfigured()).toBe(true);

    instance.uninstall();
    expect(instance.isConfigured()).toBe(false);
    expect(JSON.parse(readFileSync(hooksPath, 'utf8'))).toEqual(original);
  });

  it('detects when Codex home directory exists', () => {
    mkdirSync(path.join(dir, '.codex'), { recursive: true });
    const instance = adapter();
    const detection = instance.detect();

    expect(detection.installed).toBe(true);
    expect(detection.location).toContain('.codex');
  });
});
