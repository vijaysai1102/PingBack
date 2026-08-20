import crypto from 'node:crypto';
import type { HookCommandSpec } from '../claude/settings.js';

export const CODEX_HOOK_ENTRY_BASENAME = 'codex/hook-entry.js';
export const CODEX_REQUIRED_HOOK_EVENTS = ['UserPromptSubmit', 'Stop'] as const;

export type CodexRequiredHookEvent = (typeof CODEX_REQUIRED_HOOK_EVENTS)[number];

interface HookHandler {
  type?: unknown;
  command?: unknown;
  args?: unknown;
  timeout?: unknown;
  _pingback?: unknown;
  [key: string]: unknown;
}

interface MatcherGroup {
  matcher?: unknown;
  _pingback?: unknown;
  hooks?: unknown;
  [key: string]: unknown;
}

const TIMEOUT_SECONDS: Record<CodexRequiredHookEvent, number> = {
  UserPromptSubmit: 15,
  Stop: 15,
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isPingBackCodexHandler(handler: unknown): boolean {
  const record = asRecord(handler);
  if (record === undefined) return false;

  if (record._pingback === 1 || record._pingback === true) return true;

  const args = record.args;
  if (Array.isArray(args)) {
    if (
      args.some(
        (arg) =>
          typeof arg === 'string' &&
          (arg.includes('codex/hook-entry') || arg.includes('codex\\hook-entry')),
      )
    ) {
      return true;
    }
  }

  if (typeof record.command === 'string') {
    return (
      record.command.includes('codex/hook-entry') ||
      record.command.includes('codex\\hook-entry') ||
      record.command.includes('pingback')
    );
  }

  return false;
}

function buildHandler(spec: HookCommandSpec, event: CodexRequiredHookEvent): HookHandler {
  return {
    type: 'command',
    command: `${spec.command} "${spec.scriptPath}" codex`,
    timeout: TIMEOUT_SECONDS[event],
    _pingback: 1,
  };
}

function stripPingBackHandlers(groups: unknown): MatcherGroup[] {
  if (!Array.isArray(groups)) return [];

  const cleaned: MatcherGroup[] = [];

  for (const group of groups) {
    const record = asRecord(group);
    if (record === undefined) continue;

    const handlers = Array.isArray(record.hooks) ? record.hooks : [];
    const kept = handlers.filter((handler) => !isPingBackCodexHandler(handler));

    // Drop groups that existed only to hold PingBack's handler
    if (kept.length === 0 && (handlers.length > 0 || record._pingback === 1)) {
      continue;
    }

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
 * Adds PingBack's hooks to an existing Codex hooks settings object.
 * Existing non-PingBack hooks and matchers are preserved.
 */
export function installCodexHooks(
  settings: unknown,
  spec: HookCommandSpec,
): Record<string, unknown> {
  const root = { ...(asRecord(settings) ?? {}) };
  const existingHooks = asRecord(root.hooks) ?? {};
  const hooks: Record<string, unknown> = { ...existingHooks };

  for (const event of CODEX_REQUIRED_HOOK_EVENTS) {
    const groups = stripPingBackHandlers(hooks[event]);
    groups.push({
      matcher: '',
      _pingback: 1,
      hooks: [buildHandler(spec, event)],
    });
    hooks[event] = groups;
  }

  root.hooks = hooks;
  return root;
}

/** Removes every PingBack handler from Codex hooks settings, leaving unrelated hooks in place. */
export function uninstallCodexHooks(settings: unknown): Record<string, unknown> {
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

/** True when every required Codex hook event has a PingBack handler installed. */
export function hasPingBackCodexHooks(settings: unknown): boolean {
  const hooks = asRecord(asRecord(settings)?.hooks);
  if (hooks === undefined) return false;

  return CODEX_REQUIRED_HOOK_EVENTS.every((event) => {
    const groups = hooks[event];
    if (!Array.isArray(groups)) return false;

    return groups.some((group) => {
      const handlers = asRecord(group)?.hooks;
      return Array.isArray(handlers) && handlers.some(isPingBackCodexHandler);
    });
  });
}

/** Computes the SHA-256 trusted hash string for Codex config.toml hook state. */
export function computeHookHash(commandString: string): string {
  return `sha256:${crypto.createHash('sha256').update(commandString).digest('hex')}`;
}
