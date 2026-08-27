import { describe, expect, it } from 'vitest';
import { WindowsApplicationFocusPlatform } from '../../../src/platform/windows/application-focus.js';

describe('WindowsApplicationFocusPlatform', () => {
  it('discovers only VS Code processes whose command line names the requested project', async () => {
    const platform = new WindowsApplicationFocusPlatform(() =>
      Promise.resolve({
        stdout: JSON.stringify([
          {
            Name: 'Code.exe',
            CommandLine:
              '"C:\\Program Files\\Microsoft VS Code\\Code.exe" C:\\Code\\FinBot',
            ProcessId: 101,
          },
          {
            Name: 'Code.exe',
            CommandLine:
              '"C:\\Program Files\\Microsoft VS Code\\Code.exe" C:\\Code\\Other',
            ProcessId: 202,
          },
        ]),
        stderr: '',
        exitCode: 0,
      }),
    );

    await expect(platform.discover('C:\\Code\\FinBot')).resolves.toEqual([
      {
        id: 'visual-studio-code',
        name: 'Visual Studio Code',
        projectPaths: ['C:\\Code\\FinBot'],
        processId: 101,
      },
    ]);
  });

  it('requests foregrounding only for the matched editor process', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const platform = new WindowsApplicationFocusPlatform((command, args) => {
      calls.push({ command, args });
      return Promise.resolve({ stdout: 'True\r\n', stderr: '', exitCode: 0 });
    });

    await expect(
      platform.focus({
        id: 'visual-studio-code',
        name: 'Visual Studio Code',
        projectPaths: ['C:\\Code\\FinBot'],
        processId: 101,
      }),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('powershell.exe');
    expect(calls[0]?.args).toContain('-NoProfile');
    expect(calls[0]?.args).toContain('-NonInteractive');
    expect(calls[0]?.args.at(-1)).toContain('Get-Process -Id 101');
  });
});
