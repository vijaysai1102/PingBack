/**
 * Shapes of the Codex CLI hook payloads PingBack consumes.
 *
 * These mirror the documented and observed hook input contract for Codex CLI.
 * Every field is optional at the type level because payloads arrive from external
 * processes and are validated at runtime before use.
 */

/** Hook events PingBack subscribes to for Codex. */
export const CODEX_HOOK_EVENTS = [
  'UserPromptSubmit',
  'user_prompt_submit',
  'Stop',
  'stop',
] as const;

export type CodexHookEvent = (typeof CODEX_HOOK_EVENTS)[number];

export interface CodexHookPayload {
  session_id?: unknown;
  turn_id?: unknown;
  cwd?: unknown;
  hook_event_name?: unknown;

  // Prompt submit
  prompt?: unknown;

  // Stop / Completion / Error
  last_assistant_message?: unknown;
  error?: unknown;
  error_details?: unknown;
  transcript_path?: unknown;
}

export function isCodexHookEvent(value: unknown): value is CodexHookEvent {
  return (
    typeof value === 'string' && (CODEX_HOOK_EVENTS as readonly string[]).includes(value)
  );
}
