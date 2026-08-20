import notifier from 'node-notifier';
import type { Logger } from '../utils/logger.js';
import { silentLogger } from '../utils/logger.js';
import type { NotificationRequest, NotificationService } from './notification-service.js';
import { soundForPriority } from './notification-policy.js';
import type { SoundPlayer } from './sound-service.js';

export const APP_NAME = 'PingBack';

/** Minimal surface of node-notifier that PingBack depends on. */
export interface NotifierLike {
  notify(
    options: Record<string, unknown>,
    callback: (error: Error | null) => void,
  ): unknown;
}

export interface DesktopNotificationOptions {
  sound: SoundPlayer;
  logger?: Logger;
  notifier?: NotifierLike;
  /** Overridable for tests; defaults to the real availability probe. */
  available?: boolean;
}

/**
 * Builds the notification body. The project line is appended rather than sent
 * as a separate field because both Windows toasts and macOS notifications
 * render a single message block.
 */
export function formatBody(request: NotificationRequest): string {
  const parts = [request.message];
  if (request.project !== undefined) parts.push(`Project: ${request.project}`);
  return parts.filter((part) => part.length > 0).join('\n');
}

export class DesktopNotificationService implements NotificationService {
  readonly #sound: SoundPlayer;
  readonly #logger: Logger;
  readonly #notifier: NotifierLike;
  readonly #available: boolean;

  constructor(options: DesktopNotificationOptions) {
    this.#sound = options.sound;
    this.#logger = options.logger ?? silentLogger();
    this.#notifier = options.notifier ?? notifier;
    this.#available =
      options.available ??
      (process.platform === 'win32' || process.platform === 'darwin');
  }

  isAvailable(): boolean {
    return this.#available;
  }

  async notify(request: NotificationRequest): Promise<void> {
    // The sound is played by PingBack rather than by the toast so the tone
    // matches the event priority and stays consistent across platforms.
    await Promise.all([this.#showToast(request), this.#playSound(request)]);
  }

  async #playSound(request: NotificationRequest): Promise<void> {
    if (!request.sound) return;
    try {
      await this.#sound.play(soundForPriority(request.priority));
    } catch (error) {
      // Sound is secondary; a silent notification still does its job.
      this.#logger.warn('notification sound failed', { err: error });
    }
  }

  #showToast(request: NotificationRequest): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (error: Error | null): void => {
        if (error) this.#logger.warn('desktop notification failed', { err: error });
        else this.#logger.info('notification delivered', { priority: request.priority });
        resolve();
      };

      try {
        this.#notifier.notify(
          {
            title: request.title,
            message: formatBody(request),
            appName: APP_NAME,
            sound: false,
            wait: false,
          },
          done,
        );
      } catch (error) {
        this.#logger.warn('desktop notification threw', { err: error });
        resolve();
      }
    });
  }
}
