import {
  editorsForProject,
  type EditorProcess,
} from '../../applications/editor-processes.js';
import { runCommand, type CommandRunner } from '../../applications/command-runner.js';
import type {
  ApplicationFocusPlatform,
  ApplicationInfo,
} from '../../applications/project-association.js';

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

  constructor(run: CommandRunner = runCommand) {
    this.#run = run;
  }

  async discover(projectPath: string): Promise<ApplicationInfo[]> {
    const result = await this.#run(POWERSHELL, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      PROCESS_QUERY,
    ]);
    if (result.exitCode !== 0) return [];
    return editorsForProject(parseProcesses(result.stdout), projectPath, 'windows');
  }

  async focus(application: ApplicationInfo): Promise<boolean> {
    const processId = application.processId;
    if (!Number.isInteger(processId) || processId === undefined || processId <= 0)
      return false;

    const result = await this.#run(POWERSHELL, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      foregroundCommand(processId),
    ]);
    return result.exitCode === 0 && result.stdout.trim().toLowerCase() === 'true';
  }
}
