import { CLAUDE_HOOK_EVENTS, type ClaudeHookEvent } from './types.js';

/** Basename of the bridge script, used to recognize hooks PingBack installed. */
export const HOOK_ENTRY_BASENAME = 'hook-entry.js';

export interface HookCommandSpec {
  /** Executable resolved on PATH. */
  command: string;
  /** Absolute path to PingBack's hook bridge. */
  scriptPath: string;
}

interface HookHandler {
  type?: unknown;
  command?: unknown;
  args?: unknown;
  timeout?: unknown;
  [key: string]: unknown;
}

interface MatcherGroup {
  matcher?: unknown;
  hooks?: unknown;
  [key: string]: unknown;
}

/**
 * SessionEnd shares a 1.5s budget across hooks and raises it to the highest
 * configured timeout, so it gets a deliberately small value; the bridge
 * finishes in well under a second.
 */
const TIMEOUT_SECONDS: Record<ClaudeHookEvent, number> = {
  Notification: 5,
  StopFailure: 5,
  SessionStart: 5,
  UserPromptSubmit: 5,
  SessionEnd: 3,
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isPingBackHandler(handler: unknown): boolean {
  const record = asRecord(handler);
  if (record === undefined) return false;

  const args = record.args;
  if (Array.isArray(args)) {
    if (
      args.some((arg) => typeof arg === 'string' && arg.includes(HOOK_ENTRY_BASENAME))
    ) {
      return true;
    }
  }

  return (
    typeof record.command === 'string' && record.command.includes(HOOK_ENTRY_BASENAME)
  );
}

/**
 * Uses exec form (`command` + `args`) so the script path needs no shell
 * quoting on any platform, which the Claude Code docs recommend for Windows.
 */
function buildHandler(spec: HookCommandSpec, event: ClaudeHookEvent): HookHandler {
  return {
    type: 'command',
    command: spec.command,
    args: [spec.scriptPath],
    timeout: TIMEOUT_SECONDS[event],
  };
}

function stripPingBackHandlers(groups: unknown): MatcherGroup[] {
  if (!Array.isArray(groups)) return [];

  const cleaned: MatcherGroup[] = [];

  for (const group of groups) {
    const record = asRecord(group);
    if (record === undefined) continue;

    const handlers = Array.isArray(record.hooks) ? record.hooks : [];
    const kept = handlers.filter((handler) => !isPingBackHandler(handler));

    // Drop groups that existed only to hold PingBack's handler.
    if (kept.length === 0 && handlers.length > 0) continue;

    cleaned.push({ ...record, hooks: kept });
  }

  return cleaned;
}

function withoutEmptyEvents(hooks: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (Array.isArray(groups) && groups.length === 0) continue;
    result[event] = groups;
  }
  return result;
}

/**
 * Adds PingBack's hooks to an existing settings object.
 *
 * Existing settings are preserved untouched, and any previously installed
 * PingBack handler is replaced so re-running setup is idempotent and picks up
 * a new install path.
 */
export function installHooks(
  settings: unknown,
  spec: HookCommandSpec,
): Record<string, unknown> {
  const root = { ...(asRecord(settings) ?? {}) };
  const existingHooks = asRecord(root.hooks) ?? {};
  const hooks: Record<string, unknown> = Object.fromEntries(
    Object.entries(existingHooks).map(([event, groups]) => [
      event,
      Array.isArray(groups) ? stripPingBackHandlers(groups) : groups,
    ]),
  );

  for (const event of CLAUDE_HOOK_EVENTS) {
    const groups = stripPingBackHandlers(hooks[event]);
    groups.push({ matcher: '*', hooks: [buildHandler(spec, event)] });
    hooks[event] = groups;
  }

  root.hooks = withoutEmptyEvents(hooks);
  return root;
}

/** Removes every PingBack handler, leaving unrelated hooks in place. */
export function uninstallHooks(settings: unknown): Record<string, unknown> {
  const root = { ...(asRecord(settings) ?? {}) };
  const existingHooks = asRecord(root.hooks);
  if (existingHooks === undefined) return root;

  const hooks: Record<string, unknown> = {};
  for (const [event, groups] of Object.entries(existingHooks)) {
    hooks[event] = Array.isArray(groups) ? stripPingBackHandlers(groups) : groups;
  }

  const remaining = withoutEmptyEvents(hooks);
  if (Object.keys(remaining).length === 0) delete root.hooks;
  else root.hooks = remaining;

  return root;
}

/** True when every hook event PingBack needs has a PingBack handler installed. */
export function hasPingBackHooks(settings: unknown): boolean {
  const hooks = asRecord(asRecord(settings)?.hooks);
  if (hooks === undefined) return false;

  return CLAUDE_HOOK_EVENTS.every((event) => {
    const groups = hooks[event];
    if (!Array.isArray(groups)) return false;

    return groups.some((group) => {
      const handlers = asRecord(group)?.hooks;
      return Array.isArray(handlers) && handlers.some(isPingBackHandler);
    });
  });
}
