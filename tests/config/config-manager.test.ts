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
  return {
    notifications: {
      enabled: true,
      sound: { enabled: true, volume: 1 },
      events: {
        question: { enabled: true, delaySeconds: 5 },
        turn_completion: { enabled: true, delaySeconds: 3 },
        error: { enabled: true, delaySeconds: 3 },
        task_completed: { enabled: true, delaySeconds: 5 },
      },
    },
    logLevel: 'info',
  };
}

describe('DEFAULT_CONFIG', () => {
  it('enables notifications and sound with the v0.2 event delays', () => {
    expect(DEFAULT_CONFIG.notifications.enabled).toBe(true);
    expect(DEFAULT_CONFIG.notifications.sound).toEqual({ enabled: true, volume: 1 });
    expect(DEFAULT_CONFIG.notifications.events.question.delaySeconds).toBe(5);
    expect(DEFAULT_CONFIG.notifications.events.turn_completion.delaySeconds).toBe(3);
    expect(DEFAULT_CONFIG.notifications.events.error.delaySeconds).toBe(3);
    expect(DEFAULT_CONFIG.notifications.events.task_completed.delaySeconds).toBe(5);
  });
});

describe('normalizeConfig', () => {
  it('normalizes the v0.2 hierarchical notification settings', () => {
    const result = normalizeConfig({
      notifications: {
        enabled: false,
        sound: { enabled: false, volume: 0.8 },
        events: {
          question: { enabled: false, delaySeconds: 9 },
        },
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.config.notifications.enabled).toBe(false);
    expect(result.config.notifications.sound).toEqual({ enabled: false, volume: 0.8 });
    expect(result.config.notifications.events.question).toEqual({
      enabled: false,
      delaySeconds: 9,
    });
    expect(result.config.notifications.events.error.delaySeconds).toBe(3);
  });

  it('accepts a valid config with no warnings', () => {
    const result = normalizeConfig({
      notifications: { enabled: false, sound: { enabled: true, volume: 0.5 } },
      logLevel: 'debug',
    });

    expect(result.warnings).toEqual([]);
    expect(result.config.notifications.enabled).toBe(false);
    expect(result.config.notifications.sound.volume).toBe(0.5);
    expect(result.config.logLevel).toBe('debug');
  });

  it('fills in missing fields from defaults', () => {
    const result = normalizeConfig({ notifications: { sound: { enabled: false } } });

    expect(result.config.notifications.enabled).toBe(true);
    expect(result.config.notifications.sound).toEqual({ enabled: false, volume: 1 });
    expect(result.config.logLevel).toBe('info');
  });

  it('migrates v0.1 desktop and sound flags without warnings', () => {
    const result = normalizeConfig({ notifications: { desktop: false, sound: false } });

    expect(result.warnings).toEqual([]);
    expect(result.config.notifications.enabled).toBe(false);
    expect(result.config.notifications.sound).toEqual({ enabled: false, volume: 1 });
  });

  it('warns and uses defaults for a non-object root', () => {
    const result = normalizeConfig('nope');

    expect(result.config).toEqual(defaults());
    expect(result.warnings).toHaveLength(1);
  });

  it('warns for non-boolean notification flags', () => {
    const result = normalizeConfig({ notifications: { enabled: 'yes' } });

    expect(result.config.notifications.enabled).toBe(true);
    expect(result.warnings[0]).toContain('notifications.enabled');
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
    manager.save({
      notifications: {
        ...defaults().notifications,
        enabled: false,
        sound: { enabled: false, volume: 0.4 },
      },
      logLevel: 'warn',
    });

    const result = manager.load();
    expect(result.source).toBe('file');
    expect(result.config.notifications.enabled).toBe(false);
    expect(result.config.notifications.sound.volume).toBe(0.4);
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
      config.notifications.sound.enabled = false;
    });

    expect(updated.notifications.sound.enabled).toBe(false);
    expect(manager.load().config.notifications.sound.enabled).toBe(false);
  });
});

describe('config keys', () => {
  it('recognizes the supported keys', () => {
    expect(isConfigKey('notifications.enabled')).toBe(true);
    expect(isConfigKey('notifications.sound.enabled')).toBe(true);
    expect(isConfigKey('notifications.sound.volume')).toBe(true);
    expect(isConfigKey('notifications.events.question.delaySeconds')).toBe(true);
    expect(isConfigKey('logLevel')).toBe(true);
    expect(isConfigKey('nope')).toBe(false);
  });

  it('reads values by key', () => {
    const config = defaults();
    expect(getConfigValue(config, 'notifications.enabled')).toBe(true);
    expect(getConfigValue(config, 'notifications.sound.volume')).toBe(1);
    expect(getConfigValue(config, 'logLevel')).toBe('info');
  });

  it('reads a hierarchical configuration branch', () => {
    const config = defaults();

    expect(getConfigValue(config, 'notifications')).toEqual({
      enabled: true,
      sound: { enabled: true, volume: 1 },
      events: {
        question: { enabled: true, delaySeconds: 5 },
        turn_completion: { enabled: true, delaySeconds: 3 },
        error: { enabled: true, delaySeconds: 3 },
        task_completed: { enabled: true, delaySeconds: 5 },
      },
    });
  });

  it('sets boolean values from strings', () => {
    const config = defaults();

    expect(setConfigValue(config, 'notifications.sound.enabled', 'false')).toEqual({
      ok: true,
    });
    expect(config.notifications.sound.enabled).toBe(false);

    expect(setConfigValue(config, 'notifications.enabled', 'TRUE')).toEqual({ ok: true });
    expect(config.notifications.enabled).toBe(true);
  });

  it('rejects a non-boolean value', () => {
    const config = defaults();
    const result = setConfigValue(config, 'notifications.sound.enabled', 'maybe');

    expect(result.ok).toBe(false);
    expect(config.notifications.sound.enabled).toBe(true);
  });

  it('rejects an out-of-range volume without changing the saved value', () => {
    const config = defaults();

    expect(setConfigValue(config, 'notifications.sound.volume', '1.5')).toEqual({
      ok: false,
      error: 'notifications.sound.volume must be between 0 and 1.',
    });
    expect(config.notifications.sound.volume).toBe(1);
  });

  it('rejects a negative event delay without changing the saved value', () => {
    const config = defaults();

    expect(
      setConfigValue(config, 'notifications.events.question.delaySeconds', '-5'),
    ).toEqual({
      ok: false,
      error: 'notifications.events.question.delaySeconds must be a non-negative number.',
    });
    expect(config.notifications.events.question.delaySeconds).toBe(5);
  });

  it('validates the log level', () => {
    const config = defaults();

    expect(setConfigValue(config, 'logLevel', 'debug')).toEqual({ ok: true });
    expect(config.logLevel).toBe('debug');
    expect(setConfigValue(config, 'logLevel', 'loud').ok).toBe(false);
  });
});
