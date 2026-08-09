import { describe, expect, it } from 'vitest';
import {
  buildNotification,
  projectName,
  shouldPlaySound,
} from '../../src/notifications/notification-policy.js';
import type { RoutedEvent } from '../../src/core/event-router.js';

function routed(overrides: Partial<RoutedEvent> = {}): RoutedEvent {
  return {
    event: {
      id: 'e1',
      agent: 'claude',
      sessionId: 's1',
      type: 'attention_required',
      title: 'Claude Code needs your attention',
      message: 'Claude is waiting for permission.',
      cwd: '/Users/dev/finbot',
      timestamp: 1000,
    },
    priority: 'high',
    session: {
      id: 's1',
      agent: 'claude',
      status: 'waiting',
      startedAt: 1000,
      cwd: '/Users/dev/finbot',
    },
    ...overrides,
  };
}

describe('projectName', () => {
  it('takes the last segment of a POSIX path', () => {
    expect(projectName('/Users/dev/finbot')).toBe('finbot');
  });

  it('takes the last segment of a Windows path', () => {
    expect(projectName('C:\\code\\agent-monitor')).toBe('agent-monitor');
  });

  it('ignores a trailing separator', () => {
    expect(projectName('/Users/dev/finbot/')).toBe('finbot');
    expect(projectName('C:\\code\\finbot\\')).toBe('finbot');
  });

  it('returns undefined for missing or empty input', () => {
    expect(projectName(undefined)).toBeUndefined();
    expect(projectName('')).toBeUndefined();
    expect(projectName('   ')).toBeUndefined();
  });

  it('returns undefined for a bare drive root', () => {
    expect(projectName('C:\\')).toBeUndefined();
  });
});

describe('shouldPlaySound', () => {
  it('stays silent for low-priority events', () => {
    expect(shouldPlaySound('low', { desktop: true, sound: true })).toBe(false);
  });

  it('plays for medium and high priority', () => {
    expect(shouldPlaySound('medium', { desktop: true, sound: true })).toBe(true);
    expect(shouldPlaySound('high', { desktop: true, sound: true })).toBe(true);
  });

  it('never plays when sound is disabled', () => {
    expect(shouldPlaySound('high', { desktop: true, sound: false })).toBe(false);
  });
});

describe('buildNotification', () => {
  it('builds a notification from a routed event', () => {
    const request = buildNotification(routed(), { desktop: true, sound: true });

    expect(request).toEqual({
      title: 'Claude Code needs your attention',
      message: 'Claude is waiting for permission.',
      priority: 'high',
      project: 'finbot',
      sound: true,
    });
  });

  it('returns undefined when desktop notifications are disabled', () => {
    expect(buildNotification(routed(), { desktop: false, sound: true })).toBeUndefined();
  });

  it('falls back to the event cwd when the session has none', () => {
    const request = buildNotification(
      routed({
        session: { id: 's1', agent: 'claude', status: 'waiting', startedAt: 0 },
      }),
      { desktop: true, sound: true },
    );

    expect(request?.project).toBe('finbot');
  });

  it('omits the project when no directory is known', () => {
    const request = buildNotification(
      routed({
        event: {
          id: 'e1',
          agent: 'claude',
          sessionId: 's1',
          type: 'error',
          title: 't',
          message: 'm',
          timestamp: 0,
        },
        session: { id: 's1', agent: 'claude', status: 'error', startedAt: 0 },
        priority: 'medium',
      }),
      { desktop: true, sound: true },
    );

    expect(request?.project).toBeUndefined();
  });
});
