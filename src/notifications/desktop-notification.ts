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
    callback: (error: Error | null, response?: unknown, metadata?: unknown) => void,
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

const ACTIVATION_RESPONSES = new Set([
  'activate',
  'click',
  'clicked',
  'open project',
  'return to project',
]);

type ToastOutcome = 'hidden' | 'dismissed' | 'timedout';

const TOAST_OUTCOMES: Record<string, ToastOutcome> = {
  hidden: 'hidden',
  dismissed: 'dismissed',
  timedout: 'timedout',
  timeout: 'timedout',
};

function activationResponseValue(value: unknown): boolean {
  return (
    typeof value === 'string' && ACTIVATION_RESPONSES.has(value.trim().toLowerCase())
  );
}

function toastOutcomeValue(value: unknown): ToastOutcome | undefined {
  if (typeof value !== 'string') return undefined;
  return TOAST_OUTCOMES[value.trim().toLowerCase()];
}

function toastOutcome(response?: unknown, metadata?: unknown): ToastOutcome | undefined {
  const direct = toastOutcomeValue(response) ?? toastOutcomeValue(metadata);
  if (direct !== undefined) return direct;

  for (const value of [response, metadata]) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const result = value as Record<string, unknown>;
    const outcome =
      toastOutcomeValue(result.action) ??
      toastOutcomeValue(result.activationType) ??
      toastOutcomeValue(result.activationValue);
    if (outcome !== undefined) return outcome;
  }

  return undefined;
}

/**
 * node-notifier's declared callback type uses a string response, but its
 * Windows SnoreToast implementation supplies an action-result object instead.
 * Treat only known click/action values as activation so dismissals remain no-ops.
 */
export function isActivationResponse(response?: unknown, metadata?: unknown): boolean {
  if (activationResponseValue(response) || activationResponseValue(metadata)) return true;

  for (const value of [response, metadata]) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const result = value as Record<string, unknown>;
    if (
      activationResponseValue(result.action) ||
      activationResponseValue(result.activationType) ||
      activationResponseValue(result.activationValue) ||
      activationResponseValue(result.button)
    ) {
      return true;
    }
  }

  return false;
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
      await this.#sound.play(soundForPriority(request.priority), request.volume);
    } catch (error) {
      // Sound is secondary; a silent notification still does its job.
      this.#logger.warn('notification sound failed', { err: error });
    }
  }

  #showToast(request: NotificationRequest): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (
        error: Error | null,
        response?: unknown,
        metadata?: unknown,
      ): void => {
        const outcome = toastOutcome(response, metadata);
        if (error) this.#logger.warn('desktop notification failed', { err: error });
        else if (outcome === 'hidden') {
          this.#logger.warn('desktop notification hidden', {
            priority: request.priority,
          });
        } else if (outcome === 'dismissed') {
          this.#logger.info('desktop notification dismissed', {
            priority: request.priority,
          });
        } else if (outcome === 'timedout') {
          this.#logger.info('desktop notification timed out', {
            priority: request.priority,
          });
        } else {
          this.#logger.info('notification delivered', { priority: request.priority });
        }
        if (
          isActivationResponse(response, metadata) &&
          request.onActivate !== undefined
        ) {
          this.#logger.info('notification activation received', {
            priority: request.priority,
          });
          void Promise.resolve(request.onActivate()).catch((activationError: unknown) => {
            this.#logger.warn('notification activation failed', { err: activationError });
          });
        }
        resolve();
      };

      try {
        const options: Record<string, unknown> = {
          title: request.title,
          message: formatBody(request),
          appName: APP_NAME,
          sound: false,
          wait: request.onActivate !== undefined,
        };
        if (request.onActivate !== undefined) options.actions = ['Open Project'];

        this.#notifier.notify(options, done);
        // node-notifier backends can retain the callback until the user clicks
        // an activatable toast. Dispatch must not hold up daemon event handling.
        resolve();
      } catch (error) {
        this.#logger.warn('desktop notification threw', { err: error });
        resolve();
      }
    });
  }
}
