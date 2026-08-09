import type { AgentEvent, AgentEventType } from '../../core/types.js';
import type { SessionUpdate } from '../../core/event-schema.js';
import type { ClaudeHookPayload, ClaudeNotificationType } from './types.js';
import { isClaudeHookEvent } from './types.js';

export type NormalizedHook =
  | { kind: 'event'; event: Omit<AgentEvent, 'id'> }
  | { kind: 'session'; update: SessionUpdate }
  | { kind: 'ignored'; reason: string };

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Titles are PingBack's own wording rather than Claude's so notifications read
 * consistently, while the body keeps Claude's specific message.
 */
const TITLES: Record<AgentEventType, string> = {
  attention_required: 'Claude Code needs your attention',
  question: 'Claude Code has a question',
  error: 'Claude Code hit an error',
  task_completed: 'Claude Code finished',
};

const DEFAULT_MESSAGES: Record<AgentEventType, string> = {
  attention_required: 'Claude is waiting for you.',
  question: 'Claude is waiting for your answer.',
  error: 'Claude stopped because of an error.',
  task_completed: 'Claude finished working.',
};

/**
 * Maps a Claude notification onto PingBack's event model.
 *
 * `idle_prompt` is treated as attention rather than a quiet completion: it
 * fires when Claude has finished and is waiting, which is exactly the moment
 * PingBack exists to catch.
 */
export function eventTypeForNotification(
  notificationType: string | undefined,
): AgentEventType | undefined {
  switch (notificationType as ClaudeNotificationType | undefined) {
    case 'permission_prompt':
    case 'idle_prompt':
    case 'agent_needs_input':
      return 'attention_required';
    case 'elicitation_dialog':
      return 'question';
    case 'agent_completed':
      return 'task_completed';
    case 'auth_success':
    case 'elicitation_complete':
    case 'elicitation_response':
      return undefined;
    default:
      // Claude Code only notifies when it wants the developer, so an
      // unrecognized type is surfaced rather than silently dropped.
      return 'attention_required';
  }
}

function buildEvent(
  type: AgentEventType,
  payload: ClaudeHookPayload,
  sessionId: string,
  timestamp: number,
  message: string | undefined,
  metadata: Record<string, unknown>,
): NormalizedHook {
  return {
    kind: 'event',
    event: {
      agent: 'claude',
      sessionId,
      type,
      title: TITLES[type],
      message: message ?? DEFAULT_MESSAGES[type],
      cwd: str(payload.cwd),
      timestamp,
      metadata,
    },
  };
}

/**
 * Converts one Claude Code hook payload into a PingBack event or session
 * update. Returns `ignored` for payloads that carry no useful signal.
 */
export function normalizeHookPayload(
  payload: ClaudeHookPayload,
  now: () => number = Date.now,
): NormalizedHook {
  const hookEvent = payload.hook_event_name;
  if (!isClaudeHookEvent(hookEvent)) {
    return { kind: 'ignored', reason: `unsupported hook event: ${String(hookEvent)}` };
  }

  const sessionId = str(payload.session_id);
  if (sessionId === undefined) {
    return { kind: 'ignored', reason: 'missing session_id' };
  }

  const cwd = str(payload.cwd);
  const timestamp = now();

  switch (hookEvent) {
    case 'Notification': {
      const notificationType = str(payload.notification_type);
      const type = eventTypeForNotification(notificationType);
      if (type === undefined) {
        return {
          kind: 'ignored',
          reason: `notification type: ${String(notificationType)}`,
        };
      }

      return buildEvent(type, payload, sessionId, timestamp, str(payload.message), {
        hookEvent,
        ...(notificationType === undefined ? {} : { notificationType }),
      });
    }

    case 'StopFailure': {
      const error = str(payload.error) ?? 'unknown';
      const detail = str(payload.last_assistant_message) ?? str(payload.error_details);

      return buildEvent(
        'error',
        payload,
        sessionId,
        timestamp,
        detail ?? `Claude stopped: ${error}.`,
        { hookEvent, error },
      );
    }

    case 'SessionStart':
    case 'UserPromptSubmit':
      return { kind: 'session', update: { sessionId, status: 'working', cwd } };

    case 'SessionEnd':
      return { kind: 'session', update: { sessionId, status: 'completed', cwd } };
  }
}
