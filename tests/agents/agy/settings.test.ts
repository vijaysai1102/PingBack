import { describe, expect, it } from 'vitest';
import {
  hasPingBackAGYHooks,
  installAGYHooks,
  uninstallAGYHooks,
} from '../../../src/agents/agy/settings.js';

const spec = {
  command: 'node',
  scriptPath: 'C:\\npm\\pingback\\dist\\agents\\agy\\hook-entry.js',
};

const userHooks = {
  'safety-gate': {
    PreToolUse: [{ matcher: 'run_command', hooks: [{ command: './safe.sh' }] }],
  },
};

describe('installAGYHooks', () => {
  it('installs pingback named hook block into empty settings', () => {
    const result = installAGYHooks({}, spec);
    expect(hasPingBackAGYHooks(result)).toBe(true);

    const pingback = (result as Record<string, Record<string, unknown[]>>).pingback;
    expect(pingback).toBeDefined();
    expect(Array.isArray(pingback?.PreToolUse)).toBe(true);
    expect(Array.isArray(pingback?.PreInvocation)).toBe(true);
    expect(Array.isArray(pingback?.Stop)).toBe(true);
  });

  it('preserves existing non-PingBack named hooks', () => {
    const result = installAGYHooks(userHooks, spec);
    expect(hasPingBackAGYHooks(result)).toBe(true);
    expect(result['safety-gate']).toEqual(userHooks['safety-gate']);
  });

  it('is idempotent across repeated installs', () => {
    const once = installAGYHooks({}, spec);
    const twice = installAGYHooks(once, spec);
    expect(twice).toEqual(once);
  });
});

describe('uninstallAGYHooks', () => {
  it('removes pingback hook entry completely', () => {
    const installed = installAGYHooks(userHooks, spec);
    const uninstalled = uninstallAGYHooks(installed);

    expect(hasPingBackAGYHooks(uninstalled)).toBe(false);
    expect(uninstalled.pingback).toBeUndefined();
    expect(uninstalled).toEqual(userHooks);
  });
});
