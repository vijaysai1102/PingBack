import type { AgentEvent, AgentEventType } from '../../core/types.js';
import type { SessionUpdate } from '../../core/event-schema.js';
import type { AGYHookPayload } from './types.js';
import { isAGYHookEvent } from './types.js';

export type NormalizedHook =
  | { kind: 'event'; event: Omit<AgentEvent, 'id'> }
  | { kind: 'session'; update: SessionUpdate }
  | { kind: 'ignored'; reason: string };

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

const TITLES: Record<AgentEventType, string> = {
  attention_required: 'AGY needs your attention',
  question: 'AGY has a question',
  error: 'AGY hit an error',
  task_completed: 'AGY finished',
};

const DEFAULT_MESSAGES: Record<AgentEventType, string> = {
  attention_required: 'AGY is waiting for you.',
  question: 'AGY is waiting for your answer.',
  error: 'AGY stopped because of an error.',
  task_completed: 'AGY finished working.',
};

function extractCwd(workspacePaths: unknown): string | undefined {
  if (Array.isArray(workspacePaths) && workspacePaths.length > 0) {
    return str(workspacePaths[0]);
  }
  return undefined;
}

/**
 * Converts one AGY CLI hook payload into a PingBack event or session update.
 */
export function normalizeAGYHookPayload(
  payload: AGYHookPayload,
  now: () => number = Date.now,
): NormalizedHook {
  const hookEvent = payload.hookEventName;
  if (!isAGYHookEvent(hookEvent)) {
    return { kind: 'ignored', reason: `unsupported hook event: ${String(hookEvent)}` };
  }

  const sessionId = str(payload.conversationId);
  if (sessionId === undefined) {
    return { kind: 'ignored', reason: 'missing conversationId' };
  }

  const cwd = extractCwd(payload.workspacePaths);
  const timestamp = now();

  switch (hookEvent) {
    case 'PreInvocation':
      return {
        kind: 'session',
        update: { sessionId, status: 'working', cwd, agent: 'agy' },
      };

    case 'PreToolUse': {
      const toolName = str(payload.toolCall?.name);
      if (toolName === 'ask_question') {
        const questions = payload.toolCall?.args?.questions;
        let questionText: string | undefined;
        if (Array.isArray(questions) && questions.length > 0) {
          const first = questions[0] as Record<string, unknown>;
          questionText = str(first?.question);
        }

        return {
          kind: 'event',
          event: {
            agent: 'agy',
            sessionId,
            type: 'question',
            title: TITLES.question,
            message: questionText ?? DEFAULT_MESSAGES.question,
            cwd,
            timestamp,
            metadata: {
              hookEvent: 'PreToolUse',
              tool: 'ask_question',
            },
          },
        };
      }

      return { kind: 'ignored', reason: `ignored tool: ${String(toolName)}` };
    }

    case 'Stop': {
      const error = str(payload.error);
      const terminationReason = str(payload.terminationReason);

      if (error !== undefined || terminationReason === 'error') {
        return {
          kind: 'event',
          event: {
            agent: 'agy',
            sessionId,
            type: 'error',
            title: TITLES.error,
            message: error ?? DEFAULT_MESSAGES.error,
            cwd,
            timestamp,
            metadata: {
              hookEvent: 'Stop',
              terminationReason,
              ...(error !== undefined ? { error } : {}),
            },
          },
        };
      }

      return {
        kind: 'event',
        event: {
          agent: 'agy',
          sessionId,
          type: 'attention_required',
          title: TITLES.attention_required,
          message: DEFAULT_MESSAGES.attention_required,
          cwd,
          timestamp,
          metadata: {
            hookEvent: 'Stop',
            terminationReason,
          },
        },
      };
    }

    case 'PostToolUse':
    case 'PostInvocation':
    default:
      return { kind: 'ignored', reason: `unhandled hook event: ${String(hookEvent)}` };
  }
}
