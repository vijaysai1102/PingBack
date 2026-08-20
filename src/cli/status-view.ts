import type { DaemonStatus } from '../core/ipc/protocol.js';
import { needsAttention, type AgentSession } from '../core/types.js';
import { projectName } from '../notifications/notification-policy.js';
import { formatDuration, symbols } from './output.js';

const STATUS_LABELS: Record<AgentSession['status'], string> = {
  working: 'Working',
  waiting: 'Waiting',
  completed: 'Completed',
  error: 'Error',
  unknown: 'Unknown',
};

function sessionTiming(session: AgentSession, now: number): string {
  const last = session.lastActivityAt ?? session.startedAt;

  switch (session.status) {
    case 'waiting':
      return `Waiting: ${formatDuration(now - last)}`;
    case 'working':
      return `Running: ${formatDuration(now - session.startedAt)}`;
    case 'error':
      return `Failed: ${formatDuration(now - last)} ago`;
    case 'completed':
      return `Finished: ${formatDuration(now - last)} ago`;
    case 'unknown':
      return `Last seen: ${formatDuration(now - last)} ago`;
  }
}

function agentDisplayName(agent: AgentSession['agent']): string {
  switch (agent) {
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
  }
}

function formatSession(session: AgentSession, now: number): string[] {
  const marker = needsAttention(session) ? symbols.warn : symbols.active;
  const project = projectName(session.cwd) ?? 'unknown';
  const agent = agentDisplayName(session.agent);

  return [
    `${marker} ${agent}`,
    `  Project: ${project}`,
    `  Status: ${STATUS_LABELS[session.status]}`,
    `  ${sessionTiming(session, now)}`,
  ];
}

export function formatRunningStatus(status: DaemonStatus, now: number): string {
  const platformLabel = status.platform === 'windows' ? 'Windows' : 'macOS';
  const lines: string[] = [
    'PINGBACK',
    '',
    `Status: ${symbols.active} Running`,
    `Platform: ${platformLabel}`,
    '',
  ];

  if (status.agents && status.agents.length > 0) {
    lines.push('Agents', '─'.repeat(32));
    for (const agent of status.agents) {
      const stateLabel = agent.configured
        ? `${symbols.ok} Connected`
        : agent.installed
          ? `${symbols.warn} Installed (not configured)`
          : `${symbols.idle} Not installed`;
      lines.push(`${agent.displayName}: ${stateLabel}`);
    }
    lines.push('');
  } else {
    lines.push(
      `Claude Code: ${
        status.claudeConnected
          ? `${symbols.ok} Connected`
          : `${symbols.warn} Not configured`
      }`,
      '',
    );
  }

  lines.push('Sessions', '─'.repeat(32), '');

  if (status.sessions.length === 0) {
    lines.push('No active sessions.', '');
  } else {
    for (const session of status.sessions) {
      lines.push(...formatSession(session, now), '');
    }
  }

  const attention = status.sessions.filter(needsAttention).length;
  const count = status.sessions.length;

  if (count > 0) {
    lines.push('─'.repeat(32));
    const sessionCountText =
      count === 1 ? '1 active session' : `${String(count)} active sessions`;
    lines.push(sessionCountText);

    if (attention === 1) lines.push('1 needs your attention');
    else if (attention > 1) lines.push(`${String(attention)} need your attention`);
    else lines.push('Nothing needs your attention.');
  }

  return lines.join('\n');
}

export function formatNotRunning(platformLabel: string): string {
  return [
    'PINGBACK',
    '',
    `Status: ${symbols.idle} Not running`,
    `Platform: ${platformLabel}`,
    '',
    'Run:',
    '',
    '    pingback start',
    '',
  ].join('\n');
}
