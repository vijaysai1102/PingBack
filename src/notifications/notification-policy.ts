import path from 'node:path';
import type { RoutedEvent } from '../core/event-router.js';
import type { NotificationConfig } from '../config/config-manager.js';
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

/**
 * Every enabled v0.2 notification event plays sound unless the user disables
 * sound globally. Event priorities still determine which bundled tone is used.
 */
export function shouldPlaySound(
  priority: RoutedEvent['priority'],
  config: NotificationConfig,
): boolean {
  void priority;
  return config.sound.enabled;
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

function eventSettings(
  routed: RoutedEvent,
  config: NotificationConfig,
): {
  enabled: boolean;
  delaySeconds: number;
} {
  switch (routed.event.type) {
    case 'question':
      return config.events.question;
    case 'turn_completion':
      return config.events.turn_completion;
    case 'error':
      return config.events.error;
    case 'task_completed':
      return config.events.task_completed;
    case 'attention_required':
      // Permission and input prompts are explicitly blocking, so they do not
      // inherit the normal completion delay.
      return { enabled: true, delaySeconds: 0 };
  }
}

export function buildNotification(
  routed: RoutedEvent,
  config: NotificationConfig,
): NotificationRequest | undefined {
  if (!config.enabled) return undefined;
  const settings = eventSettings(routed, config);
  if (!settings.enabled) return undefined;

  const project = projectName(routed.session.cwd ?? routed.event.cwd);

  return {
    title: routed.event.title,
    message: routed.event.message,
    priority: routed.priority,
    project,
    sound: shouldPlaySound(routed.priority, config),
    volume: config.sound.volume,
    delaySeconds: settings.delaySeconds,
  };
}
