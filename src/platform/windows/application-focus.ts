import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  editorsForProject,
  type EditorProcess,
} from '../../applications/editor-processes.js';
import { isProjectInEditorWorkspaces } from '../../applications/editor-storage.js';
import { runCommand, type CommandRunner } from '../../applications/command-runner.js';
import type {
  ApplicationFocusPlatform,
  ApplicationInfo,
} from '../../applications/project-association.js';
import { readHostInfo, type HostInfo } from '../platform.js';

const POWERSHELL = 'powershell.exe';
const SUPPORTED_EDITOR_IDS = new Set(['cursor', 'visual-studio-code']);
const RESTORE_WINDOW = 9;
const PROCESS_QUERY =
  'Get-CimInstance -ClassName Win32_Process | Select-Object Name,CommandLine,ProcessId | ConvertTo-Json -Compress';
const FOCUS_NATIVE_TYPE =
  'using System; using System.Runtime.InteropServices; public static class PingBackFocus { [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool BringWindowToTop(IntPtr hWnd); [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd); [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach); [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId(); }';

function focusPreamble(): string {
  return `Add-Type -TypeDefinition '${FOCUS_NATIVE_TYPE}';`;
}

function foregroundCommand(processId: number): string {
  return [
    focusPreamble(),
    `$process = Get-Process -Id ${processId} -ErrorAction Stop;`,
    '$window = [IntPtr]$process.MainWindowHandle;',
    'if ($window -eq [IntPtr]::Zero) { return; }',
    `[void][PingBackFocus]::ShowWindowAsync($window, ${RESTORE_WINDOW});`,
    '[void][PingBackFocus]::BringWindowToTop($window);',
    '[void][PingBackFocus]::SetForegroundWindow($window);',
  ].join(' ');
}

function foregroundVerificationCommand(processId: number): string {
  return [
    focusPreamble(),
    '$foregroundWindow = [PingBackFocus]::GetForegroundWindow();',
    'if ($foregroundWindow -eq [IntPtr]::Zero) { $false; return; }',
    '$foregroundProcessId = [uint32]0;',
    '[void][PingBackFocus]::GetWindowThreadProcessId($foregroundWindow, [ref]$foregroundProcessId);',
    `$foregroundProcessId -eq ${processId}`,
  ].join(' ');
}

function attachedForegroundCommand(processId: number): string {
  return [
    focusPreamble(),
    `$process = Get-Process -Id ${processId} -ErrorAction Stop;`,
    '$window = [IntPtr]$process.MainWindowHandle;',
    'if ($window -eq [IntPtr]::Zero) { return; }',
    '$foregroundWindow = [PingBackFocus]::GetForegroundWindow();',
    '$currentThread = [PingBackFocus]::GetCurrentThreadId();',
    '$foregroundProcessId = [uint32]0;',
    '$targetProcessId = [uint32]0;',
    '$foregroundThread = [PingBackFocus]::GetWindowThreadProcessId($foregroundWindow, [ref]$foregroundProcessId);',
    '$targetThread = [PingBackFocus]::GetWindowThreadProcessId($window, [ref]$targetProcessId);',
    '$foregroundAttached = $false;',
    '$targetAttached = $false;',
    'try {',
    'if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) { $foregroundAttached = [PingBackFocus]::AttachThreadInput($currentThread, $foregroundThread, $true); }',
    'if ($targetThread -ne 0 -and $targetThread -ne $currentThread) { $targetAttached = [PingBackFocus]::AttachThreadInput($currentThread, $targetThread, $true); }',
    `[void][PingBackFocus]::ShowWindowAsync($window, ${RESTORE_WINDOW});`,
    '[void][PingBackFocus]::BringWindowToTop($window);',
    '[void][PingBackFocus]::SetForegroundWindow($window);',
    '[void][PingBackFocus]::SetFocus($window);',
    '} finally {',
    'if ($targetAttached) { [void][PingBackFocus]::AttachThreadInput($currentThread, $targetThread, $false); }',
    'if ($foregroundAttached) { [void][PingBackFocus]::AttachThreadInput($currentThread, $foregroundThread, $false); }',
    '}',
  ].join(' ');
}

