import type { CommandRunner } from './command-runner.js';
import {
  ProjectApplicationFocusService,
  type ApplicationFocusService,
} from './project-association.js';
import { readHostInfo, type HostInfo, type PlatformId } from '../platform/platform.js';
import { WindowsApplicationFocusPlatform } from '../platform/windows/application-focus.js';
import { MacosApplicationFocusPlatform } from '../platform/macos/application-focus.js';

/** Builds the supported platform's project-safe application focus service. */
export function createApplicationFocus(
  platform: PlatformId,
  run?: CommandRunner,
  host: HostInfo = readHostInfo(),
): ApplicationFocusService {
  const applicationPlatform =
    platform === 'windows'
      ? new WindowsApplicationFocusPlatform(run, host)
      : new MacosApplicationFocusPlatform(run, host);
  return new ProjectApplicationFocusService(applicationPlatform, platform);
}
