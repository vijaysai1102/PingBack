/** The documented Codex CLI notification delivered to a configured `notify` command. */
export const CODEX_NOTIFY_EVENTS = ['agent-turn-complete'] as const;

export type CodexNotifyEvent = (typeof CODEX_NOTIFY_EVENTS)[number];

export interface CodexHookPayload {
  type?: unknown;
  'thread-id'?: unknown;
  thread_id?: unknown;
  threadId?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
  cwd?: unknown;
  'turn-id'?: unknown;
  turn_id?: unknown;
  hook_event_name?: unknown;
  tool_name?: unknown;
  permission_mode?: unknown;
}

export function isCodexNotifyEvent(value: unknown): value is CodexNotifyEvent {
  return (
    typeof value === 'string' &&
    (CODEX_NOTIFY_EVENTS as readonly string[]).includes(value)
  );
}
