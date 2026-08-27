import { describe, expect, it } from 'vitest';
import { createApplicationFocus } from '../../src/applications/create-application-focus.js';
import type { AgentSession } from '../../src/core/types.js';

const session: AgentSession = {
  id: 'session-a',
  agent: 'claude',
  cwd: 'C:\\Code\\FinBot',
  status: 'waiting',
  startedAt: 1,
};

describe('createApplicationFocus', () => {
  it('uses the Windows adapter to expose only the session project editor', async () => {
    const focus = createApplicationFocus('windows', () =>
      Promise.resolve({
        stdout: JSON.stringify({
          Name: 'Code.exe',
          CommandLine:
            '"C:\\Program Files\\Microsoft VS Code\\Code.exe" C:\\Code\\FinBot',
          ProcessId: 101,
        }),
        stderr: '',
        exitCode: 0,
      }),
    );

    await expect(focus.detectApplication(session)).resolves.toMatchObject({
      id: 'visual-studio-code',
      processId: 101,
    });
  });
});
