import { describe, expect, it } from 'vitest';
import { editorsForProject } from '../../src/applications/editor-processes.js';

describe('editorsForProject', () => {
  it('recognizes VS Code and Cursor only when their process command line names the project', () => {
    const editors = editorsForProject(
      [
        {
          executable: 'Code.exe',
          commandLine:
            '"C:\\Program Files\\Microsoft VS Code\\Code.exe" C:\\Code\\FinBot',
        },
        {
          executable: 'Cursor.exe',
          commandLine:
            '"C:\\Users\\dev\\AppData\\Local\\Programs\\cursor\\Cursor.exe" C:\\Code\\Other',
        },
      ],
      'C:\\Code\\FinBot',
      'windows',
    );

    expect(editors).toEqual([
      {
        id: 'visual-studio-code',
        name: 'Visual Studio Code',
        projectPaths: ['C:\\Code\\FinBot'],
      },
    ]);
  });
});
