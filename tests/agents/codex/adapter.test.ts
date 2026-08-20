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

function adapter(configPath = path.join(dir, 'config.toml')): CodexAdapter {
  return new CodexAdapter({ host: host(), configPath });
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

  it('installs the supported config.toml notify integration', () => {
    const configPath = path.join(dir, 'config.toml');
    writeFileSync(configPath, 'model = "gpt-5"\n', 'utf8');
    const instance = adapter(configPath);

    expect(instance.isConfigured()).toBe(false);
    instance.setup();

    expect(instance.isConfigured()).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toContain('notify = [');
    expect(readFileSync(configPath, 'utf8')).toContain('notify-entry.js');
  });

  it('restores an existing notify command from its PingBack state file on uninstall', () => {
    const configPath = path.join(dir, 'config.toml');
    const original = 'notify = ["existing-notifier", "turn-ended"]\n';
    writeFileSync(configPath, original, 'utf8');
    const instance = adapter(configPath);

    instance.setup();
    instance.uninstall();

    expect(instance.isConfigured()).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('keeps a backup before the first config.toml modification', () => {
    const configPath = path.join(dir, 'config.toml');
    const original = 'model = "gpt-5"\n';
    writeFileSync(configPath, original, 'utf8');
    const instance = adapter(configPath);

    instance.setup();

    const backupPath = path.join(dir, 'config.toml.pingback-backup');
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, 'utf8')).toBe(original);
  });

  it('replaces legacy PingBack hooks with safe approval observers without altering other Codex hooks', () => {
    const hooksPath = path.join(dir, '.codex', 'hooks.json');
    mkdirSync(path.dirname(hooksPath), { recursive: true });
    writeFileSync(
      hooksPath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              _pingback: 1,
              hooks: [
                {
                  type: 'command',
                  command: 'node C:/PingBack/dist/agents/codex/hook-entry.js codex',
                },
              ],
            },
          ],
          Stop: [
            {
              _litmus: 1,
              hooks: [
                {
                  type: 'command',
                  command: 'node C:\\Users\\dev\\.litmus\\hook-logger.cjs codex',
                },
              ],
            },
            {
              _pingback: 1,
              hooks: [
                {
                  type: 'command',
                  command: 'node C:/PingBack/dist/agents/codex/hook-entry.js codex',
                },
              ],
            },
          ],
        },
      }),
      'utf8',
    );

    adapter().setup();

    const result = JSON.parse(readFileSync(hooksPath, 'utf8')) as {
      hooks: Record<
        string,
        Array<{
          _pingback?: number;
          _litmus?: number;
          hooks: Array<{ type: string; command: string; async?: boolean }>;
        }>
      >;
    };
    expect(result.hooks.Stop).toHaveLength(1);
    expect(result.hooks.Stop?.[0]?._litmus).toBe(1);

    for (const event of ['UserPromptSubmit', 'PermissionRequest']) {
      const pingbackHook = result.hooks[event]?.[0];
      expect(pingbackHook?._pingback).toBe(1);
      expect(pingbackHook?.hooks[0]?.type).toBe('command');
      expect(pingbackHook?.hooks[0]?.command).toContain('codex/lifecycle-entry.js');
      expect(pingbackHook?.hooks[0]?.async).toBe(true);
    }

    const backupPath = path.join(dir, '.codex', 'hooks.json.pingback-backup');
    expect(existsSync(backupPath)).toBe(true);
  });

  it('detects when Codex home directory exists', () => {
    mkdirSync(path.join(dir, '.codex'), { recursive: true });
    const instance = adapter();
    const detection = instance.detect();

    expect(detection.installed).toBe(true);
    expect(detection.location).toContain('.codex');
  });
});
