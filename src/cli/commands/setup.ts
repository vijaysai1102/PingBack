import { ClaudeAdapter } from '../../agents/claude/adapter.js';
import {
  detectAvailableEditors,
  formatAvailableEditors,
} from '../../applications/editor-availability.js';
import { ConfigManager } from '../../config/config-manager.js';
import {
  createPlatform,
  isSupportedPlatform,
  readHostInfo,
} from '../../platform/platform.js';
import { NullSoundPlayer, SoundService } from '../../notifications/sound-service.js';
import { DesktopNotificationService } from '../../notifications/desktop-notification.js';
import { PingBackError, UnsupportedPlatformError } from '../../utils/errors.js';
import { banner, line, success, warn } from '../output.js';
import { startDaemon } from './start.js';

export async function runSetup(): Promise<void> {
  const host = readHostInfo();

  if (!isSupportedPlatform(host.platform)) {
    throw new UnsupportedPlatformError(host.platform);
  }

  const platform = createPlatform(host);

  line(banner());
  line('');
  line('Checking your system...');
  line('');

  success(`${platform.displayName} detected`);
  success(`Node.js ${process.version} detected`);

  const claude = new ClaudeAdapter({ host });
  const detection = claude.detect();

  if (!detection.installed) {
    throw new PingBackError('Claude Code was not detected.', {
      code: 'CLAUDE_NOT_FOUND',
      hint: 'Install Claude Code and run:\n\n    pingback setup',
    });
  }
  success('Claude Code detected');

  const desktopNotifications = new DesktopNotificationService({
    sound: new NullSoundPlayer(),
  });
  if (desktopNotifications.isAvailable()) {
    success('Desktop notifications available');
  } else {
    warn(
      'Desktop notifications are unavailable; PingBack will continue tracking sessions.',
    );
  }

  line('');
  line('Setting up Claude Code integration...');
  claude.setup();
  success('Done');

  line('');
  line('Setting up notifications...');
  const configManager = new ConfigManager(platform.paths.configDir);
  const { config, warnings } = configManager.load();
  for (const message of warnings) warn(message);

  // Persist defaults on first run so the file exists for `pingback config`.
  configManager.save(config);
  success('Done');

  line('');
  line('Setting up sound...');
  const sound = new SoundService({ platform });
  if (sound.isAvailable()) {
    success('Done');
  } else {
    warn('Notification sounds are unavailable; PingBack will notify silently.');
  }

  line('');
  line('Checking supported editors...');
  const editors = await detectAvailableEditors(platform.id);
  if (editors.length === 0) {
    warn(formatAvailableEditors(editors));
  } else {
    success(formatAvailableEditors(editors));
  }

  line('');
  line('Starting PingBack...');
  await startDaemon({ quiet: true });
  success('Running');

  line('');
  line('PingBack is ready.');
  line('');
  line('You can use Claude Code normally.');
  line("We'll notify you when Claude needs your attention.");
  line('');
  line('Note: restart any Claude Code sessions that are already open.');
}

export function runUninstall(): void {
  const host = readHostInfo();
  const claude = new ClaudeAdapter({ host });

  claude.uninstall();
  success('Claude Code integration removed.');
  line('');
  line('Stop the background daemon with:');
  line('');
  line('    pingback stop');
}
