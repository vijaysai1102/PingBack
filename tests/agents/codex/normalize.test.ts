import { describe, expect, it } from 'vitest';
import { normalizeCodexHookPayload } from '../../../src/agents/codex/normalize.js';

const now = (): number => 1_700_000_000_000;

describe('normalizeCodexHookPayload: notify', () => {
  it('normalizes the documented turn-complete notification into task completion', () => {
    const payload = {
      type: 'agent-turn-complete',
      'thread-id': 'codex-thread-1',
      cwd: '/path/to/project',
    } as Parameters<typeof normalizeCodexHookPayload>[0];

    expect(normalizeCodexHookPayload(payload, now)).toEqual({
      kind: 'event',
      event: {
        agent: 'codex',
        sessionId: 'codex-thread-1',
        type: 'task_completed',
        title: 'Codex finished',
        message: 'Codex finished working.',
        cwd: '/path/to/project',
        timestamp: 1_700_000_000_000,
        metadata: { notifyType: 'agent-turn-complete' },
      },
    });
  });

  it('accepts the snake-case thread identifier used by some Codex runtimes', () => {
    const payload = {
      type: 'agent-turn-complete',
      thread_id: 'codex-thread-2',
    } as Parameters<typeof normalizeCodexHookPayload>[0];

    expect(normalizeCodexHookPayload(payload, now)).toMatchObject({
      kind: 'event',
      event: { sessionId: 'codex-thread-2', type: 'task_completed' },
    });
  });

  it('ignores an unrecognized notification without creating a session', () => {
    const payload = {
      type: 'other-event',
      'thread-id': 'codex-thread-1',
    } as Parameters<typeof normalizeCodexHookPayload>[0];

    expect(normalizeCodexHookPayload(payload, now)).toEqual({
      kind: 'ignored',
      reason: 'unsupported Codex notify event: other-event',
    });
  });

  it('ignores a turn-complete notification without a thread identifier', () => {
    const payload = { type: 'agent-turn-complete' } as Parameters<
      typeof normalizeCodexHookPayload
    >[0];

    expect(normalizeCodexHookPayload(payload, now)).toEqual({
      kind: 'ignored',
      reason: 'missing Codex thread identifier',
    });
  });

  it('turns Codex permission requests into attention notifications without exposing tool input', () => {
    const payload = {
      hook_event_name: 'PermissionRequest',
      session_id: 'codex-session-1',
      cwd: '/path/to/project',
      tool_name: 'shell',
      tool_input: { command: 'contains-sensitive-command' },
    } as Parameters<typeof normalizeCodexHookPayload>[0];

    expect(normalizeCodexHookPayload(payload, now)).toEqual({
      kind: 'event',
      event: {
        agent: 'codex',
        sessionId: 'codex-session-1',
        type: 'attention_required',
        title: 'Codex needs your attention',
        message: 'Codex is waiting for your approval.',
        cwd: '/path/to/project',
        timestamp: 1_700_000_000_000,
        metadata: { hookEvent: 'PermissionRequest', toolName: 'shell' },
      },
    });
  });

  it('marks a Codex session working when a user submits a new prompt', () => {
    const payload = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'codex-session-2',
      cwd: '/path/to/project',
    } as Parameters<typeof normalizeCodexHookPayload>[0];

    expect(normalizeCodexHookPayload(payload, now)).toEqual({
      kind: 'session',
      update: {
        agent: 'codex',
        sessionId: 'codex-session-2',
        status: 'working',
        cwd: '/path/to/project',
      },
    });
  });
});
