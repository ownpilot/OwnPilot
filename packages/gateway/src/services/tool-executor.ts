/**
 * Shared Tool Executor Service
 *
 * Provides a reusable tool execution capability for triggers, plans,
 * and any other system that needs to run tools outside of a chat session.
 * Creates and caches a ToolRegistry with all tools registered.
 * Also bridges plugin tools from the PluginRegistry as a fallback.
 */

import {
  ToolRegistry,
  registerAllTools,
  MEMORY_TOOLS,
  GOAL_TOOLS,
  CUSTOM_DATA_TOOLS,
  PERSONAL_DATA_TOOLS,
  type ToolExecutionResult as CoreToolResult,
} from '@ownpilot/core';
import { executeMemoryTool } from '../routes/memories.js';
import { executeGoalTool } from '../routes/goals.js';
import { executeCustomDataTool } from '../routes/custom-data.js';
import { executePersonalDataTool } from '../routes/personal-data-tools.js';
import { TRIGGER_TOOLS, executeTriggerTool, PLAN_TOOLS, executePlanTool } from '../tools/index.js';
import { gatewayConfigCenter as gatewayApiKeyCenter } from './config-center-impl.js';
import { getDefaultPluginRegistry } from '../plugins/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ============================================================================
// Shared ToolRegistry
// ============================================================================

let sharedRegistry: ToolRegistry | null = null;

/**
 * Get or create a shared ToolRegistry with all tools registered.
 * This registry can be used by triggers, plans, and other systems
 * that need to execute tools outside of a chat session.
 */
export function getSharedToolRegistry(userId = 'default'): ToolRegistry {
  if (sharedRegistry) return sharedRegistry;

  const tools = new ToolRegistry();

  // Register all core tools (file system, code exec, web fetch, etc.)
  registerAllTools(tools);
  tools.setApiKeyCenter(gatewayApiKeyCenter);

  // Register memory tools with gateway executors
  for (const toolDef of MEMORY_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const result = await executeMemoryTool(toolDef.name, args as Record<string, unknown>, userId);
      if (result.success) {
        return {
          content: typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result, null, 2),
        };
      }
      return { content: result.error ?? 'Unknown error', isError: true };
    });
  }

  // Register goal tools
  for (const toolDef of GOAL_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const result = await executeGoalTool(toolDef.name, args as Record<string, unknown>, userId);
      if (result.success) {
        return {
          content: typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result, null, 2),
        };
      }
      return { content: result.error ?? 'Unknown error', isError: true };
    });
  }

  // Register custom data tools
  for (const toolDef of CUSTOM_DATA_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const result = await executeCustomDataTool(toolDef.name, args as Record<string, unknown>);
      if (result.success) {
        return {
          content: typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result, null, 2),
        };
      }
      return { content: result.error ?? 'Unknown error', isError: true };
    });
  }

  // Register personal data tools
  for (const toolDef of PERSONAL_DATA_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const result = await executePersonalDataTool(toolDef.name, args as Record<string, unknown>);
      if (result.success) {
        return {
          content: typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result, null, 2),
        };
      }
      return { content: result.error ?? 'Unknown error', isError: true };
    });
  }

  // Register trigger tools
  for (const toolDef of TRIGGER_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const result = await executeTriggerTool(toolDef.name, args as Record<string, unknown>);
      if (result.success) {
        return {
          content: typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result, null, 2),
        };
      }
      return { content: result.error ?? 'Unknown error', isError: true };
    });
  }

  // Register plan tools
  for (const toolDef of PLAN_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const result = await executePlanTool(toolDef.name, args as Record<string, unknown>);
      if (result.success) {
        return {
          content: typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result, null, 2),
        };
      }
      return { content: result.error ?? 'Unknown error', isError: true };
    });
  }

  sharedRegistry = tools;
  return tools;
}

/**
 * Try to find and execute a tool from the PluginRegistry.
 * Falls back to this when tool is not found in the shared registry.
 */
async function executePluginTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult | null> {
  try {
    const pluginRegistry = await getDefaultPluginRegistry();
    const pluginTool = pluginRegistry.getTool(toolName);
    if (!pluginTool) return null;

    const context = {
      callId: `plan-${Date.now()}`,
      conversationId: 'system-execution',
      pluginId: pluginTool.plugin.manifest.id,
    } as const;
    const result = await pluginTool.executor(args, context as any);
    return {
      success: !result.isError,
      result: result.content,
      error: result.isError ? String(result.content) : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Plugin tool execution failed',
    };
  }
}

/**
 * Check if a tool exists in the PluginRegistry.
 */
async function hasPluginTool(toolName: string): Promise<boolean> {
  try {
    const pluginRegistry = await getDefaultPluginRegistry();
    return !!pluginRegistry.getTool(toolName);
  } catch {
    return false;
  }
}

/**
 * Execute a tool by name with arguments.
 * Checks the shared registry first, then falls back to plugin tools.
 * Returns a standardized result object.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult> {
  const tools = getSharedToolRegistry(userId);

  // Try shared registry first
  if (tools.has(toolName)) {
    try {
      const result = await tools.execute(toolName, args, {
        conversationId: 'system-execution',
      });

      if (result.ok) {
        const value = result.value;
        return {
          success: !value.isError,
          result: value.content,
          error: value.isError ? String(value.content) : undefined,
        };
      }

      return {
        success: false,
        error: result.error.message,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed',
      };
    }
  }

  // Fallback: try plugin tools
  const pluginResult = await executePluginTool(toolName, args);
  if (pluginResult) {
    return pluginResult;
  }

  return {
    success: false,
    error: `Tool '${toolName}' not found in shared registry or plugins`,
  };
}

/**
 * Check if a tool exists in the shared registry or plugin registry.
 */
export async function hasTool(toolName: string): Promise<boolean> {
  const tools = getSharedToolRegistry();
  if (tools.has(toolName)) return true;
  return hasPluginTool(toolName);
}

/**
 * Reset the shared registry (for testing or reinitialization).
 */
export function resetSharedToolRegistry(): void {
  sharedRegistry = null;
}
