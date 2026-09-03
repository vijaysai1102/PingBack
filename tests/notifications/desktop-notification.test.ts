import { describe, expect, it, vi } from 'vitest';
import {
  APP_NAME,
  DesktopNotificationService,
  formatBody,
  type NotifierLike,
} from '../../src/notifications/desktop-notification.js';
import type { NotificationRequest } from '../../src/notifications/notification-service.js';
import type { SoundName, SoundPlayer } from '../../src/notifications/sound-service.js';
import { createLogger, type LogRecord } from '../../src/utils/logger.js';

function recordingLogger(): {
  logger: ReturnType<typeof createLogger>;
  records: LogRecord[];
} {
  const records: LogRecord[] = [];
  return {
    records,
    logger: createLogger({
      level: 'debug',
      sinks: [
        (record) => {
          records.push(record);
        },
      ],
    }),
  };
}

class RecordingSound implements SoundPlayer {
  readonly played: Array<{ sound: SoundName; volume: number }> = [];
  failWith: Error | undefined;

  isAvailable(): boolean {
    return true;
  }

  play(sound: SoundName, volume: number = 1): Promise<void> {
    if (this.failWith !== undefined) return Promise.reject(this.failWith);
    this.played.push({ sound, volume });
    return Promise.resolve();
  }
}

function fakeNotifier(error: Error | null = null): {
  notifier: NotifierLike;
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    notifier: {
      notify(options, callback) {
        calls.push(options);
        callback(error);
        return undefined;
      },
    },
  };
}

function request(overrides: Partial<NotificationRequest> = {}): NotificationRequest {
  return {
    title: 'Claude Code needs your attention',
    message: 'Claude is waiting for permission.',
    priority: 'high',
    project: 'finbot',
    sound: true,
    volume: 1,
    delaySeconds: 0,
    ...overrides,
  };
}

describe('formatBody', () => {
  it('appends the project line', () => {
    expect(formatBody(request())).toBe(
      'Claude is waiting for permission.\nProject: finbot',
    );
  });

  it('omits the project line when unknown', () => {
    expect(formatBody(request({ project: undefined }))).toBe(
      'Claude is waiting for permission.',
    );
  });

  it('handles an empty message', () => {
    expect(formatBody(request({ message: '', project: 'x' }))).toBe('Project: x');
  });
});

