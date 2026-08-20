import { existsSync } from 'node:fs';
import path from 'node:path';
import type { HostInfo } from '../../platform/platform.js';
import type { AgentDetection } from '../adapter.js';

const LAUNCHER_BASENAMES = ['agy', 'antigravity', 'gemini'];
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.ps1', '.bat', ''];
const UNIX_EXTENSIONS = [''];

export function agyConfigDir(homedir: string): string {
  const candidates = [
    path.join(homedir, '.gemini', 'config'),
    path.join(homedir, '.agy', 'config'),
    path.join(homedir, '.antigravity', 'config'),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  return path.join(homedir, '.gemini', 'config');
}

export function agyHooksPath(homedir: string): string {
  return path.join(agyConfigDir(homedir), 'hooks.json');
}

export function agyHomeDir(homedir: string): string {
  const candidates = [
    path.join(homedir, '.gemini'),
    path.join(homedir, '.agy'),
    path.join(homedir, '.antigravity'),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  return path.join(homedir, '.gemini');
}

/**
 * Scans PATH (and common installation locations) for AGY, Antigravity, or Gemini CLI.
 */
export function findAGYExecutable(host: HostInfo): string | undefined {
  const rawPath = host.env.PATH ?? host.env.Path ?? host.env.path;
  const separator = host.platform === 'win32' ? ';' : ':';
  const extensions = host.platform === 'win32' ? WINDOWS_EXTENSIONS : UNIX_EXTENSIONS;

  const searchDirs = rawPath
    ? rawPath.split(separator).filter((d) => d.trim().length > 0)
    : [];

  // Add default Windows install directory if present
  if (host.platform === 'win32') {
    const localAppData =
      host.env.LOCALAPPDATA ?? path.join(host.homedir, 'AppData', 'Local');
    const agyBin = path.join(localAppData, 'agy', 'bin');
    if (!searchDirs.includes(agyBin)) searchDirs.push(agyBin);
  }

  for (const dir of searchDirs) {
    const trimmed = dir.trim();
    if (trimmed.length === 0) continue;

    for (const base of LAUNCHER_BASENAMES) {
      for (const ext of extensions) {
        const candidate = path.join(trimmed, `${base}${ext}`);
        try {
          if (existsSync(candidate)) return candidate;
        } catch {
          // Keep scanning on unreadable entries
        }
      }
    }
  }

  return undefined;
}

/**
 * AGY CLI is considered installed when its launcher is on PATH or its home directory exists.
 */
export function detectAGY(host: HostInfo): AgentDetection {
  const executable = findAGYExecutable(host);
  if (executable !== undefined) {
    return { installed: true, location: executable };
  }

  const home = agyHomeDir(host.homedir);
  if (existsSync(home)) {
    return { installed: true, location: home };
  }

  return { installed: false };
}
