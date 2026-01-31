/**
 * Tool Providers
 *
 * Each provider groups related tool definitions with their gateway executors.
 * Used by getSharedToolRegistry() via ToolRegistry.registerProvider().
 */

import type { ToolDefinition, ToolExecutionResult, ToolProvider } from '@ownpilot/core';
import {
  MEMORY_TOOLS,
  GOAL_TOOLS,
  CUSTOM_DATA_TOOLS,
  PERSONAL_DATA_TOOLS,
} from '@ownpilot/core';
import { executeMemoryTool } from '../../routes/memories.js';
import { executeGoalTool } from '../../routes/goals.js';
import { executeCustomDataTool } from '../../routes/custom-data.js';
import { executePersonalDataTool } from '../../routes/personal-data-tools.js';
import { TRIGGER_TOOLS, executeTriggerTool, PLAN_TOOLS, executePlanTool } from '../../tools/index.js';

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
  userId?: string,
) => Promise<GatewayToolResult>;

function wrapGatewayExecutor(
  toolDef: ToolDefinition,
  execute: GatewayExecutor,
  userId?: string,
): (args: Record<string, unknown>) => Promise<ToolExecutionResult> {
  return async (args): Promise<ToolExecutionResult> => {
    const result = await execute(toolDef.name, args, userId);
    if (result.success) {
      return {
        content: typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result, null, 2),
      };
    }
    return { content: result.error ?? 'Unknown error', isError: true };
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
    getTools: () => MEMORY_TOOLS.map((def) => ({
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
    getTools: () => GOAL_TOOLS.map((def) => ({
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
    getTools: () => CUSTOM_DATA_TOOLS.map((def) => ({
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
    getTools: () => PERSONAL_DATA_TOOLS.map((def) => ({
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
    getTools: () => TRIGGER_TOOLS.map((def) => ({
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
    getTools: () => PLAN_TOOLS.map((def) => ({
      definition: def,
      executor: wrapGatewayExecutor(def, executePlanTool),
    })),
  };
}
