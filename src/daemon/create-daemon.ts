import path from 'node:path';
import { ClaudeAdapter } from '../agents/claude/adapter.js';
import { ConfigManager } from '../config/config-manager.js';
import { Daemon } from '../core/daemon.js';
import { DaemonState } from '../core/daemon-state.js';
import { createPlatform, type Platform, type PlatformId } from '../platform/platform.js';
import { createApplicationFocus } from '../applications/create-application-focus.js';
import type { ApplicationFocusService } from '../applications/project-association.js';
import { SessionManager } from '../sessions/session-manager.js';
import { FileSessionStore } from '../sessions/session-store.js';
import type { NotificationService } from '../notifications/notification-service.js';
import { NullNotificationService } from '../notifications/notification-service.js';
import { DesktopNotificationService } from '../notifications/desktop-notification.js';
import { NullSoundPlayer, SoundService } from '../notifications/sound-service.js';
import { createFileSink, createLogger, type Logger } from '../utils/logger.js';
import { packageVersion } from '../utils/paths.js';

export interface CreateDaemonResult {
  daemon: Daemon;
  logger: Logger;
  platform: Platform;
}

export interface CreateDaemonOptions {
  platform?: Platform;
  applicationFocusFactory?: (platform: PlatformId) => ApplicationFocusService;
}

/** Assembles the daemon from on-disk configuration and platform defaults. */
export function createDaemon(options: CreateDaemonOptions = {}): CreateDaemonResult {
  const platform = options.platform ?? createPlatform();

  const configManager = new ConfigManager(platform.paths.configDir);
  const { config, warnings } = configManager.load();

  const logger = createLogger({
    level: config.logLevel,
    sinks: [createFileSink(path.join(platform.paths.logDir, 'daemon.log'))],
    bindings: { component: 'daemon' },
  });

  for (const warning of warnings) {
    logger.warn('config warning', { warning });
  }

  const sessions = new SessionManager({
    store: new FileSessionStore(platform.paths.dataDir),
  });

  const notifications: NotificationService = config.notifications.enabled
    ? new DesktopNotificationService({
        sound: config.notifications.sound.enabled
          ? new SoundService({ platform, logger })
          : new NullSoundPlayer(),
        logger,
      })
    : new NullNotificationService();

  let applicationFocus: ApplicationFocusService | undefined;
  try {
    applicationFocus = (options.applicationFocusFactory ?? createApplicationFocus)(
      platform.id,
    );
  } catch (error) {
    logger.warn('application focus unavailable', { err: error });
  }

  const daemon = new Daemon({
    platform,
    config,
    sessions,
    notifications,
    state: new DaemonState(platform.paths.dataDir),
    logger,
    version: packageVersion(),
    claudeConnected: () => new ClaudeAdapter().isConfigured(),
    ...(applicationFocus === undefined ? {} : { applicationFocus }),
  });

  return { daemon, logger, platform };
}
