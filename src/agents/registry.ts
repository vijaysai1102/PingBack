import type { HostInfo } from '../platform/platform.js';
import type { AgentType } from '../core/types.js';
import type { AgentAdapter } from './adapter.js';
import { ClaudeAdapter } from './claude/adapter.js';
import { CodexAdapter } from './codex/adapter.js';
import { AGYAdapter } from './agy/adapter.js';

export interface AgentRegistryOptions {
  host?: HostInfo;
}

/**
 * Instantiates all supported agent adapters.
 */
export function createAllAdapters(options: AgentRegistryOptions = {}): AgentAdapter[] {
  const adapterOptions = options.host !== undefined ? { host: options.host } : {};
  return [
    new ClaudeAdapter(adapterOptions),
    new CodexAdapter(adapterOptions),
    new AGYAdapter(adapterOptions),
  ];
}

/**
 * Resolves an adapter by agent type name.
 */
export function getAdapter(
  agent: AgentType,
  options: AgentRegistryOptions = {},
): AgentAdapter {
  const adapterOptions = options.host !== undefined ? { host: options.host } : {};
  switch (agent) {
    case 'claude':
      return new ClaudeAdapter(adapterOptions);
    case 'codex':
      return new CodexAdapter(adapterOptions);
    case 'agy':
      return new AGYAdapter(adapterOptions);
  }
}
