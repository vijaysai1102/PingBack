import { describe, expect, it } from 'vitest';
import { formatNotRunning, formatRunningStatus } from '../../src/cli/status-view.js';
import type { DaemonStatus } from '../../src/core/ipc/protocol.js';
import type { AgentSession } from '../../src/core/types.js';

const NOW = 1_000_000;

function status(
  sessions: AgentSession[],
  overrides: Partial<DaemonStatus> = {},
): DaemonStatus {
  return {
    pid: 123,
    version: '0.1.0',
    startedAt: NOW - 60_000,
    platform: 'macos',
    claudeConnected: true,
    sessions,
    ...overrides,
  };
}

describe('formatRunningStatus', () => {
  it('reports the running state and platform', () => {
    const output = formatRunningStatus(status([]), NOW);

    expect(output).toContain('PINGBACK');
    expect(output).toContain('Running');
    expect(output).toContain('Platform: macOS');
  });

  it('renders the Windows platform label', () => {
    const output = formatRunningStatus(status([], { platform: 'windows' }), NOW);
    expect(output).toContain('Platform: Windows');
  });

  it('shows Claude as connected', () => {
    expect(formatRunningStatus(status([]), NOW)).toContain('Claude Code:');
    expect(formatRunningStatus(status([]), NOW)).toContain('Connected');
  });

  it('shows Claude as not configured', () => {
    const output = formatRunningStatus(status([], { claudeConnected: false }), NOW);
    expect(output).toContain('Not configured');
  });

  it('says so when there are no sessions', () => {
    expect(formatRunningStatus(status([]), NOW)).toContain('No active sessions.');
  });

  it('lists a working session with its project and runtime', () => {
    const output = formatRunningStatus(
      status([
        {
          id: 's1',
          agent: 'claude',
          status: 'working',
          startedAt: NOW - 12 * 60_000,
          cwd: '/Users/dev/finbot',
        },
      ]),
      NOW,
    );

    expect(output).toContain('Project: finbot');
    expect(output).toContain('Status: Working');
    expect(output).toContain('Running: 12m');
  });

  it('lists a waiting session with how long it has waited', () => {
    const output = formatRunningStatus(
      status([
        {
          id: 's2',
          agent: 'claude',
          status: 'waiting',
          startedAt: NOW - 100_000,
          lastActivityAt: NOW - 42_000,
          cwd: '/Users/dev/agent-monitor',
        },
      ]),
      NOW,
    );

    expect(output).toContain('Project: agent-monitor');
    expect(output).toContain('Status: Waiting');
    expect(output).toContain('Waiting: 42s');
  });

  it('renders multi-agent configuration block when agents are provided', () => {
    const output = formatRunningStatus(
      status([], {
        agents: [
          {
            name: 'claude',
            displayName: 'Claude Code',
            configured: true,
            installed: true,
          },
          { name: 'codex', displayName: 'Codex CLI', configured: true, installed: true },
          { name: 'agy', displayName: 'AGY CLI', configured: false, installed: true },
        ],
      }),
      NOW,
    );

    expect(output).toContain('Agents');
    expect(output).toContain('Claude Code:');
    expect(output).toContain('Codex CLI:');
    expect(output).toContain('AGY CLI:');
  });

  it('counts a single session needing attention', () => {
    const output = formatRunningStatus(
      status([{ id: 's1', agent: 'claude', status: 'waiting', startedAt: NOW }]),
      NOW,
    );

    expect(output).toContain('1 active session');
    expect(output).toContain('1 needs your attention');
  });

  it('counts several sessions needing attention', () => {
    const output = formatRunningStatus(
      status([
        { id: 's1', agent: 'claude', status: 'waiting', startedAt: NOW },
        { id: 's2', agent: 'codex', status: 'error', startedAt: NOW },
      ]),
      NOW,
    );

    expect(output).toContain('2 active sessions');
    expect(output).toContain('2 need your attention');
  });

  it('says nothing needs attention when all sessions are calm', () => {
    const output = formatRunningStatus(
      status([{ id: 's1', agent: 'agy', status: 'working', startedAt: NOW }]),
      NOW,
    );

    expect(output).toContain('1 active session');
    expect(output).toContain('Nothing needs your attention.');
  });

  it('falls back to unknown when the project cannot be determined', () => {
    const output = formatRunningStatus(
      status([{ id: 's1', agent: 'claude', status: 'working', startedAt: NOW }]),
      NOW,
    );

    expect(output).toContain('Project: unknown');
  });
});

describe('formatNotRunning', () => {
  it('tells the user how to start PingBack', () => {
    const output = formatNotRunning('Windows');

    expect(output).toContain('Not running');
    expect(output).toContain('Platform: Windows');
    expect(output).toContain('pingback start');
  });
});
