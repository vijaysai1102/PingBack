import { describe, expect, it } from 'vitest';
import { MacosApplicationFocusPlatform } from '../../../src/platform/macos/application-focus.js';

describe('MacosApplicationFocusPlatform', () => {
  it('discovers only Cursor processes whose command line names the requested project', async () => {
    const platform = new MacosApplicationFocusPlatform(() =>
      Promise.resolve({
        stdout: [
          '  101 /Applications/Cursor.app/Contents/MacOS/Cursor /Applications/Cursor.app/Contents/MacOS/Cursor /Users/dev/FinBot',
          '  202 /Applications/Cursor.app/Contents/MacOS/Cursor /Applications/Cursor.app/Contents/MacOS/Cursor /Users/dev/Other',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      }),
    );

    await expect(platform.discover('/Users/dev/FinBot')).resolves.toEqual([
      {
        id: 'cursor',
        name: 'Cursor',
        projectPaths: ['/Users/dev/FinBot'],
        processId: 101,
      },
    ]);
  });

  it('requests foregrounding only for the matched editor process', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const platform = new MacosApplicationFocusPlatform((command, args) => {
      calls.push({ command, args });
      return Promise.resolve({
        stdout: calls.length === 2 ? 'true\n' : '',
        stderr: '',
        exitCode: 0,
      });
    });

    await expect(
      platform.focus({
        id: 'cursor',
        name: 'Cursor',
        projectPaths: ['/Users/dev/FinBot'],
        processId: 101,
      }),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ command: '/usr/bin/osascript' });
    expect(calls[0]?.args).toEqual([
      '-e',
      'tell application "System Events" to set frontmost of (first process whose unix id is 101) to true',
    ]);
    expect(calls[1]?.args).toEqual([
      '-e',
      'tell application "System Events" to return frontmost of (first process whose unix id is 101)',
    ]);
  });

  it('does not report focus when macOS leaves the matched editor behind other apps', async () => {
    let invocation = 0;
    const platform = new MacosApplicationFocusPlatform(() => {
      invocation += 1;
      return Promise.resolve({
        stdout: invocation % 2 === 0 ? 'false\n' : '',
        stderr: '',
        exitCode: 0,
      });
    });

    await expect(
      platform.focus({
        id: 'cursor',
        name: 'Cursor',
        projectPaths: [],
        processId: 101,
      }),
    ).resolves.toBe(false);

    expect(invocation).toBe(4);
  });

  it('refuses to foreground an application other than Cursor or VS Code', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const platform = new MacosApplicationFocusPlatform((command, args) => {
      calls.push({ command, args });
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
    });

    await expect(
      platform.focus({
        id: 'xcode',
        name: 'Xcode',
        projectPaths: ['/Users/dev/FinBot'],
        processId: 101,
      }),
    ).resolves.toBe(false);

    expect(calls).toEqual([]);
  });
});
