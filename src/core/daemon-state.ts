import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { readJsonFile, writeJsonFileAtomic } from '../utils/json-file.js';

export interface DaemonRecord {
  pid: number;
  startedAt: number;
  endpoint: string;
  version: string;
}

function parseRecord(raw: unknown): DaemonRecord | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;

  if (typeof record.pid !== 'number' || !Number.isInteger(record.pid)) return undefined;
  if (typeof record.endpoint !== 'string' || record.endpoint.length === 0)
    return undefined;

  return {
    pid: record.pid,
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : 0,
    endpoint: record.endpoint,
    version: typeof record.version === 'string' ? record.version : 'unknown',
  };
}

/** True when a process with this pid currently exists and is signalable. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * On-disk daemon bookkeeping: which process is running and the shared secret
 * that authorizes IPC requests.
 *
 * The token exists because Windows named pipes are reachable by other local
 * users by default, so the pipe name alone is not an access control.
 */
export class DaemonState {
  readonly #dataDir: string;
  readonly #recordPath: string;
  readonly #tokenPath: string;

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
    this.#recordPath = path.join(dataDir, 'daemon.json');
    this.#tokenPath = path.join(dataDir, 'daemon.token');
  }

  get recordPath(): string {
    return this.#recordPath;
  }

  get tokenPath(): string {
    return this.#tokenPath;
  }

  readToken(): string | undefined {
    try {
      const token = readFileSync(this.#tokenPath, 'utf8').trim();
      return token.length > 0 ? token : undefined;
    } catch {
      return undefined;
    }
  }

  /** Returns the existing token, creating one on first use. */
  ensureToken(): string {
    const existing = this.readToken();
    if (existing !== undefined) return existing;

    mkdirSync(this.#dataDir, { recursive: true });
    const token = randomBytes(32).toString('hex');
    writeFileSync(this.#tokenPath, token, { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(this.#tokenPath, 0o600);
    } catch {
      // Best effort: Windows ignores POSIX modes.
    }
    return token;
  }

  readRecord(): DaemonRecord | undefined {
    const result = readJsonFile(this.#recordPath);
    return result.ok ? parseRecord(result.value) : undefined;
  }

  writeRecord(record: DaemonRecord): void {
    writeJsonFileAtomic(this.#recordPath, record);
  }

  clearRecord(): void {
    if (!existsSync(this.#recordPath)) return;
    rmSync(this.#recordPath, { force: true });
  }

  /** The recorded daemon, but only if that process is still alive. */
  readLiveRecord(): DaemonRecord | undefined {
    const record = this.readRecord();
    if (record === undefined) return undefined;
    if (!isProcessAlive(record.pid)) {
      this.clearRecord();
      return undefined;
    }
    return record;
  }
}
