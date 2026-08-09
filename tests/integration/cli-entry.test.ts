import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const builtCli = path.join(repoRoot, 'dist', 'cli', 'index.js');

/**
 * A global npm install puts a symlink to the CLI on PATH (macOS and Linux), so
 * the entry-point guard has to survive being invoked through a link. When it
 * does not, every command prints nothing and still exits 0.
 */
describe('CLI entry point through a symlink', () => {
  it('produces output when invoked through a link', (ctx) => {
    if (!existsSync(builtCli)) {
      ctx.skip('requires npm run build');
      return;
    }

    const dir = mkdtempSync(path.join(tmpdir(), 'pb-entry-'));
    const link = path.join(dir, 'pingback');

    try {
      try {
        symlinkSync(builtCli, link);
      } catch {
        // Creating symlinks on Windows needs Developer Mode or elevation.
        ctx.skip('symlinks unavailable');
        return;
      }

      const output = execFileSync(process.execPath, [link, '--version'], {
        encoding: 'utf8',
      });

      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
