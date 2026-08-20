import { describe, expect, it } from 'vitest';
import {
  hasPingBackCodexLifecycleHooks,
  hasPingBackCodexNotify,
  installCodexLifecycleHooks,
  installCodexNotify,
  uninstallCodexLifecycleHooks,
  uninstallCodexNotify,
} from '../../../src/agents/codex/settings.js';

const spec = {
  command: 'node',
  scriptPath: '/opt/pingback/dist/agents/codex/notify-entry.js',
};

const existingConfig = [
  'model = "gpt-5"',
  'notify = ["existing-notifier", "turn-ended"]',
  '',
  '[projects."/code"]',
  'trust_level = "trusted"',
  '',
].join('\n');

describe('Codex notify configuration', () => {
  it('installs PingBack as the notify command while retaining the prior command for forwarding', () => {
    const result = installCodexNotify(existingConfig, spec);

    expect(result).toEqual({
      config: [
        'model = "gpt-5"',
        'notify = ["node", "/opt/pingback/dist/agents/codex/notify-entry.js"]',
        '',
        '[projects."/code"]',
        'trust_level = "trusted"',
        '',
      ].join('\n'),
      originalNotify: ['existing-notifier', 'turn-ended'],
    });
  });

  it('is idempotent and recognizes only its own managed notify command', () => {
    const installed = installCodexNotify('', spec);

    expect(hasPingBackCodexNotify(installed.config)).toBe(true);
    expect(installCodexNotify(installed.config, spec)).toEqual({
      config: installed.config,
    });
  });

  it('restores an existing notify command during uninstall without touching unrelated configuration', () => {
    const installed = installCodexNotify(existingConfig, spec);

    expect(uninstallCodexNotify(installed.config, installed.originalNotify)).toBe(
      existingConfig,
    );
  });

  it('refuses to append a second notify setting when the existing value cannot be safely parsed', () => {
    expect(() => installCodexNotify('notify = ["existing"\n', spec)).toThrow(
      'could not safely parse the existing top-level Codex notify setting',
    );
  });
});

describe('Codex lifecycle hook configuration', () => {
  const lifecycleSpec = {
    command: 'node',
    scriptPath: 'C:\\npm\\pingback\\dist\\agents\\codex\\lifecycle-entry.js',
  };

  it("adds asynchronous approval and working-state hooks without replacing another tool's hooks", () => {
    const userHooks = {
      hooks: {
        Stop: [
          {
            _litmus: 1,
            hooks: [{ type: 'command', command: 'node C:/litmus/stop.js' }],
          },
        ],
      },
    };

    const installed = installCodexLifecycleHooks(userHooks, lifecycleSpec);

    expect(installed).toEqual({
      hooks: {
        Stop: userHooks.hooks.Stop,
        PermissionRequest: [
          {
            _pingback: 1,
            hooks: [
              {
                type: 'command',
                command:
                  'node C:/npm/pingback/dist/agents/codex/lifecycle-entry.js codex',
                timeout: 15,
                async: true,
              },
            ],
          },
        ],
        SessionStart: [
          {
            _pingback: 1,
            hooks: [
              {
                type: 'command',
                command:
                  'node C:/npm/pingback/dist/agents/codex/lifecycle-entry.js codex',
                timeout: 15,
                async: true,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            _pingback: 1,
            hooks: [
              {
                type: 'command',
                command:
                  'node C:/npm/pingback/dist/agents/codex/lifecycle-entry.js codex',
                timeout: 15,
                async: true,
              },
            ],
          },
        ],
      },
    });
    expect(hasPingBackCodexLifecycleHooks(installed)).toBe(true);
  });

  it('removes only PingBack lifecycle hooks on uninstall', () => {
    const userHooks = {
      hooks: {
        Stop: [{ _litmus: 1, hooks: [{ type: 'command', command: 'node stop.js' }] }],
      },
    };

    const uninstalled = uninstallCodexLifecycleHooks(
      installCodexLifecycleHooks(userHooks, lifecycleSpec),
    );

    expect(uninstalled).toEqual(userHooks);
    expect(hasPingBackCodexLifecycleHooks(uninstalled)).toBe(false);
  });
});
