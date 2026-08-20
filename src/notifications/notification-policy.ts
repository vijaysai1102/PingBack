import path from 'node:path';
import type { RoutedEvent } from '../core/event-router.js';
import type { NotificationRequest } from './notification-service.js';
import type { SoundName } from './sound-service.js';
import type { EventPriority } from '../core/types.js';

/**
 * Derives a display name for the workspace from its directory.
 * Works for both path flavours so a macOS path is readable on Windows logs.
 */
export function projectName(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd.trim().length === 0) return undefined;

  const normalized = cwd.replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/);
  const last = segments[segments.length - 1];

  if (last === undefined || last.length === 0) return undefined;
  // A bare drive root such as "C:" is not a useful project name.
  if (/^[A-Za-z]:$/.test(last)) return undefined;

  return path.basename(last);
}

export interface NotificationPolicyConfig {
  desktop?: boolean;
  sound?: boolean;
}

/**
 * Low-priority events (task completions) are silent by default so PingBack
 * stays unobtrusive; anything that blocks the developer gets a sound.
 */
export function shouldPlaySound(
  priority: RoutedEvent['priority'],
  config: NotificationPolicyConfig,
): boolean {
  if (!config.sound) return false;
  return priority !== 'low';
}

/** Each priority gets a distinct tone so the reason is audible without looking. */
export function soundForPriority(priority: EventPriority): SoundName {
  switch (priority) {
    case 'high':
      return 'attention';
    case 'medium':
      return 'error';
    case 'low':
      return 'completion';
  }
}

export function buildNotification(
  routed: RoutedEvent,
  config: NotificationPolicyConfig,
): NotificationRequest | undefined {
  if (!config.desktop) return undefined;

  const project = projectName(routed.session?.cwd ?? routed.event.cwd);

  return {
    title: routed.event.title,
    message: routed.event.message,
    priority: routed.priority,
    project,
    sound: shouldPlaySound(routed.priority, config),
  };
}
