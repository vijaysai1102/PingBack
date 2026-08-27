import { runCommand, type CommandRunner } from '../../applications/command-runner.js';
import {
  editorsForProject,
  type EditorProcess,
} from '../../applications/editor-processes.js';
import type {
  ApplicationFocusPlatform,
  ApplicationInfo,
} from '../../applications/project-association.js';

const PROCESS_COMMAND = '/bin/ps';
const PROCESS_ARGS = ['-axo', 'pid=,comm=,command='] as const;
const APPLESCRIPT = '/usr/bin/osascript';

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

  constructor(run: CommandRunner = runCommand) {
    this.#run = run;
  }

  async discover(projectPath: string): Promise<ApplicationInfo[]> {
    const result = await this.#run(PROCESS_COMMAND, PROCESS_ARGS);
    if (result.exitCode !== 0) return [];
    return editorsForProject(parseProcesses(result.stdout), projectPath, 'macos');
  }

  async focus(application: ApplicationInfo): Promise<boolean> {
    const processId = application.processId;
    if (!Number.isInteger(processId) || processId === undefined || processId <= 0)
      return false;

    const result = await this.#run(APPLESCRIPT, [
      '-e',
      `tell application "System Events" to set frontmost of (first process whose unix id is ${processId}) to true`,
    ]);
    return result.exitCode === 0;
  }
}
