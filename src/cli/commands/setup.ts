import { createAllAdapters } from '../../agents/registry.js';
import type { AgentAdapter } from '../../agents/adapter.js';
import { ConfigManager } from '../../config/config-manager.js';
import {
  createPlatform,
  isSupportedPlatform,
  readHostInfo,
} from '../../platform/platform.js';
import { SoundService } from '../../notifications/sound-service.js';
import { PingBackError, UnsupportedPlatformError } from '../../utils/errors.js';
import { banner, info, line, success, warn } from '../output.js';
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

  const adapters = createAllAdapters({ host });
  const installedAdapters: AgentAdapter[] = [];

  line('');
  line('Scanning for supported agents...');

  for (const adapter of adapters) {
    const detection = adapter.detect();
    if (detection.installed) {
      success(`${adapter.displayName} detected`);
      installedAdapters.push(adapter);
    } else {
      info(`${adapter.displayName} not installed`);
    }
  }

  if (installedAdapters.length === 0) {
    throw new PingBackError('No supported coding agents were detected.', {
      code: 'NO_AGENTS_FOUND',
      hint: 'Install Claude Code or Codex CLI and run:\n\n    pingback setup',
    });
  }

  line('');
  line('Configuring agent integrations...');
  for (const adapter of installedAdapters) {
    adapter.setup();
    success(adapter.displayName);
  }

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
  line('Starting PingBack...');
  await startDaemon({ quiet: true });
  success('Running');

  line('');
  line('PingBack is ready.');
  line('');
  line('Active agent integrations:');
  for (const adapter of installedAdapters) {
    line(`  - ${adapter.displayName}`);
  }
  line('');
  line("We'll notify you when your agents need your attention.");
  line('');
  line('Note: restart any agent sessions that are already open.');
}

export function runUninstall(): void {
  const host = readHostInfo();
  const adapters = createAllAdapters({ host });

  let removedCount = 0;
  for (const adapter of adapters) {
    if (adapter.isConfigured()) {
      adapter.uninstall();
      success(`${adapter.displayName} integration removed.`);
      removedCount += 1;
    }
  }

  if (removedCount === 0) {
    info('No active agent integrations found.');
  }

  line('');
  line('Stop the background daemon with:');
  line('');
  line('    pingback stop');
}
