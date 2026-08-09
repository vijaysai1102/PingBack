import { existsSync } from 'node:fs';
import path from 'node:path';
import type { HostInfo } from '../../platform/platform.js';
import type { AgentDetection } from '../adapter.js';

/** Executable names Claude Code may install, across platforms and shells. */
const EXECUTABLE_NAMES = [
  'claude',
  'claude.exe',
  'claude.cmd',
  'claude.ps1',
  'claude.bat',
];

export function claudeHomeDir(homedir: string): string {
  return path.join(homedir, '.claude');
}

export function claudeSettingsPath(homedir: string): string {
  return path.join(claudeHomeDir(homedir), 'settings.json');
}

/**
 * Scans PATH for the Claude Code launcher.
 *
 * Deliberately avoids spawning `claude --version`: setup should stay fast, and
 * running an external binary just to detect it is unnecessary.
 */
export function findClaudeExecutable(host: HostInfo): string | undefined {
  const rawPath = host.env.PATH ?? host.env.Path ?? host.env.path;
  if (rawPath === undefined) return undefined;

  const separator = host.platform === 'win32' ? ';' : ':';

  for (const dir of rawPath.split(separator)) {
    const trimmed = dir.trim();
    if (trimmed.length === 0) continue;

    for (const name of EXECUTABLE_NAMES) {
      const candidate = path.join(trimmed, name);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        // An unreadable PATH entry is not fatal; keep scanning.
      }
    }
  }

  return undefined;
}

/**
 * Claude Code is considered installed when its launcher is on PATH or it has
 * created its home directory. Either signal alone is enough: a user may have
 * installed it in a shell whose PATH this process did not inherit.
 */
export function detectClaude(host: HostInfo): AgentDetection {
  const executable = findClaudeExecutable(host);
  if (executable !== undefined) {
    return { installed: true, location: executable };
  }

  const home = claudeHomeDir(host.homedir);
  if (existsSync(home)) {
    return { installed: true, location: home };
  }

  return { installed: false };
}
