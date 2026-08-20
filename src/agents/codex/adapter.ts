import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentAdapter, AgentDetection } from '../adapter.js';
import { readHostInfo, type HostInfo } from '../../platform/platform.js';
import { readJsonFile, writeJsonFileAtomic } from '../../utils/json-file.js';
import { PingBackError } from '../../utils/errors.js';
import type { HookCommandSpec } from '../claude/settings.js';
import { codexConfigPath, codexHooksPath, detectCodex } from './detector.js';
import {
  hasPingBackCodexHooks,
  installCodexHooks,
  uninstallCodexHooks,
} from './settings.js';

export interface CodexAdapterOptions {
  host?: HostInfo;
  /** Overridable so tests never touch real ~/.codex directory. */
  hooksPath?: string;
  configPath?: string;
  hookSpec?: HookCommandSpec;
}

export function defaultCodexHookScriptPath(): string {
  return fileURLToPath(new URL('./hook-entry.js', import.meta.url));
}

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex' as const;
  readonly displayName = 'Codex CLI';

  readonly #host: HostInfo;
  readonly #hooksPath: string;
  readonly #configPath: string;
  readonly #hookSpec: HookCommandSpec;

  constructor(options: CodexAdapterOptions = {}) {
    this.#host = options.host ?? readHostInfo();
    this.#hooksPath = options.hooksPath ?? codexHooksPath(this.#host.homedir);
    this.#configPath = options.configPath ?? codexConfigPath(this.#host.homedir);
    this.#hookSpec = options.hookSpec ?? {
      command: 'node',
      scriptPath: defaultCodexHookScriptPath(),
    };
  }

  get hooksPath(): string {
    return this.#hooksPath;
  }

  get configPath(): string {
    return this.#configPath;
  }

  detect(): AgentDetection {
    return detectCodex(this.#host);
  }

  #readHooks(): unknown {
    const result = readJsonFile(this.#hooksPath);

    if (!result.ok) {
      if (result.reason === 'missing') return {};
      throw new PingBackError(
        `Could not read Codex CLI hooks configuration at ${this.#hooksPath}.`,
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
      return hasPingBackCodexHooks(this.#readHooks());
    } catch {
      return false;
    }
  }

  setup(): void {
    const hooks = this.#readHooks();
    this.#backupOnce();
    writeJsonFileAtomic(this.#hooksPath, installCodexHooks(hooks, this.#hookSpec));
  }

  uninstall(): void {
    if (!existsSync(this.#hooksPath)) return;
    const hooks = this.#readHooks();
    writeJsonFileAtomic(this.#hooksPath, uninstallCodexHooks(hooks));
  }

  /** Keeps a one-time copy of the user's original hooks.json before first edit. */
  #backupOnce(): void {
    if (!existsSync(this.#hooksPath)) return;

    const backup = path.join(path.dirname(this.#hooksPath), 'hooks.json.pingback-backup');
    if (existsSync(backup)) return;

    try {
      copyFileSync(this.#hooksPath, backup);
    } catch {
      // Failed backup should not block setup; atomic write ensures integrity.
    }
  }
}
