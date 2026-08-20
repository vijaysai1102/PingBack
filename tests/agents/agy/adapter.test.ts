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
import { AGYAdapter } from '../../../src/agents/agy/adapter.js';
import type { HostInfo } from '../../../src/platform/platform.js';

let dir: string;

const spec = {
  command: 'node',
  scriptPath: '/opt/pingback/dist/agents/agy/hook-entry.js',
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

function adapter(hooksPath?: string): AGYAdapter {
  return new AGYAdapter({
    host: host(),
    hooksPath: hooksPath ?? path.join(dir, 'hooks.json'),
    hookSpec: spec,
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-agy-adapter-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('AGYAdapter setup and uninstall', () => {
  it('exposes agent name and display name', () => {
    const instance = adapter();
    expect(instance.name).toBe('agy');
    expect(instance.displayName).toBe('AGY CLI');
  });

  it('creates hooks.json on setup and detects configured state', () => {
    const hooksPath = path.join(dir, 'hooks.json');
    const instance = adapter(hooksPath);

    expect(instance.isConfigured()).toBe(false);
    instance.setup();
    expect(instance.isConfigured()).toBe(true);

    const written = JSON.parse(readFileSync(hooksPath, 'utf8')) as {
      pingback: Record<string, unknown>;
    };
    expect(written.pingback.PreToolUse).toBeDefined();
    expect(written.pingback.Stop).toBeDefined();
  });

  it('backs up original hooks.json before modification', () => {
    const hooksPath = path.join(dir, 'hooks.json');
    const original = { 'my-hook': {} };
    writeFileSync(hooksPath, JSON.stringify(original), 'utf8');

    const instance = adapter(hooksPath);
    instance.setup();

    const backupPath = path.join(dir, 'hooks.json.pingback-backup');
    expect(existsSync(backupPath)).toBe(true);
    expect(JSON.parse(readFileSync(backupPath, 'utf8'))).toEqual(original);
  });

  it('restores hooks on uninstall', () => {
    const hooksPath = path.join(dir, 'hooks.json');
    const original = { 'custom-hook': {} };
    writeFileSync(hooksPath, JSON.stringify(original), 'utf8');

    const instance = adapter(hooksPath);
    instance.setup();
    expect(instance.isConfigured()).toBe(true);

    instance.uninstall();
    expect(instance.isConfigured()).toBe(false);
    expect(JSON.parse(readFileSync(hooksPath, 'utf8'))).toEqual(original);
  });

  it('detects when AGY home directory exists', () => {
    mkdirSync(path.join(dir, '.gemini'), { recursive: true });
    const instance = adapter();
    const detection = instance.detect();

    expect(detection.installed).toBe(true);
    expect(detection.location).toContain('.gemini');
  });
});
