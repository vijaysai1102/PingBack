import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { PingBackError } from '../../utils/errors.js';
import {
  LineDecoder,
  encodeMessage,
  type IpcRequestType,
  type IpcResponse,
} from './protocol.js';

export interface IpcClientOptions {
  endpoint: string;
  token: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

function isResponse(value: unknown): value is IpcResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

/**
 * One-shot request/response over the daemon's local socket.
 *
 * The CLI is short-lived, so a fresh connection per request keeps the client
 * free of reconnect and connection-state handling.
 */
export async function sendRequest(
  options: IpcClientOptions,
  type: IpcRequestType,
  payload?: unknown,
): Promise<unknown> {
  const { endpoint, token, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const id = randomUUID();

  return new Promise<unknown>((resolve, reject) => {
    let socket: Socket;
    let settled = false;

    const finish = (error: Error | undefined, result?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error !== undefined) reject(error);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      finish(
        new PingBackError('Timed out waiting for the PingBack daemon.', {
          code: 'IPC_FAILURE',
          hint: 'Run `pingback status` to check whether the daemon is healthy.',
        }),
      );
    }, timeoutMs);

    try {
      socket = connect(endpoint);
    } catch (error) {
      clearTimeout(timer);
      reject(
        new PingBackError('Could not reach the PingBack daemon.', {
          code: 'DAEMON_NOT_RUNNING',
          hint: 'Run `pingback start` to start it.',
          cause: error,
        }),
      );
      return;
    }

    socket.setEncoding('utf8');
    const decoder = new LineDecoder();

    socket.on('connect', () => {
      socket.write(encodeMessage({ id, token, type, payload }));
    });

    socket.on('data', (chunk: string) => {
      let lines: string[];
      try {
        lines = decoder.push(chunk);
      } catch (error) {
        finish(
          new PingBackError('Daemon response exceeded the size limit.', {
            code: 'IPC_FAILURE',
            cause: error,
          }),
        );
        return;
      }

      for (const line of lines) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        if (!isResponse(parsed) || parsed.id !== id) continue;

        if (parsed.ok) {
          finish(undefined, parsed.result);
        } else {
          finish(new PingBackError(parsed.error.message, { code: 'IPC_FAILURE' }));
        }
        return;
      }
    });

    socket.on('error', (error: NodeJS.ErrnoException) => {
      const notRunning =
        error.code === 'ENOENT' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'EPIPE';
      finish(
        new PingBackError(
          notRunning
            ? 'PingBack daemon is not running.'
            : `Could not talk to the PingBack daemon: ${error.message}`,
          {
            code: notRunning ? 'DAEMON_NOT_RUNNING' : 'IPC_FAILURE',
            hint: notRunning ? 'Run:\n\n    pingback start' : undefined,
            cause: error,
          },
        ),
      );
    });

    socket.on('close', () => {
      finish(
        new PingBackError('The PingBack daemon closed the connection unexpectedly.', {
          code: 'IPC_FAILURE',
        }),
      );
    });
  });
}
