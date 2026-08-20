import { describe, expect, it } from 'vitest';
import {
  eventTypeForNotification,
  normalizeHookPayload,
} from '../../src/agents/claude/normalize.js';

const now = (): number => 1_700_000_000_000;

function notification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 'abc123',
    transcript_path: '/Users/dev/.claude/projects/x/t.jsonl',
    cwd: '/Users/dev/finbot',
    hook_event_name: 'Notification',
    message: 'Claude needs your permission to use Bash',
    notification_type: 'permission_prompt',
    ...overrides,
  };
}

describe('eventTypeForNotification', () => {
  it('maps blocking notification types to attention', () => {
    expect(eventTypeForNotification('permission_prompt')).toBe('attention_required');
    expect(eventTypeForNotification('idle_prompt')).toBe('attention_required');
    expect(eventTypeForNotification('agent_needs_input')).toBe('attention_required');
  });

  it('maps an elicitation dialog to a question', () => {
    expect(eventTypeForNotification('elicitation_dialog')).toBe('question');
  });

  it('maps a finished background agent to a completion', () => {
    expect(eventTypeForNotification('agent_completed')).toBe('task_completed');
  });

  it('ignores purely informational notification types', () => {
    expect(eventTypeForNotification('auth_success')).toBeUndefined();
    expect(eventTypeForNotification('elicitation_complete')).toBeUndefined();
    expect(eventTypeForNotification('elicitation_response')).toBeUndefined();
  });

  it('surfaces an unrecognized type rather than dropping it', () => {
    expect(eventTypeForNotification('some_future_type')).toBe('attention_required');
    expect(eventTypeForNotification(undefined)).toBe('attention_required');
  });
});

describe('normalizeHookPayload: Notification', () => {
  it('builds an attention event from a permission prompt', () => {
    const result = normalizeHookPayload(notification(), now);

    expect(result.kind).toBe('event');
    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event).toMatchObject({
      agent: 'claude',
      sessionId: 'abc123',
      type: 'attention_required',
      title: 'Claude Code needs your attention',
      message: 'Claude needs your permission to use Bash',
      cwd: '/Users/dev/finbot',
      timestamp: 1_700_000_000_000,
    });
  });

  it('records the hook and notification type as metadata', () => {
    const result = normalizeHookPayload(notification(), now);

    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.metadata).toEqual({
      hookEvent: 'Notification',
      notificationType: 'permission_prompt',
    });
  });

  it('falls back to a default message when Claude sends none', () => {
    const result = normalizeHookPayload(notification({ message: undefined }), now);

    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.message).toBe('Claude is waiting for you.');
  });

  it('treats an idle prompt as attention, not a quiet completion', () => {
    const result = normalizeHookPayload(
      notification({ notification_type: 'idle_prompt' }),
      now,
    );

    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.type).toBe('attention_required');
  });

  it('titles an elicitation dialog as a question', () => {
    const result = normalizeHookPayload(
      notification({ notification_type: 'elicitation_dialog' }),
      now,
    );

    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.type).toBe('question');
    expect(result.event.title).toBe('Claude Code has a question');
  });

  it('ignores an auth success notification', () => {
    const result = normalizeHookPayload(
      notification({ notification_type: 'auth_success' }),
      now,
    );

    expect(result.kind).toBe('ignored');
  });
});

