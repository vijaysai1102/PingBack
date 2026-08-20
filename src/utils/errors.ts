/**
 * Error codes are stable identifiers that the CLI maps to friendly guidance.
 */
export type PingBackErrorCode =
  | 'UNSUPPORTED_PLATFORM'
  | 'CLAUDE_NOT_FOUND'
  | 'DAEMON_NOT_RUNNING'
  | 'DAEMON_ALREADY_RUNNING'
  | 'DAEMON_START_FAILED'
  | 'IPC_FAILURE'
  | 'NOTIFICATION_UNAVAILABLE'
  | 'INVALID_CONFIG'
  | 'INVALID_EVENT'
  | 'SETUP_FAILED';

export interface PingBackErrorOptions {
  code: PingBackErrorCode;
  /** Actionable next step shown to the user instead of a stack trace. */
  hint?: string | undefined;
  cause?: unknown;
}

export class PingBackError extends Error {
  readonly code: PingBackErrorCode;
  readonly hint: string | undefined;

  constructor(message: string, options: PingBackErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PingBackError';
    this.code = options.code;
    this.hint = options.hint;
  }
}

export class UnsupportedPlatformError extends PingBackError {
  constructor(platform: string) {
    super(`PingBack v0.1 does not support the "${platform}" platform.`, {
      code: 'UNSUPPORTED_PLATFORM',
      hint: 'PingBack v0.1 supports Windows and macOS only.',
    });
    this.name = 'UnsupportedPlatformError';
  }
}

export function isPingBackError(value: unknown): value is PingBackError {
  return value instanceof PingBackError;
}

/** Normalizes unknown thrown values into a readable message. */
export function toMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return String(value);
}
