import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HookCommandSpec } from '../claude/settings.js';

export const CODEX_NOTIFY_ENTRY_BASENAME = 'codex/notify-entry.js';
export const CODEX_LIFECYCLE_ENTRY_BASENAME = 'codex/lifecycle-entry.js';
const CODEX_LIFECYCLE_EVENTS = [
  'PermissionRequest',
  'SessionStart',
  'UserPromptSubmit',
] as const;

interface NotifyAssignment {
  valueStart: number;
  valueEnd: number;
  lineStart: number;
  lineEnd: number;
  command: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}

function parseTomlStringArray(value: string): string[] | undefined {
  const source = value.trim();
  if (!source.startsWith('[') || !source.endsWith(']')) return undefined;

  const result: string[] = [];
  let index = 1;

  const skipWhitespace = (): void => {
    while (index < source.length - 1 && /\s/.test(source[index] ?? '')) index += 1;
  };

  skipWhitespace();
  while (index < source.length - 1) {
    const quote = source[index];
    if (quote !== '"' && quote !== "'") return undefined;
    index += 1;

    let token = '';
    let terminated = false;
    while (index < source.length - 1) {
      const char = source[index];
      if (char === undefined) return undefined;
      index += 1;

      if (char === quote) {
        terminated = true;
        break;
      }

      if (quote === '"' && char === '\\') {
        const escaped = source[index];
        if (escaped === undefined) return undefined;
        index += 1;
        const escapeMap: Record<string, string> = {
          b: '\b',
          t: '\t',
          n: '\n',
          f: '\f',
          r: '\r',
          '"': '"',
          '\\': '\\',
        };
        if (escaped === 'u' || escaped === 'U') return undefined;
        const decoded = escapeMap[escaped];
        if (decoded === undefined) return undefined;
        token += decoded;
        continue;
      }

      token += char;
    }

    if (!terminated) return undefined;
    result.push(token);
    skipWhitespace();
    if (source[index] === ']') return result;
    if (source[index] !== ',') return undefined;
    index += 1;
    skipWhitespace();
  }

  return undefined;
}

function findMatchingArrayEnd(config: string, start: number): number | undefined {
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let index = start; index < config.length; index += 1) {
    const char = config[index];
    if (char === undefined) return undefined;

    if (quote !== undefined) {
      if (quote === '"' && escaped) {
        escaped = false;
      } else if (quote === '"' && char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ']') return index;
  }

  return undefined;
}

