export interface PendingNotification {
  sessionId: string;
  eventType: string;
}

export type NotificationDelivery = () => Promise<void>;

function keyFor(notification: PendingNotification): string {
  return `${notification.sessionId}:${notification.eventType}`;
}

/**
 * Owns delayed notification delivery without delaying Claude's hook request.
 * The daemon cancels a session's pending work when Claude resumes or ends.
 */
export class NotificationScheduler {
  readonly #pending = new Map<string, ReturnType<typeof setTimeout>>();

  schedule(
    notification: PendingNotification,
    delaySeconds: number,
    deliver: NotificationDelivery,
  ): void {
    const key = keyFor(notification);
    this.#clear(key);

    const timer = setTimeout(() => {
      this.#pending.delete(key);
      void deliver();
    }, delaySeconds * 1_000);
    timer.unref();
    this.#pending.set(key, timer);
  }

  cancelSession(sessionId: string): void {
    for (const key of this.#pending.keys()) {
      if (!key.startsWith(`${sessionId}:`)) continue;
      this.#clear(key);
    }
  }

  #clear(key: string): void {
    const timer = this.#pending.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#pending.delete(key);
  }
}
