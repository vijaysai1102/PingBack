import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Daemon } from '../../src/core/daemon.js';
import { DaemonState } from '../../src/core/daemon-state.js';
import { SessionManager } from '../../src/sessions/session-manager.js';
import { createPlatform, type Platform } from '../../src/platform/platform.js';
import { silentLogger } from '../../src/utils/logger.js';
import { DEFAULT_CONFIG, type PingBackConfig } from '../../src/config/config-manager.js';
import type {
  NotificationRequest,
  NotificationService,
} from '../../src/notifications/notification-service.js';
import type { IpcRequest } from '../../src/core/ipc/protocol.js';
import type {
  ApplicationFocusService,
  ApplicationInfo,
} from '../../src/applications/project-association.js';

class RecordingNotifier implements NotificationService {
  readonly sent: NotificationRequest[] = [];
  available = true;
  failWith: Error | undefined;

  isAvailable(): boolean {
    return this.available;
  }

  notify(request: NotificationRequest): Promise<void> {
    if (this.failWith !== undefined) return Promise.reject(this.failWith);
    this.sent.push(request);
    return Promise.resolve();
  }
}

let dir: string;
let clock: number;

const platform: Platform = createPlatform({
  platform: 'darwin',
  env: {},
  homedir: '/Users/dev',
  tmpdir: '/tmp',
  uid: '501',
});

function makeDaemon(
  overrides: {
    notifier?: NotificationService;
    config?: PingBackConfig;
    claudeConnected?: () => boolean;
    applicationFocus?: ApplicationFocusService;
  } = {},
): { daemon: Daemon; sessions: SessionManager; notifier: RecordingNotifier } {
  const notifier = (overrides.notifier ?? new RecordingNotifier()) as RecordingNotifier;
  const sessions = new SessionManager({ now: () => clock });

  const daemon = new Daemon({
    platform,
    config: overrides.config ?? DEFAULT_CONFIG,
    sessions,
    notifications: notifier,
    state: new DaemonState(dir),
    logger: silentLogger(),
    version: '0.1.0',
    now: () => clock,
    ...(overrides.applicationFocus === undefined
      ? {}
      : { applicationFocus: overrides.applicationFocus }),
    ...(overrides.claudeConnected === undefined
      ? {}
      : { claudeConnected: overrides.claudeConnected }),
  });

  return { daemon, sessions, notifier };
}

function eventPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    agent: 'claude',
    sessionId: 'session-a',
    type: 'attention_required',
    title: 'Claude Code needs your attention',
    message: 'Claude is waiting for permission.',
    cwd: '/Users/dev/finbot',
    timestamp: clock,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pingback-daemon-'));
  clock = 1000;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('Daemon.ingest', () => {
  it('accepts a valid event and notifies', async () => {
    const { daemon, notifier } = makeDaemon();
    const ack = await daemon.ingest(eventPayload({ id: 'e1' }));

    expect(ack).toEqual({ accepted: true, duplicate: false, notified: true });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.priority).toBe('high');
    expect(notifier.sent[0]?.project).toBe('finbot');
  });

  it('tracks the session', async () => {
    const { daemon, sessions } = makeDaemon();
    await daemon.ingest(eventPayload({ id: 'e1' }));

    expect(sessions.get('session-a')?.status).toBe('waiting');
  });

  it('binds a matched application focus action to a notification', async () => {
    const application: ApplicationInfo = {
      id: 'visual-studio-code',
      name: 'Visual Studio Code',
      projectPaths: ['/Users/dev/finbot'],
    };
    let focused = false;
    const applicationFocus: ApplicationFocusService = {
      detectApplication: () => Promise.resolve(application),
      focusApplication: () => {
        focused = true;
        return Promise.resolve(true);
      },
    };
    const { daemon, notifier } = makeDaemon({ applicationFocus });

    await daemon.ingest(eventPayload({ id: 'e1' }));
    await notifier.sent[0]?.onActivate?.();

    expect(focused).toBe(true);
  });

  it('rejects a malformed event', async () => {
    const { daemon } = makeDaemon();

    await expect(daemon.ingest({ agent: 'codex' })).rejects.toThrow(/codex/);
    await expect(daemon.ingest('garbage')).rejects.toThrow();
  });

  it('reports a duplicate without notifying twice', async () => {
    const { daemon, notifier } = makeDaemon();
    await daemon.ingest(eventPayload({ id: 'e1' }));
    const second = await daemon.ingest(eventPayload({ id: 'e1' }));

    expect(second.duplicate).toBe(true);
    expect(second.notified).toBe(false);
    expect(notifier.sent).toHaveLength(1);
  });

  it('sends a sound for task completions after their default delay', async () => {
    vi.useFakeTimers();
    try {
      const { daemon, notifier } = makeDaemon();
      await daemon.ingest(eventPayload({ id: 'e1', type: 'task_completed' }));

      expect(notifier.sent).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(notifier.sent[0]?.sound).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('acknowledges an error immediately and delivers it after its configured delay', async () => {
    vi.useFakeTimers();
    try {
      const { daemon, notifier } = makeDaemon();

      await expect(
        daemon.ingest(eventPayload({ id: 'e1', type: 'error' })),
      ).resolves.toEqual({ accepted: true, duplicate: false, notified: false });
      expect(notifier.sent).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(notifier.sent).toHaveLength(1);
      expect(notifier.sent[0]?.priority).toBe('medium');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a delayed notification when the same session resumes working', async () => {
    vi.useFakeTimers();
    try {
      const { daemon, notifier } = makeDaemon();
      await daemon.ingest(eventPayload({ id: 'e1', type: 'error' }));
      daemon.updateSession({ sessionId: 'session-a', status: 'working' });

      await vi.advanceTimersByTimeAsync(3_000);
      expect(notifier.sent).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends a sound for high-priority events', async () => {
    const { daemon, notifier } = makeDaemon();
    await daemon.ingest(eventPayload({ id: 'e1' }));

    expect(notifier.sent[0]?.sound).toBe(true);
  });

  it('honours the desktop:false config', async () => {
    const { daemon, notifier } = makeDaemon({
      config: {
        notifications: {
          ...DEFAULT_CONFIG.notifications,
          enabled: false,
        },
        logLevel: 'info',
      },
    });
    const ack = await daemon.ingest(eventPayload({ id: 'e1' }));

    expect(ack.notified).toBe(false);
    expect(notifier.sent).toHaveLength(0);
  });

  it('honours the sound:false config', async () => {
    const { daemon, notifier } = makeDaemon({
      config: {
        notifications: {
          ...DEFAULT_CONFIG.notifications,
          sound: { enabled: false, volume: 1 },
        },
        logLevel: 'info',
      },
    });
    await daemon.ingest(eventPayload({ id: 'e1' }));

    expect(notifier.sent[0]?.sound).toBe(false);
  });

  it('keeps tracking sessions when notifications are unavailable', async () => {
    const notifier = new RecordingNotifier();
    notifier.available = false;
    const { daemon, sessions } = makeDaemon({ notifier });

    const ack = await daemon.ingest(eventPayload({ id: 'e1' }));

    expect(ack.accepted).toBe(true);
    expect(ack.notified).toBe(false);
    expect(sessions.get('session-a')?.status).toBe('waiting');
  });

  it('survives a notifier that throws', async () => {
    const notifier = new RecordingNotifier();
    notifier.failWith = new Error('toast subsystem down');
    const { daemon, sessions } = makeDaemon({ notifier });

    const ack = await daemon.ingest(eventPayload({ id: 'e1' }));

    expect(ack.accepted).toBe(true);
    expect(ack.notified).toBe(false);
    expect(sessions.get('session-a')?.status).toBe('waiting');
  });

  it('keeps multiple concurrent sessions distinct', async () => {
    const { daemon, sessions } = makeDaemon();
    await daemon.ingest(eventPayload({ id: 'e1', sessionId: 'a', cwd: '/x/alpha' }));
    await daemon.ingest(
      eventPayload({ id: 'e2', sessionId: 'b', cwd: '/x/beta', type: 'error' }),
    );

    expect(sessions.get('a')?.status).toBe('waiting');
    expect(sessions.get('b')?.status).toBe('error');
    expect(sessions.size).toBe(2);
  });
});

describe('Daemon.handleRequest', () => {
  function request(type: IpcRequest['type'], payload?: unknown): IpcRequest {
    return {
      id: 'r1',
      token: 'tok',
      type,
      ...(payload === undefined ? {} : { payload }),
    };
  }

  it('answers ping', async () => {
    const { daemon } = makeDaemon();
    await expect(daemon.handleRequest(request('ping'))).resolves.toEqual({
      pong: true,
      version: '0.1.0',
    });
  });

  it('returns status with sessions', async () => {
    const { daemon } = makeDaemon({ claudeConnected: () => true });
    await daemon.ingest(eventPayload({ id: 'e1' }));

    const status = (await daemon.handleRequest(request('status'))) as {
      sessions: unknown[];
      claudeConnected: boolean;
      platform: string;
    };

    expect(status.sessions).toHaveLength(1);
    expect(status.claudeConnected).toBe(true);
    expect(status.platform).toBe('macos');
  });

  it('reports claude as disconnected by default', async () => {
    const { daemon } = makeDaemon();
    const status = (await daemon.handleRequest(request('status'))) as {
      claudeConnected: boolean;
    };

    expect(status.claudeConnected).toBe(false);
  });

  it('routes an event request through ingest', async () => {
    const { daemon, sessions } = makeDaemon();
    const ack = await daemon.handleRequest(request('event', eventPayload({ id: 'e1' })));

    expect(ack).toMatchObject({ accepted: true });
    expect(sessions.get('session-a')).toBeDefined();
  });

  it('acknowledges shutdown before stopping', async () => {
    const { daemon } = makeDaemon();
    const stop = vi.spyOn(daemon, 'stop').mockResolvedValue();

    await expect(daemon.handleRequest(request('shutdown'))).resolves.toEqual({
      stopping: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(stop).toHaveBeenCalled();
  });
});
