import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getEditorStoragePath,
  isProjectInEditorWorkspaces,
  parseWorkspaceFolderUrl,
  readEditorOpenWorkspaces,
} from '../../src/applications/editor-storage.js';

describe('editor-storage', () => {
  it('parses workspace file URLs correctly', () => {
    expect(parseWorkspaceFolderUrl('file:///c%3A/PingBack')).toMatch(/[\\/]PingBack/i);
    expect(parseWorkspaceFolderUrl('file:///Users/dev/PingBack')).toMatch(
      /[\\/]Users[\\/]dev[\\/]PingBack/,
    );
    expect(parseWorkspaceFolderUrl('/plain/path')).toBe('/plain/path');
  });

  it('determines editor storage paths across platforms', () => {
    const winCtx = {
      platform: 'windows' as const,
      homedir: 'C:\\Users\\dev',
      env: { APPDATA: 'C:\\Users\\dev\\AppData\\Roaming' },
    };
    expect(getEditorStoragePath('cursor', winCtx)).toMatch(
      /Cursor[\\/]User[\\/]globalStorage[\\/]storage\.json/,
    );
    expect(getEditorStoragePath('visual-studio-code', winCtx)).toMatch(
      /Code[\\/]User[\\/]globalStorage[\\/]storage\.json/,
    );

    const macCtx = {
      platform: 'macos' as const,
      homedir: '/Users/dev',
      env: {},
    };
    expect(getEditorStoragePath('cursor', macCtx)).toMatch(
      /Cursor[\\/]User[\\/]globalStorage[\\/]storage\.json/,
    );
    expect(getEditorStoragePath('visual-studio-code', macCtx)).toMatch(
      /Code[\\/]User[\\/]globalStorage[\\/]storage\.json/,
    );
  });

  it('safely handles non-existent storage files', () => {
    expect(
      readEditorOpenWorkspaces('/non/existent/path/storage.json', 'windows'),
    ).toEqual([]);
  });

  it('extracts open workspaces from valid storage.json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pb-storage-test-'));
    const filePath = path.join(dir, 'storage.json');
    try {
      const data = {
        windowsState: {
          lastActiveWindow: {
            folder: 'file:///c%3A/Projects/ActiveApp',
          },
          openedWindows: [
            { folder: 'file:///c%3A/Projects/ActiveApp' },
            { folder: 'file:///c%3A/Projects/SecondApp' },
          ],
        },
      };
      writeFileSync(filePath, JSON.stringify(data), 'utf8');

      const workspaces = readEditorOpenWorkspaces(filePath, 'windows');
      expect(workspaces).toHaveLength(2);
      expect(workspaces.some((ws) => ws.includes('activeapp'))).toBe(true);
      expect(workspaces.some((ws) => ws.includes('secondapp'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches open project case-insensitively on Windows', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pb-storage-test2-'));
    const cursorDir = path.join(
      dir,
      'AppData',
      'Roaming',
      'Cursor',
      'User',
      'globalStorage',
    );
    mkdirSync(cursorDir, { recursive: true });
    const filePath = path.join(cursorDir, 'storage.json');
    try {
      const data = {
        windowsState: {
          openedWindows: [{ folder: 'file:///c%3A/PingBack' }],
        },
      };
      writeFileSync(filePath, JSON.stringify(data), 'utf8');

      const ctx = {
        platform: 'windows' as const,
        homedir: dir,
        env: { APPDATA: path.join(dir, 'AppData', 'Roaming') },
      };

      expect(isProjectInEditorWorkspaces('C:\\pingback', 'cursor', ctx)).toBe(true);
      expect(isProjectInEditorWorkspaces('C:\\OtherProject', 'cursor', ctx)).toBe(false);
      expect(isProjectInEditorWorkspaces('C:\\pingback', 'visual-studio-code', ctx)).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
