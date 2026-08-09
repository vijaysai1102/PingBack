import { describe, expect, it, vi } from 'vitest';
import {
  createConsoleSink,
  createLogger,
  isLogLevel,
  silentLogger,
  type LogRecord,
} from '../../src/utils/logger.js';

function collector(): { sink: (record: LogRecord) => void; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { sink: (record) => records.push(record), records };
}

const fixedNow = (): Date => new Date('2026-01-01T00:00:00.000Z');

describe('createLogger', () => {
  it('emits records at or above the configured level', () => {
    const { sink, records } = collector();
    const logger = createLogger({ level: 'warn', sinks: [sink], now: fixedNow });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(records.map((r) => r.level)).toEqual(['warn', 'error']);
  });

  it('includes the timestamp, level and message', () => {
    const { sink, records } = collector();
    const logger = createLogger({ level: 'debug', sinks: [sink], now: fixedNow });

    logger.info('daemon started', { port: 1 });

    expect(records[0]).toMatchObject({
      time: '2026-01-01T00:00:00.000Z',
      level: 'info',
      msg: 'daemon started',
      port: 1,
    });
  });

  it('merges child bindings into every record', () => {
    const { sink, records } = collector();
    const logger = createLogger({ level: 'debug', sinks: [sink], now: fixedNow }).child({
      component: 'daemon',
    });

    logger.info('hello');

    expect(records[0]?.component).toBe('daemon');
  });

  it('lets call fields override bindings', () => {
    const { sink, records } = collector();
    const logger = createLogger({
      level: 'debug',
      sinks: [sink],
      bindings: { component: 'core' },
      now: fixedNow,
    });

    logger.info('hello', { component: 'router' });

    expect(records[0]?.component).toBe('router');
  });

  it('truncates long strings so conversations are never persisted whole', () => {
    const { sink, records } = collector();
    const logger = createLogger({ level: 'debug', sinks: [sink], now: fixedNow });

    logger.info('event', { message: 'x'.repeat(5000) });

    const message = records[0]?.message;
    expect(typeof message).toBe('string');
    expect((message as string).length).toBeLessThan(600);
    expect(message).toContain('[truncated]');
  });

  it('truncates nested string fields', () => {
    const { sink, records } = collector();
    const logger = createLogger({ level: 'debug', sinks: [sink], now: fixedNow });

    logger.info('event', { nested: { transcript: 'y'.repeat(2000) } });

    const nested = records[0]?.nested as { transcript: string };
    expect(nested.transcript).toContain('[truncated]');
  });

  it('serializes Error fields to name and message', () => {
    const { sink, records } = collector();
    const logger = createLogger({ level: 'debug', sinks: [sink], now: fixedNow });

    logger.error('failed', { err: new TypeError('bad input') });

    expect(records[0]?.err).toEqual({ name: 'TypeError', message: 'bad input' });
  });

  it('keeps logging when one sink throws', () => {
    const { sink, records } = collector();
    const logger = createLogger({
      level: 'debug',
      sinks: [
        () => {
          throw new Error('sink down');
        },
        sink,
      ],
      now: fixedNow,
    });

    expect(() => {
      logger.info('still logged');
    }).not.toThrow();
    expect(records).toHaveLength(1);
  });
});

describe('createConsoleSink', () => {
  it('writes a human-readable line', () => {
    const write = vi.fn();
    const sink = createConsoleSink({ write } as unknown as NodeJS.WritableStream);

    sink({ time: '2026-01-01T00:00:00.000Z', level: 'info', msg: 'ready', pid: 5 });

    expect(write).toHaveBeenCalledOnce();
    const line = write.mock.calls[0]?.[0] as string;
    expect(line).toContain('INFO');
    expect(line).toContain('ready');
    expect(line).toContain('"pid":5');
  });
});

describe('isLogLevel', () => {
  it('accepts the four levels and rejects anything else', () => {
    expect(isLogLevel('debug')).toBe(true);
    expect(isLogLevel('error')).toBe(true);
    expect(isLogLevel('trace')).toBe(false);
    expect(isLogLevel(3)).toBe(false);
  });
});

describe('silentLogger', () => {
  it('discards output without throwing', () => {
    const logger = silentLogger();
    expect(() => {
      logger.error('nothing happens');
    }).not.toThrow();
  });
});