function findTopLevelNotify(config: string): NotifyAssignment | undefined {
  const header = /^\s*\[[^\]]+\]\s*(?:#.*)?$/m;
  const assignment = /^\s*notify\s*=\s*\[/gm;
  let match: RegExpExecArray | null;

  while ((match = assignment.exec(config)) !== null) {
    const before = config.slice(0, match.index);
    if (header.test(before)) return undefined;

    const valueStart = match.index + match[0].lastIndexOf('[');
    const valueEnd = findMatchingArrayEnd(config, valueStart);
    if (valueEnd === undefined) return undefined;
    const command = parseTomlStringArray(config.slice(valueStart, valueEnd + 1));
    if (command === undefined) return undefined;

    const lineStart = config.lastIndexOf('\n', match.index) + 1;
    const newline = config.indexOf('\n', valueEnd);
    return {
      valueStart,
      valueEnd,
      lineStart,
      lineEnd: newline === -1 ? config.length : newline + 1,
      command,
    };
  }

  return undefined;
}

function hasTopLevelNotifyKey(config: string): boolean {
  const header = /^\s*\[[^\]]+\]\s*(?:#.*)?$/m;
  const assignment = /^\s*notify\s*=/gm;
  let match: RegExpExecArray | null;

  while ((match = assignment.exec(config)) !== null) {
    if (!header.test(config.slice(0, match.index))) return true;
  }

  return false;
}

function notifyCommand(spec: HookCommandSpec): string[] {
  return [spec.command, spec.scriptPath];
}

function isPingBackNotify(command: readonly string[]): boolean {
  return command.some(
    (entry) =>
      entry.includes('codex/notify-entry') || entry.includes('codex\\notify-entry'),
  );
}

function replaceNotifyValue(
  config: string,
  assignment: NotifyAssignment,
  command: string[],
): string {
  return `${config.slice(0, assignment.valueStart)}${tomlStringArray(command)}${config.slice(
    assignment.valueEnd + 1,
  )}`;
}

/**
 * Installs the Codex CLI `notify` command without reformatting unrelated TOML.
 * A pre-existing command is returned so the bridge can forward notifications
 * and uninstall can restore it exactly.
 */
export function installCodexNotify(
  config: string,
  spec: HookCommandSpec,
): { config: string; originalNotify?: string[] } {
  const existing = findTopLevelNotify(config);
  if (existing !== undefined) {
    if (isPingBackNotify(existing.command)) return { config };
    return {
      config: replaceNotifyValue(config, existing, notifyCommand(spec)),
      originalNotify: existing.command,
    };
  }

  if (hasTopLevelNotifyKey(config)) {
    throw new Error('could not safely parse the existing top-level Codex notify setting');
  }

  const entry = `notify = ${tomlStringArray(notifyCommand(spec))}`;
  return {
    config:
      config.length === 0
        ? entry
        : `${config}${config.endsWith('\n') ? '' : '\n'}${entry}`,
  };
}

/** Restores the prior command only when the current setting is PingBack-managed. */
export function uninstallCodexNotify(config: string, originalNotify?: string[]): string {
  const existing = findTopLevelNotify(config);
  if (existing === undefined || !isPingBackNotify(existing.command)) return config;

  if (originalNotify !== undefined) {
    return replaceNotifyValue(config, existing, originalNotify);
  }

  return `${config.slice(0, existing.lineStart)}${config.slice(existing.lineEnd)}`;
}

export function hasPingBackCodexNotify(config: string): boolean {
  const assignment = findTopLevelNotify(config);
  return assignment !== undefined && isPingBackNotify(assignment.command);
}

function lifecycleCommand(spec: HookCommandSpec): string {
  const normalizedPath = spec.scriptPath.replace(/\\/g, '/');
  const pathArgument = normalizedPath.includes(' ')
    ? `"${normalizedPath}"`
    : normalizedPath;
  return `${spec.command} ${pathArgument} codex`;
}

function isPingBackLifecycleGroup(value: unknown): boolean {
  const group = asRecord(value);
  if (group?._pingback !== 1 || !Array.isArray(group.hooks)) return false;

  return group.hooks.some((hook) => {
    const command = asRecord(hook)?.command;
    return (
      typeof command === 'string' &&
      (command.includes(CODEX_LIFECYCLE_ENTRY_BASENAME) ||
        command.includes(CODEX_LIFECYCLE_ENTRY_BASENAME.replaceAll('/', '\\')))
    );
  });
}

/** Builds asynchronous observer hooks that never return a Codex approval decision. */
export function buildPingBackCodexLifecycleGroup(
  spec: HookCommandSpec,
): Record<string, unknown> {
  return {
    _pingback: 1,
    hooks: [
      {
        type: 'command',
        command: lifecycleCommand(spec),
        timeout: 15,
        async: true,
      },
    ],
  };
}

/**
 * Adds PingBack's Codex lifecycle observers while retaining hooks installed by
 * the user or another tool. PermissionRequest remains Codex-controlled: this
 * asynchronous command emits no decision and therefore cannot change approval.
 */
export function installCodexLifecycleHooks(
  settings: unknown,
  spec: HookCommandSpec,
): Record<string, unknown> {
  const root = { ...(asRecord(settings) ?? {}) };
  const currentHooks = asRecord(root.hooks) ?? {};
  const hooks: Record<string, unknown> = { ...currentHooks };

  for (const event of CODEX_LIFECYCLE_EVENTS) {
    const existing = hooks[event];
    const retained = (asArray(existing) ?? []).filter(
      (entry) => !isPingBackLifecycleGroup(entry),
    );
    hooks[event] = [...retained, buildPingBackCodexLifecycleGroup(spec)];
  }

  return { ...root, hooks };
}

/** Removes only PingBack's lifecycle hook groups from a Codex hooks file. */
export function uninstallCodexLifecycleHooks(settings: unknown): Record<string, unknown> {
  const root = { ...(asRecord(settings) ?? {}) };
  const currentHooks = asRecord(root.hooks);
  if (currentHooks === undefined) return root;

  const hooks: Record<string, unknown> = { ...currentHooks };
  for (const [event, value] of Object.entries(currentHooks)) {
    if (!Array.isArray(value)) continue;
    const retained = value.filter((entry) => !isPingBackLifecycleGroup(entry));
    if (retained.length === value.length) continue;
    if (retained.length === 0) delete hooks[event];
    else hooks[event] = retained;
  }

  return Object.keys(hooks).length === 0
    ? (() => {
        const { hooks: _hooks, ...withoutHooks } = root;
        return withoutHooks;
      })()
    : { ...root, hooks };
}

/** Checks that every lifecycle observer PingBack requires is present. */
export function hasPingBackCodexLifecycleHooks(settings: unknown): boolean {
  const root = asRecord(settings);
  const hooks = root === undefined ? undefined : asRecord(root.hooks);
  return (
    hooks !== undefined &&
    CODEX_LIFECYCLE_EVENTS.every(
      (event) =>
        Array.isArray(hooks[event]) && hooks[event].some(isPingBackLifecycleGroup),
    )
  );
}

/** Writes plain text atomically, matching the JSON persistence guarantees. */
export function writeTextFileAtomic(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);

  try {
    writeFileSync(tempPath, content, 'utf8');
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // The temp file may not have been created.
    }
    throw error;
  }
}
