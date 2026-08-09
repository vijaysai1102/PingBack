import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigManager,
  DEFAULT_CONFIG,
  getConfigValue,
  isConfigKey,
  normalizeConfig,
  setConfigValue,
  type PingBackConfig,
} from '../../src/config/config-manager.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function defaults(): PingBackConfig {
  return { notifications: { desktop: true, sound: true }, logLevel: 'info' };
}

describe('DEFAULT_CONFIG', () => {
  it('enables desktop notifications and sound', () => {
    expect(DEFAULT_CONFIG.notifications.desktop).toBe(true);
    expect(DEFAULT_CONFIG.notifications.sound).toBe(true);
  });
});

describe('normalizeConfig', () => {
  it('accepts a valid config with no warnings', () => {
    const result = normalizeConfig({
      notifications: { desktop: false, sound: true },
      logLevel: 'debug',
    });

    expect(result.warnings).toEqual([]);
    expect(result.config.notifications.desktop).toBe(false);
    expect(result.config.logLevel).toBe('debug');
  });

  it('fills in missing fields from defaults', () => {
    const result = normalizeConfig({ notifications: { sound: false } });

    expect(result.config.notifications.desktop).toBe(true);
    expect(result.config.notifications.sound).toBe(false);
    expect(result.config.logLevel).toBe('info');
  });

  it('warns and uses defaults for a non-object root', () => {
    const result = normalizeConfig('nope');

    expect(result.config).toEqual(defaults());
    expect(result.warnings).toHaveLength(1);
  });

  it('warns for non-boolean notification flags', () => {
    const result = normalizeConfig({ notifications: { desktop: 'yes' } });

    expect(result.config.notifications.desktop).toBe(true);
    expect(result.warnings[0]).toContain('notifications.desktop');
  });

  it('warns for an invalid log level', () => {
    const result = normalizeConfig({ logLevel: 'verbose' });

    expect(result.config.logLevel).toBe('info');
    expect(result.warnings[0]).toContain('logLevel');
  });

  it('warns when notifications is not an object', () => {
    const result = normalizeConfig({ notifications: [] });
    expect(result.warnings[0]).toContain('notifications');
  });
});

describe('ConfigManager', () => {
  it('returns defaults when no config file exists', () => {
    const result = new ConfigManager(dir).load();

    expect(result.source).toBe('defaults');
    expect(result.config).toEqual(defaults());
    expect(result.warnings).toEqual([]);
  });

  it('round-trips a saved config', () => {
    const manager = new ConfigManager(dir);
    manager.save({ notifications: { desktop: false, sound: false }, logLevel: 'warn' });

    const result = manager.load();
    expect(result.source).toBe('file');
    expect(result.config.notifications.desktop).toBe(false);
    expect(result.config.logLevel).toBe('warn');
  });

  it('falls back to defaults and warns on invalid JSON', () => {
    const manager = new ConfigManager(dir);
    writeFileSync(manager.filePath, '{ broken', 'utf8');

    const result = manager.load();
    expect(result.config).toEqual(defaults());
    expect(result.warnings[0]).toContain('valid JSON');
  });

  it('creates the config directory when saving', () => {
    const nested = path.join(dir, 'deep', 'nested');
    const manager = new ConfigManager(nested);

    expect(() => {
      manager.save(defaults());
    }).not.toThrow();
    expect(manager.load().config).toEqual(defaults());
  });

  it('applies a mutation through update', () => {
    const manager = new ConfigManager(dir);
    const updated = manager.update((config) => {
      config.notifications.sound = false;
    });

    expect(updated.notifications.sound).toBe(false);
    expect(manager.load().config.notifications.sound).toBe(false);
  });
});

describe('config keys', () => {
  it('recognizes the supported keys', () => {
    expect(isConfigKey('notifications.desktop')).toBe(true);
    expect(isConfigKey('notifications.sound')).toBe(true);
    expect(isConfigKey('logLevel')).toBe(true);
    expect(isConfigKey('nope')).toBe(false);
  });

  it('reads values by key', () => {
    const config = defaults();
    expect(getConfigValue(config, 'notifications.desktop')).toBe(true);
    expect(getConfigValue(config, 'logLevel')).toBe('info');
  });

  it('sets boolean values from strings', () => {
    const config = defaults();

    expect(setConfigValue(config, 'notifications.sound', 'false')).toEqual({ ok: true });
    expect(config.notifications.sound).toBe(false);

    expect(setConfigValue(config, 'notifications.desktop', 'TRUE')).toEqual({ ok: true });
    expect(config.notifications.desktop).toBe(true);
  });

  it('rejects a non-boolean value', () => {
    const config = defaults();
    const result = setConfigValue(config, 'notifications.sound', 'maybe');

    expect(result.ok).toBe(false);
    expect(config.notifications.sound).toBe(true);
  });

  it('validates the log level', () => {
    const config = defaults();

    expect(setConfigValue(config, 'logLevel', 'debug')).toEqual({ ok: true });
    expect(config.logLevel).toBe('debug');
    expect(setConfigValue(config, 'logLevel', 'loud').ok).toBe(false);
  });
});
