import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DaemonState, isProcessAlive } from '../../src/core/daemon-state.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-state-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isProcessAlive', () => {
  it('recognizes the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('rejects invalid pids', () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-5)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
  });

  it('reports a very unlikely pid as dead', () => {
    expect(isProcessAlive(999_999_998)).toBe(false);
  });
});

describe('DaemonState token', () => {
  it('returns undefined before a token exists', () => {
    expect(new DaemonState(dir).readToken()).toBeUndefined();
  });

  it('creates a token on first use', () => {
    const state = new DaemonState(dir);
    const token = state.ensureToken();

    expect(token).toHaveLength(64);
    expect(state.readToken()).toBe(token);
  });

  it('reuses an existing token', () => {
    const state = new DaemonState(dir);
    expect(state.ensureToken()).toBe(state.ensureToken());
  });

  it('creates the data directory if needed', () => {
    const nested = path.join(dir, 'a', 'b');
    expect(() => new DaemonState(nested).ensureToken()).not.toThrow();
  });

  it('restricts token file permissions on POSIX hosts', () => {
    const state = new DaemonState(dir);
    state.ensureToken();

    if (process.platform === 'win32') return;
    expect(statSync(state.tokenPath).mode & 0o077).toBe(0);
  });
});

describe('DaemonState record', () => {
  const record = { pid: 1234, startedAt: 999, endpoint: '/tmp/x.sock', version: '0.1.0' };

  it('returns undefined when no record exists', () => {
    expect(new DaemonState(dir).readRecord()).toBeUndefined();
  });

  it('round-trips a record', () => {
    const state = new DaemonState(dir);
    state.writeRecord(record);

    expect(state.readRecord()).toEqual(record);
  });

  it('clears a record', () => {
    const state = new DaemonState(dir);
    state.writeRecord(record);
    state.clearRecord();

    expect(state.readRecord()).toBeUndefined();
  });

  it('clearing a missing record is a no-op', () => {
    expect(() => new DaemonState(dir).clearRecord()).not.toThrow();
  });

  it('ignores a corrupted record file', () => {
    const state = new DaemonState(dir);
    writeFileSync(state.recordPath, 'not json', 'utf8');

    expect(state.readRecord()).toBeUndefined();
  });

  it('rejects a record with no pid', () => {
    const state = new DaemonState(dir);
    writeFileSync(state.recordPath, JSON.stringify({ endpoint: '/x' }), 'utf8');

    expect(state.readRecord()).toBeUndefined();
  });

  it('writes valid JSON to disk', () => {
    const state = new DaemonState(dir);
    state.writeRecord(record);

    expect(JSON.parse(readFileSync(state.recordPath, 'utf8'))).toEqual(record);
  });
});

describe('DaemonState.readLiveRecord', () => {
  it('returns the record when the process is alive', () => {
    const state = new DaemonState(dir);
    state.writeRecord({
      pid: process.pid,
      startedAt: 1,
      endpoint: '/tmp/x.sock',
      version: '0.1.0',
    });

    expect(state.readLiveRecord()?.pid).toBe(process.pid);
  });

  it('clears and returns undefined for a dead process', () => {
    const state = new DaemonState(dir);
    state.writeRecord({
      pid: 999_999_998,
      startedAt: 1,
      endpoint: '/tmp/x.sock',
      version: '0.1.0',
    });

    expect(state.readLiveRecord()).toBeUndefined();
    expect(state.readRecord()).toBeUndefined();
  });
});
