export type EventHandler<T> = (payload: T) => void | Promise<void>;

export type EventMap = Record<string, unknown>;

export interface EventBusOptions {
  /** Called when a subscriber throws, so one bad listener cannot break the rest. */
  onListenerError?: (error: unknown, event: string) => void;
}

/**
 * A minimal typed publish/subscribe bus.
 *
 * Subscriber failures are isolated and reported rather than propagated: a
 * notification backend that throws must not stop session tracking.
 */
export class EventBus<Events> {
  readonly #handlers = new Map<keyof Events, Set<EventHandler<never>>>();
  readonly #onListenerError: ((error: unknown, event: string) => void) | undefined;

  constructor(options: EventBusOptions = {}) {
    this.#onListenerError = options.onListenerError;
  }

  on<K extends keyof Events & string>(
    event: K,
    handler: EventHandler<Events[K]>,
  ): () => void {
    let set = this.#handlers.get(event);
    if (set === undefined) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  once<K extends keyof Events & string>(
    event: K,
    handler: EventHandler<Events[K]>,
  ): () => void {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      return handler(payload);
    });
    return unsubscribe;
  }

  off<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): void {
    const set = this.#handlers.get(event);
    if (set === undefined) return;
    set.delete(handler);
    if (set.size === 0) this.#handlers.delete(event);
  }

  listenerCount<K extends keyof Events & string>(event: K): number {
    return this.#handlers.get(event)?.size ?? 0;
  }

  removeAll(): void {
    this.#handlers.clear();
  }

  /** Waits for every subscriber to settle; rejected subscribers are reported, not thrown. */
  async emit<K extends keyof Events & string>(
    event: K,
    payload: Events[K],
  ): Promise<void> {
    const set = this.#handlers.get(event);
    if (set === undefined || set.size === 0) return;

    // Snapshot so handlers may unsubscribe during dispatch.
    const handlers = [...set] as EventHandler<Events[K]>[];
    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler(payload);
        } catch (error) {
          this.#reportListenerError(error, event);
        }
      }),
    );
  }

  #reportListenerError(error: unknown, event: string): void {
    if (this.#onListenerError === undefined) return;
    try {
      this.#onListenerError(error, event);
    } catch {
      // A failing error reporter must never escalate.
    }
  }
}
