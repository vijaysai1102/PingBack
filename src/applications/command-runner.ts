import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<CommandResult>;

/** Runs a native command without a shell so project paths are never interpolated as code. */
export async function runCommand(
  command: string,
  args: readonly string[],
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, [...args], { windowsHide: true });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const commandError = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      stdout: commandError.stdout ?? '',
      stderr: commandError.stderr ?? '',
      exitCode: typeof commandError.code === 'number' ? commandError.code : 1,
    };
  }
}
