import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentSession } from '../../core/types.js';
import {
  focusFallback,
  type TerminalFocusResult,
  type TerminalFocusService,
  type TerminalInfo,
} from '../terminal-focus.js';

const execFileAsync = promisify(execFile);

export interface MacosCommandRunner {
  run(command: string, args: string[]): Promise<string>;
}

export interface MacosTerminalFocusServiceOptions {
  runner?: MacosCommandRunner;
}

class MacosRunner implements MacosCommandRunner {
  async run(command: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(command, args);
    return stdout;
  }
}

function validProcessId(pid: number | undefined): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0;
}

function ttyForOutput(raw: string): string | undefined {
  const tty = raw.trim().replace(/^\/dev\//, '');
  return /^[A-Za-z0-9]+$/.test(tty) ? tty : undefined;
}

function terminalScript(tty: string): string {
  const device = `/dev/${tty}`;
  return [
    'tell application "Terminal"',
    '  repeat with terminalWindow in windows',
    '    repeat with terminalTab in tabs of terminalWindow',
    `      if tty of terminalTab is "${device}" then`,
    '        set selected tab of terminalWindow to terminalTab',
    '        set index of terminalWindow to 1',
    '        activate',
    '        return "focused"',
    '      end if',
    '    end repeat',
    '  end repeat',
    'end tell',
    'return "not-found"',
  ].join('\n');
}

function iTermScript(tty: string): string {
  const device = `/dev/${tty}`;
  return [
    'tell application "iTerm"',
    '  repeat with terminalWindow in windows',
    '    repeat with terminalTab in tabs of terminalWindow',
    '      repeat with terminalSession in sessions of terminalTab',
    `        if tty of terminalSession is "${device}" then`,
    '          select terminalSession',
    '          activate',
    '          return "focused"',
    '        end if',
    '      end repeat',
    '    end repeat',
    '  end repeat',
    'end tell',
    'return "not-found"',
  ].join('\n');
}

/** Focuses Terminal.app or iTerm only when the session TTY is an exact match. */
export class MacosTerminalFocusService implements TerminalFocusService {
  readonly #runner: MacosCommandRunner;

  constructor(options: MacosTerminalFocusServiceOptions = {}) {
    this.#runner = options.runner ?? new MacosRunner();
  }

  async detectTerminal(
    session: Pick<AgentSession, 'pid' | 'cwd'>,
  ): Promise<TerminalInfo | undefined> {
    if (!validProcessId(session.pid)) return undefined;
    try {
      const tty = ttyForOutput(
        await this.#runner.run('/bin/ps', ['-o', 'tty=', '-p', String(session.pid)]),
      );
      return tty === undefined
        ? undefined
        : { processId: session.pid, processName: 'Terminal', tty };
    } catch {
      return undefined;
    }
  }

  async focusTerminal(
    session: Pick<AgentSession, 'pid' | 'cwd'>,
  ): Promise<TerminalFocusResult> {
    const terminal = await this.detectTerminal(session);
    if (terminal === undefined || terminal.tty === undefined)
      return focusFallback(session.cwd);

    for (const script of [terminalScript(terminal.tty), iTermScript(terminal.tty)]) {
      try {
        const result = await this.#runner.run('/usr/bin/osascript', ['-e', script]);
        if (result.trim() === 'focused') {
          return {
            focused: true,
            message: `Focused terminal tab ${terminal.tty}.`,
            terminal,
          };
        }
      } catch {
        // Try the next supported terminal application, then return a fallback.
      }
    }

    return focusFallback(session.cwd);
  }
}
