import type { HookCommandSpec } from '../claude/settings.js';

export const AGY_HOOK_ENTRY_BASENAME = 'agy/hook-entry.js';
export const PINGBACK_HOOK_NAME = 'pingback';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Builds the `"pingback"` named hook configuration block for AGY's hooks.json.
 */
export function buildPingBackAGYHookConfig(
  spec: HookCommandSpec,
): Record<string, unknown> {
  const cmd = `${spec.command} "${spec.scriptPath}" agy`;

  return {
    PreToolUse: [
      {
        matcher: 'ask_question',
        hooks: [
          {
            type: 'command',
            command: cmd,
            timeout: 15,
          },
        ],
      },
    ],
    PreInvocation: [
      {
        type: 'command',
        command: cmd,
        timeout: 15,
      },
    ],
    Stop: [
      {
        type: 'command',
        command: cmd,
        timeout: 15,
      },
    ],
  };
}

/**
 * Installs or updates PingBack's named hook entry in AGY hooks.json, preserving other hooks.
 */
export function installAGYHooks(
  settings: unknown,
  spec: HookCommandSpec,
): Record<string, unknown> {
  const root = { ...(asRecord(settings) ?? {}) };
  root[PINGBACK_HOOK_NAME] = buildPingBackAGYHookConfig(spec);
  return root;
}

/**
 * Removes PingBack's named hook entry from AGY hooks.json.
 */
export function uninstallAGYHooks(settings: unknown): Record<string, unknown> {
  const root = { ...(asRecord(settings) ?? {}) };
  delete root[PINGBACK_HOOK_NAME];
  return root;
}

/**
 * Checks whether PingBack is configured in AGY hooks.json.
 */
export function hasPingBackAGYHooks(settings: unknown): boolean {
  const root = asRecord(settings);
  if (root === undefined) return false;

  const pingbackConfig = asRecord(root[PINGBACK_HOOK_NAME]);
  if (pingbackConfig === undefined) return false;

  return (
    Array.isArray(pingbackConfig.PreToolUse) &&
    pingbackConfig.PreToolUse.length > 0 &&
    Array.isArray(pingbackConfig.PreInvocation) &&
    pingbackConfig.PreInvocation.length > 0 &&
    Array.isArray(pingbackConfig.Stop) &&
    pingbackConfig.Stop.length > 0
  );
}
