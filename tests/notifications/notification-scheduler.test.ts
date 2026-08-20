import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NotificationScheduler } from '../../src/notifications/notification-scheduler.js';
import type {
  NotificationService,
  NotificationRequest,
} from '../../src/notifications/notification-service.js';
import type { RoutedEvent } from '../../src/core/event-router.js';
import { DEFAULT_CONFIG, type PingBackConfig } from '../../src/config/config-manager.js';

class MockNotificationService implements NotificationService {
  readonly delivered: NotificationRequest[] = [];
  available = true;

  isAvailable(): boolean {
    return this.available;
  }

  notify(request: NotificationRequest): Promise<void> {
    this.delivered.push(request);
    return Promise.resolve();
  }
}

function makeRouted(overrides: Partial<RoutedEvent['event']> = {}): RoutedEvent {
  const event = {
    id: 'evt-1',
    agent: 'claude' as const,
    sessionId: 'sess-1',
    type: 'attention_required' as const,
    title: 'Attention',
    message: 'Waiting',
    timestamp: Date.now(),
    ...overrides,
  };
  return {
    event,
    session: {
      id: event.sessionId,
      agent: event.agent,
      status: 'waiting',
      startedAt: event.timestamp,
      lastActivityAt: event.timestamp,
    },
    priority: 'high',
  };
}

describe('NotificationScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches immediately when delaySeconds is 0', async () => {
    const service = new MockNotificationService();
    const config: PingBackConfig = {
      ...DEFAULT_CONFIG,
      notifications: {
        ...DEFAULT_CONFIG.notifications,
        events: {
          ...DEFAULT_CONFIG.notifications.events,
          attention_required: { delaySeconds: 0, sound: true, desktop: true },
        },
      },
    };

    const scheduler = new NotificationScheduler({
      notifications: service,
      getConfig: () => config,
    });

    const routed = makeRouted();
    await scheduler.schedule(routed);

    expect(service.delivered).toHaveLength(1);
    expect(service.delivered[0]?.title).toBe('Attention');
  });

  it('delays notification dispatch by configured delaySeconds', async () => {
    const service = new MockNotificationService();
    const config: PingBackConfig = {
      ...DEFAULT_CONFIG,
      notifications: {
        ...DEFAULT_CONFIG.notifications,
        events: {
          ...DEFAULT_CONFIG.notifications.events,
          question: { delaySeconds: 5, sound: true, desktop: true },
        },
      },
    };

    const scheduler = new NotificationScheduler({
      notifications: service,
      getConfig: () => config,
    });

    const routed = makeRouted({
      type: 'question',
      title: 'Question',
      message: 'Need answer',
    });
    await scheduler.schedule(routed);

    expect(service.delivered).toHaveLength(0);
    expect(scheduler.hasPending('sess-1', 'claude')).toBe(true);

    // Advance 4 seconds: still pending
    vi.advanceTimersByTime(4000);
    expect(service.delivered).toHaveLength(0);

    // Advance past 5 seconds: dispatched!
    vi.advanceTimersByTime(1000);
    expect(service.delivered).toHaveLength(1);
    expect(service.delivered[0]?.title).toBe('Question');
    expect(scheduler.hasPending('sess-1', 'claude')).toBe(false);
  });

  it('cancels pending notification when user resumes activity during grace period', async () => {
    const service = new MockNotificationService();
    const config: PingBackConfig = {
      ...DEFAULT_CONFIG,
      notifications: {
        ...DEFAULT_CONFIG.notifications,
        events: {
          ...DEFAULT_CONFIG.notifications.events,
          attention_required: { delaySeconds: 3, sound: true, desktop: true },
        },
      },
    };

    const scheduler = new NotificationScheduler({
      notifications: service,
      getConfig: () => config,
    });

    const routed = makeRouted({ sessionId: 'sess-abc', agent: 'codex' });
    await scheduler.schedule(routed);

    expect(scheduler.hasPending('sess-abc', 'codex')).toBe(true);

    // User submits prompt after 1.5s
    vi.advanceTimersByTime(1500);
    const cancelled = scheduler.cancel('sess-abc', 'codex');
    expect(cancelled).toBe(true);
    expect(scheduler.hasPending('sess-abc', 'codex')).toBe(false);

    // Advance past original timer
    vi.advanceTimersByTime(3000);
    expect(service.delivered).toHaveLength(0);
  });

  it('respects event-level sound and desktop disabled toggles', async () => {
    const service = new MockNotificationService();
    const config: PingBackConfig = {
      ...DEFAULT_CONFIG,
      notifications: {
        desktop: true,
        sound: true,
        volume: 1.0,
        events: {
          ...DEFAULT_CONFIG.notifications.events,
          task_completed: { delaySeconds: 0, sound: false, desktop: true },
        },
      },
    };

    const scheduler = new NotificationScheduler({
      notifications: service,
      getConfig: () => config,
    });

    const routed = makeRouted({ type: 'task_completed' });
    await scheduler.schedule(routed);

    expect(service.delivered).toHaveLength(1);
    expect(service.delivered[0]?.sound).toBe(false);
  });

  it('attaches the focus action returned for the exact routed agent session', async () => {
    const service = new MockNotificationService();
    const action = {
      label: 'Return to Codex',
      onActivate: () => Promise.resolve({ handled: true }),
    };
    const actionFor = vi.fn(() => action);
    const scheduler = new NotificationScheduler({
      notifications: service,
      getConfig: () => DEFAULT_CONFIG,
      actionFor,
    });
    const routed = makeRouted({ agent: 'codex', sessionId: 'codex-42' });

    await scheduler.schedule(routed);

    expect(actionFor).toHaveBeenCalledWith(routed);
    expect(
      (service.delivered[0] as NotificationRequest & { action?: unknown }).action,
    ).toBe(action);
  });
});
