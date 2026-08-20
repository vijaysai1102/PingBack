import type { AgentSession, AgentType } from '../types.js';
import type { PlatformId } from '../../platform/platform.js';

export const IPC_REQUEST_TYPES = [
  'ping',
  'status',
  'event',
  'session',
  'shutdown',
] as const;

export type IpcRequestType = (typeof IPC_REQUEST_TYPES)[number];

export interface IpcRequest {
  id: string;
  token: string;
  type: IpcRequestType;
  payload?: unknown;
}

export interface AgentStatusInfo {
  name: AgentType;
  displayName: string;
  configured: boolean;
  installed: boolean;
}

export interface DaemonStatus {
  pid: number;
  version: string;
  startedAt: number;
  platform: PlatformId;
  claudeConnected: boolean;
  agents?: AgentStatusInfo[] | undefined;
  sessions: AgentSession[];
}

export type IpcResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: string; message: string } };

/** Guards against a runaway or hostile client sending an unbounded line. */
export const MAX_LINE_BYTES = 256 * 1024;

export function encodeMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

export class LineTooLongError extends Error {
  constructor() {
    super('IPC message exceeded the maximum line length.');
    this.name = 'LineTooLongError';
  }
}

/**
 * Incremental newline-delimited JSON decoder. Socket chunks do not align with
 * message boundaries, so partial lines are buffered until a newline arrives.
 */
export class LineDecoder {
  #buffer = '';
  readonly #maxBytes: number;

  constructor(maxBytes: number = MAX_LINE_BYTES) {
    this.#maxBytes = maxBytes;
  }

  push(chunk: string): string[] {
    this.#buffer += chunk;

    if (this.#buffer.length > this.#maxBytes) {
      this.#buffer = '';
      throw new LineTooLongError();
    }

    const lines: string[] = [];
    let newlineIndex = this.#buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = this.#buffer.slice(0, newlineIndex).trim();
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (line.length > 0) lines.push(line);
      newlineIndex = this.#buffer.indexOf('\n');
    }

    return lines;
  }
}

export function isIpcRequestType(value: unknown): value is IpcRequestType {
  return typeof value === 'string' && IPC_REQUEST_TYPES.includes(value as IpcRequestType);
}

export type ParsedRequest =
  { ok: true; request: IpcRequest } | { ok: false; error: string; id: string };

export function parseRequest(line: string): ParsedRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, error: 'Request is not valid JSON.', id: 'unknown' };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Request must be a JSON object.', id: 'unknown' };
  }

  const record = raw as Record<string, unknown>;
  const id =
    typeof record.id === 'string' && record.id.length > 0 ? record.id : 'unknown';

  if (!isIpcRequestType(record.type)) {
    return { ok: false, error: `Unknown request type: ${String(record.type)}`, id };
  }

  if (typeof record.token !== 'string') {
    return { ok: false, error: 'Request is missing an auth token.', id };
  }

  return {
    ok: true,
    request: { id, token: record.token, type: record.type, payload: record.payload },
  };
}
