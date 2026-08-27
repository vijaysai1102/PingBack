import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDaemon } from '../../src/daemon/create-daemon.js';
import { createPlatform, type PlatformId } from '../../src/platform/platform.js';
import type { ApplicationFocusService } from '../../src/applications/project-association.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('createDaemon', () => {
  it('constructs the application-focus service for the selected platform', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pingback-create-daemon-'));
    dirs.push(dir);
    const platform = createPlatform({
      platform: 'win32',
      env: { APPDATA: path.join(dir, 'config'), LOCALAPPDATA: path.join(dir, 'data') },
      homedir: dir,
      tmpdir: dir,
      uid: 'test-user',
    });
    let selectedPlatform: PlatformId | undefined;
    const applicationFocus: ApplicationFocusService = {
      detectApplication: () => Promise.resolve(undefined),
      focusApplication: () => Promise.resolve(false),
    };

    const result = createDaemon({
      platform,
      applicationFocusFactory: (platformId) => {
        selectedPlatform = platformId;
        return applicationFocus;
      },
    });

    expect(result.daemon).toBeDefined();
    expect(selectedPlatform).toBe('windows');
  });
});
