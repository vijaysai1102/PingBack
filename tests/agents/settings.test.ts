import { describe, expect, it } from 'vitest';
import {
  hasPingBackHooks,
  installHooks,
  isPingBackHandler,
  uninstallHooks,
  type HookCommandSpec,
} from '../../src/agents/claude/settings.js';
import { CLAUDE_HOOK_EVENTS } from '../../src/agents/claude/types.js';

const spec: HookCommandSpec = {
  command: 'node',
  scriptPath: 'C:\\npm\\pingback\\dist\\agents\\claude\\hook-entry.js',
};

const userSettings = {
  permissions: { allow: ['Bash(git status)'] },
  model: 'sonnet',
  hooks: {
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-audit-script' }] },
    ],
  },
};

describe('isPingBackHandler', () => {
  it('recognizes a handler by its args', () => {
    expect(
      isPingBackHandler({ type: 'command', command: 'node', args: [spec.scriptPath] }),
    ).toBe(true);
  });

  it('recognizes a handler declared in shell form', () => {
    expect(isPingBackHandler({ type: 'command', command: 'node /x/hook-entry.js' })).toBe(
      true,
    );
  });

  it('does not claim unrelated handlers', () => {
    expect(isPingBackHandler({ type: 'command', command: 'my-audit-script' })).toBe(
      false,
    );
    expect(isPingBackHandler({ type: 'command', command: 'node build.js' })).toBe(false);
    expect(isPingBackHandler(null)).toBe(false);
    expect(isPingBackHandler('nope')).toBe(false);
  });
});

describe('installHooks', () => {
  it('adds a handler for every hook event PingBack needs', () => {
    const result = installHooks({}, spec);
    const hooks = result.hooks as Record<string, unknown>;

    for (const event of CLAUDE_HOOK_EVENTS) {
      expect(Array.isArray(hooks[event])).toBe(true);
    }
  });

  it('uses exec form so the path needs no shell quoting', () => {
    const result = installHooks({}, spec);
    const hooks = result.hooks as Record<string, { hooks: Record<string, unknown>[] }[]>;
    const handler = hooks.Notification?.[0]?.hooks[0];

    expect(handler).toMatchObject({
      type: 'command',
      command: 'node',
      args: [spec.scriptPath],
    });
  });

  it('gives SessionEnd a small timeout because it shares a 1.5s budget', () => {
    const result = installHooks({}, spec);
    const hooks = result.hooks as Record<string, { hooks: { timeout?: number }[] }[]>;

    expect(hooks.SessionEnd?.[0]?.hooks[0]?.timeout).toBe(3);
    expect(hooks.Notification?.[0]?.hooks[0]?.timeout).toBe(5);
  });

  it('preserves unrelated top-level settings', () => {
    const result = installHooks(userSettings, spec);

    expect(result.permissions).toEqual(userSettings.permissions);
    expect(result.model).toBe('sonnet');
  });

  it('preserves unrelated hooks', () => {
    const result = installHooks(userSettings, spec);
    const hooks = result.hooks as Record<string, unknown[]>;

    expect(hooks.PreToolUse).toEqual(userSettings.hooks.PreToolUse);
  });

  it('does not mutate the input settings', () => {
    const original = JSON.parse(JSON.stringify(userSettings)) as unknown;
    installHooks(userSettings, spec);

    expect(userSettings).toEqual(original);
  });

  it('is idempotent: re-running does not duplicate handlers', () => {
    const once = installHooks({}, spec);
    const twice = installHooks(once, spec);
    const hooks = twice.hooks as Record<string, unknown[]>;

    expect(hooks.Notification).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  it('removes a retired PingBack hook while preserving the supported hooks', () => {
    const settingsWithRetiredHook = {
      hooks: {
        Stop: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: 'node',
                args: ['C:\\npm\\pingback\\dist\\agents\\claude\\hook-entry.js'],
              },
            ],
          },
        ],
      },
    };

    const result = installHooks(settingsWithRetiredHook, spec);
    const hooks = result.hooks as Record<string, unknown>;

    expect(hooks.Stop).toBeUndefined();
    expect(hooks.Notification).toBeDefined();
  });

  it('replaces a handler installed at a previous path', () => {
    const old = installHooks({}, { command: 'node', scriptPath: '/old/hook-entry.js' });
    const updated = installHooks(old, spec);
    const hooks = updated.hooks as Record<string, { hooks: { args: string[] }[] }[]>;

    expect(hooks.Notification).toHaveLength(1);
    expect(hooks.Notification?.[0]?.hooks[0]?.args).toEqual([spec.scriptPath]);
  });

  it('keeps a user handler that shares an event with PingBack', () => {
    const existing = {
      hooks: {
        Notification: [
          { matcher: '*', hooks: [{ type: 'command', command: 'user-notify' }] },
        ],
      },
    };
    const result = installHooks(existing, spec);
    const groups = result.hooks as Record<string, { hooks: { command?: string }[] }[]>;

    expect(groups.Notification).toHaveLength(2);
    expect(groups.Notification?.[0]?.hooks[0]?.command).toBe('user-notify');
  });

  it('handles a non-object settings root', () => {
    expect(() => installHooks(null, spec)).not.toThrow();
    expect(installHooks('junk', spec).hooks).toBeDefined();
  });
});

describe('hasPingBackHooks', () => {
  it('is true after install', () => {
    expect(hasPingBackHooks(installHooks({}, spec))).toBe(true);
  });

  it('is false for untouched settings', () => {
    expect(hasPingBackHooks({})).toBe(false);
    expect(hasPingBackHooks(userSettings)).toBe(false);
    expect(hasPingBackHooks(null)).toBe(false);
  });

  it('is false when only some events are configured', () => {
    const partial = installHooks({}, spec);
    const hooks = partial.hooks as Record<string, unknown>;
    delete hooks.SessionEnd;

    expect(hasPingBackHooks(partial)).toBe(false);
  });
});

describe('uninstallHooks', () => {
  it('removes every PingBack handler', () => {
    const installed = installHooks({}, spec);
    const result = uninstallHooks(installed);

    expect(hasPingBackHooks(result)).toBe(false);
    expect(result.hooks).toBeUndefined();
  });

  it('leaves unrelated hooks and settings intact', () => {
    const installed = installHooks(userSettings, spec);
    const result = uninstallHooks(installed);
    const hooks = result.hooks as Record<string, unknown[]>;

    expect(hooks.PreToolUse).toEqual(userSettings.hooks.PreToolUse);
    expect(result.permissions).toEqual(userSettings.permissions);
    expect(result.model).toBe('sonnet');
  });

  it('restores settings to their original shape', () => {
    const installed = installHooks(userSettings, spec);
    expect(uninstallHooks(installed)).toEqual(userSettings);
  });

  it('keeps a user handler sharing an event with PingBack', () => {
    const existing = {
      hooks: {
        Notification: [
          { matcher: '*', hooks: [{ type: 'command', command: 'user-notify' }] },
        ],
      },
    };
    const result = uninstallHooks(installHooks(existing, spec));

    expect(result).toEqual(existing);
  });

  it('is safe to run when nothing is installed', () => {
    expect(uninstallHooks({})).toEqual({});
    expect(uninstallHooks(userSettings)).toEqual(userSettings);
  });
});
