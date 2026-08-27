import { describe, expect, it } from 'vitest';
import {
  buildNotification,
  projectName,
  shouldPlaySound,
} from '../../src/notifications/notification-policy.js';
import type { RoutedEvent } from '../../src/core/event-router.js';
import type { NotificationConfig } from '../../src/config/config-manager.js';

function notificationConfig(
  overrides: Partial<NotificationConfig> = {},
): NotificationConfig {
  return {
    enabled: true,
    sound: { enabled: true, volume: 0.8 },
    events: {
      question: { enabled: true, delaySeconds: 5 },
      turn_completion: { enabled: true, delaySeconds: 3 },
      error: { enabled: true, delaySeconds: 3 },
      task_completed: { enabled: true, delaySeconds: 5 },
    },
    ...overrides,
  };
}

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
  it('plays for every v0.2 notification event when sound is enabled', () => {
    const config = notificationConfig();
    expect(shouldPlaySound('low', config)).toBe(true);
    expect(shouldPlaySound('medium', config)).toBe(true);
    expect(shouldPlaySound('high', config)).toBe(true);
  });

  it('never plays when sound is disabled', () => {
    expect(
      shouldPlaySound(
        'high',
        notificationConfig({ sound: { enabled: false, volume: 0.8 } }),
      ),
    ).toBe(false);
  });
});

describe('buildNotification', () => {
  it('builds a notification from a routed event', () => {
    const request = buildNotification(routed(), notificationConfig());

    expect(request).toEqual({
      title: 'Claude Code needs your attention',
      message: 'Claude is waiting for permission.',
      priority: 'high',
      project: 'finbot',
      sound: true,
      volume: 0.8,
      delaySeconds: 0,
    });
  });

  it('uses the event-specific delay for errors', () => {
    const request = buildNotification(
      routed({
        event: {
          ...routed().event,
          type: 'error',
        },
        priority: 'medium',
      }),
      notificationConfig(),
    );

    expect(request).toMatchObject({ delaySeconds: 3 });
  });

  it('uses the turn-completion delay for normal Claude idle notifications', () => {
    const request = buildNotification(
      routed({
        event: { ...routed().event, type: 'turn_completion' },
        priority: 'low',
      }),
      notificationConfig(),
    );

    expect(request).toMatchObject({ delaySeconds: 3, sound: true });
  });

  it('does not build a notification for a disabled event type', () => {
    const config = notificationConfig();
    config.events.error.enabled = false;

    expect(
      buildNotification(
        routed({
          event: { ...routed().event, type: 'error' },
          priority: 'medium',
        }),
        config,
      ),
    ).toBeUndefined();
  });

  it('returns undefined when notifications are disabled', () => {
    expect(
      buildNotification(routed(), notificationConfig({ enabled: false })),
    ).toBeUndefined();
  });

  it('falls back to the event cwd when the session has none', () => {
    const request = buildNotification(
      routed({
        session: { id: 's1', agent: 'claude', status: 'waiting', startedAt: 0 },
      }),
      notificationConfig(),
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
      notificationConfig(),
    );

    expect(request?.project).toBeUndefined();
  });
});
