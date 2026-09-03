import { describe, expect, it } from 'vitest';
import type { CommandRunner } from '../../../src/applications/command-runner.js';
import { installWindowsToastRegistration } from '../../../src/platform/windows/index.js';

describe('installWindowsToastRegistration', () => {
  it('registers PingBack with SnoreToast before it sends actionable toasts', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const run: CommandRunner = (command, args) => {
      calls.push({ command, args });
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
    };

    await expect(
      installWindowsToastRegistration(run, {
        executable: 'C:\\PingBack\\node_modules\\node-notifier\\snoretoast-x64.exe',
        application: 'C:\\Program Files\\nodejs\\node.exe',
        appId: 'PingBack',
      }),
    ).resolves.toBe(true);

    expect(calls).toEqual([
      {
        command: 'C:\\PingBack\\node_modules\\node-notifier\\snoretoast-x64.exe',
        args: ['-install', 'PingBack', 'C:\\Program Files\\nodejs\\node.exe', 'PingBack'],
      },
    ]);
  });
});
