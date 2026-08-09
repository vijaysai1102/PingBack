import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && LOG_LEVELS.includes(value as LogLevel);
}

export type LogFields = Record<string, unknown>;

export interface LogRecord extends LogFields {
  time: string;
  level: LogLevel;
  msg: string;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  sinks: LogSink[];
  bindings?: LogFields;
  now?: () => Date;
}

/**
 * Caps string field length. PingBack logs event metadata for diagnostics but
 * must never persist whole conversations or large terminal output.
 */
const MAX_FIELD_LENGTH = 500;

function redact(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_FIELD_LENGTH) {
    return `${value.slice(0, MAX_FIELD_LENGTH)}…[truncated]`;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = redact(item);
    return out;
  }
  return value;
}

export function createLogger(options: LoggerOptions): Logger {
  const { level, sinks, bindings = {}, now = () => new Date() } = options;
  const threshold = LEVEL_RANK[level];

  function write(recordLevel: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_RANK[recordLevel] < threshold) return;

    const record: LogRecord = {
      time: now().toISOString(),
      level: recordLevel,
      msg,
      ...(redact(bindings) as LogFields),
      ...(fields === undefined ? {} : (redact(fields) as LogFields)),
    };

    for (const sink of sinks) {
      try {
        sink(record);
      } catch {
        // Logging must never take down the daemon.
      }
    }
  }

  return {
    debug: (msg, fields) => {
      write('debug', msg, fields);
    },
    info: (msg, fields) => {
      write('info', msg, fields);
    },
    warn: (msg, fields) => {
      write('warn', msg, fields);
    },
    error: (msg, fields) => {
      write('error', msg, fields);
    },
    child: (extra) => createLogger({ ...options, bindings: { ...bindings, ...extra } }),
  };
}

export function createFileSink(filePath: string): LogSink {
  let ready = false;
  return (record) => {
    if (!ready) {
      mkdirSync(path.dirname(filePath), { recursive: true });
      ready = true;
    }
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  };
}

export function createConsoleSink(
  stream: NodeJS.WritableStream = process.stderr,
): LogSink {
  return (record) => {
    const { time, level, msg, ...rest } = record;
    const extras = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    stream.write(`${time} ${level.toUpperCase().padEnd(5)} ${msg}${extras}\n`);
  };
}

/** A logger that discards everything; used by the CLI and by tests. */
export function silentLogger(): Logger {
  return createLogger({ level: 'error', sinks: [] });
}
