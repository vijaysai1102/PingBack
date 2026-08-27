import type { PlatformId } from '../platform/platform.js';
import { runCommand, type CommandRunner } from './command-runner.js';
import { editorForExecutable } from './editor-processes.js';

const WINDOWS_COMMAND = 'powershell.exe';
const WINDOWS_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'Get-Process -Name Code,Cursor -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName',
] as const;
const MACOS_COMMAND = '/bin/ps';
const MACOS_ARGS = ['-axo', 'comm='] as const;

function executableName(value: string): string {
  return value.trim().split(/[\\/]/).at(-1) ?? value.trim();
}

/** Finds supported running editors for setup output; it never chooses a focus target. */
export async function detectAvailableEditors(
  platform: PlatformId,
  run: CommandRunner = runCommand,
): Promise<string[]> {
  const result = await run(
    platform === 'windows' ? WINDOWS_COMMAND : MACOS_COMMAND,
    platform === 'windows' ? WINDOWS_ARGS : MACOS_ARGS,
  );
  if (result.exitCode !== 0) return [];

  const names = new Set<string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const editor = editorForExecutable(executableName(line));
    if (editor !== undefined) names.add(editor.name);
  }
  return [...names];
}

/** Renders a concise setup result without treating editors as a requirement. */
export function formatAvailableEditors(editors: readonly string[]): string {
  if (editors.length === 0) return 'No supported running editor detected.';
  if (editors.length === 1) return `Supported running editor: ${editors[0]}`;
  return `Supported running editors: ${editors.join(', ')}`;
}