describe('DesktopNotificationService', () => {
  it('sends the title and body to the notifier', async () => {
    const { notifier, calls } = fakeNotifier();
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      available: true,
    });

    await service.notify(request());

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      title: 'Claude Code needs your attention',
      message: 'Claude is waiting for permission.\nProject: finbot',
    });
  });

  it('uses PingBack as the native notification identity on every supported platform', async () => {
    const { notifier, calls } = fakeNotifier();
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      available: true,
    });

    await service.notify(request());

    expect(calls[0]?.appName).toBe(APP_NAME);
  });

  it('disables the toast sound so PingBack controls the tone', async () => {
    const { notifier, calls } = fakeNotifier();
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      available: true,
    });

    await service.notify(request());
    expect(calls[0]?.sound).toBe(false);
  });

  it('plays the attention sound for high priority', async () => {
    const sound = new RecordingSound();
    const { notifier } = fakeNotifier();
    const service = new DesktopNotificationService({ sound, notifier, available: true });

    await service.notify(request({ priority: 'high' }));
    expect(sound.played).toEqual([{ sound: 'attention', volume: 1 }]);
  });

  it('plays the error sound for medium priority', async () => {
    const sound = new RecordingSound();
    const { notifier } = fakeNotifier();
    const service = new DesktopNotificationService({ sound, notifier, available: true });

    await service.notify(request({ priority: 'medium' }));
    expect(sound.played).toEqual([{ sound: 'error', volume: 1 }]);
  });

  it('plays no sound when the request asks for silence', async () => {
    const sound = new RecordingSound();
    const { notifier } = fakeNotifier();
    const service = new DesktopNotificationService({ sound, notifier, available: true });

    await service.notify(request({ sound: false }));
    expect(sound.played).toEqual([]);
  });

  it('runs the session-bound activation handler when the notification is clicked', async () => {
    let activations = 0;
    const notifier: NotifierLike = {
      notify(_options, callback) {
        callback(null, 'activate');
      },
    };
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      available: true,
    });

    await service.notify(
      request({
        onActivate: () => {
          activations += 1;
        },
      }),
    );

    expect(activations).toBe(1);
  });

  it('runs the session-bound activation handler for the Windows SnoreToast action result', async () => {
    let activations = 0;
    const notifier: NotifierLike = {
      notify(_options, callback) {
        callback(null, {
          action: 'buttonClicked',
          button: 'Open Project',
          activationType: 'Open Project',
        });
      },
    };
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      available: true,
    });

    await service.notify(
      request({
        onActivate: () => {
          activations += 1;
        },
      }),
    );

    expect(activations).toBe(1);
  });

  it('records when Windows returns an Open Project action', async () => {
    const { logger, records } = recordingLogger();
    const notifier: NotifierLike = {
      notify(_options, callback) {
        callback(null, {
          action: 'buttonClicked',
          button: 'Open Project',
          activationType: 'Open Project',
        });
      },
    };
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      logger,
      available: true,
    });

    await service.notify(request({ onActivate: () => undefined }));

    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'info',
        msg: 'notification activation received',
      }),
    );
  });

  it('runs the session-bound activation handler for the macOS action metadata', async () => {
    let activations = 0;
    const notifier: NotifierLike = {
      notify(_options, callback) {
        callback(null, undefined, { activationValue: 'Open Project' });
      },
    };
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      available: true,
    });

    await service.notify(
      request({
        onActivate: () => {
          activations += 1;
        },
      }),
    );

    expect(activations).toBe(1);
  });

  it('returns after dispatching an activatable notification without waiting for a click', async () => {
    let activationCallback:
      ((error: Error | null, response?: string) => void) | undefined;
    const notifier: NotifierLike = {
      notify(_options, callback) {
        activationCallback = callback;
      },
    };
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      available: true,
    });

    await expect(
      service.notify(request({ onActivate: () => undefined })),
    ).resolves.toBeUndefined();
    expect(activationCallback).toBeDefined();
  });

  it('adds an Open Project action when a session has an associated application', async () => {
    let options: Record<string, unknown> | undefined;
    const notifier: NotifierLike = {
      notify(notificationOptions, callback) {
        options = notificationOptions;
        callback(null);
      },
    };
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      available: true,
    });

    await service.notify(request({ onActivate: () => undefined }));

    expect(options?.actions).toEqual(['Open Project']);
  });

  it('still resolves when the notifier reports an error', async () => {
    const { notifier } = fakeNotifier(new Error('no notification center'));
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      available: true,
    });

    await expect(service.notify(request())).resolves.toBeUndefined();
  });

  it('reports availability', () => {
    const { notifier } = fakeNotifier();
    const sound = new RecordingSound();

    expect(
      new DesktopNotificationService({ sound, notifier, available: true }).isAvailable(),
    ).toBe(true);
    expect(
      new DesktopNotificationService({ sound, notifier, available: false }).isAvailable(),
    ).toBe(false);
  });

  it('does not throw when the notifier itself throws', async () => {
    const throwingNotifier: NotifierLike = {
      notify() {
        throw new Error('toaster missing');
      },
    };
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier: throwingNotifier,
      available: true,
    });

    await expect(service.notify(request())).resolves.toBeUndefined();
  });

  it('does not wait for the user to dismiss the toast', async () => {
    const { notifier, calls } = fakeNotifier();
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      available: true,
    });

    await service.notify(request());
    expect(calls[0]?.wait).toBe(false);
  });

  it('records delivery so the log can answer "was I notified?"', async () => {
    const { logger, records } = recordingLogger();
    const { notifier } = fakeNotifier();
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      logger,
      available: true,
    });

    await service.notify(request({ priority: 'high' }));

    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'info',
        msg: 'notification delivered',
        priority: 'high',
      }),
    );
  });

  it('records the failure instead of the delivery when the toast fails', async () => {
    const { logger, records } = recordingLogger();
    const { notifier } = fakeNotifier(new Error('no notification center'));
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      logger,
      available: true,
    });

    await service.notify(request());

    expect(records.map((record) => record.msg)).toContain('desktop notification failed');
    expect(records.map((record) => record.msg)).not.toContain('notification delivered');
  });

  it('records a hidden Windows toast as not visible', async () => {
    const { logger, records } = recordingLogger();
    const notifier: NotifierLike = {
      notify(_options, callback) {
        callback(null, { action: 'hidden', activationType: 'hidden' });
      },
    };
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      logger,
      available: true,
    });

    await service.notify(request());

    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'desktop notification hidden',
      }),
    );
    expect(records.map((record) => record.msg)).not.toContain('notification delivered');
  });

  it('records a timed-out Windows toast without calling it hidden', async () => {
    const { logger, records } = recordingLogger();
    const notifier: NotifierLike = {
      notify(_options, callback) {
        callback(null, { action: 'timedout', activationType: 'timedout' });
      },
    };
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier,
      logger,
      available: true,
    });

    await service.notify(request());

    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'info',
        msg: 'desktop notification timed out',
      }),
    );
    expect(records.map((record) => record.msg)).not.toContain(
      'desktop notification hidden',
    );
  });

  it('delivers the toast even when the sound player rejects', async () => {
    const sound = new RecordingSound();
    sound.failWith = new Error('no audio device');
    const { notifier, calls } = fakeNotifier();
    const service = new DesktopNotificationService({ sound, notifier, available: true });

    await expect(service.notify(request())).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});

describe('notifier integration shape', () => {
  it('calls notify exactly once per request', async () => {
    const notify = vi.fn(
      (_options: Record<string, unknown>, cb: (e: Error | null) => void) => {
        cb(null);
        return undefined;
      },
    );
    const service = new DesktopNotificationService({
      sound: new RecordingSound(),
      notifier: { notify },
      available: true,
    });

    await service.notify(request());
    await service.notify(request({ priority: 'low', sound: false }));

    expect(notify).toHaveBeenCalledTimes(2);
  });
});
