import type { AgentSession } from '../core/types.js';
import type { PlatformId } from '../platform/platform.js';

export interface ApplicationInfo {
  id: string;
  name: string;
  projectPaths: string[];
  /** Native process identifier when the platform can focus a specific editor instance. */
  processId?: number;
}

export interface ApplicationFocusPlatform {
  discover(projectPath: string): Promise<ApplicationInfo[]>;
  focus(application: ApplicationInfo): Promise<boolean>;
}

export interface ApplicationFocusService {
  detectApplication(session: AgentSession): Promise<ApplicationInfo | undefined>;
  focusApplication(application: ApplicationInfo | undefined): Promise<boolean>;
}

function comparablePath(path: string, platform: PlatformId): string {
  const normalized = path.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return platform === 'windows' ? normalized.toLowerCase() : normalized;
}

/** Returns an editor only when it explicitly reports the session's project. */
export function associateProjectApplication(
  session: AgentSession,
  applications: readonly ApplicationInfo[],
  platform: PlatformId,
): ApplicationInfo | undefined {
  if (session.cwd === undefined || session.cwd.trim().length === 0) return undefined;

  const project = comparablePath(session.cwd, platform);
  return applications.find((application) =>
    application.projectPaths.some((path) => comparablePath(path, platform) === project),
  );
}

/** Coordinates platform discovery with safe project-path association. */
export class ProjectApplicationFocusService implements ApplicationFocusService {
  readonly #platform: ApplicationFocusPlatform;
  readonly #platformId: PlatformId;

  constructor(platform: ApplicationFocusPlatform, platformId: PlatformId) {
    this.#platform = platform;
    this.#platformId = platformId;
  }

  async detectApplication(session: AgentSession): Promise<ApplicationInfo | undefined> {
    if (session.cwd === undefined || session.cwd.trim().length === 0) return undefined;
    try {
      const applications = await this.#platform.discover(session.cwd);
      return associateProjectApplication(session, applications, this.#platformId);
    } catch {
      return undefined;
    }
  }

  async focusApplication(application: ApplicationInfo | undefined): Promise<boolean> {
    if (application === undefined) return false;
    try {
      return await this.#platform.focus(application);
    } catch {
      return false;
    }
  }
}
