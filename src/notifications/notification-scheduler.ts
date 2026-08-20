import type { RoutedEvent } from '../core/event-router.js';
import type { Logger } from '../utils/logger.js';
import { silentLogger } from '../utils/logger.js';
import type { NotificationAction, NotificationService } from './notification-service.js';
import type {
  EventNotificationConfig,
  PingBackConfig,
} from '../config/config-manager.js';
import { buildNotification } from './notification-policy.js';

export interface ScheduledNotification {
  routed: RoutedEvent;
  config: EventNotificationConfig;
  scheduledAt: number;
  fireAt: number;
  timerId: NodeJS.Timeout;
}

export interface NotificationSchedulerOptions {
  notifications: NotificationService;
  getConfig: () => PingBackConfig;
  /** Produces an action for this exact routed event/session, if supported. */
  actionFor?: (routed: RoutedEvent) => NotificationAction | undefined;
  logger?: Logger;
}

export class NotificationScheduler {
  readonly #notifications: NotificationService;
  readonly #getConfig: () => PingBackConfig;
  readonly #actionFor: (routed: RoutedEvent) => NotificationAction | undefined;
  readonly #logger: Logger;
  readonly #pending = new Map<string, ScheduledNotification>();

  constructor(options: NotificationSchedulerOptions) {
    this.#notifications = options.notifications;
    this.#getConfig = options.getConfig;
    this.#actionFor = options.actionFor ?? (() => undefined);
    this.#logger = options.logger ?? silentLogger();
  }

  async schedule(routed: RoutedEvent): Promise<boolean> {
    const key = `${routed.event.agent ?? 'claude'}:${routed.event.sessionId}`;
    this.cancel(routed.event.sessionId, routed.event.agent);

    const config = this.#getConfig();
    const eventConfig = config.notifications.events?.[routed.event.type] ?? {
      delaySeconds: 0,
      sound: true,
      desktop: true,
    };

    const delaySeconds = Math.max(0, eventConfig.delaySeconds ?? 0);

    if (delaySeconds === 0) {
      return await this.#dispatch(routed);
    }

    const scheduledAt = Date.now();
    const fireAt = scheduledAt + delaySeconds * 1000;

    const timerId = setTimeout(() => {
      this.#pending.delete(key);
      void this.#dispatch(routed);
    }, delaySeconds * 1000);

    if (timerId.unref) {
      timerId.unref();
    }

    this.#pending.set(key, {
      routed,
      config: eventConfig,
      scheduledAt,
      fireAt,
      timerId,
    });

    this.#logger.debug('scheduled notification with grace period', {
      key,
      eventType: routed.event.type,
      delaySeconds,
    });

    return true;
  }

  cancel(sessionId: string, agent?: string): boolean {
    const targetAgent = agent ?? 'claude';
    const key = `${targetAgent}:${sessionId}`;
    const item = this.#pending.get(key);
    if (item !== undefined) {
      clearTimeout(item.timerId);
      this.#pending.delete(key);
      this.#logger.debug('cancelled pending notification on user activity', { key });
      return true;
    }
    return false;
  }

  hasPending(sessionId: string, agent?: string): boolean {
    const targetAgent = agent ?? 'claude';
    return this.#pending.has(`${targetAgent}:${sessionId}`);
  }

  dispose(): void {
    for (const item of this.#pending.values()) {
      clearTimeout(item.timerId);
    }
    this.#pending.clear();
  }

  async #dispatch(routed: RoutedEvent): Promise<boolean> {
    const config = this.#getConfig();
    const eventConfig = config.notifications.events?.[routed.event.type];

    const desktopEnabled = config.notifications.desktop && (eventConfig?.desktop ?? true);
    const soundEnabled = config.notifications.sound && (eventConfig?.sound ?? true);

    const request = buildNotification(routed, {
      desktop: desktopEnabled,
      sound: soundEnabled,
      action: this.#actionFor(routed),
    });

    if (request === undefined) return false;
    if (!this.#notifications.isAvailable()) {
      this.#logger.warn('notification skipped', { reason: 'unavailable' });
      return false;
    }

    try {
      await this.#notifications.notify(request);
      return true;
    } catch (err: unknown) {
      this.#logger.error('notification delivery failed', { err });
      return false;
    }
  }
}
