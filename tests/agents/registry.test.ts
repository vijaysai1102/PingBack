import { describe, expect, it } from 'vitest';
import { createAllAdapters, getAdapter } from '../../src/agents/registry.js';
import type { HostInfo } from '../../src/platform/platform.js';

const mockHost: HostInfo = {
  platform: 'darwin',
  env: {},
  homedir: '/Users/test',
  tmpdir: '/tmp',
  uid: '501',
};

describe('Agent Registry', () => {
  it('creates all supported agent adapters', () => {
    const adapters = createAllAdapters({ host: mockHost });
    const names = adapters.map((a) => a.name);

    expect(names).toEqual(['claude', 'codex', 'agy']);
    expect(adapters.map((a) => a.displayName)).toEqual([
      'Claude Code',
      'Codex CLI',
      'AGY CLI',
    ]);
  });

  it('gets specific adapter by name', () => {
    expect(getAdapter('claude', { host: mockHost }).displayName).toBe('Claude Code');
    expect(getAdapter('codex', { host: mockHost }).displayName).toBe('Codex CLI');
    expect(getAdapter('agy', { host: mockHost }).displayName).toBe('AGY CLI');
  });
});
