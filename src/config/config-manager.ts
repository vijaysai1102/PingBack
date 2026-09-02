import path from 'node:path';
import { isLogLevel, type LogLevel } from '../utils/logger.js';
import { readJsonFile, writeJsonFileAtomic } from '../utils/json-file.js';

export type NotificationEventName =
  'attention_required' | 'question' | 'turn_completion' | 'error' | 'task_completed';

export const NOTIFICATION_EVENT_NAMES: readonly NotificationEventName[] = [
  'attention_required',
  'question',
  'turn_completion',
  'error',
  'task_completed',
];

export interface NotificationEventConfig {
  enabled: boolean;
  delaySeconds: number;
}

export interface NotificationSoundConfig {
  enabled: boolean;
  volume: number;
}

export interface NotificationConfig {
  enabled: boolean;
  sound: NotificationSoundConfig;
  events: Record<NotificationEventName, NotificationEventConfig>;
}

export interface PingBackConfig {
  notifications: NotificationConfig;
  logLevel: LogLevel;
}

export const DEFAULT_CONFIG: PingBackConfig = {
  notifications: {
    enabled: true,
    sound: { enabled: true, volume: 1 },
    events: {
      attention_required: { enabled: true, delaySeconds: 5 },
      question: { enabled: true, delaySeconds: 5 },
      turn_completion: { enabled: true, delaySeconds: 5 },
      error: { enabled: true, delaySeconds: 5 },
      task_completed: { enabled: true, delaySeconds: 5 },
    },
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
    notifications: {
      enabled: DEFAULT_CONFIG.notifications.enabled,
      sound: { ...DEFAULT_CONFIG.notifications.sound },
      events: Object.fromEntries(
        NOTIFICATION_EVENT_NAMES.map((name) => [
          name,
          { ...DEFAULT_CONFIG.notifications.events[name] },
        ]),
      ) as Record<NotificationEventName, NotificationEventConfig>,
    },
    logLevel: DEFAULT_CONFIG.logLevel,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeBoolean(
  value: unknown,
  pathName: string,
  warnings: string[],
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  warnings.push(`"${pathName}" must be true or false; using default.`);
  return undefined;
}

function normalizeVolume(value: unknown, warnings: string[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  warnings.push('"notifications.sound.volume" must be between 0 and 1; using default.');
  return undefined;
}

function normalizeDelay(
  value: unknown,
  event: NotificationEventName,
  warnings: string[],
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  warnings.push(
    `"notifications.events.${event}.delaySeconds" must be a non-negative number; using default.`,
  );
  return undefined;
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
      const enabled = normalizeBoolean(
        notifications.enabled,
        'notifications.enabled',
        warnings,
      );
      const legacyDesktop = normalizeBoolean(
        notifications.desktop,
        'notifications.desktop',
        warnings,
      );
      config.notifications.enabled =
        enabled ?? legacyDesktop ?? config.notifications.enabled;

      if (typeof notifications.sound === 'boolean') {
        config.notifications.sound.enabled = notifications.sound;
      } else {
        const sound = asRecord(notifications.sound);
        if (notifications.sound !== undefined && sound === undefined) {
          warnings.push('"notifications.sound" must be an object; using default.');
        } else if (sound !== undefined) {
          const soundEnabled = normalizeBoolean(
            sound.enabled,
            'notifications.sound.enabled',
            warnings,
          );
          const volume = normalizeVolume(sound.volume, warnings);
          config.notifications.sound.enabled =
            soundEnabled ?? config.notifications.sound.enabled;
          config.notifications.sound.volume = volume ?? config.notifications.sound.volume;
        }
      }

      if (notifications.events !== undefined) {
        const events = asRecord(notifications.events);
        if (events === undefined) {
          warnings.push('"notifications.events" is not an object; using defaults.');
        } else {
          for (const event of NOTIFICATION_EVENT_NAMES) {
            const entry = asRecord(events[event]);
            if (events[event] === undefined) continue;
            if (entry === undefined) {
              warnings.push(
                `"notifications.events.${event}" is not an object; using default.`,
              );
              continue;
            }
            const eventEnabled = normalizeBoolean(
              entry.enabled,
              `notifications.events.${event}.enabled`,
              warnings,
            );
            let delay = normalizeDelay(entry.delaySeconds, event, warnings);
            if (delay === 3 && (event === 'turn_completion' || event === 'error')) {
              delay = 5;
            }
            config.notifications.events[event].enabled =
              eventEnabled ?? config.notifications.events[event].enabled;
            config.notifications.events[event].delaySeconds =
              delay ?? config.notifications.events[event].delaySeconds;
          }
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

type NotificationBooleanConfigKey =
  | 'notifications.enabled'
  | 'notifications.sound.enabled'
  | `notifications.events.${NotificationEventName}.enabled`;

type NotificationNumberConfigKey =
  | 'notifications.sound.volume'
  | `notifications.events.${NotificationEventName}.delaySeconds`;

export type ConfigKey =
  NotificationBooleanConfigKey | NotificationNumberConfigKey | 'logLevel';

export type ConfigPath =
  | ConfigKey
  | 'notifications'
  | 'notifications.sound'
  | 'notifications.events'
  | `notifications.events.${NotificationEventName}`;

export const CONFIG_KEYS: readonly ConfigKey[] = [
  'notifications.enabled',
  'notifications.sound.enabled',
  'notifications.sound.volume',
  ...NOTIFICATION_EVENT_NAMES.flatMap((event) => [
    `notifications.events.${event}.enabled` as const,
    `notifications.events.${event}.delaySeconds` as const,
  ]),
  'logLevel',
];

export function isConfigKey(value: string): value is ConfigKey {
  return CONFIG_KEYS.includes(value as ConfigKey);
}

export function isConfigPath(value: string): value is ConfigPath {
  return (
    isConfigKey(value) ||
    value === 'notifications' ||
    value === 'notifications.sound' ||
    value === 'notifications.events' ||
    NOTIFICATION_EVENT_NAMES.some((event) => value === `notifications.events.${event}`)
  );
}

function eventKeyParts(
  key: ConfigPath,
): { event: NotificationEventName; field: 'enabled' | 'delaySeconds' } | undefined {
  const match =
    /^notifications\.events\.(attention_required|question|turn_completion|error|task_completed)\.(enabled|delaySeconds)$/.exec(
      key,
    );
  if (match === null) return undefined;
  return {
    event: match[1] as NotificationEventName,
    field: match[2] as 'enabled' | 'delaySeconds',
  };
}

export function getConfigValue(config: PingBackConfig, key: ConfigPath): unknown {
  if (key === 'notifications') return config.notifications;
  if (key === 'notifications.sound') return config.notifications.sound;
  if (key === 'notifications.events') return config.notifications.events;
  if (NOTIFICATION_EVENT_NAMES.some((event) => key === `notifications.events.${event}`)) {
    const event = key.slice('notifications.events.'.length) as NotificationEventName;
    return config.notifications.events[event];
  }
  if (key === 'notifications.enabled') return config.notifications.enabled;
  if (key === 'notifications.sound.enabled') return config.notifications.sound.enabled;
  if (key === 'notifications.sound.volume') return config.notifications.sound.volume;
  if (key === 'logLevel') return config.logLevel;

  const event = eventKeyParts(key);
  if (event === undefined) return config.logLevel;
  return config.notifications.events[event.event][event.field];
}

export type ConfigSetResult = { ok: true } | { ok: false; error: string };

function parseBoolean(key: string, rawValue: string): boolean | ConfigSetResult {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return { ok: false, error: `${key} must be true or false` };
}

function parseNumber(
  rawValue: string,
  minimum: number,
  error: string,
): number | ConfigSetResult {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < minimum) return { ok: false, error };
  return value;
}

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

  if (key === 'notifications.sound.volume') {
    const value = parseNumber(
      rawValue,
      0,
      'notifications.sound.volume must be between 0 and 1.',
    );
    if (typeof value !== 'number' || value > 1) {
      return typeof value === 'number'
        ? { ok: false, error: 'notifications.sound.volume must be between 0 and 1.' }
        : value;
    }
    config.notifications.sound.volume = value;
    return { ok: true };
  }

  const event = eventKeyParts(key);
  if (event?.field === 'delaySeconds') {
    const value = parseNumber(rawValue, 0, `${key} must be a non-negative number.`);
    if (typeof value !== 'number') return value;
    config.notifications.events[event.event].delaySeconds = value;
    return { ok: true };
  }

  const value = parseBoolean(key, rawValue);
  if (typeof value !== 'boolean') return value;
  if (key === 'notifications.enabled') config.notifications.enabled = value;
  else if (key === 'notifications.sound.enabled')
    config.notifications.sound.enabled = value;
  else if (event?.field === 'enabled')
    config.notifications.events[event.event].enabled = value;

  return { ok: true };
}
