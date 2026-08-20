import { describe, expect, it } from 'vitest';

type TerminalFocusModule = {
  UnavailableTerminalFocusService?: new () => {
    focusTerminal(session: { pid?: number; cwd?: string }): Promise<{
      focused: boolean;
      message: string;
    }>;
  };
  WindowsTerminalFocusService?: new (options: {
    runner: { run(args: string[]): Promise<string> };
  }) => {
    detectTerminal(session: { pid?: number }): Promise<unknown>;
    focusTerminal(session: { pid?: number; cwd?: string }): Promise<{
      focused: boolean;
      message: string;
      terminal?: unknown;
    }>;
  };
  MacosTerminalFocusService?: new (options: {
    runner: { run(command: string, args: string[]): Promise<string> };
  }) => {
    focusTerminal(session: { pid?: number; cwd?: string }): Promise<{
      focused: boolean;
      message: string;
      terminal?: unknown;
    }>;
  };
};

async function loadTerminalFocus(): Promise<TerminalFocusModule | undefined> {
  return await import('../../src/platform/terminal-focus.js').catch(() => undefined);
}

describe('terminal focus services', () => {
  it('returns a clear fallback without a session PID', async () => {
    const api = await loadTerminalFocus();
    expect(api?.UnavailableTerminalFocusService).toBeTypeOf('function');
    if (api?.UnavailableTerminalFocusService === undefined) return;

    const service = new api.UnavailableTerminalFocusService();
    await expect(service.focusTerminal({ cwd: '/code/finbot' })).resolves.toEqual({
      focused: false,
      message: 'Unable to focus this agent terminal. Open project: /code/finbot',
    });
  });

  it('focuses only the visible recognized Windows parent process', async () => {
    const api = await loadTerminalFocus();
    expect(api?.WindowsTerminalFocusService).toBeTypeOf('function');
    if (api?.WindowsTerminalFocusService === undefined) return;

    const invocations: string[][] = [];
    const service = new api.WindowsTerminalFocusService({
      runner: {
        run(args: string[]): Promise<string> {
          invocations.push(args);
          return Promise.resolve(
            JSON.stringify({
              processId: 812,
              processName: 'WindowsTerminal',
              windowId: '0x0000032C',
              focused: true,
            }),
          );
        },
      },
    });

    await expect(
      service.focusTerminal({ pid: 900, cwd: 'C:\\code\\api' }),
    ).resolves.toEqual({
      focused: true,
      message: 'Focused WindowsTerminal.',
      terminal: {
        processId: 812,
        processName: 'WindowsTerminal',
        windowId: '0x0000032C',
      },
    });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.join(' ')).toContain('$agentPid = 900');
  });

  it('does not focus a Windows window when process discovery is malformed', async () => {
    const api = await loadTerminalFocus();
    expect(api?.WindowsTerminalFocusService).toBeTypeOf('function');
    if (api?.WindowsTerminalFocusService === undefined) return;

    const service = new api.WindowsTerminalFocusService({
      runner: { run: () => Promise.resolve('not-json') },
    });

    await expect(
      service.focusTerminal({ pid: 900, cwd: 'C:\\code\\api' }),
    ).resolves.toEqual({
      focused: false,
      message: 'Unable to focus this agent terminal. Open project: C:\\code\\api',
    });
  });

  it('selects the exact macOS terminal TTY rather than merely activating an app', async () => {
    const api = await loadTerminalFocus();
    expect(api?.MacosTerminalFocusService).toBeTypeOf('function');
    if (api?.MacosTerminalFocusService === undefined) return;

    const invocations: Array<{ command: string; args: string[] }> = [];
    const service = new api.MacosTerminalFocusService({
      runner: {
        run(command: string, args: string[]): Promise<string> {
          invocations.push({ command, args });
          if (command === '/bin/ps') return Promise.resolve('ttys001\n');
          return Promise.resolve('focused\n');
        },
      },
    });

    await expect(service.focusTerminal({ pid: 901, cwd: '/code/api' })).resolves.toEqual({
      focused: true,
      message: 'Focused terminal tab ttys001.',
      terminal: { processId: 901, processName: 'Terminal', tty: 'ttys001' },
    });
    expect(invocations[1]?.command).toBe('/usr/bin/osascript');
    expect(invocations[1]?.args.join(' ')).toContain('/dev/ttys001');
  });
});
