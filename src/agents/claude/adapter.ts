import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentAdapter, AgentDetection } from '../adapter.js';
import { readHostInfo, type HostInfo } from '../../platform/platform.js';
import { readJsonFile, writeJsonFileAtomic } from '../../utils/json-file.js';
import { PingBackError } from '../../utils/errors.js';
import { claudeSettingsPath, detectClaude } from './detector.js';
import {
  hasPingBackHooks,
  installHooks,
  uninstallHooks,
  type HookCommandSpec,
} from './settings.js';

export interface ClaudeAdapterOptions {
  host?: HostInfo;
  /** Overridable so tests never touch the real ~/.claude directory. */
  settingsPath?: string;
  hookSpec?: HookCommandSpec;
}

/**
 * Absolute path to the compiled hook bridge.
 *
 * Claude Code spawns this directly, so it must point at the installed `dist`
 * copy rather than anything relative to the user's project.
 */
export function defaultHookScriptPath(): string {
  return fileURLToPath(new URL('./hook-entry.js', import.meta.url));
}

export class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude' as const;
  readonly displayName = 'Claude Code';

  readonly #host: HostInfo;
  readonly #settingsPath: string;
  readonly #hookSpec: HookCommandSpec;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.#host = options.host ?? readHostInfo();
    this.#settingsPath = options.settingsPath ?? claudeSettingsPath(this.#host.homedir);
    this.#hookSpec = options.hookSpec ?? {
      // Resolved on PATH so the integration survives a Node upgrade.
      command: 'node',
      scriptPath: defaultHookScriptPath(),
    };
  }

  get settingsPath(): string {
    return this.#settingsPath;
  }

  detect(): AgentDetection {
    return detectClaude(this.#host);
  }

  #readSettings(): unknown {
    const result = readJsonFile(this.#settingsPath);

    if (!result.ok) {
      if (result.reason === 'missing') return {};
      throw new PingBackError(
        `Could not read Claude Code settings at ${this.#settingsPath}.`,
        {
          code: 'SETUP_FAILED',
          hint:
            result.reason === 'invalid'
              ? 'The file is not valid JSON. Fix or remove it, then run `pingback setup` again.'
              : 'Check that the file is readable, then run `pingback setup` again.',
        },
      );
    }

    return result.value;
  }

  isConfigured(): boolean {
    try {
      return hasPingBackHooks(this.#readSettings());
    } catch {
      return false;
    }
  }

  setup(): void {
    const settings = this.#readSettings();
    this.#backupOnce();
    writeJsonFileAtomic(this.#settingsPath, installHooks(settings, this.#hookSpec));
  }

  uninstall(): void {
    if (!existsSync(this.#settingsPath)) return;
    const settings = this.#readSettings();
    writeJsonFileAtomic(this.#settingsPath, uninstallHooks(settings));
  }

  /** Keeps a one-time copy of the user's original settings before first edit. */
  #backupOnce(): void {
    if (!existsSync(this.#settingsPath)) return;

    const backup = path.join(
      path.dirname(this.#settingsPath),
      'settings.json.pingback-backup',
    );
    if (existsSync(backup)) return;

    try {
      copyFileSync(this.#settingsPath, backup);
    } catch {
      // A failed backup should not block setup; the write itself is atomic.
    }
  }
}
