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
// Route executor imports are lazy to break the circular dependency:
// tool-providers/index.ts → routes/*.ts → tool-executor.ts → provider-manifest.ts → tool-providers/index.ts
import {
  TRIGGER_TOOLS,
  executeTriggerTool,
  PLAN_TOOLS,
  executePlanTool,
  HEARTBEAT_TOOLS,
  executeHeartbeatTool,
  EXTENSION_TOOLS,
  executeExtensionTool,
  SOUL_COMMUNICATION_TOOLS,
  executeSoulCommunicationTool,
  CODING_AGENT_TOOLS,
  executeCodingAgentTool,
  CLI_TOOL_TOOLS,
  executeCliToolTool,
  BACKGROUND_AGENT_TOOLS,
  executeBackgroundAgentTool,
  SUBAGENT_TOOLS,
  executeSubagentTool,
  ORCHESTRA_TOOL_DEFINITIONS,
  executeOrchestraTool,
  ARTIFACT_TOOLS,
  executeArtifactTool,
  BROWSER_TOOLS,
  executeBrowserTool,
  EDGE_TOOLS,
  executeEdgeTool,
  SKILL_TOOLS,
  executeSkillTool,
  FLEET_TOOLS,
  executeFleetTool,
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
// Lazy executor helpers (break circular dependency with route files)
// ============================================================================

function lazyRouteExecutor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  importFn: () => Promise<any>,
  exportName: string
): GatewayExecutor {
  let importPromise: Promise<GatewayExecutor> | undefined;
  return async (toolName, args, userId) => {
    if (!importPromise) {
      importPromise = importFn().then((mod) => mod[exportName] as GatewayExecutor);
    }
    const executor = await importPromise;
    return executor(toolName, args, userId);
  };
}

// ============================================================================
// Concrete Providers
// ============================================================================

/**
 * Create a provider for memory tools (requires userId)
 */
export function createMemoryToolProvider(userId: string): ToolProvider {
  const executor = lazyRouteExecutor(() => import('../../routes/memories.js'), 'executeMemoryTool');
  return {
    name: 'memory',
    getTools: () =>
      MEMORY_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executor, userId),
      })),
  };
}

/**
 * Create a provider for goal tools (requires userId)
 */
export function createGoalToolProvider(userId: string): ToolProvider {
  const executor = lazyRouteExecutor(() => import('../../routes/goals.js'), 'executeGoalTool');
  return {
    name: 'goal',
    getTools: () =>
      GOAL_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executor, userId),
      })),
  };
}

/**
 * Create a provider for custom data tools
 */
export function createCustomDataToolProvider(): ToolProvider {
  const executor = lazyRouteExecutor(
    () => import('../../routes/custom-data.js'),
    'executeCustomDataTool'
  );
  return {
    name: 'custom-data',
    getTools: () =>
      CUSTOM_DATA_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executor),
      })),
  };
}

/**
 * Create a provider for personal data tools
 */
export function createPersonalDataToolProvider(): ToolProvider {
  const executor = lazyRouteExecutor(
    () => import('../../routes/personal-data-tools.js'),
    'executePersonalDataTool'
  );
  return {
    name: 'personal-data',
    getTools: () =>
      PERSONAL_DATA_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executor),
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

/**
 * Create a provider for coding agent tools (requires userId)
 */
export function createCodingAgentToolProvider(userId: string): ToolProvider {
  return {
    name: 'coding-agent',
    getTools: () =>
      CODING_AGENT_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeCodingAgentTool, userId),
      })),
  };
}

/**
 * Create a provider for CLI tool execution tools (requires userId)
 */
export function createCliToolProvider(userId: string): ToolProvider {
  return {
    name: 'cli-tools',
    getTools: () =>
      CLI_TOOL_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeCliToolTool, userId),
      })),
  };
}

/**
 * Create a provider for background agent tools (requires userId)
 */
export function createBackgroundAgentToolProvider(userId: string): ToolProvider {
  return {
    name: 'background-agent',
    getTools: () =>
      BACKGROUND_AGENT_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeBackgroundAgentTool, userId),
      })),
  };
}

/**
 * Create a provider for subagent tools (requires userId).
 * Uses a custom wrapper because executeSubagentTool needs conversationId from ToolContext.
 */
