import { describe, expect, it } from 'vitest';
import { normalizeCodexHookPayload } from '../../../src/agents/codex/normalize.js';

const now = (): number => 1_700_000_000_000;

describe('normalizeCodexHookPayload: UserPromptSubmit', () => {
  it('normalizes UserPromptSubmit to session working update', () => {
    const result = normalizeCodexHookPayload(
      {
        session_id: 'codex-sess-1',
        cwd: '/path/to/project',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Refactor this module',
        turn_id: 'turn-1',
      },
      now,
    );

    expect(result).toEqual({
      kind: 'session',
      update: {
        sessionId: 'codex-sess-1',
        status: 'working',
        cwd: '/path/to/project',
        agent: 'codex',
      },
    });
  });

  it('tolerates lower-case user_prompt_submit', () => {
    const result = normalizeCodexHookPayload(
      {
        session_id: 'codex-sess-1',
        cwd: '/path/to/project',
        hook_event_name: 'user_prompt_submit',
      },
      now,
    );

    expect(result.kind).toBe('session');
  });
});

describe('normalizeCodexHookPayload: Stop', () => {
  it('normalizes Stop without errors to attention_required event', () => {
    const result = normalizeCodexHookPayload(
      {
        session_id: 'codex-sess-1',
        cwd: '/path/to/project',
        hook_event_name: 'Stop',
        last_assistant_message: 'Finished running tests, waiting for your input.',
        turn_id: 'turn-1',
      },
      now,
    );

    expect(result.kind).toBe('event');
    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event).toMatchObject({
      agent: 'codex',
      sessionId: 'codex-sess-1',
      type: 'attention_required',
      title: 'Codex needs your attention',
      message: 'Finished running tests, waiting for your input.',
      cwd: '/path/to/project',
      timestamp: 1_700_000_000_000,
      metadata: {
        hookEvent: 'Stop',
        turnId: 'turn-1',
      },
    });
  });

  it('normalizes Stop with error to error event', () => {
    const result = normalizeCodexHookPayload(
      {
        session_id: 'codex-sess-1',
        cwd: '/path/to/project',
        hook_event_name: 'Stop',
        error: 'ExecutionTimeout',
        last_assistant_message: 'Codex hit an execution timeout error',
      },
      now,
    );

    expect(result.kind).toBe('event');
    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event).toMatchObject({
      agent: 'codex',
      sessionId: 'codex-sess-1',
      type: 'error',
      title: 'Codex hit an error',
      message: 'Codex hit an execution timeout error',
      metadata: {
        hookEvent: 'Stop',
        error: 'ExecutionTimeout',
      },
    });
  });

  it('falls back to default message when last_assistant_message is absent', () => {
    const result = normalizeCodexHookPayload(
      {
        session_id: 'codex-sess-1',
        hook_event_name: 'Stop',
      },
      now,
    );

    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event.message).toBe('Codex is waiting for you.');
  });
});

describe('normalizeCodexHookPayload: malformed / unsupported payloads', () => {
  it('ignores unsupported hook events', () => {
    const result = normalizeCodexHookPayload(
      {
        session_id: 'sess-1',
        hook_event_name: 'UnsupportedEvent',
      },
      now,
    );

    expect(result.kind).toBe('ignored');
  });

  it('ignores payloads without session_id', () => {
    const result = normalizeCodexHookPayload(
      {
        hook_event_name: 'Stop',
      },
      now,
    );

    expect(result.kind).toBe('ignored');
  });
});
