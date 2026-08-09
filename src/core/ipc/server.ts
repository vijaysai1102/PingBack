import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, rmSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { PingBackError } from '../../utils/errors.js';
import type { Logger } from '../../utils/logger.js';
import { silentLogger } from '../../utils/logger.js';
import {
  LineDecoder,
  encodeMessage,
  parseRequest,
  type IpcRequest,
  type IpcResponse,
} from './protocol.js';

/** May return a value or a promise; the server awaits the result either way. */
export type IpcRequestHandler = (request: IpcRequest) => unknown;

export interface IpcServerOptions {
  endpoint: string;
  token: string;
  handler: IpcRequestHandler;
  logger?: Logger;
}

/** Constant-time compare so a token cannot be recovered by timing the response. */
function tokensMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isUnixSocketPath(endpoint: string): boolean {
  return !endpoint.startsWith('\\\\');
}

/**
 * Accepts newline-delimited JSON requests over a named pipe (Windows) or a
 * Unix domain socket (macOS). PingBack never opens a TCP port.
 */
export class IpcServer {
  readonly #endpoint: string;
  readonly #token: string;
  readonly #handler: IpcRequestHandler;
  readonly #logger: Logger;
  readonly #sockets = new Set<Socket>();
  #server: Server | undefined;

  constructor(options: IpcServerOptions) {
    this.#endpoint = options.endpoint;
    this.#token = options.token;
    this.#handler = options.handler;
    this.#logger = options.logger ?? silentLogger();
  }

  async listen(): Promise<void> {
    this.#removeStaleSocket();

    const server = createServer((socket) => {
      this.#handleConnection(socket);
    });
    this.#server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.off('listening', onListening);
        reject(
          error.code === 'EADDRINUSE'
            ? new PingBackError('Another PingBack daemon is already listening.', {
                code: 'DAEMON_ALREADY_RUNNING',
                hint: 'Run `pingback stop` first, or `pingback status` to inspect it.',
                cause: error,
              })
            : new PingBackError(
                `Could not start the PingBack IPC server: ${error.message}`,
                {
                  code: 'DAEMON_START_FAILED',
                  cause: error,
                },
              ),
        );
      };
      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.#endpoint);
    });

    this.#logger.info('ipc listening', { endpoint: this.#endpoint });
  }

  async close(): Promise<void> {
    const server = this.#server;
    if (server === undefined) return;
    this.#server = undefined;

    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    this.#removeStaleSocket();
    this.#logger.info('ipc closed');
  }

  /**
   * A Unix socket file outlives a crashed daemon and would make listen fail
   * with EADDRINUSE, so remove it when no process is actually accepting.
   */
  #removeStaleSocket(): void {
    if (!isUnixSocketPath(this.#endpoint)) return;
    if (!existsSync(this.#endpoint)) return;
    try {
      rmSync(this.#endpoint, { force: true });
    } catch {
      // If removal fails, listen will surface the real error.
    }
  }

  #handleConnection(socket: Socket): void {
    this.#sockets.add(socket);
    socket.setEncoding('utf8');

    const decoder = new LineDecoder();

    socket.on('data', (chunk: string) => {
      let lines: string[];
      try {
        lines = decoder.push(chunk);
      } catch {
        this.#send(socket, {
          id: 'unknown',
          ok: false,
          error: {
            code: 'MESSAGE_TOO_LARGE',
            message: 'Request exceeded the size limit.',
          },
        });
        socket.destroy();
        return;
      }

      for (const line of lines) {
        void this.#dispatch(socket, line);
      }
    });

    socket.on('error', () => {
      // A client disconnecting mid-request is routine; drop the socket quietly.
      this.#sockets.delete(socket);
    });

    socket.on('close', () => {
      this.#sockets.delete(socket);
    });
  }

  async #dispatch(socket: Socket, line: string): Promise<void> {
    const parsed = parseRequest(line);

    if (!parsed.ok) {
      this.#send(socket, {
        id: parsed.id,
        ok: false,
        error: { code: 'BAD_REQUEST', message: parsed.error },
      });
      return;
    }

    const request = parsed.request;

    if (!tokensMatch(this.#token, request.token)) {
      this.#logger.warn('ipc request rejected', {
        reason: 'bad_token',
        type: request.type,
      });
      this.#send(socket, {
        id: request.id,
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid PingBack auth token.' },
      });
      return;
    }

    try {
      const result = await this.#handler(request);
      this.#send(socket, { id: request.id, ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#logger.warn('ipc handler failed', { type: request.type, message });
      this.#send(socket, {
        id: request.id,
        ok: false,
        error: { code: 'HANDLER_FAILED', message },
      });
    }
  }

  #send(socket: Socket, response: IpcResponse): void {
    if (socket.destroyed) return;
    socket.write(encodeMessage(response));
  }
}
