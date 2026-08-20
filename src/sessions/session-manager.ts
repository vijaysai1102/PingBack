import type { AgentEvent, AgentSession, SessionStatus } from '../core/types.js';
import { statusForEvent } from '../core/types.js';
import { MemorySessionStore, type SessionStore } from './session-store.js';

export interface SessionManagerOptions {
  store?: SessionStore;
  now?: () => number;
  /** Completed sessions older than this are dropped on prune. */
  completedTtlMs?: number;
  /** Any session untouched for this long is dropped on prune. */
  staleTtlMs?: number;
  /** Hard cap so a long-lived daemon cannot grow the store without bound. */
  maxSessions?: number;
}

const DEFAULT_COMPLETED_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_STALE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const DEFAULT_MAX_SESSIONS = 200;

/**
 * Tracks one entry per agent session, keyed by the agent's own session id.
 *
 * Sessions are keyed by id rather than by process or directory so that several
 * concurrent Claude sessions in different projects never collapse into one.
 */
export class SessionManager {
  readonly #sessions = new Map<string, AgentSession>();
  readonly #store: SessionStore;
  readonly #now: () => number;
  readonly #completedTtlMs: number;
  readonly #staleTtlMs: number;
  readonly #maxSessions: number;

  constructor(options: SessionManagerOptions = {}) {
    this.#store = options.store ?? new MemorySessionStore();
    this.#now = options.now ?? (() => Date.now());
    this.#completedTtlMs = options.completedTtlMs ?? DEFAULT_COMPLETED_TTL_MS;
    this.#staleTtlMs = options.staleTtlMs ?? DEFAULT_STALE_TTL_MS;
    this.#maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;

    for (const session of this.#store.load()) {
      this.#sessions.set(session.id, session);
    }
  }

  list(): AgentSession[] {
    return [...this.#sessions.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): AgentSession | undefined {
    const session = this.#sessions.get(id);
    return session === undefined ? undefined : { ...session };
  }

  get size(): number {
    return this.#sessions.size;
  }

  /** Creates or updates the session implied by an event. */
  applyEvent(event: AgentEvent): AgentSession {
    const existing = this.#sessions.get(event.sessionId);
    const status = statusForEvent(event.type);

    const session: AgentSession = existing
      ? {
          ...existing,
          status,
          lastActivityAt: event.timestamp,
          cwd: event.cwd ?? existing.cwd,
          pid: event.pid ?? existing.pid,
        }
      : {
          id: event.sessionId,
          agent: event.agent,
          status,
          startedAt: event.timestamp,
          lastActivityAt: event.timestamp,
          cwd: event.cwd,
          pid: event.pid,
          metadata: undefined,
        };

    this.#sessions.set(session.id, session);
    this.#enforceLimit();
    this.#persist();
    return { ...session };
  }

  /** Records session state that did not come from a notification-worthy event. */
  touch(
    sessionId: string,
    status: SessionStatus,
    details: { cwd?: string | undefined; pid?: number | undefined } = {},
  ): AgentSession {
    const now = this.#now();
    const existing = this.#sessions.get(sessionId);

    const session: AgentSession = existing
      ? {
          ...existing,
          status,
          lastActivityAt: now,
          cwd: details.cwd ?? existing.cwd,
          pid: details.pid ?? existing.pid,
        }
      : {
          id: sessionId,
          agent: 'claude',
          status,
          startedAt: now,
          lastActivityAt: now,
          cwd: details.cwd,
          pid: details.pid,
          metadata: undefined,
        };

    this.#sessions.set(sessionId, session);
    this.#enforceLimit();
    this.#persist();
    return { ...session };
  }

  remove(id: string): boolean {
    const removed = this.#sessions.delete(id);
    if (removed) this.#persist();
    return removed;
  }

  clear(): void {
    this.#sessions.clear();
    this.#persist();
  }

  /** Drops finished and abandoned sessions. Returns how many were removed. */
  prune(): number {
    const now = this.#now();
    let removed = 0;

    for (const [id, session] of this.#sessions) {
      const last = session.lastActivityAt ?? session.startedAt;
      const age = now - last;
      const isFinished = session.status === 'completed';

      if ((isFinished && age > this.#completedTtlMs) || age > this.#staleTtlMs) {
        this.#sessions.delete(id);
        removed += 1;
      }
    }

    if (removed > 0) this.#persist();
    return removed;
  }

  #enforceLimit(): void {
    if (this.#sessions.size <= this.#maxSessions) return;
    // Oldest activity first, so the freshest sessions survive.
    const ordered = [...this.#sessions.values()].sort(
      (a, b) => (a.lastActivityAt ?? a.startedAt) - (b.lastActivityAt ?? b.startedAt),
    );
    const excess = this.#sessions.size - this.#maxSessions;
    for (let i = 0; i < excess; i += 1) {
      const victim = ordered[i];
      if (victim !== undefined) this.#sessions.delete(victim.id);
    }
  }

  #persist(): void {
    try {
      this.#store.save(this.list());
    } catch {
      // A failed write must not stop notifications; state stays in memory.
    }
  }
}
