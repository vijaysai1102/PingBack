import type { EventPriority } from '../core/types.js';

export interface NotificationRequest {
  title: string;
  message: string;
  priority: EventPriority;
  /** Project or workspace name, shown when PingBack can determine it. */
  project?: string | undefined;
  /** Whether a sound should accompany this notification. */
  sound: boolean;
}

export interface NotificationService {
  /** Whether desktop notifications can currently be delivered. */
  isAvailable(): boolean;
  notify(request: NotificationRequest): Promise<void>;
}

/**
 * Used when notifications are disabled in config or unavailable on the host.
 * The daemon keeps running and tracking sessions either way.
 */
export class NullNotificationService implements NotificationService {
  isAvailable(): boolean {
    return false;
  }

  notify(): Promise<void> {
    return Promise.resolve();
  }
}
