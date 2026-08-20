import { existsSync } from 'node:fs';
import path from 'node:path';
import type { HostInfo } from '../../platform/platform.js';
import type { AgentDetection } from '../adapter.js';

/** Executable names Codex CLI may install, across platforms and shells. */
const EXECUTABLE_NAMES = ['codex', 'codex.exe', 'codex.cmd', 'codex.ps1', 'codex.bat'];

export function codexHomeDir(homedir: string): string {
  return path.join(homedir, '.codex');
}

export function codexHooksPath(homedir: string): string {
  return path.join(codexHomeDir(homedir), 'hooks.json');
}

export function codexConfigPath(homedir: string): string {
  return path.join(codexHomeDir(homedir), 'config.toml');
}

/**
 * Scans PATH for the Codex CLI launcher.
 */
export function findCodexExecutable(host: HostInfo): string | undefined {
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
        // Unreadable PATH entry is not fatal; keep scanning.
      }
    }
  }

  return undefined;
}

/**
 * Codex CLI is considered installed when its launcher is on PATH or it has
 * created its home directory (~/.codex).
 */
export function detectCodex(host: HostInfo): AgentDetection {
  const executable = findCodexExecutable(host);
  if (executable !== undefined) {
    return { installed: true, location: executable };
  }

  const home = codexHomeDir(host.homedir);
  if (existsSync(home)) {
    return { installed: true, location: home };
  }

  return { installed: false };
}
