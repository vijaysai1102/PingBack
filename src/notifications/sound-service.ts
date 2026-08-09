import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Platform } from '../platform/platform.js';
import type { Logger } from '../utils/logger.js';
import { silentLogger } from '../utils/logger.js';
import { assetPath } from '../utils/paths.js';

export type SoundName = 'attention' | 'completion' | 'error';

export interface SoundPlayer {
  isAvailable(): boolean;
  play(sound: SoundName): Promise<void>;
}

export interface SoundServiceOptions {
  platform: Platform;
  logger?: Logger;
  /** Overridable so tests do not touch the filesystem or spawn processes. */
  resolveFile?: (sound: SoundName) => string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export function defaultSoundFile(sound: SoundName): string {
  return assetPath('sounds', `${sound}.wav`);
}

/**
 * Plays a bundled WAV using the OS's built-in player.
 *
 * Playback failures are never fatal: a missing audio device must not stop the
 * desktop notification from being delivered.
 */
export class SoundService implements SoundPlayer {
  readonly #platform: Platform;
  readonly #logger: Logger;
  readonly #resolveFile: (sound: SoundName) => string;
  readonly #timeoutMs: number;

  constructor(options: SoundServiceOptions) {
    this.#platform = options.platform;
    this.#logger = options.logger ?? silentLogger();
    this.#resolveFile = options.resolveFile ?? defaultSoundFile;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  isAvailable(): boolean {
    return existsSync(this.#resolveFile('attention'));
  }

  async play(sound: SoundName): Promise<void> {
    const file = this.#resolveFile(sound);

    if (!existsSync(file)) {
      this.#logger.warn('sound asset missing', { sound, file });
      return;
    }

    const { command, args } = this.#platform.buildSoundCommand(file);

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });

      const timer = setTimeout(() => {
        child.kill();
        this.#logger.warn('sound playback timed out', { sound });
        finish();
      }, this.#timeoutMs);

      child.once('error', (error) => {
        this.#logger.warn('sound playback failed', { sound, err: error });
        finish();
      });
      child.once('close', finish);
    });
  }
}

/** Used when sound is disabled in config. */
export class NullSoundPlayer implements SoundPlayer {
  isAvailable(): boolean {
    return false;
  }

  play(): Promise<void> {
    return Promise.resolve();
  }
}