export function createSubagentToolProvider(userId: string): ToolProvider {
  return {
    name: 'subagent',
    getTools: () =>
      SUBAGENT_TOOLS.map((def) => ({
        definition: def,
        executor: async (
          args: Record<string, unknown>,
          context: ToolContext
        ): Promise<ToolExecutionResult> => {
          try {
            const effectiveUserId = context?.userId ?? userId;
            const conversationId = context?.conversationId;
            const result = await executeSubagentTool(
              def.name,
              args,
              effectiveUserId,
              conversationId
            );
            if (result.success) {
              const content =
                typeof result.result === 'string'
                  ? result.result
                  : JSON.stringify(result.result, null, 2);
              return { content };
            }
            return { content: result.error ?? 'Unknown error', isError: true };
          } catch (err) {
            return { content: getErrorMessage(err, 'Tool execution failed'), isError: true };
          }
        },
      })),
  };
}

/**
 * Create a provider for orchestra tools (requires userId).
 * Uses custom wrapper because executeOrchestraTool needs conversationId from ToolContext.
 */
export function createOrchestraToolProvider(userId: string): ToolProvider {
  return {
    name: 'orchestra',
    getTools: () =>
      ORCHESTRA_TOOL_DEFINITIONS.map((def) => ({
        definition: def,
        executor: async (
          args: Record<string, unknown>,
          context: ToolContext
        ): Promise<ToolExecutionResult> => {
          try {
            const effectiveUserId = context?.userId ?? userId;
            const conversationId = context?.conversationId ?? 'unknown';
            const result = await executeOrchestraTool(
              def.name,
              args,
              effectiveUserId,
              conversationId
            );
            if (result.success) {
              const content =
                typeof result.result === 'string'
                  ? result.result
                  : JSON.stringify(result.result, null, 2);
              return { content };
            }
            return { content: result.error ?? 'Unknown error', isError: true };
          } catch (err) {
            return { content: getErrorMessage(err, 'Tool execution failed'), isError: true };
          }
        },
      })),
  };
}

/**
 * Create a provider for artifact tools (requires userId).
 * Uses custom wrapper because executeArtifactTool needs conversationId from ToolContext.
 */
export function createArtifactToolProvider(userId: string): ToolProvider {
  return {
    name: 'artifact',
    getTools: () =>
      ARTIFACT_TOOLS.map((def) => ({
        definition: def,
        executor: async (
          args: Record<string, unknown>,
          context: ToolContext
        ): Promise<ToolExecutionResult> => {
          try {
            const effectiveUserId = context?.userId ?? userId;
            const conversationId = context?.conversationId ?? '';
            const result = await executeArtifactTool(
              def.name,
              args,
              effectiveUserId,
              conversationId
            );
            if (result.success) {
              const content =
                typeof result.result === 'string'
                  ? result.result
                  : JSON.stringify(result.result, null, 2);
              return { content };
            }
            return { content: result.error ?? 'Unknown error', isError: true };
          } catch (err) {
            return { content: getErrorMessage(err, 'Tool execution failed'), isError: true };
          }
        },
      })),
  };
}

/**
 * Create a provider for browser automation tools (requires userId).
 */
export function createBrowserToolProvider(userId: string): ToolProvider {
  return {
    name: 'browser',
    getTools: () =>
      BROWSER_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeBrowserTool, userId),
      })),
  };
}

/**
 * Create a provider for edge device tools (requires userId).
 */
export function createEdgeToolProvider(userId: string): ToolProvider {
  return {
    name: 'edge',
    getTools: () =>
      EDGE_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeEdgeTool, userId),
      })),
  };
}

/**
 * Create a provider for soul communication tools (requires userId).
 */
export function createSoulCommunicationToolProvider(userId: string): ToolProvider {
  return {
    name: 'soul-communication',
    getTools: () =>
      SOUL_COMMUNICATION_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeSoulCommunicationTool, userId),
      })),
  };
}

/**
 * Create a provider for skill management tools (requires userId).
 */
export function createSkillToolProvider(userId: string): ToolProvider {
  return {
    name: 'skill',
    getTools: () =>
      SKILL_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeSkillTool, userId),
      })),
  };
}

/**
 * Create a provider for fleet management tools (requires userId).
 */
export function createFleetToolProvider(userId: string): ToolProvider {
  return {
    name: 'fleet',
    getTools: () =>
      FLEET_TOOLS.map((def) => ({
        definition: def,
        executor: wrapGatewayExecutor(def, executeFleetTool, userId),
      })),
  };
}
