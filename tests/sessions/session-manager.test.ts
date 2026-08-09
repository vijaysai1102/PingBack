import { beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../../src/sessions/session-manager.js';
import { MemorySessionStore } from '../../src/sessions/session-store.js';
import type { AgentEvent } from '../../src/core/types.js';

let clock = 1000;
const now = (): number => clock;

function event(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 'e1',
    agent: 'claude',
    sessionId: 'session-a',
    type: 'attention_required',
    title: 'title',
    message: 'message',
    timestamp: clock,
    ...overrides,
  };
}

beforeEach(() => {
  clock = 1000;
});

describe('SessionManager.applyEvent', () => {
  it('creates a session on first sight', () => {
    const sessions = new SessionManager({ now });
    const session = sessions.applyEvent(event({ cwd: '/proj', pid: 99 }));

    expect(session.id).toBe('session-a');
    expect(session.agent).toBe('claude');
    expect(session.status).toBe('waiting');
    expect(session.startedAt).toBe(1000);
    expect(session.cwd).toBe('/proj');
    expect(session.pid).toBe(99);
  });

  it('updates status and activity on later events', () => {
    const sessions = new SessionManager({ now });
    sessions.applyEvent(event());

    clock = 5000;
    const updated = sessions.applyEvent(
      event({ id: 'e2', type: 'task_completed', timestamp: 5000 }),
    );

    expect(updated.status).toBe('completed');
    expect(updated.startedAt).toBe(1000);
    expect(updated.lastActivityAt).toBe(5000);
  });

  it('keeps previously known cwd and pid when an event omits them', () => {
    const sessions = new SessionManager({ now });
    sessions.applyEvent(event({ cwd: '/proj', pid: 42 }));
    const updated = sessions.applyEvent(event({ id: 'e2', type: 'error' }));

    expect(updated.cwd).toBe('/proj');
    expect(updated.pid).toBe(42);
  });

  it('tracks concurrent sessions separately', () => {
    const sessions = new SessionManager({ now });
    sessions.applyEvent(event({ sessionId: 'a', cwd: '/a' }));
    sessions.applyEvent(event({ sessionId: 'b', cwd: '/b', type: 'error' }));
    sessions.applyEvent(event({ sessionId: 'c', cwd: '/c', type: 'task_completed' }));

    expect(sessions.size).toBe(3);
    expect(sessions.get('a')?.status).toBe('waiting');
    expect(sessions.get('b')?.status).toBe('error');
    expect(sessions.get('c')?.status).toBe('completed');
  });

  it('returns a copy so callers cannot mutate internal state', () => {
    const sessions = new SessionManager({ now });
    const session = sessions.applyEvent(event());
    session.status = 'completed';

    expect(sessions.get('session-a')?.status).toBe('waiting');
  });
});

describe('SessionManager.touch', () => {
  it('records a status change with no event', () => {
    const sessions = new SessionManager({ now });
    const session = sessions.touch('session-a', 'working', { cwd: '/proj', pid: 7 });

    expect(session.status).toBe('working');
    expect(session.cwd).toBe('/proj');
    expect(session.pid).toBe(7);
  });

  it('updates an existing session in place', () => {
    const sessions = new SessionManager({ now });
    sessions.applyEvent(event({ cwd: '/proj' }));

    clock = 3000;
    const touched = sessions.touch('session-a', 'working');

    expect(touched.startedAt).toBe(1000);
    expect(touched.lastActivityAt).toBe(3000);
    expect(touched.cwd).toBe('/proj');
  });
});

describe('SessionManager persistence', () => {
  it('writes sessions to the store', () => {
    const store = new MemorySessionStore();
    const sessions = new SessionManager({ store, now });
    sessions.applyEvent(event());

    expect(store.load()).toHaveLength(1);
    expect(store.load()[0]?.id).toBe('session-a');
  });

  it('restores sessions from the store on construction', () => {
    const store = new MemorySessionStore([
      { id: 'restored', agent: 'claude', status: 'waiting', startedAt: 10 },
    ]);
    const sessions = new SessionManager({ store, now });

    expect(sessions.get('restored')?.status).toBe('waiting');
  });

  it('survives a store that throws on save', () => {
    const store = {
      load: () => [],
      save: () => {
        throw new Error('disk full');
      },
    };
    const sessions = new SessionManager({ store, now });

    expect(() => sessions.applyEvent(event())).not.toThrow();
    expect(sessions.get('session-a')?.status).toBe('waiting');
  });
});

describe('SessionManager.prune', () => {
  it('drops completed sessions past the TTL', () => {
    const sessions = new SessionManager({ now, completedTtlMs: 1000 });
    sessions.applyEvent(event({ type: 'task_completed' }));

    clock = 3000;
    expect(sessions.prune()).toBe(1);
    expect(sessions.size).toBe(0);
  });

  it('keeps completed sessions inside the TTL', () => {
    const sessions = new SessionManager({ now, completedTtlMs: 10_000 });
    sessions.applyEvent(event({ type: 'task_completed' }));

    clock = 3000;
    expect(sessions.prune()).toBe(0);
    expect(sessions.size).toBe(1);
  });

  it('drops stale sessions regardless of status', () => {
    const sessions = new SessionManager({ now, staleTtlMs: 5000 });
    sessions.applyEvent(event({ type: 'attention_required' }));

    clock = 100_000;
    expect(sessions.prune()).toBe(1);
  });
});

describe('SessionManager limits', () => {
  it('evicts the least recently active session past the cap', () => {
    const sessions = new SessionManager({ now, maxSessions: 2 });

    sessions.applyEvent(event({ sessionId: 'a', timestamp: 1000 }));
    clock = 2000;
    sessions.applyEvent(event({ sessionId: 'b', timestamp: 2000 }));
    clock = 3000;
    sessions.applyEvent(event({ sessionId: 'c', timestamp: 3000 }));

    expect(sessions.size).toBe(2);
    expect(sessions.get('a')).toBeUndefined();
    expect(sessions.get('c')).toBeDefined();
  });
});

describe('SessionManager.list', () => {
  it('returns newest sessions first', () => {
    const sessions = new SessionManager({ now });
    sessions.applyEvent(event({ sessionId: 'old', timestamp: 1000 }));
    sessions.applyEvent(event({ sessionId: 'new', timestamp: 9000 }));

    expect(sessions.list().map((s) => s.id)).toEqual(['new', 'old']);
  });
});

describe('SessionManager.remove and clear', () => {
  it('removes a known session and reports unknown ones', () => {
    const sessions = new SessionManager({ now });
    sessions.applyEvent(event());

    expect(sessions.remove('session-a')).toBe(true);
    expect(sessions.remove('missing')).toBe(false);
  });

  it('clears every session', () => {
    const sessions = new SessionManager({ now });
    sessions.applyEvent(event({ sessionId: 'a' }));
    sessions.applyEvent(event({ sessionId: 'b' }));
    sessions.clear();

    expect(sessions.size).toBe(0);
  });
});
