/**
 * Tool Providers
 *
 * Each provider groups related tool definitions with their gateway executors.
 * Used by getSharedToolRegistry() via ToolRegistry.registerProvider().
 */

import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolProvider,
  ToolContext,
} from '@ownpilot/core';
import { MEMORY_TOOLS, GOAL_TOOLS, CUSTOM_DATA_TOOLS, PERSONAL_DATA_TOOLS } from '@ownpilot/core';
import { executeMemoryTool } from '../../routes/memories.js';
import { executeGoalTool } from '../../routes/goals.js';
import { executeCustomDataTool } from '../../routes/custom-data.js';
import { executePersonalDataTool } from '../../routes/personal-data-tools.js';
import {
  TRIGGER_TOOLS,
  executeTriggerTool,
  PLAN_TOOLS,
  executePlanTool,
  HEARTBEAT_TOOLS,
  executeHeartbeatTool,
  EXTENSION_TOOLS,
  executeExtensionTool,
} from '../../tools/index.js';
import { CONFIG_TOOLS, executeConfigTool } from '../config-tools.js';
import { getErrorMessage } from '../../routes/helpers.js';

// ============================================================================
// Result type from gateway executors
// ============================================================================

interface GatewayToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ============================================================================
// Helper: wrap gateway executor into a ToolExecutor
// ============================================================================

type GatewayExecutor = (
  toolName: string,
  args: Record<string, unknown>,
  userId?: string
) => Promise<GatewayToolResult>;

function wrapGatewayExecutor(
  toolDef: ToolDefinition,
  execute: GatewayExecutor,
  fallbackUserId?: string
): (args: Record<string, unknown>, context: ToolContext) => Promise<ToolExecutionResult> {
  return async (args, context): Promise<ToolExecutionResult> => {
    try {
      // Prefer userId from execution context (supports multi-user),
      // fall back to the userId captured at provider creation time.
      const effectiveUserId = context?.userId ?? fallbackUserId;
      const result = await execute(toolDef.name, args, effectiveUserId);
      if (result.success) {
        let content: string;
        try {
          content =
            typeof result.result === 'string'
              ? result.result
              : JSON.stringify(result.result, null, 2);
        } catch {
          content = String(result.result);
        }
        return { content };
      }
      return { content: result.error ?? 'Unknown error', isError: true };
    } catch (err) {
      return { content: getErrorMessage(err, 'Tool execution failed'), isError: true };
    }
  };
}

// ============================================================================
// Concrete Providers
// ============================================================================

/**
 * Create a provider for memory tools (requires userId)
 */
export function createMemoryToolProvider(userId: string): ToolProvider {
  return {
    name: 'memory',
    getTools: () =>
      MEMORY_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeMemoryTool, userId),
      })),
  };
}

/**
 * Create a provider for goal tools (requires userId)
 */
export function createGoalToolProvider(userId: string): ToolProvider {
  return {
    name: 'goal',
    getTools: () =>
      GOAL_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeGoalTool, userId),
      })),
  };
}

/**
 * Create a provider for custom data tools
 */
export function createCustomDataToolProvider(): ToolProvider {
  return {
    name: 'custom-data',
    getTools: () =>
      CUSTOM_DATA_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeCustomDataTool),
      })),
  };
}

/**
 * Create a provider for personal data tools
 */
export function createPersonalDataToolProvider(): ToolProvider {
  return {
    name: 'personal-data',
    getTools: () =>
      PERSONAL_DATA_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executePersonalDataTool),
      })),
  };
}

/**
 * Create a provider for trigger tools
 */
export function createTriggerToolProvider(): ToolProvider {
  return {
    name: 'trigger',
    getTools: () =>
      TRIGGER_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeTriggerTool),
      })),
  };
}

/**
 * Create a provider for plan tools
 */
export function createPlanToolProvider(): ToolProvider {
  return {
    name: 'plan',
    getTools: () =>
      PLAN_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executePlanTool),
      })),
  };
}

/**
 * Create a provider for config center tools
 */
export function createConfigToolProvider(): ToolProvider {
  return {
    name: 'config',
    getTools: () =>
      CONFIG_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeConfigTool as GatewayExecutor),
      })),
  };
}

/**
 * Create a provider for heartbeat tools (requires userId)
 */
export function createHeartbeatToolProvider(userId: string): ToolProvider {
  return {
    name: 'heartbeat',
    getTools: () =>
      HEARTBEAT_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeHeartbeatTool, userId),
      })),
  };
}

/**
 * Create a provider for extension management tools (requires userId)
 */
export function createExtensionToolProvider(userId: string): ToolProvider {
  return {
    name: 'extension',
    getTools: () =>
      EXTENSION_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeExtensionTool, userId),
      })),
  };
}
