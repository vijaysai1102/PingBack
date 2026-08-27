import { describe, expect, it } from 'vitest';
import {
  detectAvailableEditors,
  formatAvailableEditors,
} from '../../src/applications/editor-availability.js';

describe('detectAvailableEditors', () => {
  it('reports each supported Windows editor running at setup time once', async () => {
    await expect(
      detectAvailableEditors('windows', () =>
        Promise.resolve({
          stdout: 'Code\r\nCode\r\nCursor\r\nNotepad\r\n',
          stderr: '',
          exitCode: 0,
        }),
      ),
    ).resolves.toEqual(['Visual Studio Code', 'Cursor']);
  });

  it('makes no supported editor a non-fatal setup outcome', () => {
    expect(formatAvailableEditors([])).toBe('No supported running editor detected.');
    expect(formatAvailableEditors(['Cursor'])).toBe('Supported running editor: Cursor');
  });
});
