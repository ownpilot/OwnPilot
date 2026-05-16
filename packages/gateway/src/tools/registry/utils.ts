/**
 * Tool Registry — Shared Utilities
 *
 *  - safeStringArray         — defensive cast for DB JSON fields
 *  - PLUGIN_SUPERSEDES_CORE  — plugin tool → core stub names it replaces
 *  - removeSupersededCoreStubs — unregister those stubs once a plugin loads
 *  - toToolResult            — gateway exec result → CoreToolResult
 *  - findSimilarTools        — 2-arg wrapper over core's 3-arg helper
 *  - ToolExecutor / ToolGroup types
 */

import type { ToolRegistry } from '@ownpilot/core';
import {
  findSimilarToolNames,
  type ToolExecutionResult as CoreToolResult,
  type ToolDefinition,
} from '@ownpilot/core';

/** Safely extract a string[] from unknown config values (DB records, etc.) */
export function safeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Maps plugin tool names to the core stub tool names they supersede.
 * When a plugin provides a real implementation, the corresponding core stubs
 * are unregistered to prevent the LLM from seeing duplicate tools.
 */
export const PLUGIN_SUPERSEDES_CORE: Record<string, string[]> = {
  email_send: ['send_email'],
  email_read: ['list_emails', 'read_email'],
  email_search: ['search_emails'],
  email_delete: ['delete_email', 'reply_email'],
  weather_current: ['get_weather'],
  weather_forecast: ['get_weather_forecast'],
  web_search: ['search_web'],
};

/**
 * Removes core stub tools that are superseded by plugin tools.
 * Returns the number of stubs removed.
 */
export function removeSupersededCoreStubs(
  tools: ToolRegistry,
  pluginToolNames: Set<string>
): number {
  let removed = 0;
  for (const [pluginTool, coreStubs] of Object.entries(PLUGIN_SUPERSEDES_CORE)) {
    if (pluginToolNames.has(pluginTool)) {
      for (const stub of coreStubs) {
        if (tools.unregister(stub)) {
          removed++;
        }
      }
    }
  }
  return removed;
}

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  userId?: string
) => Promise<{ success: boolean; result?: unknown; error?: string }>;

export interface ToolGroup {
  definitions: readonly ToolDefinition[];
  executor: ToolExecutor;
  needsUserId: boolean;
}

/**
 * Convert a gateway tool execution result into the CoreToolResult shape
 * (single-string `content`, optional `isError`).
 */
export function toToolResult(result: {
  success: boolean;
  result?: unknown;
  error?: string;
}): CoreToolResult {
  if (result.success) {
    return {
      content:
        typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2),
    };
  }
  return { content: result.error ?? 'Unknown error', isError: true };
}

/** Compatibility wrapper: old 2-arg signature → new 3-arg from core */
export function findSimilarTools(tools: ToolRegistry, query: string): string[] {
  return findSimilarToolNames(tools, query, 5);
}
