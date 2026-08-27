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
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
    });

    await expect(
      platform.focus({
        id: 'cursor',
        name: 'Cursor',
        projectPaths: ['/Users/dev/FinBot'],
        processId: 101,
      }),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: '/usr/bin/osascript' });
    expect(calls[0]?.args).toEqual([
      '-e',
      'tell application "System Events" to set frontmost of (first process whose unix id is 101) to true',
    ]);
  });
});
