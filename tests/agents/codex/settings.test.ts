import { describe, expect, it } from 'vitest';
import {
  computeHookHash,
  hasPingBackCodexHooks,
  installCodexHooks,
  isPingBackCodexHandler,
  uninstallCodexHooks,
} from '../../../src/agents/codex/settings.js';

const spec = {
  command: 'node',
  scriptPath: 'C:\\npm\\pingback\\dist\\agents\\codex\\hook-entry.js',
};

const userHooks = {
  hooks: {
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-audit-script' }] },
    ],
  },
};

describe('isPingBackCodexHandler', () => {
  it('recognizes a handler marked with _pingback', () => {
    expect(
      isPingBackCodexHandler({ type: 'command', command: 'test', _pingback: 1 }),
    ).toBe(true);
  });

  it('recognizes a handler by script path', () => {
    expect(
      isPingBackCodexHandler({
        type: 'command',
        command: 'node "C:\\pingback\\dist\\agents\\codex\\hook-entry.js"',
      }),
    ).toBe(true);
  });

  it('does not claim unrelated handlers', () => {
    expect(isPingBackCodexHandler({ type: 'command', command: 'custom-logger' })).toBe(
      false,
    );
  });
});

describe('installCodexHooks', () => {
  it('installs required hooks into empty settings', () => {
    const result = installCodexHooks({}, spec);
    const hooks = result.hooks as Record<string, unknown[]>;

    expect(Array.isArray(hooks.UserPromptSubmit)).toBe(true);
    expect(Array.isArray(hooks.Stop)).toBe(true);
    expect(hasPingBackCodexHooks(result)).toBe(true);
  });

  it('preserves existing non-PingBack hooks', () => {
    const result = installCodexHooks(userHooks, spec);
    const hooks = result.hooks as Record<string, unknown[]>;

    expect(hooks.PreToolUse).toEqual(userHooks.hooks.PreToolUse);
    expect(hasPingBackCodexHooks(result)).toBe(true);
  });

  it('is idempotent on repeat installations', () => {
    const once = installCodexHooks({}, spec);
    const twice = installCodexHooks(once, spec);

    expect(twice).toEqual(once);
  });
});

describe('uninstallCodexHooks', () => {
  it('removes PingBack hooks leaving empty hooks clean', () => {
    const installed = installCodexHooks({}, spec);
    const uninstalled = uninstallCodexHooks(installed);

    expect(hasPingBackCodexHooks(uninstalled)).toBe(false);
    expect(uninstalled.hooks).toBeUndefined();
  });

  it('leaves third-party hooks intact after uninstall', () => {
    const installed = installCodexHooks(userHooks, spec);
    const uninstalled = uninstallCodexHooks(installed);

    expect(uninstalled).toEqual(userHooks);
  });
});

describe('computeHookHash', () => {
  it('calculates sha256 hash string', () => {
    const hash = computeHookHash('node test.js');
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
