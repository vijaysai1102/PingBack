import type { PlatformId } from '../platform/platform.js';
import type { ApplicationInfo } from './project-association.js';

export interface EditorProcess {
  executable: string;
  commandLine: string;
  processId?: number;
}

const EDITORS: Record<string, Omit<ApplicationInfo, 'projectPaths'>> = {
  'code.exe': { id: 'visual-studio-code', name: 'Visual Studio Code' },
  code: { id: 'visual-studio-code', name: 'Visual Studio Code' },
  'cursor.exe': { id: 'cursor', name: 'Cursor' },
  cursor: { id: 'cursor', name: 'Cursor' },
};

function comparable(value: string, platform: PlatformId): string {
  const normalized = value.replace(/\\/g, '/');
  return platform === 'windows' ? normalized.toLowerCase() : normalized;
}

/**
 * Only reports an editor when its own command line explicitly contains the
 * session project path. A running editor alone is never enough to focus it.
 */
export function editorsForProject(
  processes: readonly EditorProcess[],
  projectPath: string,
  platform: PlatformId,
): ApplicationInfo[] {
  const project = comparable(projectPath, platform);
  const seen = new Set<string>();
  const applications: ApplicationInfo[] = [];

  for (const process of processes) {
    const editor = EDITORS[process.executable.toLowerCase()];
    if (
      editor === undefined ||
      !comparable(process.commandLine, platform).includes(project)
    ) {
      continue;
    }
    if (seen.has(editor.id)) continue;
    seen.add(editor.id);
    applications.push({
      ...editor,
      projectPaths: [projectPath],
      ...(process.processId === undefined ? {} : { processId: process.processId }),
    });
  }

  return applications;
}
