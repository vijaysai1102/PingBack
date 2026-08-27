import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Daemon } from '../../src/core/daemon.js';
import { DaemonState } from '../../src/core/daemon-state.js';
import { sendRequest } from '../../src/core/ipc/client.js';
import { SessionManager } from '../../src/sessions/session-manager.js';
import { FileSessionStore } from '../../src/sessions/session-store.js';
import { createPlatform, type Platform } from '../../src/platform/platform.js';
import { DEFAULT_CONFIG } from '../../src/config/config-manager.js';
import { silentLogger } from '../../src/utils/logger.js';
import { normalizeHookPayload } from '../../src/agents/claude/normalize.js';
import { formatRunningStatus } from '../../src/cli/status-view.js';
import type { DaemonStatus } from '../../src/core/ipc/protocol.js';
import type {
  NotificationRequest,
  NotificationService,
} from '../../src/notifications/notification-service.js';

class RecordingNotifier implements NotificationService {
  readonly sent: NotificationRequest[] = [];

  isAvailable(): boolean {
    return true;
  }

  notify(request: NotificationRequest): Promise<void> {
    this.sent.push(request);
    return Promise.resolve();
  }
}

function testEndpoint(): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\pingback-e2e-${randomUUID()}`
    : path.join(tmpdir(), `pb-e2e-${randomUUID().slice(0, 8)}.sock`);
}

let dir: string;
let daemon: Daemon;
let notifier: RecordingNotifier;
let sessions: SessionManager;
let token: string;
let endpoint: string;

/** Exactly what the hook bridge sends: normalize the payload, then forward it. */
async function fireHook(
  payload: Record<string, unknown>,
  pid?: number,
): Promise<unknown> {
  const normalized = normalizeHookPayload(payload);
  if (normalized.kind === 'ignored') return { ignored: true };

  if (normalized.kind === 'session') {
    return sendRequest({ endpoint, token }, 'session', { ...normalized.update, pid });
  }
  return sendRequest({ endpoint, token }, 'event', { ...normalized.event, pid });
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-e2e-'));
  endpoint = testEndpoint();

  const platform: Platform = { ...createPlatform(), ipcEndpoint: endpoint };
  notifier = new RecordingNotifier();
  sessions = new SessionManager({ store: new FileSessionStore(dir) });

  const state = new DaemonState(dir);
  daemon = new Daemon({
    platform,
    config: DEFAULT_CONFIG,
    sessions,
    notifications: notifier,
    state,
    logger: silentLogger(),
    version: '0.1.0',
  });

  await daemon.start();
  token = state.ensureToken();
});

afterEach(async () => {
  await daemon.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('the PingBack v0.1 target scenario', () => {
  it('carries a Claude permission prompt through to a notification and a waiting session', async () => {
    // Claude starts.
    await fireHook(
      { session_id: 'sess-1', cwd: '/code/finbot', hook_event_name: 'SessionStart' },
      4242,
    );
    expect(sessions.get('sess-1')?.status).toBe('working');

    // Claude works, then needs the developer.
    await fireHook(
      {
        session_id: 'sess-1',
        cwd: '/code/finbot',
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission to use Bash',
      },
      4242,
    );

    // A desktop notification is raised, with sound, naming the project.
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatchObject({
      title: 'Claude Code needs your attention',
      message: 'Claude needs your permission to use Bash',
      priority: 'high',
      project: 'finbot',
      sound: true,
    });

    // The session is identified and shown as waiting.
    const session = sessions.get('sess-1');
    expect(session?.status).toBe('waiting');
    expect(session?.cwd).toBe('/code/finbot');
    expect(session?.pid).toBe(4242);

    const status = (await sendRequest({ endpoint, token }, 'status')) as DaemonStatus;
    const rendered = formatRunningStatus(status, Date.now());
    expect(rendered).toContain('Project: finbot');
    expect(rendered).toContain('Status: Waiting');
    expect(rendered).toContain('1 session needs your attention.');

    // The developer returns and answers; Claude goes back to work.
    await fireHook(
      { session_id: 'sess-1', cwd: '/code/finbot', hook_event_name: 'UserPromptSubmit' },
      4242,
    );
    expect(sessions.get('sess-1')?.status).toBe('working');

    // The session ends cleanly.
    await fireHook(
      {
        session_id: 'sess-1',
        cwd: '/code/finbot',
        hook_event_name: 'SessionEnd',
        reason: 'other',
      },
      4242,
    );
    expect(sessions.get('sess-1')?.status).toBe('completed');
  });

  it('stays silent while nothing needs attention', async () => {
    await fireHook({ session_id: 's', cwd: '/code/x', hook_event_name: 'SessionStart' });
    await fireHook({
      session_id: 's',
      cwd: '/code/x',
      hook_event_name: 'UserPromptSubmit',
    });
    await fireHook({
      session_id: 's',
      hook_event_name: 'Notification',
      notification_type: 'auth_success',
      message: 'Logged in',
    });

    expect(notifier.sent).toHaveLength(0);
  });

  it('notifies once when Claude finishes and goes idle', async () => {
    await fireHook({
      session_id: 's',
      cwd: '/code/x',
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
      message: 'Claude is waiting for your input',
    });

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.priority).toBe('high');
    expect(sessions.get('s')?.status).toBe('waiting');
  });

  it('raises a medium-priority alert when Claude hits an API error', async () => {
    await fireHook({
      session_id: 's',
      cwd: '/code/x',
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
      last_assistant_message: 'API Error: Rate limit reached',
    });

    await new Promise((resolve) => setTimeout(resolve, 3_050));
    expect(notifier.sent[0]).toMatchObject({
      title: 'Claude Code hit an error',
      message: 'API Error: Rate limit reached',
      priority: 'medium',
      sound: true,
    });
    expect(sessions.get('s')?.status).toBe('error');
  });

  it('tracks three concurrent projects without mixing them up', async () => {
    for (const [id, project] of [
      ['a', 'alpha'],
      ['b', 'beta'],
      ['c', 'gamma'],
    ]) {
      await fireHook({
        session_id: id,
        cwd: `/code/${String(project)}`,
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: 'permission needed',
      });
    }

    expect(sessions.size).toBe(3);
    expect(notifier.sent.map((n) => n.project)).toEqual(['alpha', 'beta', 'gamma']);

    const status = (await sendRequest({ endpoint, token }, 'status')) as DaemonStatus;
    expect(formatRunningStatus(status, Date.now())).toContain(
      '3 sessions need your attention.',
    );
  });

  it('raises a single notification when a hook fires twice', async () => {
    const payload = {
      session_id: 's',
      cwd: '/code/x',
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'permission needed',
    };

    await fireHook(payload);
    await fireHook(payload);

    expect(notifier.sent).toHaveLength(1);
  });

  it('rejects a malformed event without disturbing the daemon', async () => {
    await expect(
      sendRequest({ endpoint, token }, 'event', { agent: 'codex', sessionId: 'x' }),
    ).rejects.toThrow();

    // The daemon is still healthy and still serving.
    await expect(sendRequest({ endpoint, token }, 'ping')).resolves.toMatchObject({
      pong: true,
    });
  });

  it('refuses requests that do not carry the daemon token', async () => {
    await expect(
      sendRequest({ endpoint, token: 'not-the-token' }, 'status'),
    ).rejects.toThrow(/auth token/);
  });

  it('persists sessions so a restarted daemon still reports them', async () => {
    await fireHook({
      session_id: 'survivor',
      cwd: '/code/x',
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'permission needed',
    });

    const restored = new SessionManager({ store: new FileSessionStore(dir) });
    expect(restored.get('survivor')?.status).toBe('waiting');
  });
});
