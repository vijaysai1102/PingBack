import type { AgentType } from '../core/types.js';

export interface AgentDetection {
  installed: boolean;
  /** Where the agent was found, for display in `pingback setup`. */
  location?: string | undefined;
  version?: string | undefined;
}

/**
 * The contract PingBack Core relies on for every agent.
 *
 * Note there is no start/stop pair: PingBack's integrations are push-based.
 * Claude Code invokes a hook that forwards events into the daemon, so an
 * adapter has nothing to run in the background. Adding no-op lifecycle methods
 * would be abstraction without purpose; a future adapter that needs to poll can
 * own its own timer behind `setup`.
 */
export interface AgentAdapter {
  readonly name: AgentType;
  readonly displayName: string;

  /** Whether the agent is installed on this machine. */
  detect(): AgentDetection;

  /** Whether PingBack's integration is currently installed for this agent. */
  isConfigured(): boolean;

  /** Installs the integration. Must be idempotent. */
  setup(): void;

  /** Removes the integration, leaving unrelated user settings untouched. */
  uninstall(): void;
}
