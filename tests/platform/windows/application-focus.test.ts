import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    expect(calls).toHaveLength(2);
    expect(calls[0]?.command).toBe('powershell.exe');
    expect(calls[0]?.args).toContain('-NoProfile');
    expect(calls[0]?.args).toContain('-NonInteractive');
    expect(calls[0]?.args.at(-1)).toContain('Get-Process -Id 101');
    expect(calls[1]?.command).toBe('powershell.exe');
  });

  it('refuses to foreground an application other than Cursor or VS Code', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const platform = new WindowsApplicationFocusPlatform((command, args) => {
      calls.push({ command, args });
      return Promise.resolve({ stdout: 'True\r\n', stderr: '', exitCode: 0 });
    });

    await expect(
      platform.focus({
        id: 'webstorm',
        name: 'WebStorm',
        projectPaths: ['C:\\Code\\FinBot'],
        processId: 101,
      }),
    ).resolves.toBe(false);

    expect(calls).toEqual([]);
  });

  it('does not report focus when Windows leaves the matched editor outside the foreground', async () => {
    let invocation = 0;
    const platform = new WindowsApplicationFocusPlatform(() => {
      invocation += 1;
      return Promise.resolve({
        stdout: invocation % 2 === 1 ? 'True\r\n' : 'False\r\n',
        stderr: '',
        exitCode: 0,
      });
    });

    await expect(
      platform.focus({
        id: 'cursor',
        name: 'Cursor',
        projectPaths: [],
        processId: 505,
      }),
    ).resolves.toBe(false);

    expect(invocation).toBe(4);
  });

  it('discovers running Cursor via workspace metadata when command line has no project path', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pb-win-focus-'));
    const cursorDir = path.join(
      dir,
      'AppData',
      'Roaming',
      'Cursor',
      'User',
      'globalStorage',
    );
    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(
      path.join(cursorDir, 'storage.json'),
      JSON.stringify({
        windowsState: {
          openedWindows: [{ folder: 'file:///c%3A/Code/FinBot' }],
        },
      }),
    );

    try {
      const host = {
        platform: 'win32' as const,
        homedir: dir,
        env: { APPDATA: path.join(dir, 'AppData', 'Roaming') },
        uid: '1000',
        tmpdir: dir,
      };

      const platform = new WindowsApplicationFocusPlatform(
        () =>
          Promise.resolve({
            stdout: JSON.stringify([
              {
                Name: 'Cursor.exe',
                CommandLine:
                  '"C:\\Users\\dev\\AppData\\Local\\Programs\\cursor\\Cursor.exe"',
                ProcessId: 505,
              },
            ]),
            stderr: '',
            exitCode: 0,
          }),
        host,
      );

      await expect(platform.discover('C:\\Code\\FinBot')).resolves.toEqual([
        {
          id: 'cursor',
          name: 'Cursor',
          projectPaths: ['C:\\Code\\FinBot'],
          processId: 505,
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not treat a successful editor launch as foreground success when verification fails', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const host = {
      platform: 'win32' as const,
      homedir: 'C:\\Users\\dev',
      env: {},
      uid: '1000',
      tmpdir: 'C:\\Temp',
    };

    const platform = new WindowsApplicationFocusPlatform((command, args) => {
      calls.push({ command, args });
      if (command === 'powershell.exe') {
        // Simulates Electron returning False because MainWindowHandle is 0
        return Promise.resolve({ stdout: 'False\r\n', stderr: '', exitCode: 0 });
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
    }, host);

    await expect(
      platform.focus({
        id: 'cursor',
        name: 'Cursor',
        projectPaths: ['C:\\Code\\FinBot'],
        processId: 505,
      }),
    ).resolves.toBe(false);

    expect(calls).toHaveLength(9);
    expect(calls[0]?.command).toBe('powershell.exe');
    expect(calls[4]?.command).toBe('cmd.exe');
    expect(calls[4]?.args).toEqual(['/c', 'cursor', 'C:\\Code\\FinBot']);
    expect(calls[5]?.command).toBe('powershell.exe');
  });
});
