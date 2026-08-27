import { describe, expect, it } from 'vitest';
import {
  ProjectApplicationFocusService,
  associateProjectApplication,
} from '../../src/applications/project-association.js';
import type { AgentSession } from '../../src/core/types.js';

function session(cwd: string | undefined): AgentSession {
  return {
    id: 'session-a',
    agent: 'claude',
    cwd,
    status: 'working',
    startedAt: 1,
  };
}

describe('associateProjectApplication', () => {
  it('associates a session only with an editor that explicitly reports its project path', () => {
    const application = associateProjectApplication(
      session('C:\\Code\\FinBot'),
      [
        {
          id: 'visual-studio-code',
          name: 'Visual Studio Code',
          projectPaths: ['C:\\Code\\FinBot'],
        },
        {
          id: 'cursor',
          name: 'Cursor',
          projectPaths: ['C:\\Code\\OtherProject'],
        },
      ],
      'windows',
    );

    expect(application).toMatchObject({
      id: 'visual-studio-code',
      name: 'Visual Studio Code',
    });
  });

  it('does not associate an editor when no running editor reports the session project', () => {
    const application = associateProjectApplication(
      session('/Users/dev/finbot'),
      [
        {
          id: 'visual-studio-code',
          name: 'Visual Studio Code',
          projectPaths: ['/Users/dev/another-project'],
        },
      ],
      'macos',
    );

    expect(application).toBeUndefined();
  });

  it('focuses only the application associated with the session project', async () => {
    const service = new ProjectApplicationFocusService(
      {
        discover: () =>
          Promise.resolve([
            {
              id: 'visual-studio-code',
              name: 'Visual Studio Code',
              projectPaths: ['C:\\Code\\FinBot'],
            },
          ]),
        focus: (application) => Promise.resolve(application.id === 'visual-studio-code'),
      },
      'windows',
    );

    const application = await service.detectApplication(session('C:\\Code\\FinBot'));

    expect(application?.name).toBe('Visual Studio Code');
    await expect(service.focusApplication(application)).resolves.toBe(true);
    await expect(service.focusApplication(undefined)).resolves.toBe(false);
  });

  it('fails safely when platform discovery or focus is unavailable', async () => {
    const service = new ProjectApplicationFocusService(
      {
        discover: () => Promise.reject(new Error('process inspection unavailable')),
        focus: () => Promise.reject(new Error('foreground request denied')),
      },
      'windows',
    );

    await expect(
      service.detectApplication(session('C:\\Code\\FinBot')),
    ).resolves.toBeUndefined();
    await expect(
      service.focusApplication({
        id: 'visual-studio-code',
        name: 'Visual Studio Code',
        projectPaths: ['C:\\Code\\FinBot'],
      }),
    ).resolves.toBe(false);
  });
});
