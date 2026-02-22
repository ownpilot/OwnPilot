/**
 * Tool Max Limits Registry
 *
 * Centralized upper limits for tools that return lists/collections.
 * These caps are enforced in the use_tool proxy to prevent unbounded queries,
 * regardless of what the LLM requests.
 *
 * Format: tool_name → { paramName, maxValue, defaultValue }
 * - paramName: the argument key that controls result count
 * - maxValue: absolute upper cap (enforced even if LLM asks for more)
 * - defaultValue: used when LLM omits the parameter
 */

import { getBaseName } from '../tool-namespace.js';

export interface ToolLimit {
  /** Name of the parameter that controls result count */
  readonly paramName: string;
  /** Absolute maximum allowed value */
  readonly maxValue: number;
  /** Default value when parameter is omitted */
  readonly defaultValue: number;
}

export const TOOL_MAX_LIMITS: Record<string, ToolLimit> = {
  // ─────────────────────────────────────────────
  // EMAIL
  // ─────────────────────────────────────────────
  list_emails: { paramName: 'limit', maxValue: 50, defaultValue: 20 },
  search_emails: { paramName: 'limit', maxValue: 100, defaultValue: 50 },

  // ─────────────────────────────────────────────
  // PERSONAL DATA (tasks, notes, calendar, contacts, bookmarks)
  // ─────────────────────────────────────────────
  list_tasks: { paramName: 'limit', maxValue: 50, defaultValue: 20 },
  list_notes: { paramName: 'limit', maxValue: 50, defaultValue: 20 },
  list_calendar_events: { paramName: 'limit', maxValue: 50, defaultValue: 20 },
  list_contacts: { paramName: 'limit', maxValue: 50, defaultValue: 20 },
  list_bookmarks: { paramName: 'limit', maxValue: 50, defaultValue: 20 },

  // ─────────────────────────────────────────────
  // EXPENSES
  // ─────────────────────────────────────────────
  query_expenses: { paramName: 'limit', maxValue: 100, defaultValue: 50 },

  // ─────────────────────────────────────────────
  // MEMORY
  // ─────────────────────────────────────────────
  search_memories: { paramName: 'limit', maxValue: 50, defaultValue: 10 },
  list_memories: { paramName: 'limit', maxValue: 50, defaultValue: 20 },

  // ─────────────────────────────────────────────
  // GOALS
  // ─────────────────────────────────────────────
  list_goals: { paramName: 'limit', maxValue: 30, defaultValue: 10 },
  get_next_actions: { paramName: 'limit', maxValue: 20, defaultValue: 5 },

  // ─────────────────────────────────────────────
  // CUSTOM DATA
  // ─────────────────────────────────────────────
  list_custom_records: { paramName: 'limit', maxValue: 50, defaultValue: 20 },
  search_custom_records: { paramName: 'limit', maxValue: 50, defaultValue: 20 },

  // ─────────────────────────────────────────────
  // GIT
  // ─────────────────────────────────────────────
  git_log: { paramName: 'limit', maxValue: 50, defaultValue: 10 },

  // ─────────────────────────────────────────────
  // FILE SYSTEM
  // ─────────────────────────────────────────────
  search_files: { paramName: 'maxResults', maxValue: 100, defaultValue: 50 },

  // ─────────────────────────────────────────────
  // WEB SEARCH
  // ─────────────────────────────────────────────
  search_web: { paramName: 'maxResults', maxValue: 20, defaultValue: 10 },
};

/**
 * Apply limit caps to tool arguments.
 * Ensures the limit parameter doesn't exceed the configured max,
 * and applies the default if the parameter is missing.
 *
 * @returns A new args object with the capped limit (original is not mutated)
 */
export function applyToolLimits(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const limit = TOOL_MAX_LIMITS[toolName] ?? TOOL_MAX_LIMITS[getBaseName(toolName)];
  if (!limit) return args;

  const currentValue = args[limit.paramName];
  const numValue = currentValue != null ? Number(currentValue) : undefined;

  if (numValue == null || isNaN(numValue)) {
    // Parameter not provided or invalid → apply default
    return { ...args, [limit.paramName]: limit.defaultValue };
  }

  if (numValue > limit.maxValue) {
    // Cap to max
    return { ...args, [limit.paramName]: limit.maxValue };
  }

  // Value is within range
  return args;
}
