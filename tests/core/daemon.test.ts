import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Daemon } from '../../src/core/daemon.js';
import { DaemonState } from '../../src/core/daemon-state.js';
import { SessionManager } from '../../src/sessions/session-manager.js';
import { createPlatform, type Platform } from '../../src/platform/platform.js';
import type { TerminalFocusService } from '../../src/platform/terminal-focus.js';
import { silentLogger } from '../../src/utils/logger.js';
import { DEFAULT_CONFIG, type PingBackConfig } from '../../src/config/config-manager.js';
import type {
  NotificationRequest,
  NotificationService,
} from '../../src/notifications/notification-service.js';
import type { IpcRequest } from '../../src/core/ipc/protocol.js';

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

const ZERO_DELAY_EVENTS = {
  attention_required: { delaySeconds: 0, sound: true, desktop: true },
  question: { delaySeconds: 0, sound: true, desktop: true },
  error: { delaySeconds: 0, sound: true, desktop: true },
  task_completed: { delaySeconds: 0, sound: false, desktop: true },
};

function makeDaemon(
  overrides: {
    notifier?: NotificationService;
    config?: Partial<PingBackConfig>;
    claudeConnected?: () => boolean;
    terminalFocus?: TerminalFocusService;
  } = {},
): { daemon: Daemon; sessions: SessionManager; notifier: RecordingNotifier } {
  const notifier = (overrides.notifier ?? new RecordingNotifier()) as RecordingNotifier;
  const sessions = new SessionManager({ now: () => clock });

  const config: PingBackConfig = {
    ...DEFAULT_CONFIG,
    ...overrides.config,
    notifications: {
      ...DEFAULT_CONFIG.notifications,
      ...overrides.config?.notifications,
      events: overrides.config?.notifications?.events ?? ZERO_DELAY_EVENTS,
    },
  };

  const daemonOptions = {
    platform,
    config,
    sessions,
    notifications: notifier,
    state: new DaemonState(dir),
    logger: silentLogger(),
    version: '0.1.0',
    now: () => clock,
    ...(overrides.claudeConnected === undefined
      ? {}
      : { claudeConnected: overrides.claudeConnected }),
  } as ConstructorParameters<typeof Daemon>[0] & { terminalFocus?: TerminalFocusService };
  if (overrides.terminalFocus !== undefined)
    daemonOptions.terminalFocus = overrides.terminalFocus;
  const daemon = new Daemon(daemonOptions);

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

  it('binds Return to Codex to the matching multi-agent session at activation time', async () => {
    const focusTerminal = vi.fn(() =>
      Promise.resolve({
        focused: true,
        message: 'Focused WindowsTerminal.',
      }),
    );
    const terminalFocus: TerminalFocusService = {
      detectTerminal: () => Promise.resolve(undefined),
      focusTerminal,
    };
    const { daemon, notifier } = makeDaemon({ terminalFocus });

    await daemon.ingest(
      eventPayload({
        id: 'e-codex',
        agent: 'codex',
        sessionId: 'codex-42',
        pid: 4242,
        cwd: 'C:\\code\\api',
      }),
    );

    const action = notifier.sent[0]?.action;
    expect(action?.label).toBe('Return to Codex');
    await expect(action?.onActivate()).resolves.toEqual({ handled: true });
    expect(focusTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'codex-42', agent: 'codex', pid: 4242 }),
    );
  });

  it('rejects a malformed event', async () => {
    const { daemon } = makeDaemon();

    await expect(daemon.ingest({ agent: 'unsupported' })).rejects.toThrow(/unsupported/);
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

  it('does not send a sound for low-priority completions', async () => {
    const { daemon, notifier } = makeDaemon();
    await daemon.ingest(eventPayload({ id: 'e1', type: 'task_completed' }));

    expect(notifier.sent[0]?.sound).toBe(false);
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
          desktop: false,
          sound: true,
          volume: 1.0,
          events: ZERO_DELAY_EVENTS,
        },
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
          desktop: true,
          sound: false,
          volume: 1.0,
          events: ZERO_DELAY_EVENTS,
        },
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
