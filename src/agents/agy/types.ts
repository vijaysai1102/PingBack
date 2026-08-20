/**
 * Shapes of the AGY / Antigravity CLI hook payloads PingBack consumes.
 *
 * These mirror the documented hook input contract for Google Antigravity (AGY) CLI.
 * All JSON keys in AGY hook payloads use camelCase (protojson encoding).
 */

export const AGY_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PreInvocation',
  'PostInvocation',
  'Stop',
] as const;

export type AGYHookEvent = (typeof AGY_HOOK_EVENTS)[number];

export interface AGYToolCall {
  name?: unknown;
  args?: Record<string, unknown>;
}

export interface AGYHookPayload {
  conversationId?: unknown;
  workspacePaths?: unknown;
  transcriptPath?: unknown;
  artifactDirectoryPath?: unknown;
  modelName?: unknown;
  hookEventName?: unknown;

  // PreToolUse / PostToolUse
  toolCall?: AGYToolCall;
  stepIdx?: unknown;

  // PreInvocation / PostInvocation
  invocationNum?: unknown;
  initialNumSteps?: unknown;

  // Stop
  executionNum?: unknown;
  terminationReason?: unknown;
  error?: unknown;
  fullyIdle?: unknown;
}

export function isAGYHookEvent(value: unknown): value is AGYHookEvent {
  return (
    typeof value === 'string' && (AGY_HOOK_EVENTS as readonly string[]).includes(value)
  );
}
