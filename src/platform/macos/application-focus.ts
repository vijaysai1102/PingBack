import { runCommand, type CommandRunner } from '../../applications/command-runner.js';
import {
  editorsForProject,
  type EditorProcess,
} from '../../applications/editor-processes.js';
import { isProjectInEditorWorkspaces } from '../../applications/editor-storage.js';
import type {
  ApplicationFocusPlatform,
  ApplicationInfo,
} from '../../applications/project-association.js';
import { readHostInfo, type HostInfo } from '../platform.js';

const PROCESS_COMMAND = '/bin/ps';
const PROCESS_ARGS = ['-axo', 'pid=,comm=,command='] as const;
const APPLESCRIPT = '/usr/bin/osascript';
const SUPPORTED_EDITOR_IDS = new Set(['cursor', 'visual-studio-code']);

function activateCommand(processId: number): string {
  return `tell application "System Events" to set frontmost of (first process whose unix id is ${processId}) to true`;
}

function frontmostCommand(processId: number): string {
  return `tell application "System Events" to return frontmost of (first process whose unix id is ${processId})`;
}

function executableName(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments.at(-1) ?? path;
}

function parseProcesses(output: string): EditorProcess[] {
  return output.split(/\r?\n/).flatMap((line): EditorProcess[] => {
    const match = /^\s*(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (match === null) return [];
    const processId = Number(match[1]);
    const executablePath = match[2];
    const commandLine = match[3];
    if (
      !Number.isInteger(processId) ||
      executablePath === undefined ||
      commandLine === undefined
    ) {
      return [];
    }
    return [{ executable: executableName(executablePath), commandLine, processId }];
  });
}

/** macOS process discovery and foregrounding for a project-associated editor. */
export class MacosApplicationFocusPlatform implements ApplicationFocusPlatform {
  readonly #run: CommandRunner;
  readonly #host: HostInfo;

  constructor(run: CommandRunner = runCommand, host: HostInfo = readHostInfo()) {
    this.#run = run;
    this.#host = host;
  }

  async discover(projectPath: string): Promise<ApplicationInfo[]> {
    const result = await this.#run(PROCESS_COMMAND, PROCESS_ARGS);
    if (result.exitCode !== 0) return [];
    const processes = parseProcesses(result.stdout);

    // 1. Direct process command-line match
    const fromCommandLine = editorsForProject(processes, projectPath, 'macos');
    if (fromCommandLine.length > 0) return fromCommandLine;

    // 2. Check open workspaces in storage metadata for running editors
    const context = {
      platform: 'macos' as const,
      homedir: this.#host.homedir,
      env: this.#host.env,
    };

    const applications: ApplicationInfo[] = [];

    // Cursor
    const cursorProcesses = processes.filter(
      (p) => p.executable.toLowerCase() === 'cursor',
    );
    if (cursorProcesses.length > 0) {
      if (isProjectInEditorWorkspaces(projectPath, 'cursor', context)) {
        applications.push({
          id: 'cursor',
          name: 'Cursor',
          projectPaths: [projectPath],
          ...(cursorProcesses[0]?.processId === undefined
            ? {}
            : { processId: cursorProcesses[0].processId }),
        });
      }
    }

    // VS Code
    const codeProcesses = processes.filter(
      (p) =>
        p.executable.toLowerCase() === 'code' ||
        p.executable.toLowerCase() === 'electron',
    );
    if (codeProcesses.length > 0) {
      if (isProjectInEditorWorkspaces(projectPath, 'visual-studio-code', context)) {
        applications.push({
          id: 'visual-studio-code',
          name: 'Visual Studio Code',
          projectPaths: [projectPath],
          ...(codeProcesses[0]?.processId === undefined
            ? {}
            : { processId: codeProcesses[0].processId }),
        });
      }
    }

    return applications;
  }

  async focus(application: ApplicationInfo): Promise<boolean> {
    if (!SUPPORTED_EDITOR_IDS.has(application.id)) return false;

    const processId = application.processId;
    if (!Number.isInteger(processId) || processId === undefined || processId <= 0)
      return false;

    return this.#focusProcess(processId);
  }

  async #focusProcess(processId: number): Promise<boolean> {
    const initial = await this.#activate(processId);
    if (initial && (await this.#isFrontmost(processId))) return true;

    const retry = await this.#activate(processId);
    return retry && (await this.#isFrontmost(processId));
  }

  async #activate(processId: number): Promise<boolean> {
    const result = await this.#run(APPLESCRIPT, ['-e', activateCommand(processId)]);
    return result.exitCode === 0;
  }

  async #isFrontmost(processId: number): Promise<boolean> {
    const result = await this.#run(APPLESCRIPT, ['-e', frontmostCommand(processId)]);
    return result.exitCode === 0 && result.stdout.trim().toLowerCase() === 'true';
  }
}
