import type { AgentEvent, AgentEventType } from '../../core/types.js';
import type { SessionUpdate } from '../../core/event-schema.js';
import type { CodexHookPayload } from './types.js';
import { isCodexHookEvent } from './types.js';

export type NormalizedHook =
  | { kind: 'event'; event: Omit<AgentEvent, 'id'> }
  | { kind: 'session'; update: SessionUpdate }
  | { kind: 'ignored'; reason: string };

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

const TITLES: Record<AgentEventType, string> = {
  attention_required: 'Codex needs your attention',
  question: 'Codex has a question',
  error: 'Codex hit an error',
  task_completed: 'Codex finished',
};

const DEFAULT_MESSAGES: Record<AgentEventType, string> = {
  attention_required: 'Codex is waiting for you.',
  question: 'Codex is waiting for your answer.',
  error: 'Codex stopped because of an error.',
  task_completed: 'Codex finished working.',
};

/**
 * Converts one Codex CLI hook payload into a PingBack event or session
 * update. Returns `ignored` for payloads that carry no useful signal or missing session_id.
 */
export function normalizeCodexHookPayload(
  payload: CodexHookPayload,
  now: () => number = Date.now,
): NormalizedHook {
  const hookEvent = payload.hook_event_name;
  if (!isCodexHookEvent(hookEvent)) {
    return { kind: 'ignored', reason: `unsupported hook event: ${String(hookEvent)}` };
  }

  const sessionId = str(payload.session_id);
  if (sessionId === undefined) {
    return { kind: 'ignored', reason: 'missing session_id' };
  }

  const cwd = str(payload.cwd);
  const timestamp = now();
  const normalizedEventName =
    typeof hookEvent === 'string' ? hookEvent.toLowerCase() : '';

  switch (normalizedEventName) {
    case 'userpromptsubmit':
    case 'user_prompt_submit':
      return { kind: 'session', update: { sessionId, status: 'working', cwd } };

    case 'stop': {
      const error = str(payload.error) ?? str(payload.error_details);
      const detail = str(payload.last_assistant_message);

      if (error !== undefined) {
        return {
          kind: 'event',
          event: {
            agent: 'codex',
            sessionId,
            type: 'error',
            title: TITLES.error,
            message: detail ?? error ?? DEFAULT_MESSAGES.error,
            cwd,
            timestamp,
            metadata: {
              hookEvent,
              error,
              ...(payload.turn_id !== undefined ? { turnId: payload.turn_id } : {}),
            },
          },
        };
      }

      return {
        kind: 'event',
        event: {
          agent: 'codex',
          sessionId,
          type: 'attention_required',
          title: TITLES.attention_required,
          message: detail ?? DEFAULT_MESSAGES.attention_required,
          cwd,
          timestamp,
          metadata: {
            hookEvent,
            ...(payload.turn_id !== undefined ? { turnId: payload.turn_id } : {}),
          },
        },
      };
    }

    default:
      return { kind: 'ignored', reason: `unhandled hook event: ${String(hookEvent)}` };
  }
}
