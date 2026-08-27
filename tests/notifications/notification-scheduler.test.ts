import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationScheduler } from '../../src/notifications/notification-scheduler.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('NotificationScheduler', () => {
  it('delivers a notification only after its configured delay', async () => {
    vi.useFakeTimers();
    const scheduler = new NotificationScheduler();
    const deliver = vi.fn().mockResolvedValue(undefined);

    scheduler.schedule({ sessionId: 'finbot', eventType: 'error' }, 3, deliver);

    await vi.advanceTimersByTimeAsync(2_999);
    expect(deliver).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending session notification when Claude resumes work', async () => {
    vi.useFakeTimers();
    const scheduler = new NotificationScheduler();
    const deliver = vi.fn().mockResolvedValue(undefined);

    scheduler.schedule({ sessionId: 'finbot', eventType: 'question' }, 5, deliver);
    scheduler.cancelSession('finbot');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(deliver).not.toHaveBeenCalled();
  });
});
