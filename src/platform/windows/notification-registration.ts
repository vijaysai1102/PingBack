import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch } from 'node:os';
import path from 'node:path';
import { runCommand, type CommandRunner } from '../../applications/command-runner.js';

export const PINGBACK_APP_ID = 'PingBack';

export interface WindowsToastRegistrationOptions {
  executable: string;
  application: string;
  appId: string;
}

/** Registers the Start-menu shortcut required by Windows for a custom toast App ID. */
export async function installWindowsToastRegistration(
  run: CommandRunner,
  options: WindowsToastRegistrationOptions,
): Promise<boolean> {
  const result = await run(options.executable, [
    '-install',
    options.appId,
    options.application,
    options.appId,
  ]);
  return result.exitCode === 0;
}

function snoreToastExecutable(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const notifierEntry = require.resolve('node-notifier');
    const binary = arch() === 'x64' ? 'snoretoast-x64.exe' : 'snoretoast-x86.exe';
    const executable = path.join(
      path.dirname(notifierEntry),
      'vendor',
      'snoreToast',
      binary,
    );
    return existsSync(executable) ? executable : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort registration for every Windows daemon launch, including upgrades. */
export async function ensureWindowsToastRegistration(): Promise<boolean> {
  const executable = snoreToastExecutable();
  if (executable === undefined) return false;

  return installWindowsToastRegistration(runCommand, {
    executable,
    application: process.execPath,
    appId: PINGBACK_APP_ID,
  });
}
