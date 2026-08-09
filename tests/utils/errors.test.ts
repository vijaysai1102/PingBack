import { describe, expect, it } from 'vitest';
import {
  PingBackError,
  UnsupportedPlatformError,
  isPingBackError,
  toMessage,
} from '../../src/utils/errors.js';

describe('PingBackError', () => {
  it('carries a stable code and an optional hint', () => {
    const error = new PingBackError('daemon is not running', {
      code: 'DAEMON_NOT_RUNNING',
      hint: 'Run `pingback start`',
    });

    expect(error.code).toBe('DAEMON_NOT_RUNNING');
    expect(error.hint).toBe('Run `pingback start`');
    expect(error.message).toBe('daemon is not running');
    expect(error).toBeInstanceOf(Error);
  });

  it('leaves hint undefined when not supplied', () => {
    const error = new PingBackError('nope', { code: 'IPC_FAILURE' });
    expect(error.hint).toBeUndefined();
  });

  it('preserves the underlying cause', () => {
    const cause = new Error('EPIPE');
    const error = new PingBackError('ipc failed', { code: 'IPC_FAILURE', cause });
    expect(error.cause).toBe(cause);
  });
});

describe('UnsupportedPlatformError', () => {
  it('is a PingBackError with the platform in the message', () => {
    const error = new UnsupportedPlatformError('linux');
    expect(isPingBackError(error)).toBe(true);
    expect(error.code).toBe('UNSUPPORTED_PLATFORM');
    expect(error.message).toContain('linux');
    expect(error.hint).toContain('Windows and macOS');
  });
});

describe('isPingBackError', () => {
  it('rejects plain errors and non-errors', () => {
    expect(isPingBackError(new Error('plain'))).toBe(false);
    expect(isPingBackError('string')).toBe(false);
    expect(isPingBackError(null)).toBe(false);
    expect(isPingBackError(undefined)).toBe(false);
  });
});

describe('toMessage', () => {
  it('normalizes unknown thrown values', () => {
    expect(toMessage(new Error('boom'))).toBe('boom');
    expect(toMessage('boom')).toBe('boom');
    expect(toMessage(42)).toBe('42');
    expect(toMessage(null)).toBe('null');
  });
});
