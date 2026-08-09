import { describe, expect, it } from 'vitest';
import {
  LineDecoder,
  LineTooLongError,
  encodeMessage,
  isIpcRequestType,
  parseRequest,
} from '../../src/core/ipc/protocol.js';

describe('encodeMessage', () => {
  it('appends a newline terminator', () => {
    expect(encodeMessage({ a: 1 })).toBe('{"a":1}\n');
  });
});

describe('LineDecoder', () => {
  it('returns a complete line', () => {
    expect(new LineDecoder().push('{"a":1}\n')).toEqual(['{"a":1}']);
  });

  it('buffers a partial line until the newline arrives', () => {
    const decoder = new LineDecoder();

    expect(decoder.push('{"a":')).toEqual([]);
    expect(decoder.push('1}\n')).toEqual(['{"a":1}']);
  });

  it('splits several messages in one chunk', () => {
    expect(new LineDecoder().push('a\nb\nc\n')).toEqual(['a', 'b', 'c']);
  });

  it('keeps a trailing partial line for the next chunk', () => {
    const decoder = new LineDecoder();

    expect(decoder.push('a\nb')).toEqual(['a']);
    expect(decoder.push('\n')).toEqual(['b']);
  });

  it('ignores blank lines', () => {
    expect(new LineDecoder().push('\n\na\n')).toEqual(['a']);
  });

  it('throws once the buffer exceeds the limit', () => {
    const decoder = new LineDecoder(16);
    expect(() => decoder.push('x'.repeat(32))).toThrow(LineTooLongError);
  });

  it('recovers after an oversized line', () => {
    const decoder = new LineDecoder(16);

    expect(() => decoder.push('x'.repeat(32))).toThrow();
    expect(decoder.push('ok\n')).toEqual(['ok']);
  });
});

describe('isIpcRequestType', () => {
  it('accepts the supported request types', () => {
    expect(isIpcRequestType('ping')).toBe(true);
    expect(isIpcRequestType('status')).toBe(true);
    expect(isIpcRequestType('event')).toBe(true);
    expect(isIpcRequestType('shutdown')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isIpcRequestType('restart')).toBe(false);
    expect(isIpcRequestType(5)).toBe(false);
  });
});

describe('parseRequest', () => {
  it('accepts a well-formed request', () => {
    const result = parseRequest('{"id":"1","token":"t","type":"ping"}');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.request).toMatchObject({ id: '1', token: 't', type: 'ping' });
  });

  it('preserves the payload', () => {
    const result = parseRequest(
      '{"id":"1","token":"t","type":"event","payload":{"a":1}}',
    );

    if (!result.ok) throw new Error('expected ok');
    expect(result.request.payload).toEqual({ a: 1 });
  });

  it('rejects invalid JSON', () => {
    const result = parseRequest('{ nope');
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object request', () => {
    expect(parseRequest('[]').ok).toBe(false);
    expect(parseRequest('"hi"').ok).toBe(false);
  });

  it('rejects an unknown type', () => {
    const result = parseRequest('{"id":"1","token":"t","type":"explode"}');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('explode');
  });

  it('rejects a request with no token', () => {
    const result = parseRequest('{"id":"1","type":"ping"}');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('token');
  });

  it('falls back to an unknown id so a reply can still be correlated', () => {
    const result = parseRequest('{"type":"nope"}');

    if (result.ok) throw new Error('expected failure');
    expect(result.id).toBe('unknown');
  });
});
