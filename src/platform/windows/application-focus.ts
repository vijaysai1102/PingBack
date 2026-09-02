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
const PROCESS_QUERY =
  'Get-CimInstance -ClassName Win32_Process | Select-Object Name,CommandLine,ProcessId | ConvertTo-Json -Compress';

function foregroundCommand(processId: number): string {
  return [
    'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class PingBackFocus { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }\';',
    `$process = Get-Process -Id ${processId} -ErrorAction Stop;`,
    '[PingBackFocus]::SetForegroundWindow($process.MainWindowHandle)',
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
    const processId = application.processId;
    if (Number.isInteger(processId) && processId !== undefined && processId > 0) {
      const result = await this.#run(POWERSHELL, [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        foregroundCommand(processId),
      ]);
      if (result.exitCode === 0 && result.stdout.trim().toLowerCase() === 'true') {
        return true;
      }
    }

    // Fallback: use editor CLI launcher to bring the window to the foreground
    const projectPath = application.projectPaths[0];
    if (projectPath !== undefined) {
      const cliPath = findEditorCli(application.id, this.#host);
      if (cliPath !== undefined) {
        const result = await this.#run('cmd.exe', ['/c', cliPath, projectPath]);
        if (result.exitCode === 0) return true;
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
        if (result.exitCode === 0) return true;
      }
    }

    return false;
  }
}
