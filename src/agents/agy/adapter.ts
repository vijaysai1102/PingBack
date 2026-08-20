import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentAdapter, AgentDetection } from '../adapter.js';
import { readHostInfo, type HostInfo } from '../../platform/platform.js';
import { readJsonFile, writeJsonFileAtomic } from '../../utils/json-file.js';
import { PingBackError } from '../../utils/errors.js';
import type { HookCommandSpec } from '../claude/settings.js';
import { agyHooksPath, detectAGY } from './detector.js';
import { hasPingBackAGYHooks, installAGYHooks, uninstallAGYHooks } from './settings.js';

export interface AGYAdapterOptions {
  host?: HostInfo;
  /** Overridable so tests never touch real ~/.gemini directory. */
  hooksPath?: string;
  hookSpec?: HookCommandSpec;
}

export function defaultAGYHookScriptPath(): string {
  return fileURLToPath(new URL('./hook-entry.js', import.meta.url));
}

export class AGYAdapter implements AgentAdapter {
  readonly name = 'agy' as const;
  readonly displayName = 'AGY CLI';

  readonly #host: HostInfo;
  readonly #hooksPath: string;
  readonly #hookSpec: HookCommandSpec;

  constructor(options: AGYAdapterOptions = {}) {
    this.#host = options.host ?? readHostInfo();
    this.#hooksPath = options.hooksPath ?? agyHooksPath(this.#host.homedir);
    this.#hookSpec = options.hookSpec ?? {
      command: 'node',
      scriptPath: defaultAGYHookScriptPath(),
    };
  }

  get hooksPath(): string {
    return this.#hooksPath;
  }

  detect(): AgentDetection {
    return detectAGY(this.#host);
  }

  #readHooks(): unknown {
    const result = readJsonFile(this.#hooksPath);

    if (!result.ok) {
      if (result.reason === 'missing') return {};
      throw new PingBackError(
        `Could not read AGY hooks configuration at ${this.#hooksPath}.`,
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
      return hasPingBackAGYHooks(this.#readHooks());
    } catch {
      return false;
    }
  }

  setup(): void {
    const hooks = this.#readHooks();
    this.#backupOnce();
    writeJsonFileAtomic(this.#hooksPath, installAGYHooks(hooks, this.#hookSpec));
  }

  uninstall(): void {
    if (!existsSync(this.#hooksPath)) return;
    const hooks = this.#readHooks();
    writeJsonFileAtomic(this.#hooksPath, uninstallAGYHooks(hooks));
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
