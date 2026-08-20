import { randomUUID } from 'node:crypto';
import { PingBackError } from '../utils/errors.js';
import { isAgentEventType, type AgentEvent, type SessionStatus } from './types.js';

/** Hard caps so a malformed or hostile payload cannot blow up memory or a toast. */
const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 300;
const MAX_METADATA_KEYS = 20;

function clamp(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalPid(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;

  const entries = Object.entries(value as Record<string, unknown>)
    .slice(0, MAX_METADATA_KEYS)
    .filter(([, item]) => {
      const type = typeof item;
      return type === 'string' || type === 'number' || type === 'boolean';
    });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Validates an event arriving over IPC. The daemon trusts nothing on the wire:
 * anything that cannot be coerced into a well-formed event is rejected.
 */
export function parseAgentEvent(raw: unknown, now: () => number = Date.now): AgentEvent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PingBackError('Event payload must be a JSON object.', {
      code: 'INVALID_EVENT',
    });
  }

  const record = raw as Record<string, unknown>;

  if (record.agent !== 'claude') {
    throw new PingBackError(`Unsupported agent: ${String(record.agent)}`, {
      code: 'INVALID_EVENT',
      hint: 'PingBack v0.1 supports the "claude" agent only.',
    });
  }

  if (!isAgentEventType(record.type)) {
    throw new PingBackError(`Unknown event type: ${String(record.type)}`, {
      code: 'INVALID_EVENT',
    });
  }

  const sessionId = optionalString(record.sessionId);
  if (sessionId === undefined) {
    throw new PingBackError('Event is missing a sessionId.', { code: 'INVALID_EVENT' });
  }

  const title = optionalString(record.title);
  const message = optionalString(record.message);
  const timestamp =
    typeof record.timestamp === 'number' && Number.isFinite(record.timestamp)
      ? record.timestamp
      : now();

  return {
    id: optionalString(record.id) ?? randomUUID(),
    agent: 'claude',
    sessionId,
    type: record.type,
    title: clamp(title ?? 'Claude Code', MAX_TITLE_LENGTH),
    message: clamp(message ?? '', MAX_MESSAGE_LENGTH),
    cwd: optionalString(record.cwd),
    pid: optionalPid(record.pid),
    timestamp,
    metadata: sanitizeMetadata(record.metadata),
  };
}

/**
 * A session state change that carries no notification, such as Claude starting
 * work again after the developer answered a prompt.
 */
export interface SessionUpdate {
  sessionId: string;
  status: SessionStatus;
  cwd?: string | undefined;
  pid?: number | undefined;
}

const VALID_STATUSES: readonly SessionStatus[] = [
  'working',
  'waiting',
  'completed',
  'error',
  'unknown',
];

export function parseSessionUpdate(raw: unknown): SessionUpdate {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PingBackError('Session update must be a JSON object.', {
      code: 'INVALID_EVENT',
    });
  }

  const record = raw as Record<string, unknown>;

  const sessionId = optionalString(record.sessionId);
  if (sessionId === undefined) {
    throw new PingBackError('Session update is missing a sessionId.', {
      code: 'INVALID_EVENT',
    });
  }

  if (!VALID_STATUSES.includes(record.status as SessionStatus)) {
    throw new PingBackError(`Unknown session status: ${String(record.status)}`, {
      code: 'INVALID_EVENT',
    });
  }

  return {
    sessionId,
    status: record.status as SessionStatus,
    cwd: optionalString(record.cwd),
    pid: optionalPid(record.pid),
  };
}
