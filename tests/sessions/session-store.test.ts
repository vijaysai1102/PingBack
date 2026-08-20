import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSessionStore, parseSession } from '../../src/sessions/session-store.js';
import type { AgentSession } from '../../src/core/types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-sessions-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sample: AgentSession = {
  id: 's1',
  agent: 'claude',
  status: 'waiting',
  startedAt: 1000,
  lastActivityAt: 2000,
  cwd: '/proj',
  pid: 42,
};

describe('parseSession', () => {
  it('accepts a well-formed record', () => {
    expect(parseSession(sample)).toEqual(sample);
  });

  it.each([
    ['a missing id', { ...sample, id: undefined }],
    ['a non-claude agent', { ...sample, agent: 'codex' }],
    ['a missing startedAt', { ...sample, startedAt: undefined }],
    ['a non-object', 'nope'],
    ['null', null],
  ])('rejects %s', (_label, raw) => {
    expect(parseSession(raw)).toBeUndefined();
  });

  it('falls back to unknown for an unrecognized status', () => {
    expect(parseSession({ ...sample, status: 'exploded' })?.status).toBe('unknown');
  });

  it('drops non-primitive optional fields', () => {
    const parsed = parseSession({ ...sample, pid: 'abc', cwd: 42 });
    expect(parsed?.pid).toBeUndefined();
    expect(parsed?.cwd).toBeUndefined();
  });
});

describe('FileSessionStore', () => {
  it('returns an empty list when the file does not exist', () => {
    expect(new FileSessionStore(dir).load()).toEqual([]);
  });

  it('round-trips sessions through disk', () => {
    const store = new FileSessionStore(dir);
    store.save([sample]);

    expect(new FileSessionStore(dir).load()).toEqual([sample]);
  });

  it('creates the data directory if missing', () => {
    const nested = path.join(dir, 'a', 'b');
    const store = new FileSessionStore(nested);

    expect(() => {
      store.save([sample]);
    }).not.toThrow();
    expect(new FileSessionStore(nested).load()).toEqual([sample]);
  });

  it('recovers from a corrupted file instead of throwing', () => {
    const store = new FileSessionStore(dir);
    writeFileSync(store.filePath, '{ this is not json', 'utf8');

    expect(store.load()).toEqual([]);
  });

  it('skips individual malformed records but keeps valid ones', () => {
    const store = new FileSessionStore(dir);
    writeFileSync(
      store.filePath,
      JSON.stringify({ version: 1, sessions: [sample, { junk: true }, null] }),
      'utf8',
    );

    expect(store.load()).toEqual([sample]);
  });

  it('reads a bare array for forward compatibility', () => {
    const store = new FileSessionStore(dir);
    writeFileSync(store.filePath, JSON.stringify([sample]), 'utf8');

    expect(store.load()).toEqual([sample]);
  });

  it('leaves no temp files behind after a write', () => {
    const store = new FileSessionStore(dir);
    store.save([sample]);

    const parsed: unknown = JSON.parse(readFileSync(store.filePath, 'utf8'));
    expect((parsed as { version: number }).version).toBe(1);
  });
});
