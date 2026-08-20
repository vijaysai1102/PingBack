import type { Platform } from '../platform/platform.js';
import type { PingBackConfig } from '../config/config-manager.js';
import type { Logger } from '../utils/logger.js';
import type { NotificationService } from '../notifications/notification-service.js';
import { buildNotification } from '../notifications/notification-policy.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { DaemonState } from './daemon-state.js';
import { EventRouter } from './event-router.js';
import { parseAgentEvent, parseSessionUpdate } from './event-schema.js';
import { IpcServer } from './ipc/server.js';
import type { DaemonStatus, IpcRequest } from './ipc/protocol.js';

export interface DaemonOptions {
  platform: Platform;
  config: PingBackConfig;
  sessions: SessionManager;
  notifications: NotificationService;
  state: DaemonState;
  logger: Logger;
  version: string;
  /** Reports whether the Claude integration is currently installed. */
  claudeConnected?: () => boolean;
  pruneIntervalMs?: number;
  now?: () => number;
}

const DEFAULT_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

export interface EventAck {
  accepted: boolean;
  duplicate: boolean;
  notified: boolean;
}

/**
 * The long-lived local process: it owns the IPC server, routes incoming agent
 * events into session state, and fans out notifications.
 */
export class Daemon {
  readonly #options: DaemonOptions;
  readonly #router: EventRouter;
  readonly #logger: Logger;
  readonly #now: () => number;

  #server: IpcServer | undefined;
  #pruneTimer: NodeJS.Timeout | undefined;
  #startedAt = 0;
  #stopping = false;
  #onStopped: (() => void) | undefined;

  constructor(options: DaemonOptions) {
    this.#options = options;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => Date.now());
    this.#router = new EventRouter({ sessions: options.sessions, now: this.#now });
  }

  get startedAt(): number {
    return this.#startedAt;
  }

  /** Registers a callback fired once the daemon has fully shut down. */
  onStopped(callback: () => void): void {
    this.#onStopped = callback;
  }

  async start(): Promise<void> {
    const { platform, state, logger, version } = this.#options;

    const token = state.ensureToken();
    this.#startedAt = this.#now();

    // Sessions restored from disk may predate a long downtime; drop the ones
    // that are already finished or abandoned before reporting any status.
    const stale = this.#options.sessions.prune();
    if (stale > 0) logger.debug('pruned stale sessions on start', { count: stale });

    const server = new IpcServer({
      endpoint: platform.ipcEndpoint,
      token,
      logger,
      handler: (request) => this.handleRequest(request),
    });

    await server.listen();
    this.#server = server;

    state.writeRecord({
      pid: process.pid,
      startedAt: this.#startedAt,
      endpoint: platform.ipcEndpoint,
      version,
    });

    this.#pruneTimer = setInterval(() => {
      const removed = this.#options.sessions.prune();
      if (removed > 0) logger.debug('pruned sessions', { removed });
    }, this.#options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS);
    this.#pruneTimer.unref();

    logger.info('daemon started', {
      pid: process.pid,
      version,
      platform: platform.id,
      endpoint: platform.ipcEndpoint,
    });
  }

  async stop(): Promise<void> {
    if (this.#stopping) return;
    this.#stopping = true;

    if (this.#pruneTimer !== undefined) {
      clearInterval(this.#pruneTimer);
      this.#pruneTimer = undefined;
    }

    await this.#server?.close();
    this.#server = undefined;
    this.#options.state.clearRecord();
    this.#logger.info('daemon stopped');
    this.#onStopped?.();
  }

  async handleRequest(request: IpcRequest): Promise<unknown> {
    switch (request.type) {
      case 'ping':
        return { pong: true, version: this.#options.version };

      case 'status':
        return this.status();

      case 'event':
        return this.ingest(request.payload);

      case 'session':
        return this.updateSession(request.payload);

      case 'shutdown':
        // Reply first, then unwind, so the caller sees a clean acknowledgement.
        setTimeout(() => {
          void this.stop();
        }, 0);
        return { stopping: true };
    }
  }

  status(): DaemonStatus {
    const { platform, version, claudeConnected } = this.#options;
    return {
      pid: process.pid,
      version,
      startedAt: this.#startedAt,
      platform: platform.id,
      claudeConnected: claudeConnected?.() ?? false,
      sessions: this.#options.sessions.list(),
    };
  }

  /** Applies a state-only change that should never raise a notification. */
  updateSession(payload: unknown): { accepted: true } {
    const update = parseSessionUpdate(payload);

    this.#options.sessions.touch(update.sessionId, update.status, {
      cwd: update.cwd,
      pid: update.pid,
    });

    this.#logger.debug('session updated', {
      sessionId: update.sessionId,
      status: update.status,
    });
    return { accepted: true };
  }

  /** Validates, routes and (when warranted) notifies for one incoming event. */
  async ingest(payload: unknown): Promise<EventAck> {
    const event = parseAgentEvent(payload, this.#now);
    const outcome = this.#router.route(event);

    if (outcome.status === 'duplicate') {
      this.#logger.debug('event suppressed', {
        sessionId: event.sessionId,
        type: event.type,
        reason: outcome.reason,
      });
      return { accepted: true, duplicate: true, notified: false };
    }

    this.#logger.info('event routed', {
      sessionId: event.sessionId,
      type: event.type,
      priority: outcome.routed.priority,
    });

    const notified = await this.#notify(outcome.routed);
    return { accepted: true, duplicate: false, notified };
  }

  async #notify(routed: Parameters<typeof buildNotification>[0]): Promise<boolean> {
    const request = buildNotification(routed, this.#options.config.notifications);
    if (request === undefined) return false;

    if (!this.#options.notifications.isAvailable()) {
      this.#logger.warn('notification skipped', { reason: 'unavailable' });
      return false;
    }

    try {
      await this.#options.notifications.notify(request);
      this.#logger.debug('notification delivered', { priority: request.priority });
      return true;
    } catch (error) {
      // Session tracking must survive a notification backend failure.
      this.#logger.error('notification failed', { err: error });
      return false;
    }
  }
}
