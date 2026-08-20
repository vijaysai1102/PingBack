import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigManager,
  DEFAULT_CONFIG,
  DEFAULT_EVENT_CONFIGS,
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
      desktop: true,
      sound: true,
      volume: 1.0,
      events: {
        attention_required: { ...DEFAULT_EVENT_CONFIGS.attention_required },
        question: { ...DEFAULT_EVENT_CONFIGS.question },
        error: { ...DEFAULT_EVENT_CONFIGS.error },
        task_completed: { ...DEFAULT_EVENT_CONFIGS.task_completed },
      },
    },
    logLevel: 'info',
  };
}

describe('DEFAULT_CONFIG', () => {
  it('alerts immediately for attention, questions, and errors while keeping completions silent', () => {
    expect(DEFAULT_CONFIG.notifications.desktop).toBe(true);
    expect(DEFAULT_CONFIG.notifications.sound).toBe(true);
    expect(DEFAULT_CONFIG.notifications.volume).toBe(1.0);
    expect(DEFAULT_CONFIG.notifications.events.attention_required).toEqual({
      delaySeconds: 0,
      sound: true,
      desktop: true,
    });
    expect(DEFAULT_CONFIG.notifications.events.question).toEqual({
      delaySeconds: 0,
      sound: true,
      desktop: true,
    });
    expect(DEFAULT_CONFIG.notifications.events.error).toEqual({
      delaySeconds: 0,
      sound: true,
      desktop: true,
    });
    expect(DEFAULT_CONFIG.notifications.events.task_completed).toEqual({
      delaySeconds: 0,
      sound: false,
      desktop: true,
    });
  });
});

describe('normalizeConfig', () => {
  it('accepts a valid config with no warnings', () => {
    const result = normalizeConfig({
      notifications: {
        desktop: false,
        sound: true,
        volume: 0.8,
        events: {
          question: { delaySeconds: 2, sound: false, desktop: true },
        },
      },
      logLevel: 'debug',
    });

    expect(result.warnings).toEqual([]);
    expect(result.config.notifications.desktop).toBe(false);
    expect(result.config.notifications.volume).toBe(0.8);
    expect(result.config.notifications.events.question.delaySeconds).toBe(2);
    expect(result.config.notifications.events.question.sound).toBe(false);
    expect(result.config.logLevel).toBe('debug');
  });

  it('fills in missing fields from defaults', () => {
    const result = normalizeConfig({ notifications: { sound: false } });

    expect(result.config.notifications.desktop).toBe(true);
    expect(result.config.notifications.sound).toBe(false);
    expect(result.config.notifications.volume).toBe(1.0);
    expect(result.config.notifications.events.question.delaySeconds).toBe(0);
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

  it('warns for invalid volume values', () => {
    const result = normalizeConfig({ notifications: { volume: 2.5 } });

    expect(result.config.notifications.volume).toBe(1.0);
    expect(result.warnings[0]).toContain('notifications.volume');
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
        desktop: false,
        sound: false,
        volume: 0.5,
        events: { ...DEFAULT_EVENT_CONFIGS },
      },
      logLevel: 'warn',
    });

    const result = manager.load();
    expect(result.source).toBe('file');
    expect(result.config.notifications.desktop).toBe(false);
    expect(result.config.notifications.volume).toBe(0.5);
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
    expect(isConfigKey('notifications.volume')).toBe(true);
    expect(isConfigKey('notifications.events.question.delaySeconds')).toBe(true);
    expect(isConfigKey('logLevel')).toBe(true);
    expect(isConfigKey('nope')).toBe(false);
  });

  it('reads values by key', () => {
    const config = defaults();
    expect(getConfigValue(config, 'notifications.desktop')).toBe(true);
    expect(getConfigValue(config, 'notifications.volume')).toBe(1.0);
    expect(getConfigValue(config, 'notifications.events.question.delaySeconds')).toBe(0);
    expect(getConfigValue(config, 'logLevel')).toBe('info');
  });

  it('sets boolean and numeric values from strings', () => {
    const config = defaults();

    expect(setConfigValue(config, 'notifications.sound', 'false')).toEqual({ ok: true });
    expect(config.notifications.sound).toBe(false);

    expect(setConfigValue(config, 'notifications.volume', '0.75')).toEqual({ ok: true });
    expect(config.notifications.volume).toBe(0.75);

    expect(
      setConfigValue(config, 'notifications.events.question.delaySeconds', '10'),
    ).toEqual({ ok: true });
    expect(config.notifications.events.question.delaySeconds).toBe(10);
  });

  it('rejects an invalid volume value', () => {
    const config = defaults();
    const result = setConfigValue(config, 'notifications.volume', '1.5');

    expect(result.ok).toBe(false);
    expect(config.notifications.volume).toBe(1.0);
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
