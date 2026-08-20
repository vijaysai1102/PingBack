import type { AgentEvent } from '../../core/types.js';
import type { SessionUpdate } from '../../core/event-schema.js';
import type { CodexHookPayload } from './types.js';
import { isCodexNotifyEvent } from './types.js';

export type NormalizedHook =
  | { kind: 'event'; event: Omit<AgentEvent, 'id'> }
  | { kind: 'session'; update: SessionUpdate }
  | { kind: 'ignored'; reason: string };

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Converts Codex's supported `notify` payload into PingBack's common event. */
export function normalizeCodexHookPayload(
  payload: CodexHookPayload,
  now: () => number = Date.now,
): NormalizedHook {
  const notifyType = stringValue(payload.type);
  if (isCodexNotifyEvent(notifyType)) {
    const sessionId =
      stringValue(payload['thread-id']) ??
      stringValue(payload.thread_id) ??
      stringValue(payload.threadId);
    if (sessionId === undefined) {
      return { kind: 'ignored', reason: 'missing Codex thread identifier' };
    }

    return {
      kind: 'event',
      event: {
        agent: 'codex',
        sessionId,
        type: 'task_completed',
        title: 'Codex finished',
        message: 'Codex finished working.',
        cwd: stringValue(payload.cwd),
        timestamp: now(),
        metadata: { notifyType },
      },
    };
  }

  const hookEvent = stringValue(payload.hook_event_name);
  const sessionId = stringValue(payload.session_id) ?? stringValue(payload.sessionId);
  if (sessionId === undefined) {
    return hookEvent === undefined
      ? {
          kind: 'ignored',
          reason: `unsupported Codex notify event: ${notifyType ?? 'unknown'}`,
        }
      : { kind: 'ignored', reason: 'missing Codex session identifier' };
  }

  const cwd = stringValue(payload.cwd);
  switch (hookEvent) {
    case 'PermissionRequest': {
      const toolName = stringValue(payload.tool_name);
      return {
        kind: 'event',
        event: {
          agent: 'codex',
          sessionId,
          type: 'attention_required',
          title: 'Codex needs your attention',
          message: 'Codex is waiting for your approval.',
          cwd,
          timestamp: now(),
          metadata: {
            hookEvent,
            ...(toolName === undefined ? {} : { toolName }),
          },
        },
      };
    }

    case 'SessionStart':
    case 'UserPromptSubmit':
      return {
        kind: 'session',
        update: { agent: 'codex', sessionId, status: 'working', cwd },
      };

    default:
      return {
        kind: 'ignored',
        reason: `unsupported Codex hook event: ${hookEvent ?? 'unknown'}`,
      };
  }
}