describe('normalizeHookPayload: StopFailure', () => {
  it('builds a medium-priority error event', () => {
    const result = normalizeHookPayload(
      {
        session_id: 'abc123',
        cwd: '/Users/dev/finbot',
        hook_event_name: 'StopFailure',
        error: 'rate_limit',
        error_details: '429 Too Many Requests',
        last_assistant_message: 'API Error: Rate limit reached',
      },
      now,
    );

    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.type).toBe('error');
    expect(result.event.title).toBe('Claude Code hit an error');
    expect(result.event.message).toBe('API Error: Rate limit reached');
    expect(result.event.metadata).toEqual({
      hookEvent: 'StopFailure',
      error: 'rate_limit',
    });
  });

  it('falls back to error_details then to the error type', () => {
    const withDetails = normalizeHookPayload(
      {
        session_id: 'a',
        hook_event_name: 'StopFailure',
        error: 'server_error',
        error_details: '500 boom',
      },
      now,
    );
    if (withDetails.kind !== 'event') throw new Error('expected event');
    expect(withDetails.event.message).toBe('500 boom');

    const bare = normalizeHookPayload(
      { session_id: 'a', hook_event_name: 'StopFailure', error: 'overloaded' },
      now,
    );
    if (bare.kind !== 'event') throw new Error('expected event');
    expect(bare.event.message).toBe('Claude stopped: overloaded.');
  });

  it('handles a missing error field', () => {
    const result = normalizeHookPayload(
      { session_id: 'a', hook_event_name: 'StopFailure' },
      now,
    );

    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.message).toBe('Claude stopped: unknown.');
  });
});

describe('normalizeHookPayload: Stop', () => {
  it('builds an attention event on normal stop', () => {
    const result = normalizeHookPayload(
      {
        session_id: 'abc123',
        cwd: '/Users/dev/finbot',
        hook_event_name: 'Stop',
        last_assistant_message: 'Finished running task.',
      },
      now,
    );

    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event).toMatchObject({
      agent: 'claude',
      sessionId: 'abc123',
      type: 'attention_required',
      title: 'Claude Code needs your attention',
      message: 'Finished running task.',
      cwd: '/Users/dev/finbot',
    });
  });

  it('builds an error event when Stop carries error details', () => {
    const result = normalizeHookPayload(
      {
        session_id: 'abc123',
        cwd: '/Users/dev/finbot',
        hook_event_name: 'Stop',
        error: 'aborted',
      },
      now,
    );

    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.type).toBe('error');
  });
});

describe('normalizeHookPayload: session state', () => {
  it('marks the session working on SessionStart', () => {
    const result = normalizeHookPayload(
      { session_id: 'abc', cwd: '/proj', hook_event_name: 'SessionStart' },
      now,
    );

    expect(result).toEqual({
      kind: 'session',
      update: {
        sessionId: 'abc',
        status: 'working',
        cwd: '/proj',
        agent: 'claude',
      },
    });
  });

  it('marks the session working on UserPromptSubmit', () => {
    const result = normalizeHookPayload(
      { session_id: 'abc', cwd: '/proj', hook_event_name: 'UserPromptSubmit' },
      now,
    );

    if (result.kind !== 'session') throw new Error('expected session');
    expect(result.update.status).toBe('working');
  });

  it('marks the session completed on SessionEnd', () => {
    const result = normalizeHookPayload(
      { session_id: 'abc', hook_event_name: 'SessionEnd', reason: 'other' },
      now,
    );

    if (result.kind !== 'session') throw new Error('expected session');
    expect(result.update.status).toBe('completed');
  });
});

describe('normalizeHookPayload: malformed input', () => {
  it('ignores an unsupported hook event', () => {
    const result = normalizeHookPayload(
      { session_id: 'a', hook_event_name: 'PreToolUse' },
      now,
    );

    expect(result.kind).toBe('ignored');
    if (result.kind !== 'ignored') throw new Error('expected ignored');
    expect(result.reason).toContain('PreToolUse');
  });

  it('ignores a payload with no session id', () => {
    const result = normalizeHookPayload({ hook_event_name: 'Notification' }, now);

    expect(result.kind).toBe('ignored');
    if (result.kind !== 'ignored') throw new Error('expected ignored');
    expect(result.reason).toContain('session_id');
  });

  it('ignores an empty payload', () => {
    expect(normalizeHookPayload({}, now).kind).toBe('ignored');
  });

  it('ignores non-string session ids', () => {
    const result = normalizeHookPayload(
      { session_id: 42, hook_event_name: 'Notification' },
      now,
    );

    expect(result.kind).toBe('ignored');
  });

  it('tolerates a missing cwd', () => {
    const result = normalizeHookPayload(notification({ cwd: undefined }), now);

    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.cwd).toBeUndefined();
  });
});
