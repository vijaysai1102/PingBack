import type { AgentSession } from '../core/types.js';
import type { Platform } from './platform.js';
import { MacosTerminalFocusService } from './macos/terminal-focus.js';
import { WindowsTerminalFocusService } from './windows/terminal-focus.js';

export interface TerminalInfo {
  processId: number;
  processName: string;
  windowId?: string | undefined;
  tty?: string | undefined;
}

export interface TerminalFocusResult {
  focused: boolean;
  message: string;
  terminal?: TerminalInfo | undefined;
}

export interface TerminalFocusService {
  detectTerminal(
    session: Pick<AgentSession, 'pid' | 'cwd'>,
  ): Promise<TerminalInfo | undefined>;
  focusTerminal(session: Pick<AgentSession, 'pid' | 'cwd'>): Promise<TerminalFocusResult>;
}

export function focusFallback(cwd: string | undefined): TerminalFocusResult {
  return {
    focused: false,
    message: `Unable to focus this agent terminal. Open project: ${cwd ?? 'unknown'}`,
  };
}

/** Safe fallback for unsupported or unavailable platform focus implementations. */
export class UnavailableTerminalFocusService implements TerminalFocusService {
  detectTerminal(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  focusTerminal(
    session: Pick<AgentSession, 'pid' | 'cwd'>,
  ): Promise<TerminalFocusResult> {
    return Promise.resolve(focusFallback(session.cwd));
  }
}

/** Keeps platform selection out of PingBack Core. */
export function createTerminalFocusService(platform: Platform): TerminalFocusService {
  switch (platform.id) {
    case 'windows':
      return new WindowsTerminalFocusService();
    case 'macos':
      return new MacosTerminalFocusService();
  }
}

export { MacosTerminalFocusService, WindowsTerminalFocusService };
