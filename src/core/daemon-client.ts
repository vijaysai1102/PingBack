import { PingBackError } from '../utils/errors.js';
import type { Platform } from '../platform/platform.js';
import { DaemonState } from './daemon-state.js';
import { sendRequest } from './ipc/client.js';
import type { DaemonStatus, IpcRequestType } from './ipc/protocol.js';
import type { EventAck } from './daemon.js';
import type { SessionUpdate } from './event-schema.js';

const NOT_RUNNING_HINT = 'Run:\n\n    pingback start';

/** Client-side view of the running daemon, used by the CLI and the hook bridge. */
export class DaemonClient {
  readonly #platform: Platform;
  readonly #state: DaemonState;
  readonly #timeoutMs: number | undefined;

  constructor(platform: Platform, timeoutMs?: number) {
    this.#platform = platform;
    this.#state = new DaemonState(platform.paths.dataDir);
    this.#timeoutMs = timeoutMs;
  }

  get state(): DaemonState {
    return this.#state;
  }

  #requireToken(): string {
    const token = this.#state.readToken();
    if (token === undefined) {
      throw new PingBackError('PingBack daemon is not running.', {
        code: 'DAEMON_NOT_RUNNING',
        hint: NOT_RUNNING_HINT,
      });
    }
    return token;
  }

  async #send(type: IpcRequestType, payload?: unknown): Promise<unknown> {
    return sendRequest(
      {
        endpoint: this.#platform.ipcEndpoint,
        token: this.#requireToken(),
        ...(this.#timeoutMs === undefined ? {} : { timeoutMs: this.#timeoutMs }),
      },
      type,
      payload,
    );
  }

  /** True when a daemon answers on the socket. Never throws. */
  async isRunning(): Promise<boolean> {
    try {
      await this.#send('ping');
      return true;
    } catch {
      return false;
    }
  }

  async status(): Promise<DaemonStatus> {
    return (await this.#send('status')) as DaemonStatus;
  }

  async shutdown(): Promise<void> {
    await this.#send('shutdown');
  }

  async sendEvent(event: unknown): Promise<EventAck> {
    return (await this.#send('event', event)) as EventAck;
  }

  async sendSessionUpdate(update: SessionUpdate): Promise<void> {
    await this.#send('session', update);
  }
}
