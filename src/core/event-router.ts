import type { SessionManager } from '../sessions/session-manager.js';
import {
  priorityForEvent,
  type AgentEvent,
  type AgentSession,
  type EventPriority,
} from './types.js';

export interface RoutedEvent {
  event: AgentEvent;
  priority: EventPriority;
  session: AgentSession;
}

export type RouteOutcome =
  | { status: 'routed'; routed: RoutedEvent }
  | { status: 'duplicate'; reason: 'event_id' | 'repeat_within_window' };

export interface EventRouterOptions {
  sessions: SessionManager;
  now?: () => number;
  /** Identical session+type events inside this window collapse into one. */
  dedupeWindowMs?: number;
  /** How many recent event ids to remember. */
  recentIdLimit?: number;
}

const DEFAULT_DEDUPE_WINDOW_MS = 2000;
const DEFAULT_RECENT_ID_LIMIT = 500;

/**
 * Turns validated agent events into routing decisions: it classifies priority,
 * updates session state, and drops duplicates so a hook that fires twice
 * produces a single notification.
 */
export class EventRouter {
  readonly #sessions: SessionManager;
  readonly #now: () => number;
  readonly #dedupeWindowMs: number;
  readonly #recentIdLimit: number;

  /** Insertion-ordered; used as a bounded FIFO of recently seen event ids. */
  readonly #recentIds = new Set<string>();
  readonly #lastSeenByKey = new Map<string, number>();

  constructor(options: EventRouterOptions) {
    this.#sessions = options.sessions;
    this.#now = options.now ?? (() => Date.now());
    this.#dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    this.#recentIdLimit = options.recentIdLimit ?? DEFAULT_RECENT_ID_LIMIT;
  }

  route(event: AgentEvent): RouteOutcome {
    if (this.#recentIds.has(event.id)) {
      return { status: 'duplicate', reason: 'event_id' };
    }
    this.#rememberId(event.id);

    const key = `${event.sessionId}:${event.type}`;
    const previous = this.#lastSeenByKey.get(key);
    const now = this.#now();

    if (previous !== undefined && now - previous < this.#dedupeWindowMs) {
      // Still record the session update; only the notification is suppressed.
      this.#sessions.applyEvent(event);
      this.#lastSeenByKey.set(key, now);
      return { status: 'duplicate', reason: 'repeat_within_window' };
    }

    this.#lastSeenByKey.set(key, now);
    const session = this.#sessions.applyEvent(event);

    return {
      status: 'routed',
      routed: { event, priority: priorityForEvent(event.type), session },
    };
  }

  #rememberId(id: string): void {
    this.#recentIds.add(id);
    if (this.#recentIds.size <= this.#recentIdLimit) return;

    const oldest = this.#recentIds.values().next();
    if (!oldest.done) this.#recentIds.delete(oldest.value);
  }
}
