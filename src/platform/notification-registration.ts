import type { Platform } from './platform.js';
import { ensureWindowsToastRegistration } from './windows/notification-registration.js';

/** Ensures the platform has the native registration needed for PingBack toasts. */
export async function ensureNotificationRegistration(
  platform: Platform,
): Promise<boolean> {
  if (platform.id === 'windows') return ensureWindowsToastRegistration();
  return true;
}
