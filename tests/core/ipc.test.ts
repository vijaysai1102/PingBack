import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IpcServer, type IpcRequestHandler } from '../../src/core/ipc/server.js';
import { sendRequest } from '../../src/core/ipc/client.js';
import { PingBackError } from '../../src/utils/errors.js';

const TOKEN = 'test-token-0123456789';

function makeEndpoint(): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\pingback-test-${randomUUID()}`
    : path.join(tmpdir(), `pb-${randomUUID().slice(0, 8)}.sock`);
}

let servers: IpcServer[] = [];

async function startServer(handler: IpcRequestHandler): Promise<string> {
  const endpoint = makeEndpoint();
  const server = new IpcServer({ endpoint, token: TOKEN, handler });
  await server.listen();
  servers.push(server);
  return endpoint;
}

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

describe('IPC round trip', () => {
  it('delivers a request and returns the result', async () => {
    const endpoint = await startServer(() => ({ pong: true }));

    const result = await sendRequest({ endpoint, token: TOKEN }, 'ping');
    expect(result).toEqual({ pong: true });
  });

  it('passes the payload through to the handler', async () => {
    let seen: unknown;
    const endpoint = await startServer((request) => {
      seen = request.payload;
      return { ok: true };
    });

    await sendRequest({ endpoint, token: TOKEN }, 'event', { sessionId: 'abc' });
    expect(seen).toEqual({ sessionId: 'abc' });
  });

  it('supports an async handler', async () => {
    const endpoint = await startServer(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { late: true };
    });

    await expect(sendRequest({ endpoint, token: TOKEN }, 'status')).resolves.toEqual({
      late: true,
    });
  });

  it('handles several sequential requests', async () => {
    let count = 0;
    const endpoint = await startServer(() => ({ count: ++count }));

    await sendRequest({ endpoint, token: TOKEN }, 'ping');
    await sendRequest({ endpoint, token: TOKEN }, 'ping');
    const third = await sendRequest({ endpoint, token: TOKEN }, 'ping');

    expect(third).toEqual({ count: 3 });
  });

  it('rejects a request carrying the wrong token', async () => {
    const endpoint = await startServer(() => ({ pong: true }));

    await expect(sendRequest({ endpoint, token: 'wrong' }, 'ping')).rejects.toThrow(
      /Invalid PingBack auth token/,
    );
  });

  it('does not invoke the handler for an unauthorized request', async () => {
    let called = false;
    const endpoint = await startServer(() => {
      called = true;
      return {};
    });

    await expect(sendRequest({ endpoint, token: 'wrong' }, 'ping')).rejects.toThrow();
    expect(called).toBe(false);
  });

  it('surfaces a handler failure as an error response', async () => {
    const endpoint = await startServer(() => {
      throw new Error('handler exploded');
    });

    await expect(sendRequest({ endpoint, token: TOKEN }, 'event')).rejects.toThrow(
      /handler exploded/,
    );
  });

  it('keeps serving after a handler failure', async () => {
    let shouldFail = true;
    const endpoint = await startServer(() => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('transient');
      }
      return { recovered: true };
    });

    await expect(sendRequest({ endpoint, token: TOKEN }, 'ping')).rejects.toThrow();
    await expect(sendRequest({ endpoint, token: TOKEN }, 'ping')).resolves.toEqual({
      recovered: true,
    });
  });

  it('reports DAEMON_NOT_RUNNING when nothing is listening', async () => {
    const endpoint = makeEndpoint();

    await expect(sendRequest({ endpoint, token: TOKEN }, 'ping')).rejects.toMatchObject({
      code: 'DAEMON_NOT_RUNNING',
    });
  });

  it('times out rather than hanging when the handler never replies', async () => {
    const endpoint = await startServer(() => new Promise(() => {}));

    await expect(
      sendRequest({ endpoint, token: TOKEN, timeoutMs: 150 }, 'ping'),
    ).rejects.toThrow(/Timed out/);
  });

  it('refuses to start a second server on the same endpoint', async () => {
    const endpoint = await startServer(() => ({}));
    const duplicate = new IpcServer({ endpoint, token: TOKEN, handler: () => ({}) });

    await expect(duplicate.listen()).rejects.toBeInstanceOf(PingBackError);
  });

  it('leaves the running daemon reachable after a duplicate is refused', async () => {
    const endpoint = await startServer(() => ({ original: true }));
    const duplicate = new IpcServer({ endpoint, token: TOKEN, handler: () => ({}) });

    await expect(duplicate.listen()).rejects.toBeInstanceOf(PingBackError);

    // The refused server must not have unlinked the live socket on macOS.
    await expect(sendRequest({ endpoint, token: TOKEN }, 'ping')).resolves.toEqual({
      original: true,
    });
  });

  it('takes over a socket file left behind by a crashed daemon', async () => {
    // Windows named pipes are not files, so there is nothing to leave behind.
    if (process.platform === 'win32') return;

    const endpoint = makeEndpoint();
    writeFileSync(endpoint, '');

    const server = new IpcServer({
      endpoint,
      token: TOKEN,
      handler: () => ({ fresh: true }),
    });
    await server.listen();
    servers.push(server);

    await expect(sendRequest({ endpoint, token: TOKEN }, 'ping')).resolves.toEqual({
      fresh: true,
    });
  });

  it('stops answering once closed', async () => {
    const endpoint = await startServer(() => ({ pong: true }));
    await servers[0]?.close();
    servers = [];

    await expect(sendRequest({ endpoint, token: TOKEN }, 'ping')).rejects.toThrow();
  });
});
