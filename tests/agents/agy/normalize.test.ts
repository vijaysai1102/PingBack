import { describe, expect, it } from 'vitest';
import { normalizeAGYHookPayload } from '../../../src/agents/agy/normalize.js';

const now = (): number => 1_700_000_000_000;

describe('normalizeAGYHookPayload: PreInvocation', () => {
  it('normalizes PreInvocation to working session state', () => {
    const result = normalizeAGYHookPayload(
      {
        conversationId: 'agy-conv-123',
        workspacePaths: ['/Users/dev/myproject'],
        hookEventName: 'PreInvocation',
        invocationNum: 1,
      },
      now,
    );

    expect(result).toEqual({
      kind: 'session',
      update: {
        sessionId: 'agy-conv-123',
        status: 'working',
        cwd: '/Users/dev/myproject',
        agent: 'agy',
      },
    });
  });
});

describe('normalizeAGYHookPayload: PreToolUse (ask_question)', () => {
  it('normalizes ask_question tool call to question event', () => {
    const result = normalizeAGYHookPayload(
      {
        conversationId: 'agy-conv-123',
        workspacePaths: ['/Users/dev/myproject'],
        hookEventName: 'PreToolUse',
        toolCall: {
          name: 'ask_question',
          args: {
            questions: [
              {
                question: 'Which database would you like to use?',
              },
            ],
          },
        },
      },
      now,
    );

    expect(result.kind).toBe('event');
    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event).toMatchObject({
      agent: 'agy',
      sessionId: 'agy-conv-123',
      type: 'question',
      title: 'AGY has a question',
      message: 'Which database would you like to use?',
      cwd: '/Users/dev/myproject',
      timestamp: 1_700_000_000_000,
      metadata: {
        hookEvent: 'PreToolUse',
        tool: 'ask_question',
      },
    });
  });

  it('ignores other tool calls', () => {
    const result = normalizeAGYHookPayload(
      {
        conversationId: 'agy-conv-123',
        hookEventName: 'PreToolUse',
        toolCall: { name: 'run_command' },
      },
      now,
    );

    expect(result.kind).toBe('ignored');
  });
});

describe('normalizeAGYHookPayload: Stop', () => {
  it('normalizes normal Stop to attention_required event', () => {
    const result = normalizeAGYHookPayload(
      {
        conversationId: 'agy-conv-123',
        workspacePaths: ['/Users/dev/myproject'],
        hookEventName: 'Stop',
        terminationReason: 'model_stop',
        fullyIdle: true,
      },
      now,
    );

    expect(result.kind).toBe('event');
    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event).toMatchObject({
      agent: 'agy',
      sessionId: 'agy-conv-123',
      type: 'attention_required',
      title: 'AGY needs your attention',
      message: 'AGY is waiting for you.',
      cwd: '/Users/dev/myproject',
      metadata: {
        hookEvent: 'Stop',
        terminationReason: 'model_stop',
      },
    });
  });

  it('normalizes Stop with error to error event', () => {
    const result = normalizeAGYHookPayload(
      {
        conversationId: 'agy-conv-123',
        hookEventName: 'Stop',
        terminationReason: 'error',
        error: 'Context length exceeded',
      },
      now,
    );

    expect(result.kind).toBe('event');
    if (result.kind !== 'event') throw new Error('expected event');
    expect(result.event).toMatchObject({
      agent: 'agy',
      sessionId: 'agy-conv-123',
      type: 'error',
      title: 'AGY hit an error',
      message: 'Context length exceeded',
      metadata: {
        hookEvent: 'Stop',
        terminationReason: 'error',
        error: 'Context length exceeded',
      },
    });
  });
});

describe('normalizeAGYHookPayload: malformed input', () => {
  it('ignores unsupported hook events', () => {
    const result = normalizeAGYHookPayload(
      { conversationId: 'c1', hookEventName: 'Unknown' },
      now,
    );
    expect(result.kind).toBe('ignored');
  });

  it('ignores payload with missing conversationId', () => {
    const result = normalizeAGYHookPayload({ hookEventName: 'Stop' }, now);
    expect(result.kind).toBe('ignored');
  });
});
