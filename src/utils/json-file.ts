import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export type JsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'missing' | 'unreadable' | 'invalid'; error?: unknown };

export function readJsonFile(filePath: string): JsonReadResult {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ok: false, reason: code === 'ENOENT' ? 'missing' : 'unreadable', error };
  }

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, reason: 'invalid', error };
  }
}

/**
 * Writes via a temp file and rename so a crash mid-write cannot leave a
 * truncated store behind. Node maps rename onto MoveFileEx with replace
 * semantics on Windows, so this is atomic on both supported platforms.
 */
export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Temp file may not exist; nothing to clean up.
    }
    throw error;
  }
}
