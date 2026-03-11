/**
 * Command Interceptor — Slash Command Parser
 *
 * Detects and parses slash commands from user messages.
 * Only intercepts when the message STARTS with "/".
 */

import type { ParsedCommand } from './types.ts';

/**
 * Regex for slash command detection:
 * - Must start with /
 * - Command name: alphanumeric, underscores, hyphens, colons (for skill namespaces like gsd:health)
 * - Optional args after whitespace
 * - [\s\S]* instead of .* to support multiline args
 */
const COMMAND_REGEX = /^\/([a-zA-Z0-9_:-]+)(?:\s+([\s\S]*))?$/;

/**
 * Parse a slash command from a message.
 *
 * Rules:
 * - Only first-position slash is intercepted: "/rename foo" → parsed
 * - Mid-message slash is NOT intercepted: "please /rename" → null
 * - Empty command name is rejected: "/" → null
 * - Command names are case-insensitive (lowercased)
 * - Args are trimmed but preserve internal whitespace
 *
 * @returns ParsedCommand if message is a slash command, null otherwise
 */
export function parseCommand(message: string): ParsedCommand | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) return null;

  const match = trimmed.match(COMMAND_REGEX);
  if (!match) return null;

  return {
    name: match[1].toLowerCase(),
    args: (match[2] ?? '').trim(),
  };
}
