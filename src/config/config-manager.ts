import path from 'node:path';
import { isLogLevel, type LogLevel } from '../utils/logger.js';
import { readJsonFile, writeJsonFileAtomic } from '../utils/json-file.js';
import type { AgentEventType } from '../core/types.js';

export interface EventNotificationConfig {
  delaySeconds: number;
  sound: boolean;
  desktop: boolean;
}

export interface NotificationConfig {
  desktop: boolean;
  sound: boolean;
  volume: number; // 0.0 to 1.0
  events: Record<AgentEventType, EventNotificationConfig>;
}

export interface PingBackConfig {
  notifications: NotificationConfig;
  logLevel: LogLevel;
}

export const DEFAULT_EVENT_CONFIGS: Record<AgentEventType, EventNotificationConfig> = {
  attention_required: {
    delaySeconds: 0,
    sound: true,
    desktop: true,
  },
  question: {
    delaySeconds: 0,
    sound: true,
    desktop: true,
  },
  error: {
    delaySeconds: 0,
    sound: true,
    desktop: true,
  },
  task_completed: {
    delaySeconds: 0,
    sound: false,
    desktop: true,
  },
};

export const DEFAULT_CONFIG: PingBackConfig = {
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

export interface ConfigLoadResult {
  config: PingBackConfig;
  /** Human-readable problems found in the stored file, if any. */
  warnings: string[];
  source: 'defaults' | 'file';
}

function cloneDefaults(): PingBackConfig {
  return {
    notifications: {
      desktop: DEFAULT_CONFIG.notifications.desktop,
      sound: DEFAULT_CONFIG.notifications.sound,
      volume: DEFAULT_CONFIG.notifications.volume,
      events: {
        attention_required: { ...DEFAULT_EVENT_CONFIGS.attention_required },
        question: { ...DEFAULT_EVENT_CONFIGS.question },
        error: { ...DEFAULT_EVENT_CONFIGS.error },
        task_completed: { ...DEFAULT_EVENT_CONFIGS.task_completed },
      },
    },
    logLevel: DEFAULT_CONFIG.logLevel,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const EVENT_TYPES: readonly AgentEventType[] = [
  'attention_required',
  'question',
  'error',
  'task_completed',
];

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

      if (notifications.volume !== undefined) {
        const vol = Number(notifications.volume);
        if (Number.isFinite(vol) && vol >= 0 && vol <= 1) {
          config.notifications.volume = vol;
        } else {
          warnings.push(
            '"notifications.volume" must be between 0.0 and 1.0; using default.',
          );
        }
      }

      if (notifications.events !== undefined) {
        const rawEvents = asRecord(notifications.events);
        if (rawEvents !== undefined) {
          for (const event of EVENT_TYPES) {
            const eventBlock = asRecord(rawEvents[event]);
            if (eventBlock === undefined) continue;

            if (eventBlock.delaySeconds !== undefined) {
              const delay = Number(eventBlock.delaySeconds);
              if (Number.isFinite(delay) && delay >= 0) {
                config.notifications.events[event].delaySeconds = delay;
              } else {
                warnings.push(
                  `"notifications.events.${event}.delaySeconds" must be a non-negative number.`,
                );
              }
            }

            if (eventBlock.sound !== undefined) {
              if (typeof eventBlock.sound === 'boolean') {
                config.notifications.events[event].sound = eventBlock.sound;
              } else {
                warnings.push(
                  `"notifications.events.${event}.sound" must be true or false.`,
                );
              }
            }

            if (eventBlock.desktop !== undefined) {
              if (typeof eventBlock.desktop === 'boolean') {
                config.notifications.events[event].desktop = eventBlock.desktop;
              } else {
                warnings.push(
                  `"notifications.events.${event}.desktop" must be true or false.`,
                );
              }
            }
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

export const CONFIG_KEYS = [
  'notifications.desktop',
  'notifications.sound',
  'notifications.volume',
  'notifications.events.attention_required.delaySeconds',
  'notifications.events.attention_required.sound',
  'notifications.events.attention_required.desktop',
  'notifications.events.question.delaySeconds',
  'notifications.events.question.sound',
  'notifications.events.question.desktop',
  'notifications.events.error.delaySeconds',
  'notifications.events.error.sound',
  'notifications.events.error.desktop',
  'notifications.events.task_completed.delaySeconds',
  'notifications.events.task_completed.sound',
  'notifications.events.task_completed.desktop',
  'logLevel',
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

export function isConfigKey(value: string): value is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(value);
}

export function getConfigValue(
  config: PingBackConfig,
  key: string,
): boolean | number | string | undefined {
  if (key === 'logLevel') return config.logLevel;
  if (key === 'notifications.desktop') return config.notifications.desktop;
  if (key === 'notifications.sound') return config.notifications.sound;
  if (key === 'notifications.volume') return config.notifications.volume;

  const match = key.match(
    /^notifications\.events\.([a-z_]+)\.(delaySeconds|sound|desktop)$/,
  );
  if (match) {
    const event = match[1] as AgentEventType;
    const prop = match[2] as keyof EventNotificationConfig;
    if (config.notifications.events[event] !== undefined) {
      return config.notifications.events[event][prop];
    }
  }

  return undefined;
}

export type ConfigSetResult = { ok: true } | { ok: false; error: string };

export function setConfigValue(
  config: PingBackConfig,
  key: string,
  rawValue: string,
): ConfigSetResult {
  if (key === 'logLevel') {
    if (!isLogLevel(rawValue)) {
      return { ok: false, error: 'logLevel must be one of: debug, info, warn, error' };
    }
    config.logLevel = rawValue;
    return { ok: true };
  }

  if (key === 'notifications.desktop' || key === 'notifications.sound') {
    const normalized = rawValue.trim().toLowerCase();
    if (normalized !== 'true' && normalized !== 'false') {
      return { ok: false, error: `${key} must be true or false` };
    }
    config.notifications[key === 'notifications.desktop' ? 'desktop' : 'sound'] =
      normalized === 'true';
    return { ok: true };
  }

  if (key === 'notifications.volume') {
    const vol = Number(rawValue.trim());
    if (!Number.isFinite(vol) || vol < 0 || vol > 1) {
      return {
        ok: false,
        error: 'notifications.volume must be a number between 0.0 and 1.0',
      };
    }
    config.notifications.volume = vol;
    return { ok: true };
  }

  const match = key.match(
    /^notifications\.events\.([a-z_]+)\.(delaySeconds|sound|desktop)$/,
  );
  if (match) {
    const event = match[1] as AgentEventType;
    const prop = match[2] as keyof EventNotificationConfig;

    if (!EVENT_TYPES.includes(event)) {
      return {
        ok: false,
        error: `Unknown event type "${event}". Valid events: ${EVENT_TYPES.join(', ')}`,
      };
    }

    if (prop === 'delaySeconds') {
      const delay = Number(rawValue.trim());
      if (!Number.isFinite(delay) || delay < 0) {
        return { ok: false, error: `${key} must be a non-negative number` };
      }
      config.notifications.events[event].delaySeconds = delay;
      return { ok: true };
    }

    const normalized = rawValue.trim().toLowerCase();
    if (normalized !== 'true' && normalized !== 'false') {
      return { ok: false, error: `${key} must be true or false` };
    }
    config.notifications.events[event][prop] = normalized === 'true';
    return { ok: true };
  }

  return { ok: false, error: `Unknown configuration key: ${key}` };
}
