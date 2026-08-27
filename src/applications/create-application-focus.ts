import type { CommandRunner } from './command-runner.js';
import {
  ProjectApplicationFocusService,
  type ApplicationFocusService,
} from './project-association.js';
import type { PlatformId } from '../platform/platform.js';
import { WindowsApplicationFocusPlatform } from '../platform/windows/application-focus.js';
import { MacosApplicationFocusPlatform } from '../platform/macos/application-focus.js';

/** Builds the supported platform's project-safe application focus service. */
export function createApplicationFocus(
  platform: PlatformId,
  run?: CommandRunner,
): ApplicationFocusService {
  const applicationPlatform =
    platform === 'windows'
      ? new WindowsApplicationFocusPlatform(run)
      : new MacosApplicationFocusPlatform(run);
  return new ProjectApplicationFocusService(applicationPlatform, platform);
}
