const useUnicode = process.platform !== 'win32' || process.env.WT_SESSION !== undefined;

export const symbols = {
  ok: useUnicode ? '✓' : '[ok]',
  fail: useUnicode ? '✗' : '[x]',
  warn: useUnicode ? '⚠' : '[!]',
  active: useUnicode ? '●' : '*',
  idle: useUnicode ? '○' : 'o',
};

export function banner(): string {
  return 'PINGBACK';
}

export function heading(text: string): void {
  process.stdout.write(`\n${text}\n`);
}

export function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function success(text: string): void {
  line(`${symbols.ok} ${text}`);
}

export function warn(text: string): void {
  line(`${symbols.warn} ${text}`);
}

export function failure(text: string): void {
  process.stderr.write(`${symbols.fail} ${text}\n`);
}

export function rule(width = 32): void {
  line('─'.repeat(width));
}

/** Formats a duration in milliseconds as a compact human string (e.g. "12m", "42s"). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
