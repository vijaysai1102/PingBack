import {
  CONFIG_KEYS,
  ConfigManager,
  getConfigValue,
  isConfigKey,
  isConfigPath,
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
  for (const key of CONFIG_KEYS) {
    line(`${key} = ${String(getConfigValue(config, key))}`);
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

export function runConfigGet(key: string): void {
  if (!isConfigPath(key)) {
    throw new PingBackError(`Unknown config key: ${key}`, {
      code: 'INVALID_CONFIG',
      hint: `Available keys:\n\n    ${CONFIG_KEYS.join('\n    ')}\n    notifications`,
    });
  }

  const configManager = manager();
  const { config, warnings } = configManager.load();
  const value = getConfigValue(config, key);

  line(
    typeof value === 'object' && value !== null
      ? JSON.stringify(value, null, 2)
      : String(value),
  );

  for (const message of warnings) warn(message);
}
