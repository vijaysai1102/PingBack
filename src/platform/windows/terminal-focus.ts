import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AgentSession } from '../../core/types.js';
import {
  focusFallback,
  type TerminalFocusResult,
  type TerminalFocusService,
  type TerminalInfo,
} from '../terminal-focus.js';

const execFileAsync = promisify(execFile);

export interface WindowsCommandRunner {
  run(args: string[]): Promise<string>;
}

export interface WindowsTerminalFocusServiceOptions {
  runner?: WindowsCommandRunner;
}

function powershellPath(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
  return path.win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

class PowerShellRunner implements WindowsCommandRunner {
  async run(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(powershellPath(), args, { windowsHide: true });
    return stdout;
  }
}

function validProcessId(pid: number | undefined): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0;
}

function focusScript(agentPid: number, focus: boolean): string {
  const focusLiteral = focus ? '$true' : '$false';
  return [
    '$ErrorActionPreference = "Stop"',
    '$terminalNames = @("WindowsTerminal", "WindowsTerminalPreview", "Code", "cmd", "powershell", "pwsh", "ConEmu64", "Hyper", "alacritty", "wezterm")',
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class PingBackWindow {',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '}',
    '"@',
    `$agentPid = ${agentPid}`,
    `$focus = ${focusLiteral}`,
    '$current = Get-CimInstance Win32_Process -Filter "ProcessId = $agentPid" -ErrorAction SilentlyContinue',
    'while ($null -ne $current) {',
    '  $process = Get-Process -Id $current.ProcessId -ErrorAction SilentlyContinue',
    '  if ($null -ne $process -and $terminalNames -contains $process.ProcessName -and $process.MainWindowHandle -ne 0) {',
    '    $focused = $false',
    '    if ($focus) {',
    '      [PingBackWindow]::ShowWindow($process.MainWindowHandle, 9) | Out-Null',
    '      $focused = [PingBackWindow]::SetForegroundWindow($process.MainWindowHandle)',
    '    }',
    '    [pscustomobject]@{ processId = $process.Id; processName = $process.ProcessName; windowId = ("0x{0:X8}" -f $process.MainWindowHandle); focused = $focused } | ConvertTo-Json -Compress',
    '    exit 0',
    '  }',
    '  if ($current.ParentProcessId -le 0 -or $current.ParentProcessId -eq $current.ProcessId) { break }',
    '  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ParentProcessId)" -ErrorAction SilentlyContinue',
    '}',
    '"{}"',
  ].join('\n');
}

function parseTerminal(
  raw: string,
): { terminal: TerminalInfo; focused: boolean } | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.processId !== 'number' ||
      !Number.isInteger(parsed.processId) ||
      parsed.processId <= 0 ||
      typeof parsed.processName !== 'string' ||
      parsed.processName.length === 0 ||
      typeof parsed.windowId !== 'string' ||
      parsed.windowId.length === 0
    ) {
      return undefined;
    }

    return {
      terminal: {
        processId: parsed.processId,
        processName: parsed.processName,
        windowId: parsed.windowId,
      },
      focused: parsed.focused === true,
    };
  } catch {
    return undefined;
  }
}

/** Focuses only a recognized terminal/IDE window found in the agent's parent chain. */
export class WindowsTerminalFocusService implements TerminalFocusService {
  readonly #runner: WindowsCommandRunner;

  constructor(options: WindowsTerminalFocusServiceOptions = {}) {
    this.#runner = options.runner ?? new PowerShellRunner();
  }

  async detectTerminal(
    session: Pick<AgentSession, 'pid' | 'cwd'>,
  ): Promise<TerminalInfo | undefined> {
    return (await this.#inspect(session.pid, false))?.terminal;
  }

  async focusTerminal(
    session: Pick<AgentSession, 'pid' | 'cwd'>,
  ): Promise<TerminalFocusResult> {
    const found = await this.#inspect(session.pid, true);
    if (found === undefined || !found.focused) return focusFallback(session.cwd);

    return {
      focused: true,
      message: `Focused ${found.terminal.processName}.`,
      terminal: found.terminal,
    };
  }

  async #inspect(
    pid: number | undefined,
    focus: boolean,
  ): Promise<{ terminal: TerminalInfo; focused: boolean } | undefined> {
    if (!validProcessId(pid)) return undefined;
    try {
      const raw = await this.#runner.run([
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        focusScript(pid, focus),
      ]);
      return parseTerminal(raw);
    } catch {
      return undefined;
    }
  }
}
