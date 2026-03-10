/**
 * Command Interceptor — Type Definitions
 *
 * Types for the bridge-side slash command handling system.
 * Commands are intercepted before reaching CC, handled in bridge memory.
 */

import type { SessionInfo, SessionConfigOverrides, DiskSessionEntry } from '../types.ts';

// Re-export root types used by handlers
export type { SessionConfigOverrides, DiskSessionEntry } from '../types.ts';

/**
 * Result of parsing a slash command from user input.
 */
export interface ParsedCommand {
  /** Command name without the leading slash (e.g., "rename", "model") */
  name: string;
  /** Everything after the command name, trimmed */
  args: string;
}

/**
 * Context passed to command handlers.
 * Provides access to session info and bridge state.
 * Service callbacks are bound to the current conversationId by router.ts.
 */
export interface CommandContext {
  conversationId: string;
  projectDir: string;
  /** Session info if an active session exists. Null for first-time conversations. */
  sessionInfo: SessionInfo | null;

  // --- Service callbacks (Phase 2) ---
  /** Store per-session config overrides for next CC spawn. */
  setConfigOverrides: (overrides: Partial<SessionConfigOverrides>) => void;
  /** Retrieve current per-session config overrides. */
  getConfigOverrides: () => SessionConfigOverrides;
  /** Terminate the current session. */
  terminate: () => void;
  /** Set a display name for the session (bridge memory only). */
  setDisplayName: (name: string) => void;
  /** Get the current display name (null if not set). */
  getDisplayName: () => string | null;
  /** List CC sessions stored on disk. */
  listDiskSessions: (projectDir?: string) => Promise<DiskSessionEntry[]>;
  /** Get the file path to the session JSONL (null if no session). */
  getSessionJsonlPath: () => string | null;
}

/**
 * Result returned by a command handler.
 */
export interface CommandResult {
  /** True if the command was fully handled (returns synthetic response). */
  handled: boolean;
  /** Response text to return to the user (when handled=true). */
  response?: string;
  /**
   * If set, replaces the original message before sending to CC.
   * Used by delegate commands (e.g., /compact → natural language).
   * Only used when handled=false.
   */
  transformedMessage?: string;
}

/**
 * Function signature for command handlers.
 */
export type CommandHandler = (
  args: string,
  ctx: CommandContext,
) => Promise<CommandResult>;

/**
 * Full command definition for registry registration.
 */
export interface CommandDefinition {
  name: string;
  description: string;
  usage?: string;
  category: 'info' | 'session' | 'config' | 'noop' | 'delegate';
  handler: CommandHandler;
}
