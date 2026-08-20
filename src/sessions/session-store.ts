import path from 'node:path';
import type { AgentSession, SessionStatus } from '../core/types.js';
import { readJsonFile, writeJsonFileAtomic } from '../utils/json-file.js';

export interface SessionStore {
  load(): AgentSession[];
  save(sessions: AgentSession[]): void;
}

const VALID_STATUSES: readonly SessionStatus[] = [
  'working',
  'waiting',
  'completed',
  'error',
  'unknown',
];

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Rebuilds a session from untrusted JSON. Returns undefined for records that
 * cannot be trusted so a corrupted store degrades to fewer sessions rather
 * than crashing the daemon.
 */
export function parseSession(raw: unknown): AgentSession | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;

  const id = optionalString(record.id);
  if (id === undefined) return undefined;
  if (record.agent !== 'claude') return undefined;

  const status = VALID_STATUSES.includes(record.status as SessionStatus)
    ? (record.status as SessionStatus)
    : 'unknown';

  const startedAt = optionalNumber(record.startedAt);
  if (startedAt === undefined) return undefined;

  const metadata =
    typeof record.metadata === 'object' &&
    record.metadata !== null &&
    !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : undefined;

  return {
    id,
    agent: 'claude',
    status,
    startedAt,
    pid: optionalNumber(record.pid),
    cwd: optionalString(record.cwd),
    lastActivityAt: optionalNumber(record.lastActivityAt),
    metadata,
  };
}

export class FileSessionStore implements SessionStore {
  readonly #filePath: string;

  constructor(dataDir: string) {
    this.#filePath = path.join(dataDir, 'sessions.json');
  }

  get filePath(): string {
    return this.#filePath;
  }

  load(): AgentSession[] {
    const result = readJsonFile(this.#filePath);
    if (!result.ok) return [];

    const root = result.value;
    const list = Array.isArray(root)
      ? root
      : typeof root === 'object' &&
          root !== null &&
          Array.isArray((root as { sessions?: unknown }).sessions)
        ? (root as { sessions: unknown[] }).sessions
        : [];

    const sessions: AgentSession[] = [];
    for (const entry of list) {
      const session = parseSession(entry);
      if (session !== undefined) sessions.push(session);
    }
    return sessions;
  }

  save(sessions: AgentSession[]): void {
    writeJsonFileAtomic(this.#filePath, { version: 1, sessions });
  }
}

export class MemorySessionStore implements SessionStore {
  #sessions: AgentSession[];

  constructor(initial: AgentSession[] = []) {
    this.#sessions = [...initial];
  }

  load(): AgentSession[] {
    return this.#sessions.map((session) => ({ ...session }));
  }

  save(sessions: AgentSession[]): void {
    this.#sessions = sessions.map((session) => ({ ...session }));
  }
}
