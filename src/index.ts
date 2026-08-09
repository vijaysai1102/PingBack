export {
  createPlatform,
  readHostInfo,
  isSupportedPlatform,
} from './platform/platform.js';
export type {
  Platform,
  PlatformId,
  PlatformPaths,
  HostInfo,
} from './platform/platform.js';
export {
  PingBackError,
  UnsupportedPlatformError,
  isPingBackError,
} from './utils/errors.js';
export type { PingBackErrorCode } from './utils/errors.js';
export { packageVersion, packageRoot, assetPath } from './utils/paths.js';
