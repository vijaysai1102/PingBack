import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../../src/sessions/session-manager.js';
import { FileSessionStore } from '../../src/sessions/session-store.js';
import { normalizeHookPayload } from '../../src/agents/claude/normalize.js';
import { parseAgentEvent, parseSessionUpdate } from '../../src/core/event-schema.js';
import { EventRouter } from '../../src/core/event-router.js';

let dir: string;
let clock: number;
const now = (): number => clock;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-identity-'));
  clock = 1000;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Mirrors what the hook bridge does: normalize, then hand to the daemon. */
function feedNotification(
  router: EventRouter,
  sessionId: string,
  cwd: string,
  pid?: number,
): void {
  const normalized = normalizeHookPayload(
    {
      session_id: sessionId,
      cwd,
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'Claude needs your permission',
    },
    now,
  );

  if (normalized.kind !== 'event') throw new Error('expected event');
  router.route(parseAgentEvent({ ...normalized.event, pid }, now));
}

describe('session identity across concurrent Claude sessions', () => {
  it('keeps three projects in separate sessions', () => {
    const sessions = new SessionManager({ now });
    const router = new EventRouter({ sessions, now });

    feedNotification(router, 'sess-a', '/code/project-a', 101);
    feedNotification(router, 'sess-b', '/code/project-b', 102);
    feedNotification(router, 'sess-c', '/code/project-c', 103);

    expect(sessions.size).toBe(3);
    expect(sessions.get('sess-a')?.cwd).toBe('/code/project-a');
    expect(sessions.get('sess-b')?.cwd).toBe('/code/project-b');
    expect(sessions.get('sess-c')?.cwd).toBe('/code/project-c');
  });

  it('does not merge sessions that share a working directory', () => {
    const sessions = new SessionManager({ now });
    const router = new EventRouter({ sessions, now });

    feedNotification(router, 'sess-a', '/code/same', 201);
    feedNotification(router, 'sess-b', '/code/same', 202);

    expect(sessions.size).toBe(2);
  });

  it('records the reported process id', () => {
    const sessions = new SessionManager({ now });
    const router = new EventRouter({ sessions, now });

    feedNotification(router, 'sess-a', '/code/a', 4242);

    expect(sessions.get('sess-a')?.pid).toBe(4242);
  });

  it('tolerates a missing process id', () => {
    const sessions = new SessionManager({ now });
    const router = new EventRouter({ sessions, now });

    feedNotification(router, 'sess-a', '/code/a');

    expect(sessions.get('sess-a')?.pid).toBeUndefined();
  });

  it('follows one session through its full lifecycle', () => {
    const sessions = new SessionManager({ now });
    const router = new EventRouter({ sessions, now });

    const start = normalizeHookPayload(
      { session_id: 's1', cwd: '/code/app', hook_event_name: 'SessionStart' },
      now,
    );
    if (start.kind !== 'session') throw new Error('expected session');
    const startUpdate = parseSessionUpdate(start.update);
    sessions.touch(startUpdate.sessionId, startUpdate.status, { cwd: startUpdate.cwd });
    expect(sessions.get('s1')?.status).toBe('working');

    clock = 2000;
    feedNotification(router, 's1', '/code/app');
    expect(sessions.get('s1')?.status).toBe('waiting');

    clock = 3000;
    const prompt = normalizeHookPayload(
      { session_id: 's1', cwd: '/code/app', hook_event_name: 'UserPromptSubmit' },
      now,
    );
    if (prompt.kind !== 'session') throw new Error('expected session');
    sessions.touch('s1', prompt.update.status);
    expect(sessions.get('s1')?.status).toBe('working');

    clock = 4000;
    const end = normalizeHookPayload(
      { session_id: 's1', hook_event_name: 'SessionEnd', reason: 'other' },
      now,
    );
    if (end.kind !== 'session') throw new Error('expected session');
    sessions.touch('s1', end.update.status);

    expect(sessions.get('s1')?.status).toBe('completed');
    expect(sessions.get('s1')?.startedAt).toBe(1000);
  });

  it('routes an error event into the error state', () => {
    const sessions = new SessionManager({ now });
    const router = new EventRouter({ sessions, now });

    const normalized = normalizeHookPayload(
      {
        session_id: 's1',
        cwd: '/code/app',
        hook_event_name: 'StopFailure',
        error: 'rate_limit',
      },
      now,
    );
    if (normalized.kind !== 'event') throw new Error('expected event');
    router.route(parseAgentEvent(normalized.event, now));

    expect(sessions.get('s1')?.status).toBe('error');
  });
});

describe('session persistence across daemon restarts', () => {
  it('restores sessions written by a previous daemon', () => {
    const first = new SessionManager({ store: new FileSessionStore(dir), now });
    const router = new EventRouter({ sessions: first, now });
    feedNotification(router, 'sess-a', '/code/a', 501);

    const second = new SessionManager({ store: new FileSessionStore(dir), now });

    expect(second.get('sess-a')?.status).toBe('waiting');
    expect(second.get('sess-a')?.cwd).toBe('/code/a');
    expect(second.get('sess-a')?.pid).toBe(501);
  });

  it('drops sessions that went stale while the daemon was down', () => {
    const first = new SessionManager({ store: new FileSessionStore(dir), now });
    const router = new EventRouter({ sessions: first, now });
    feedNotification(router, 'sess-a', '/code/a');

    clock = 1000 + 48 * 60 * 60 * 1000;
    const second = new SessionManager({
      store: new FileSessionStore(dir),
      now,
      staleTtlMs: 24 * 60 * 60 * 1000,
    });

    expect(second.prune()).toBe(1);
    expect(second.size).toBe(0);
  });

  it('keeps a session that was active just before the restart', () => {
    const first = new SessionManager({ store: new FileSessionStore(dir), now });
    const router = new EventRouter({ sessions: first, now });
    feedNotification(router, 'sess-a', '/code/a');

    clock = 1000 + 30_000;
    const second = new SessionManager({ store: new FileSessionStore(dir), now });

    expect(second.prune()).toBe(0);
    expect(second.get('sess-a')).toBeDefined();
  });
});
