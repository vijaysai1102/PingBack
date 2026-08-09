import { describe, expect, it } from 'vitest';
import {
  isAgentEventType,
  needsAttention,
  priorityForEvent,
  statusForEvent,
  type AgentSession,
} from '../../src/core/types.js';

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's1',
    agent: 'claude',
    status: 'working',
    startedAt: 0,
    ...overrides,
  };
}

describe('priorityForEvent', () => {
  it('classifies blocking events as high priority', () => {
    expect(priorityForEvent('attention_required')).toBe('high');
    expect(priorityForEvent('question')).toBe('high');
  });

  it('classifies errors as medium and completions as low', () => {
    expect(priorityForEvent('error')).toBe('medium');
    expect(priorityForEvent('task_completed')).toBe('low');
  });
});

describe('statusForEvent', () => {
  it('maps events onto the session state they imply', () => {
    expect(statusForEvent('attention_required')).toBe('waiting');
    expect(statusForEvent('question')).toBe('waiting');
    expect(statusForEvent('error')).toBe('error');
    expect(statusForEvent('task_completed')).toBe('completed');
  });
});

describe('isAgentEventType', () => {
  it('accepts the four v0.1 event types', () => {
    expect(isAgentEventType('attention_required')).toBe(true);
    expect(isAgentEventType('task_completed')).toBe(true);
    expect(isAgentEventType('error')).toBe(true);
    expect(isAgentEventType('question')).toBe(true);
  });

  it('rejects unknown and non-string values', () => {
    expect(isAgentEventType('agent_idle')).toBe(false);
    expect(isAgentEventType('')).toBe(false);
    expect(isAgentEventType(null)).toBe(false);
    expect(isAgentEventType(7)).toBe(false);
  });
});

describe('needsAttention', () => {
  it('is true only for waiting and error sessions', () => {
    expect(needsAttention(session({ status: 'waiting' }))).toBe(true);
    expect(needsAttention(session({ status: 'error' }))).toBe(true);
    expect(needsAttention(session({ status: 'working' }))).toBe(false);
    expect(needsAttention(session({ status: 'completed' }))).toBe(false);
    expect(needsAttention(session({ status: 'unknown' }))).toBe(false);
  });
});
