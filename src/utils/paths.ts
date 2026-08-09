import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedRoot: string | undefined;

/**
 * Resolves the installed package root by walking up from this module until a
 * package.json named "pingback" is found. This works both from `src` during
 * development and from `dist` after a global npm install.
 */
export function packageRoot(): string {
  if (cachedRoot !== undefined) return cachedRoot;

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          (parsed as { name?: unknown }).name === 'pingback'
        ) {
          cachedRoot = dir;
          return dir;
        }
      } catch {
        // Unreadable package.json: keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fall back to two levels up from this file (dist/utils -> package root).
  cachedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  return cachedRoot;
}

export function packageVersion(): string {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(path.join(packageRoot(), 'package.json'), 'utf8'),
    );
    const version = (parsed as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Absolute path to a bundled asset, e.g. `assetPath('sounds', 'attention.wav')`. */
export function assetPath(...segments: string[]): string {
  return path.join(packageRoot(), 'assets', ...segments);
}
