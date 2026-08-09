import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../src/agents/claude/adapter.js';
import {
  claudeSettingsPath,
  detectClaude,
  findClaudeExecutable,
} from '../../src/agents/claude/detector.js';
import { PingBackError } from '../../src/utils/errors.js';
import type { HostInfo } from '../../src/platform/platform.js';

let dir: string;

const spec = { command: 'node', scriptPath: '/opt/pingback/dist/x/hook-entry.js' };

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

function adapter(settingsPath?: string): ClaudeAdapter {
  return new ClaudeAdapter({
    host: host(),
    settingsPath: settingsPath ?? path.join(dir, 'settings.json'),
    hookSpec: spec,
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-claude-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('claudeSettingsPath', () => {
  it('points at ~/.claude/settings.json', () => {
    expect(claudeSettingsPath('/Users/dev')).toBe(
      path.join('/Users/dev', '.claude', 'settings.json'),
    );
  });
});

describe('findClaudeExecutable', () => {
  it('finds the launcher on PATH', () => {
    const binDir = path.join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const name = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    writeFileSync(path.join(binDir, name), '');

    const separator = process.platform === 'win32' ? ';' : ':';
    const found = findClaudeExecutable(
      host({ env: { PATH: [path.join(dir, 'nope'), binDir].join(separator) } }),
    );

    expect(found).toBe(path.join(binDir, name));
  });

  it('returns undefined when PATH is unset', () => {
    expect(findClaudeExecutable(host({ env: {} }))).toBeUndefined();
  });

  it('returns undefined when the launcher is absent', () => {
    expect(findClaudeExecutable(host({ env: { PATH: dir } }))).toBeUndefined();
  });

  it('ignores empty PATH entries', () => {
    expect(() => findClaudeExecutable(host({ env: { PATH: '::' } }))).not.toThrow();
  });
});

describe('detectClaude', () => {
  it('detects Claude via its home directory', () => {
    mkdirSync(path.join(dir, '.claude'), { recursive: true });
    const detection = detectClaude(host());

    expect(detection.installed).toBe(true);
    expect(detection.location).toContain('.claude');
  });

  it('reports not installed when nothing is found', () => {
    expect(detectClaude(host()).installed).toBe(false);
  });
});

describe('ClaudeAdapter setup and uninstall', () => {
  it('creates a settings file when none exists', () => {
    const settingsPath = path.join(dir, 'settings.json');
    adapter(settingsPath).setup();

    const written: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(
      (written as { hooks: Record<string, unknown> }).hooks.Notification,
    ).toBeDefined();
  });

  it('reports configured only after setup', () => {
    const instance = adapter();
    expect(instance.isConfigured()).toBe(false);

    instance.setup();
    expect(instance.isConfigured()).toBe(true);
  });

  it('preserves existing user settings', () => {
    const settingsPath = path.join(dir, 'settings.json');
    writeFileSync(
      settingsPath,
      JSON.stringify({ model: 'sonnet', permissions: { allow: ['Bash(ls)'] } }),
      'utf8',
    );

    adapter(settingsPath).setup();
    const written = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<
      string,
      unknown
    >;

    expect(written.model).toBe('sonnet');
    expect(written.permissions).toEqual({ allow: ['Bash(ls)'] });
  });

  it('backs up the original settings before the first edit', () => {
    const settingsPath = path.join(dir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ model: 'sonnet' }), 'utf8');

    adapter(settingsPath).setup();

    const backup = path.join(dir, 'settings.json.pingback-backup');
    expect(existsSync(backup)).toBe(true);
    expect(JSON.parse(readFileSync(backup, 'utf8'))).toEqual({ model: 'sonnet' });
  });

  it('does not overwrite an existing backup on a later setup', () => {
    const settingsPath = path.join(dir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ model: 'original' }), 'utf8');

    const instance = adapter(settingsPath);
    instance.setup();
    instance.setup();

    const backup = path.join(dir, 'settings.json.pingback-backup');
    expect(JSON.parse(readFileSync(backup, 'utf8'))).toEqual({ model: 'original' });
  });

  it('is idempotent across repeated setup runs', () => {
    const settingsPath = path.join(dir, 'settings.json');
    const instance = adapter(settingsPath);

    instance.setup();
    const first = readFileSync(settingsPath, 'utf8');
    instance.setup();

    expect(readFileSync(settingsPath, 'utf8')).toBe(first);
  });

  it('round-trips back to the original settings on uninstall', () => {
    const settingsPath = path.join(dir, 'settings.json');
    const original = {
      model: 'sonnet',
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [] }] },
    };
    writeFileSync(settingsPath, JSON.stringify(original), 'utf8');

    const instance = adapter(settingsPath);
    instance.setup();
    instance.uninstall();

    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual(original);
    expect(instance.isConfigured()).toBe(false);
  });

  it('uninstall is safe when no settings file exists', () => {
    expect(() => adapter().uninstall()).not.toThrow();
  });

  it('rejects an unreadable settings file rather than clobbering it', () => {
    const settingsPath = path.join(dir, 'settings.json');
    writeFileSync(settingsPath, '{ this is not json', 'utf8');

    expect(() => adapter(settingsPath).setup()).toThrow(PingBackError);
    // The corrupted file must be left exactly as the user wrote it.
    expect(readFileSync(settingsPath, 'utf8')).toBe('{ this is not json');
  });

  it('reports not configured when settings are corrupted', () => {
    const settingsPath = path.join(dir, 'settings.json');
    writeFileSync(settingsPath, 'broken', 'utf8');

    expect(adapter(settingsPath).isConfigured()).toBe(false);
  });
});

describe('ClaudeAdapter identity', () => {
  it('exposes the agent name and display name', () => {
    const instance = adapter();
    expect(instance.name).toBe('claude');
    expect(instance.displayName).toBe('Claude Code');
  });
});
