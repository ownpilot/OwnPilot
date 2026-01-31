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
  registerCoreTools,
} from '@ownpilot/core';
import { gatewayConfigCenter as gatewayApiKeyCenter } from './config-center-impl.js';
import { getDefaultPluginRegistry } from '../plugins/index.js';
import {
  createMemoryToolProvider,
  createGoalToolProvider,
  createCustomDataToolProvider,
  createPersonalDataToolProvider,
  createTriggerToolProvider,
  createPlanToolProvider,
} from './tool-providers/index.js';

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

  // Register all modular tools (file system, code exec, web fetch, etc.)
  registerAllTools(tools);

  // Register legacy core tools (get_current_time, calculate, etc.)
  // Duplicates are safely ignored by ToolRegistry
  registerCoreTools(tools);

  tools.setApiKeyCenter(gatewayApiKeyCenter);

  // Register gateway tool providers
  tools.registerProvider(createMemoryToolProvider(userId));
  tools.registerProvider(createGoalToolProvider(userId));
  tools.registerProvider(createCustomDataToolProvider());
  tools.registerProvider(createPersonalDataToolProvider());
  tools.registerProvider(createTriggerToolProvider());
  tools.registerProvider(createPlanToolProvider());

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
