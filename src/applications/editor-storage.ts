import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlatformId } from '../platform/platform.js';

export interface EditorStorageContext {
  platform: PlatformId;
  homedir: string;
  env: Record<string, string | undefined>;
}

export function getEditorStoragePath(
  editorId: string,
  context: EditorStorageContext,
): string | undefined {
  const { platform, homedir, env } = context;

  if (platform === 'windows') {
    const appData = env.APPDATA ?? path.join(homedir, 'AppData', 'Roaming');
    if (editorId === 'cursor') {
      return path.join(appData, 'Cursor', 'User', 'globalStorage', 'storage.json');
    }
    if (editorId === 'visual-studio-code') {
      return path.join(appData, 'Code', 'User', 'globalStorage', 'storage.json');
    }
  } else if (platform === 'macos') {
    const appSupport = path.join(homedir, 'Library', 'Application Support');
    if (editorId === 'cursor') {
      return path.join(appSupport, 'Cursor', 'User', 'globalStorage', 'storage.json');
    }
    if (editorId === 'visual-studio-code') {
      return path.join(appSupport, 'Code', 'User', 'globalStorage', 'storage.json');
    }
  }

  return undefined;
}

export function parseWorkspaceFolderUrl(folderUrl: string): string {
  try {
    const decoded = decodeURIComponent(folderUrl);
    if (decoded.startsWith('file:///')) {
      const match = /^file:\/\/\/([a-zA-Z]:.*)$/.exec(decoded);
      if (match !== null && match[1] !== undefined) {
        return match[1].replace(/\//g, '\\');
      }
      return fileURLToPath(new URL(decoded));
    }
    return decoded;
  } catch {
    return folderUrl;
  }
}

function normalizePath(targetPath: string, platform: PlatformId): string {
  const normalized = targetPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'windows' ? normalized.toLowerCase() : normalized;
}

export function readEditorOpenWorkspaces(
  storagePath: string,
  platform: PlatformId,
): string[] {
  if (!existsSync(storagePath)) return [];

  try {
    const raw = readFileSync(storagePath, 'utf8');
    const data = JSON.parse(raw) as {
      windowsState?: {
        lastActiveWindow?: { folder?: unknown };
        openedWindows?: Array<{ folder?: unknown }>;
      };
    };

    const state = data?.windowsState;
    if (state === undefined || typeof state !== 'object' || state === null) return [];

    const rawFolders: string[] = [];
    if (typeof state.lastActiveWindow?.folder === 'string') {
      rawFolders.push(state.lastActiveWindow.folder);
    }

    if (Array.isArray(state.openedWindows)) {
      for (const win of state.openedWindows) {
        if (typeof win?.folder === 'string') {
          rawFolders.push(win.folder);
        }
      }
    }

    const uniquePaths = new Set<string>();
    for (const folder of rawFolders) {
      const parsed = parseWorkspaceFolderUrl(folder);
      uniquePaths.add(normalizePath(parsed, platform));
    }

    return Array.from(uniquePaths);
  } catch {
    return [];
  }
}

export function isProjectInEditorWorkspaces(
  projectPath: string,
  editorId: string,
  context: EditorStorageContext,
): boolean {
  const storagePath = getEditorStoragePath(editorId, context);
  if (storagePath === undefined) return false;

  const openWorkspaces = readEditorOpenWorkspaces(storagePath, context.platform);
  const target = normalizePath(projectPath, context.platform);

  return openWorkspaces.some((ws) => ws === target);
}
