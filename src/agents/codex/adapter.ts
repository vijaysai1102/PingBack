import { copyFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentAdapter, AgentDetection } from '../adapter.js';
import { readHostInfo, type HostInfo } from '../../platform/platform.js';
import { readJsonFile, writeJsonFileAtomic } from '../../utils/json-file.js';
import { PingBackError } from '../../utils/errors.js';
import type { HookCommandSpec } from '../claude/settings.js';
import { codexConfigPath, detectCodex } from './detector.js';
import {
  hasPingBackCodexNotify,
  hasPingBackCodexLifecycleHooks,
  installCodexLifecycleHooks,
  installCodexNotify,
  uninstallCodexLifecycleHooks,
  uninstallCodexNotify,
  writeTextFileAtomic,
} from './settings.js';

interface CodexNotifyState {
  originalNotify?: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isLegacyPingBackHook(value: unknown): boolean {
  const hookGroup = asRecord(value);
  if (hookGroup === undefined) return false;
  const hooks = hookGroup.hooks;
  return (
    Array.isArray(hooks) &&
    hooks.some((hook) => {
      const command = asRecord(hook)?.command;
      return (
        typeof command === 'string' &&
        (command.includes('PingBack/dist/agents/codex/hook-entry') ||
          command.includes('PingBack\\dist\\agents\\codex\\hook-entry'))
      );
    })
  );
}

/**
 * Removes the obsolete Codex hook-based PingBack integration. It predates the
 * supported `notify` integration and references a bridge that no longer exists.
 */
function removeLegacyPingBackHooks(
  settings: unknown,
): Record<string, unknown> | undefined {
  const root = asRecord(settings);
  const hooks = root === undefined ? undefined : asRecord(root.hooks);
  if (hooks === undefined) return undefined;

  let changed = false;
  const cleanedHooks: Record<string, unknown> = { ...hooks };
  for (const [event, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) continue;

    const retained = value.filter((entry) => !isLegacyPingBackHook(entry));
    if (retained.length === value.length) continue;

    changed = true;
    if (retained.length === 0) delete cleanedHooks[event];
    else cleanedHooks[event] = retained;
  }

  return changed ? { ...root, hooks: cleanedHooks } : undefined;
}

export interface CodexAdapterOptions {
  host?: HostInfo;
  /** Overridable so tests never touch the user's Codex configuration. */
  configPath?: string;
  statePath?: string;
  notifySpec?: HookCommandSpec;
  lifecycleSpec?: HookCommandSpec;
}

export function defaultCodexNotifyScriptPath(): string {
  return fileURLToPath(new URL('./notify-entry.js', import.meta.url));
}

export function defaultCodexLifecycleScriptPath(): string {
  return fileURLToPath(new URL('./lifecycle-entry.js', import.meta.url));
}

function defaultStatePath(host: HostInfo): string {
  return path.join(host.homedir, '.codex', 'pingback-notify.json');
}

function defaultLegacyHooksPath(host: HostInfo): string {
  return path.join(host.homedir, '.codex', 'hooks.json');
}

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex' as const;
  readonly displayName = 'Codex CLI';

  readonly #host: HostInfo;
  readonly #configPath: string;
  readonly #statePath: string;
  readonly #hooksPath: string;
  readonly #notifySpec: HookCommandSpec;
  readonly #lifecycleSpec: HookCommandSpec;

