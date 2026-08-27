/**
 * Shapes of the Claude Code hook payloads PingBack consumes.
 *
 * These mirror the documented hook input contract. Every field is optional at
 * the type level because the payload arrives from an external process and is
 * validated at runtime before use.
 */

/** Hook events PingBack subscribes to. */
export const CLAUDE_HOOK_EVENTS = [
  'Notification',
  'StopFailure',
  'SessionStart',
  'UserPromptSubmit',
  'SessionEnd',
] as const;

export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

/**
 * Notification types Claude Code can emit. `agent_needs_input` and
 * `agent_completed` require Claude Code v2.1.198 or later.
 */
export type ClaudeNotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'auth_success'
  | 'elicitation_dialog'
  | 'elicitation_url_dialog'
  | 'elicitation_complete'
  | 'elicitation_response'
  | 'agent_needs_input'
  | 'agent_completed'
  | 'quota_auto_resume_fired'
  | 'quota_auto_resume_stale'
  | 'quota_auto_resume_disabled';

export interface ClaudeHookPayload {
  session_id?: unknown;
  transcript_path?: unknown;
  cwd?: unknown;
  hook_event_name?: unknown;
  permission_mode?: unknown;

  // Notification
  message?: unknown;
  title?: unknown;
  notification_type?: unknown;

  // StopFailure
  error?: unknown;
  error_details?: unknown;
  last_assistant_message?: unknown;

  // SessionEnd
  reason?: unknown;

  // Present only inside subagent calls
  agent_id?: unknown;
  agent_type?: unknown;
}

export function isClaudeHookEvent(value: unknown): value is ClaudeHookEvent {
  return (
    typeof value === 'string' && (CLAUDE_HOOK_EVENTS as readonly string[]).includes(value)
  );
}
