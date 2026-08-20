import { describe, expect, it } from 'vitest';
import { parseAgentEvent } from '../../src/core/event-schema.js';
import { PingBackError } from '../../src/utils/errors.js';

const validPayload = {
  agent: 'claude',
  sessionId: 'abc123',
  type: 'attention_required',
  title: 'Claude Code needs your attention',
  message: 'Claude is waiting for permission.',
  cwd: '/Users/dev/finbot',
  pid: 4242,
  timestamp: 1_700_000_000_000,
};

describe('parseAgentEvent', () => {
  it('accepts a well-formed payload', () => {
    const event = parseAgentEvent(validPayload);

    expect(event.agent).toBe('claude');
    expect(event.sessionId).toBe('abc123');
    expect(event.type).toBe('attention_required');
    expect(event.cwd).toBe('/Users/dev/finbot');
    expect(event.pid).toBe(4242);
    expect(event.timestamp).toBe(1_700_000_000_000);
  });

  it('generates an id when one is not supplied', () => {
    const event = parseAgentEvent(validPayload);
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('preserves a supplied id', () => {
    const event = parseAgentEvent({ ...validPayload, id: 'evt-1' });
    expect(event.id).toBe('evt-1');
  });

  it('defaults the timestamp from the injected clock', () => {
    const event = parseAgentEvent({ ...validPayload, timestamp: undefined }, () => 555);
    expect(event.timestamp).toBe(555);
  });

  it.each([
    ['a non-object payload', 'nope'],
    ['null', null],
    ['an array', []],
  ])('rejects %s', (_label, payload) => {
    expect(() => parseAgentEvent(payload)).toThrow(PingBackError);
  });

  it('accepts events from the supported Claude and Codex agents', () => {
    const claude = parseAgentEvent({ ...validPayload, agent: 'claude' });
    const codex = parseAgentEvent({ ...validPayload, agent: 'codex' });

    expect(claude.agent).toBe('claude');
    expect(codex.agent).toBe('codex');
  });

  it('rejects AGY events after AGY support is removed', () => {
    expect(() => parseAgentEvent({ ...validPayload, agent: 'agy' })).toThrow(
      'Unsupported agent: agy',
    );
  });

  it('rejects an unsupported agent', () => {
    expect(() => parseAgentEvent({ ...validPayload, agent: 'unsupported-bot' })).toThrow(
      /unsupported-bot/,
    );
  });

  it('rejects an unknown event type', () => {
    expect(() => parseAgentEvent({ ...validPayload, type: 'agent_idle' })).toThrow(
      /agent_idle/,
    );
  });

  it('rejects a missing sessionId', () => {
    expect(() => parseAgentEvent({ ...validPayload, sessionId: '' })).toThrow(
      /sessionId/,
    );
  });

  it('truncates an oversized message instead of failing', () => {
    const event = parseAgentEvent({ ...validPayload, message: 'x'.repeat(5000) });

    expect(event.message.length).toBeLessThanOrEqual(300);
    expect(event.message.endsWith('…')).toBe(true);
  });

  it('collapses whitespace in the title', () => {
    const event = parseAgentEvent({ ...validPayload, title: '  Needs\n\n  input  ' });
    expect(event.title).toBe('Needs input');
  });

  it('falls back to a default title when missing', () => {
    const event = parseAgentEvent({ ...validPayload, title: undefined });
    expect(event.title).toBe('Claude Code');
  });

  it('drops an invalid pid rather than rejecting the event', () => {
    expect(parseAgentEvent({ ...validPayload, pid: -1 }).pid).toBeUndefined();
    expect(parseAgentEvent({ ...validPayload, pid: 1.5 }).pid).toBeUndefined();
    expect(parseAgentEvent({ ...validPayload, pid: 'abc' }).pid).toBeUndefined();
  });

  it('keeps only primitive metadata values', () => {
    const event = parseAgentEvent({
      ...validPayload,
      metadata: { hookEvent: 'Notification', count: 2, ok: true, nested: { a: 1 } },
    });

    expect(event.metadata).toEqual({ hookEvent: 'Notification', count: 2, ok: true });
  });

  it('caps the number of metadata keys', () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`k${String(i)}`, i]),
    );
    const event = parseAgentEvent({ ...validPayload, metadata });

    expect(Object.keys(event.metadata ?? {}).length).toBeLessThanOrEqual(20);
  });

  it('returns undefined metadata when nothing usable remains', () => {
    const event = parseAgentEvent({ ...validPayload, metadata: { nested: { a: 1 } } });
    expect(event.metadata).toBeUndefined();
  });
});
