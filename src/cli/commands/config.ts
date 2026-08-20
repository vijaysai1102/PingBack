import {
  CONFIG_KEYS,
  ConfigManager,
  getConfigValue,
  isConfigKey,
  setConfigValue,
} from '../../config/config-manager.js';
import { createPlatform } from '../../platform/platform.js';
import { PingBackError } from '../../utils/errors.js';
import { line, warn } from '../output.js';

function manager(): ConfigManager {
  return new ConfigManager(createPlatform().paths.configDir);
}

export function runConfigList(): void {
  const configManager = manager();
  const { config, warnings } = configManager.load();

  line('PINGBACK CONFIG');
  line('');
  line('General');
  line('────────────────────────────────');
  line(`notifications.desktop = ${String(config.notifications.desktop)}`);
  line(`notifications.sound = ${String(config.notifications.sound)}`);
  line(`notifications.volume = ${String(config.notifications.volume)}`);
  line(`logLevel = ${config.logLevel}`);
  line('');
  line('Grace Periods & Event Rules');
  line('────────────────────────────────');
  for (const [event, rules] of Object.entries(config.notifications.events)) {
    const soundLabel = rules.sound ? 'ON' : 'OFF';
    const desktopLabel = rules.desktop ? 'ON' : 'OFF';
    line(
      `${event}: ${rules.delaySeconds}s grace period | Sound: ${soundLabel} | Desktop: ${desktopLabel}`,
    );
  }
  line('');
  line(configManager.filePath);

  for (const message of warnings) warn(message);
}

export function runConfigSet(key: string, value: string): void {
  if (!isConfigKey(key)) {
    throw new PingBackError(`Unknown config key: ${key}`, {
      code: 'INVALID_CONFIG',
      hint: `Available keys:\n\n    ${CONFIG_KEYS.join('\n    ')}`,
    });
  }

  const configManager = manager();
  const { config } = configManager.load();
  const result = setConfigValue(config, key, value);

  if (!result.ok) {
    throw new PingBackError(result.error, { code: 'INVALID_CONFIG' });
  }

  configManager.save(config);
  line(`${key} = ${String(getConfigValue(config, key))}`);
  line('');
  line('Restart PingBack for changes to take effect:');
  line('');
  line('    pingback stop && pingback start');
}
