import { beforeEach, describe, expect, it } from 'vitest';
import { EventRouter } from '../../src/core/event-router.js';
import { SessionManager } from '../../src/sessions/session-manager.js';
import type { AgentEvent, AgentEventType } from '../../src/core/types.js';

let clock = 1000;
const now = (): number => clock;

function event(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: `evt-${String(Math.random())}`,
    agent: 'claude',
    sessionId: 'session-a',
    type: 'attention_required',
    title: 'Claude Code needs your attention',
    message: 'Waiting for permission.',
    timestamp: clock,
    ...overrides,
  };
}

function makeRouter(): { router: EventRouter; sessions: SessionManager } {
  const sessions = new SessionManager({ now });
  const router = new EventRouter({ sessions, now, dedupeWindowMs: 2000 });
  return { router, sessions };
}

beforeEach(() => {
  clock = 1000;
});

describe('EventRouter', () => {
  it('routes a fresh event with its priority and session', () => {
    const { router } = makeRouter();
    const outcome = router.route(event({ id: 'e1' }));

    expect(outcome.status).toBe('routed');
    if (outcome.status !== 'routed') throw new Error('expected routed');
    expect(outcome.routed.priority).toBe('high');
    expect(outcome.routed.session.id).toBe('session-a');
    expect(outcome.routed.session.status).toBe('waiting');
  });

  it.each<[AgentEventType, string]>([
    ['attention_required', 'high'],
    ['question', 'high'],
    ['error', 'medium'],
    ['task_completed', 'low'],
  ])('assigns %s the %s priority', (type, priority) => {
    const { router } = makeRouter();
    const outcome = router.route(event({ id: `e-${type}`, type }));

    if (outcome.status !== 'routed') throw new Error('expected routed');
    expect(outcome.routed.priority).toBe(priority);
  });

  it('drops a replayed event id', () => {
    const { router } = makeRouter();
    router.route(event({ id: 'same' }));
    const second = router.route(event({ id: 'same' }));

    expect(second.status).toBe('duplicate');
    if (second.status !== 'duplicate') throw new Error('expected duplicate');
    expect(second.reason).toBe('event_id');
  });

  it('collapses identical session and type events inside the window', () => {
    const { router } = makeRouter();
    router.route(event({ id: 'e1' }));

    clock += 500;
    const second = router.route(event({ id: 'e2' }));

    expect(second.status).toBe('duplicate');
    if (second.status !== 'duplicate') throw new Error('expected duplicate');
    expect(second.reason).toBe('repeat_within_window');
  });

  it('still updates session state for a suppressed duplicate', () => {
    const { router, sessions } = makeRouter();
    router.route(event({ id: 'e1', type: 'attention_required' }));

    clock += 500;
    router.route(event({ id: 'e2', type: 'attention_required', cwd: '/proj' }));

    expect(sessions.get('session-a')?.cwd).toBe('/proj');
  });

  it('routes again once the dedupe window has passed', () => {
    const { router } = makeRouter();
    router.route(event({ id: 'e1' }));

    clock += 2500;
    const second = router.route(event({ id: 'e2' }));

    expect(second.status).toBe('routed');
  });

  it('does not collapse different event types in the same session', () => {
    const { router } = makeRouter();
    router.route(event({ id: 'e1', type: 'attention_required' }));
    const second = router.route(event({ id: 'e2', type: 'error' }));

    expect(second.status).toBe('routed');
  });

  it('does not collapse the same event type across different sessions', () => {
    const { router } = makeRouter();
    router.route(event({ id: 'e1', sessionId: 'session-a' }));
    const second = router.route(event({ id: 'e2', sessionId: 'session-b' }));

    expect(second.status).toBe('routed');
  });

  it('keeps concurrent sessions independent', () => {
    const { router, sessions } = makeRouter();
    router.route(
      event({ id: 'e1', sessionId: 'a', cwd: '/a', type: 'attention_required' }),
    );
    router.route(event({ id: 'e2', sessionId: 'b', cwd: '/b', type: 'task_completed' }));

    expect(sessions.get('a')?.status).toBe('waiting');
    expect(sessions.get('b')?.status).toBe('completed');
    expect(sessions.get('a')?.cwd).toBe('/a');
    expect(sessions.get('b')?.cwd).toBe('/b');
  });

  it('bounds the remembered event id set', () => {
    const sessions = new SessionManager({ now });
    const router = new EventRouter({
      sessions,
      now,
      recentIdLimit: 2,
      dedupeWindowMs: 0,
    });

    router.route(event({ id: 'a' }));
    router.route(event({ id: 'b' }));
    router.route(event({ id: 'c' }));

    // 'a' was evicted, so it is no longer recognized as a duplicate.
    expect(router.route(event({ id: 'a' })).status).toBe('routed');
    expect(router.route(event({ id: 'c' })).status).toBe('duplicate');
  });
});
