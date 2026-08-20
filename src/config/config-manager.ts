import path from 'node:path';
import { isLogLevel, type LogLevel } from '../utils/logger.js';
import { readJsonFile, writeJsonFileAtomic } from '../utils/json-file.js';

export interface NotificationConfig {
  desktop: boolean;
  sound: boolean;
}

export interface PingBackConfig {
  notifications: NotificationConfig;
  logLevel: LogLevel;
}

export const DEFAULT_CONFIG: PingBackConfig = {
  notifications: {
    desktop: true,
    sound: true,
  },
  logLevel: 'info',
};

export interface ConfigLoadResult {
  config: PingBackConfig;
  /** Human-readable problems found in the stored file, if any. */
  warnings: string[];
  source: 'defaults' | 'file';
}

function cloneDefaults(): PingBackConfig {
  return {
    notifications: { ...DEFAULT_CONFIG.notifications },
    logLevel: DEFAULT_CONFIG.logLevel,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Coerces arbitrary parsed JSON into a valid config. Unknown or malformed
 * fields fall back to defaults and produce a warning instead of an error, so a
 * hand-edited config can never stop PingBack from starting.
 */
export function normalizeConfig(raw: unknown): ConfigLoadResult {
  const config = cloneDefaults();
  const warnings: string[] = [];

  const root = asRecord(raw);
  if (root === undefined) {
    return {
      config,
      warnings: ['Config root is not an object; using defaults.'],
      source: 'defaults',
    };
  }

  if (root.notifications !== undefined) {
    const notifications = asRecord(root.notifications);
    if (notifications === undefined) {
      warnings.push('"notifications" is not an object; using defaults.');
    } else {
      for (const key of ['desktop', 'sound'] as const) {
        const value = notifications[key];
        if (value === undefined) continue;
        if (typeof value === 'boolean') {
          config.notifications[key] = value;
        } else {
          warnings.push(`"notifications.${key}" must be true or false; using default.`);
        }
      }
    }
  }

  if (root.logLevel !== undefined) {
    if (isLogLevel(root.logLevel)) {
      config.logLevel = root.logLevel;
    } else {
      warnings.push('"logLevel" must be one of debug, info, warn, error; using default.');
    }
  }

  return { config, warnings, source: 'file' };
}

export class ConfigManager {
  readonly #filePath: string;

  constructor(configDir: string) {
    this.#filePath = path.join(configDir, 'config.json');
  }

  get filePath(): string {
    return this.#filePath;
  }

  load(): ConfigLoadResult {
    const result = readJsonFile(this.#filePath);

    if (!result.ok) {
      if (result.reason === 'missing') {
        return { config: cloneDefaults(), warnings: [], source: 'defaults' };
      }
      const reason =
        result.reason === 'invalid'
          ? 'Config file is not valid JSON; using defaults.'
          : 'Config file could not be read; using defaults.';
      return { config: cloneDefaults(), warnings: [reason], source: 'defaults' };
    }

    return normalizeConfig(result.value);
  }

  save(config: PingBackConfig): void {
    writeJsonFileAtomic(this.#filePath, config);
  }

  /** Loads, applies a change, and persists. Returns the saved config. */
  update(mutate: (config: PingBackConfig) => void): PingBackConfig {
    const { config } = this.load();
    mutate(config);
    this.save(config);
    return config;
  }
}

export type ConfigKey = 'notifications.desktop' | 'notifications.sound' | 'logLevel';

export const CONFIG_KEYS: readonly ConfigKey[] = [
  'notifications.desktop',
  'notifications.sound',
  'logLevel',
];

export function isConfigKey(value: string): value is ConfigKey {
  return CONFIG_KEYS.includes(value as ConfigKey);
}

export function getConfigValue(config: PingBackConfig, key: ConfigKey): boolean | string {
  switch (key) {
    case 'notifications.desktop':
      return config.notifications.desktop;
    case 'notifications.sound':
      return config.notifications.sound;
    case 'logLevel':
      return config.logLevel;
  }
}

export type ConfigSetResult = { ok: true } | { ok: false; error: string };

export function setConfigValue(
  config: PingBackConfig,
  key: ConfigKey,
  rawValue: string,
): ConfigSetResult {
  if (key === 'logLevel') {
    if (!isLogLevel(rawValue)) {
      return { ok: false, error: 'logLevel must be one of: debug, info, warn, error' };
    }
    config.logLevel = rawValue;
    return { ok: true };
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized !== 'true' && normalized !== 'false') {
    return { ok: false, error: `${key} must be true or false` };
  }

  const value = normalized === 'true';
  if (key === 'notifications.desktop') config.notifications.desktop = value;
  else config.notifications.sound = value;

  return { ok: true };
}