function findEditorCli(editorId: string, host: HostInfo): string | undefined {
  const localAppData =
    host.env.LOCALAPPDATA ?? path.win32.join(host.homedir, 'AppData', 'Local');
  const programFiles = host.env.ProgramFiles ?? 'C:\\Program Files';
  const candidates: string[] = [];

  if (editorId === 'cursor') {
    candidates.push(
      path.win32.join(
        localAppData,
        'Programs',
        'cursor',
        'resources',
        'app',
        'bin',
        'cursor.cmd',
      ),
      path.win32.join(localAppData, 'Programs', 'cursor', 'bin', 'cursor.cmd'),
      path.win32.join(programFiles, 'cursor', 'bin', 'cursor.cmd'),
    );
  } else if (editorId === 'visual-studio-code') {
    candidates.push(
      path.win32.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.win32.join(programFiles, 'Microsoft VS Code', 'bin', 'code.cmd'),
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

interface WindowsProcessRecord {
  Name?: unknown;
  CommandLine?: unknown;
  ProcessId?: unknown;
}

function parseProcesses(output: string): EditorProcess[] {
  if (output.trim().length === 0) return [];

  let records: unknown;
  try {
    records = JSON.parse(output);
  } catch {
    return [];
  }

  const values = Array.isArray(records) ? records : [records];
  return values.flatMap((value): EditorProcess[] => {
    if (value === null || typeof value !== 'object') return [];
    const record = value as WindowsProcessRecord;
    if (
      typeof record.Name !== 'string' ||
      typeof record.CommandLine !== 'string' ||
      typeof record.ProcessId !== 'number'
    ) {
      return [];
    }
    return [
      {
        executable: record.Name,
        commandLine: record.CommandLine,
        processId: record.ProcessId,
      },
    ];
  });
}

/** Windows process discovery and foregrounding for a project-associated editor. */
export class WindowsApplicationFocusPlatform implements ApplicationFocusPlatform {
  readonly #run: CommandRunner;
  readonly #host: HostInfo;

  constructor(run: CommandRunner = runCommand, host: HostInfo = readHostInfo()) {
    this.#run = run;
    this.#host = host;
  }

  async discover(projectPath: string): Promise<ApplicationInfo[]> {
    const result = await this.#run(POWERSHELL, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      PROCESS_QUERY,
    ]);
    if (result.exitCode !== 0) return [];
    const processes = parseProcesses(result.stdout);

    // 1. Direct process command-line match
    const fromCommandLine = editorsForProject(processes, projectPath, 'windows');
    if (fromCommandLine.length > 0) return fromCommandLine;

    // 2. Check open workspaces in storage metadata for running editors
    const context = {
      platform: 'windows' as const,
      homedir: this.#host.homedir,
      env: this.#host.env,
    };

    const applications: ApplicationInfo[] = [];

    // Cursor
    const cursorProcesses = processes.filter(
      (p) =>
        p.executable.toLowerCase() === 'cursor.exe' ||
        p.executable.toLowerCase() === 'cursor',
    );
    if (cursorProcesses.length > 0) {
      if (isProjectInEditorWorkspaces(projectPath, 'cursor', context)) {
        const main =
          cursorProcesses.find(
            (p) => !p.commandLine.includes('--type=') && !p.commandLine.includes('.js'),
          ) ?? cursorProcesses[0];
        applications.push({
          id: 'cursor',
          name: 'Cursor',
          projectPaths: [projectPath],
          ...(main?.processId === undefined ? {} : { processId: main.processId }),
        });
      }
    }

    // VS Code
    const codeProcesses = processes.filter(
      (p) =>
        p.executable.toLowerCase() === 'code.exe' ||
        p.executable.toLowerCase() === 'code',
    );
    if (codeProcesses.length > 0) {
      if (isProjectInEditorWorkspaces(projectPath, 'visual-studio-code', context)) {
        const main =
          codeProcesses.find(
            (p) => !p.commandLine.includes('--type=') && !p.commandLine.includes('.js'),
          ) ?? codeProcesses[0];
        applications.push({
          id: 'visual-studio-code',
          name: 'Visual Studio Code',
          projectPaths: [projectPath],
          ...(main?.processId === undefined ? {} : { processId: main.processId }),
        });
      }
    }

    return applications;
  }

  async focus(application: ApplicationInfo): Promise<boolean> {
    if (!SUPPORTED_EDITOR_IDS.has(application.id)) return false;

    const processId = application.processId;
    if (
      Number.isInteger(processId) &&
      processId !== undefined &&
      processId > 0 &&
      (await this.#focusProcess(processId))
    ) {
      return true;
    }

    // A launcher can restore the matching project window, but its successful
    // exit does not prove that Windows granted it foreground ownership.
    const projectPath = application.projectPaths[0];
    if (projectPath !== undefined) {
      const cliPath = findEditorCli(application.id, this.#host);
      if (cliPath !== undefined) {
        const result = await this.#run('cmd.exe', ['/c', cliPath, projectPath]);
        if (
          result.exitCode === 0 &&
          Number.isInteger(processId) &&
          processId !== undefined &&
          processId > 0
        ) {
          return this.#focusProcess(processId);
        }
      }
      // Try bare command on PATH
      const bareCmd =
        application.id === 'cursor'
          ? 'cursor'
          : application.id === 'visual-studio-code'
            ? 'code'
            : undefined;
      if (bareCmd !== undefined) {
        const result = await this.#run('cmd.exe', ['/c', bareCmd, projectPath]);
        if (
          result.exitCode === 0 &&
          Number.isInteger(processId) &&
          processId !== undefined &&
          processId > 0
        ) {
          return this.#focusProcess(processId);
        }
      }
    }

    return false;
  }

  async #focusProcess(processId: number): Promise<boolean> {
    const direct = await this.#run(POWERSHELL, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      foregroundCommand(processId),
    ]);
    if (direct.exitCode === 0 && (await this.#isForeground(processId))) return true;

    const attached = await this.#run(POWERSHELL, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      attachedForegroundCommand(processId),
    ]);
    return attached.exitCode === 0 && (await this.#isForeground(processId));
  }

  async #isForeground(processId: number): Promise<boolean> {
    const result = await this.#run(POWERSHELL, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      foregroundVerificationCommand(processId),
    ]);
    return result.exitCode === 0 && result.stdout.trim().toLowerCase() === 'true';
  }
}
