/**
 * The normalized core model. Nothing in this file may reference an
 * agent-specific event shape: adapters translate into these types.
 */

/** v0.1 ships the Claude adapter only; the union exists so adding one is additive. */
export type AgentType = 'claude';

export type AgentEventType =
  'attention_required' | 'turn_completion' | 'task_completed' | 'error' | 'question';

export const AGENT_EVENT_TYPES: readonly AgentEventType[] = [
  'attention_required',
  'turn_completion',
  'task_completed',
  'error',
  'question',
];

export type EventPriority = 'low' | 'medium' | 'high';

export interface AgentEvent {
  id: string;
  agent: AgentType;
  sessionId: string;
  type: AgentEventType;

  title: string;
  message: string;

  cwd?: string | undefined;
  pid?: number | undefined;

  timestamp: number;

  metadata?: Record<string, unknown> | undefined;
}

export type SessionStatus = 'working' | 'waiting' | 'completed' | 'error' | 'unknown';

export interface AgentSession {
  id: string;
  agent: AgentType;

  pid?: number | undefined;
  cwd?: string | undefined;

  status: SessionStatus;

  startedAt: number;
  lastActivityAt?: number | undefined;

  metadata?: Record<string, unknown> | undefined;
}

/**
 * Priority classification per the product spec: completions stay quiet,
 * errors are mid, and anything blocking the developer is high.
 */
const PRIORITY_BY_EVENT: Record<AgentEventType, EventPriority> = {
  task_completed: 'low',
  error: 'medium',
  turn_completion: 'low',
  attention_required: 'high',
  question: 'high',
};

export function priorityForEvent(type: AgentEventType): EventPriority {
  return PRIORITY_BY_EVENT[type];
}

/** The session state an event implies. */
const STATUS_BY_EVENT: Record<AgentEventType, SessionStatus> = {
  task_completed: 'completed',
  error: 'error',
  turn_completion: 'waiting',
  attention_required: 'waiting',
  question: 'waiting',
};

export function statusForEvent(type: AgentEventType): SessionStatus {
  return STATUS_BY_EVENT[type];
}

export function isAgentEventType(value: unknown): value is AgentEventType {
  return typeof value === 'string' && AGENT_EVENT_TYPES.includes(value as AgentEventType);
}

/** True when a session is blocking the developer and needs their attention. */
export function needsAttention(session: AgentSession): boolean {
  return session.status === 'waiting' || session.status === 'error';
}