  constructor(options: CodexAdapterOptions = {}) {
    this.#host = options.host ?? readHostInfo();
    this.#configPath = options.configPath ?? codexConfigPath(this.#host.homedir);
    this.#statePath = options.statePath ?? defaultStatePath(this.#host);
    this.#hooksPath = defaultLegacyHooksPath(this.#host);
    this.#notifySpec = options.notifySpec ?? {
      command: process.execPath,
      scriptPath: defaultCodexNotifyScriptPath(),
    };
    this.#lifecycleSpec = options.lifecycleSpec ?? {
      command: process.execPath,
      scriptPath: defaultCodexLifecycleScriptPath(),
    };
  }

  get configPath(): string {
    return this.#configPath;
  }

  get statePath(): string {
    return this.#statePath;
  }

  detect(): AgentDetection {
    return detectCodex(this.#host);
  }

  isConfigured(): boolean {
    try {
      return (
        hasPingBackCodexNotify(this.#readConfig()) &&
        hasPingBackCodexLifecycleHooks(this.#readHooks())
      );
    } catch {
      return false;
    }
  }

  setup(): void {
    const hooks = this.#readHooks();
    const withoutLegacy = removeLegacyPingBackHooks(hooks) ?? hooks;
    const installedHooks = installCodexLifecycleHooks(withoutLegacy, this.#lifecycleSpec);
    if (JSON.stringify(installedHooks) !== JSON.stringify(hooks)) {
      this.#backupHooksOnce();
      writeJsonFileAtomic(this.#hooksPath, installedHooks);
    }

    const config = this.#readConfig();
    const installed = installCodexNotify(config, this.#notifySpec);
    if (installed.config === config) return;

    this.#backupOnce();
    writeTextFileAtomic(this.#configPath, installed.config);
    if (installed.originalNotify !== undefined) {
      writeJsonFileAtomic(this.#statePath, { originalNotify: installed.originalNotify });
    }
  }

  uninstall(): void {
    if (existsSync(this.#configPath)) {
      const config = this.#readConfig();
      if (hasPingBackCodexNotify(config)) {
        const restored = uninstallCodexNotify(config, this.#readState().originalNotify);
        writeTextFileAtomic(this.#configPath, restored);
        try {
          unlinkSync(this.#statePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }

    if (existsSync(this.#hooksPath)) {
      const hooks = this.#readHooks();
      const uninstalled = uninstallCodexLifecycleHooks(hooks);
      if (JSON.stringify(uninstalled) !== JSON.stringify(hooks)) {
        writeJsonFileAtomic(this.#hooksPath, uninstalled);
      }
    }
  }

  #readConfig(): string {
    try {
      return readFileSync(this.#configPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw new PingBackError(
        `Could not read Codex configuration at ${this.#configPath}.`,
        {
          code: 'SETUP_FAILED',
          hint: 'Check that config.toml is readable, then run `pingback setup` again.',
        },
      );
    }
  }

  #readState(): CodexNotifyState {
    const result = readJsonFile(this.#statePath);
    if (!result.ok || typeof result.value !== 'object' || result.value === null)
      return {};

    const originalNotify = (result.value as { originalNotify?: unknown }).originalNotify;
    return Array.isArray(originalNotify) &&
      originalNotify.every((item) => typeof item === 'string')
      ? { originalNotify }
      : {};
  }

  #readHooks(): unknown {
    const result = readJsonFile(this.#hooksPath);
    if (result.ok) {
      if (asRecord(result.value) !== undefined) return result.value;
      throw new PingBackError(
        `Codex hooks configuration at ${this.#hooksPath} must be a JSON object.`,
        {
          code: 'SETUP_FAILED',
          hint: 'Fix or remove hooks.json, then run `pingback setup` again.',
        },
      );
    }
    if (result.reason === 'missing') return {};
    throw new PingBackError(
      `Could not read Codex hooks configuration at ${this.#hooksPath}.`,
      {
        code: 'SETUP_FAILED',
        hint:
          result.reason === 'invalid'
            ? 'The file is not valid JSON. Fix or remove it, then run `pingback setup` again.'
            : 'Check that hooks.json is readable, then run `pingback setup` again.',
      },
    );
  }

  #backupHooksOnce(): void {
    if (!existsSync(this.#hooksPath)) return;
    const backupPath = path.join(
      path.dirname(this.#hooksPath),
      'hooks.json.pingback-backup',
    );
    if (existsSync(backupPath)) return;

    try {
      copyFileSync(this.#hooksPath, backupPath);
    } catch {
      // The atomic write still protects configuration integrity if backup fails.
    }
  }

  #backupOnce(): void {
    if (!existsSync(this.#configPath)) return;
    const backupPath = path.join(
      path.dirname(this.#configPath),
      'config.toml.pingback-backup',
    );
    if (existsSync(backupPath)) return;

    try {
      copyFileSync(this.#configPath, backupPath);
    } catch {
      // The atomic write still protects config integrity if a backup cannot be made.
    }
  }
}
