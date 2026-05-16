/**
 * Core Tool Registration
 *
 *  - registerGatewayTools  — gateway domain tools (memory, goals, custom-data,
 *                            personal-data, config, triggers, plans, soul-comms,
 *                            crew, habits, claw, etc.). Subagent/orchestra/
 *                            artifact tools need conversationId from context
 *                            and are wired separately.
 *  - registerDynamicTools  — CRUD meta-tools (create/list/etc.), special meta-
 *                            tools (search_tools, use_tool, batch_use_tool,
 *                            inspect_tool_source, get_tool_help), and active
 *                            user custom tools.
 */

import type { ToolRegistry } from '@ownpilot/core';
import {
  DYNAMIC_TOOL_DEFINITIONS,
  MEMORY_TOOLS,
  GOAL_TOOLS,
  CUSTOM_DATA_TOOLS,
  PERSONAL_DATA_TOOLS,
  qualifyToolName,
  type ToolDefinition,
  type ToolExecutionResult as CoreToolResult,
} from '@ownpilot/core';
import { executeMemoryTool } from '../../routes/memories.js';
import { executeGoalTool } from '../../routes/goals.js';
import { executeCustomDataTool } from '../../routes/custom-data.js';
import { executePersonalDataTool } from '../../routes/personal-data-tools.js';
import {
  executeCustomToolTool,
  executeActiveCustomTool,
  getActiveCustomToolDefinitions,
} from '../../routes/custom-tools.js';
import {
  TRIGGER_TOOLS,
  executeTriggerTool,
  PLAN_TOOLS,
  executePlanTool,
  HEARTBEAT_TOOLS,
  executeHeartbeatTool,
  EXTENSION_TOOLS,
  executeExtensionTool,
  PULSE_TOOLS,
  executePulseTool,
  NOTIFICATION_TOOLS,
  executeNotificationTool,
  EVENT_TOOLS,
  executeEventTool,
  SUBAGENT_TOOLS,
  executeSubagentTool,
  ORCHESTRA_TOOL_DEFINITIONS,
  executeOrchestraTool,
  ARTIFACT_TOOLS,
  executeArtifactTool,
  SOUL_COMMUNICATION_TOOLS,
  executeSoulCommunicationTool,
  CREW_TOOLS,
  executeCrewTool,
  HABIT_TOOLS,
  executeHabitTool,
  CLAW_TOOLS,
  executeClawTool,
  CLAW_MANAGEMENT_TOOLS,
  executeClawManagementTool,
  INTERACTIVE_TOOLS,
  executeInteractiveTool,
} from '../index.js';
import { CONFIG_TOOLS, executeConfigTool } from '../../services/config-tools.js';
import {
  traceToolCallStart,
  traceToolCallEnd,
  traceDbWrite,
  traceDbRead,
} from '../../tracing/index.js';
import { AI_META_TOOL_NAMES } from '../../config/defaults.js';
import { toToolResult, type ToolExecutor, type ToolGroup } from './utils.js';
import {
  executeUseTool,
  executeBatchUseTool,
  executeSearchTools,
  executeInspectToolSource,
  executeGetToolHelp,
} from './meta-executors.js';

/**
 * Register all gateway domain tools (memory, goals, custom data, personal data,
 * config, triggers, plans) on the given ToolRegistry.
 *
 * When `trace` is true, each tool call is wrapped with traceToolCallStart/End.
 */
export function registerGatewayTools(tools: ToolRegistry, userId: string, trace: boolean): void {
  const groups: ToolGroup[] = [
    { definitions: MEMORY_TOOLS, executor: executeMemoryTool, needsUserId: true },
    { definitions: GOAL_TOOLS, executor: executeGoalTool, needsUserId: true },
    {
      definitions: CUSTOM_DATA_TOOLS,
      executor: executeCustomDataTool as ToolExecutor,
      needsUserId: false,
    },
    {
      definitions: PERSONAL_DATA_TOOLS,
      executor: executePersonalDataTool as ToolExecutor,
      needsUserId: false,
    },
    { definitions: CONFIG_TOOLS, executor: executeConfigTool as ToolExecutor, needsUserId: false },
    { definitions: TRIGGER_TOOLS, executor: executeTriggerTool, needsUserId: true },
    { definitions: PLAN_TOOLS, executor: executePlanTool, needsUserId: true },
    { definitions: HEARTBEAT_TOOLS, executor: executeHeartbeatTool, needsUserId: true },
    { definitions: EXTENSION_TOOLS, executor: executeExtensionTool, needsUserId: true },
    { definitions: PULSE_TOOLS, executor: executePulseTool, needsUserId: true },
    { definitions: NOTIFICATION_TOOLS, executor: executeNotificationTool, needsUserId: true },
    { definitions: EVENT_TOOLS, executor: executeEventTool, needsUserId: true },
    {
      definitions: SOUL_COMMUNICATION_TOOLS,
      executor: executeSoulCommunicationTool,
      needsUserId: true,
    },
    {
      definitions: CREW_TOOLS,
      executor: executeCrewTool,
      needsUserId: true,
    },
    {
      definitions: HABIT_TOOLS,
      executor: executeHabitTool,
      needsUserId: true,
    },
    {
      definitions: CLAW_TOOLS,
      executor: executeClawTool,
      needsUserId: true,
    },
    {
      definitions: CLAW_MANAGEMENT_TOOLS,
      executor: executeClawManagementTool,
      needsUserId: true,
    },
    {
      definitions: INTERACTIVE_TOOLS,
      executor: executeInteractiveTool as ToolExecutor,
      needsUserId: false,
    },
  ];

  for (const group of groups) {
    for (const toolDef of group.definitions) {
      const qName = qualifyToolName(toolDef.name, 'core');
      tools.register({ ...toolDef, name: qName }, async (args): Promise<CoreToolResult> => {
        const startTime = trace
          ? traceToolCallStart(toolDef.name, args as Record<string, unknown>)
          : 0;

        const result = group.needsUserId
          ? await group.executor(toolDef.name, args as Record<string, unknown>, userId)
          : await group.executor(toolDef.name, args as Record<string, unknown>);

        if (trace) {
          traceToolCallEnd(toolDef.name, startTime, result.success, result.result, result.error);
        }

        return toToolResult(result);
      });
    }
  }

  // Subagent tools (need conversationId from context, registered separately)
  for (const toolDef of SUBAGENT_TOOLS) {
    const qName = qualifyToolName(toolDef.name, 'core');
    tools.register({ ...toolDef, name: qName }, async (args, context): Promise<CoreToolResult> => {
      const startTime = trace
        ? traceToolCallStart(toolDef.name, args as Record<string, unknown>)
        : 0;

      const result = await executeSubagentTool(
        toolDef.name,
        args as Record<string, unknown>,
        userId,
        context?.conversationId
      );

      if (trace) {
        traceToolCallEnd(toolDef.name, startTime, result.success, result.result, result.error);
      }

      return toToolResult(result);
    });
  }

  // Orchestra tools (need conversationId from context, registered separately)
  for (const toolDef of ORCHESTRA_TOOL_DEFINITIONS) {
    const qName = qualifyToolName(toolDef.name, 'core');
    tools.register({ ...toolDef, name: qName }, async (args, context): Promise<CoreToolResult> => {
      const startTime = trace
        ? traceToolCallStart(toolDef.name, args as Record<string, unknown>)
        : 0;

      const result = await executeOrchestraTool(
        toolDef.name,
        args as Record<string, unknown>,
        userId,
        context?.conversationId ?? ''
      );

      if (trace) {
        traceToolCallEnd(toolDef.name, startTime, result.success, result.result, result.error);
      }

      return toToolResult(result);
    });
  }

  // Artifact tools (need conversationId from context, registered separately)
  for (const toolDef of ARTIFACT_TOOLS) {
    const qName = qualifyToolName(toolDef.name, 'core');
    tools.register({ ...toolDef, name: qName }, async (args, context): Promise<CoreToolResult> => {
      const startTime = trace
        ? traceToolCallStart(toolDef.name, args as Record<string, unknown>)
        : 0;

      const result = await executeArtifactTool(
        toolDef.name,
        args as Record<string, unknown>,
        userId,
        context?.conversationId ?? ''
      );

      if (trace) {
        traceToolCallEnd(toolDef.name, startTime, result.success, result.result, result.error);
      }

      return toToolResult(result);
    });
  }
}

/** Names of meta-tools that have dedicated executors (registered separately) */
const META_TOOL_NAMES = new Set([...AI_META_TOOL_NAMES, 'inspect_tool_source']);

/**
 * Register all dynamic tools: CRUD meta-tools, special meta-tools, and active custom tools.
 * Used by both agent and chat endpoints to avoid duplicating ~80 lines of registration logic.
 *
 * @returns The active custom tool definitions (needed for tool-list assembly).
 */
export async function registerDynamicTools(
  tools: ToolRegistry,
  userId: string,
  conversationId: string,
  trace: boolean
): Promise<ToolDefinition[]> {
  // 1. Register CRUD meta-tools (create_tool, list_custom_tools, etc.)
  for (const toolDef of DYNAMIC_TOOL_DEFINITIONS) {
    if (META_TOOL_NAMES.has(toolDef.name)) continue;

    const qName = qualifyToolName(toolDef.name, 'core');
    tools.register({ ...toolDef, name: qName }, async (args, _context): Promise<CoreToolResult> => {
      const startTime = trace
        ? traceToolCallStart(toolDef.name, args as Record<string, unknown>)
        : 0;
      const result = await executeCustomToolTool(
        toolDef.name,
        args as Record<string, unknown>,
        userId
      );

      if (trace) {
        if (toolDef.name === 'create_tool') traceDbWrite('custom_tools', 'insert');
        else if (toolDef.name === 'list_custom_tools') traceDbRead('custom_tools', 'select');
        else if (toolDef.name === 'delete_custom_tool') traceDbWrite('custom_tools', 'delete');
        else if (toolDef.name === 'toggle_custom_tool' || toolDef.name === 'update_custom_tool')
          traceDbWrite('custom_tools', 'update');
        traceToolCallEnd(toolDef.name, startTime, result.success, result.result, result.error);
      }

      return toToolResult(result);
    });
  }

  // 2. Register special meta-tools with dedicated executors
  //    search_tools, get_tool_help, use_tool, batch_use_tool stay unprefixed (LLM native API)
  //    inspect_tool_source gets core. prefix (accessed via use_tool)
  const searchToolsDef = DYNAMIC_TOOL_DEFINITIONS.find((t) => t.name === 'search_tools');
  if (searchToolsDef) {
    tools.register(searchToolsDef, (args) =>
      executeSearchTools(tools, args as Record<string, unknown>)
    );
  }
  const inspectToolSourceDef = DYNAMIC_TOOL_DEFINITIONS.find(
    (t) => t.name === 'inspect_tool_source'
  );
  if (inspectToolSourceDef) {
    const qName = qualifyToolName('inspect_tool_source', 'core');
    tools.register({ ...inspectToolSourceDef, name: qName }, (args) =>
      executeInspectToolSource(tools, userId, args as Record<string, unknown>)
    );
  }
  const getToolHelpDef = DYNAMIC_TOOL_DEFINITIONS.find((t) => t.name === 'get_tool_help');
  if (getToolHelpDef) {
    tools.register(getToolHelpDef, (args) =>
      executeGetToolHelp(tools, args as Record<string, unknown>)
    );
  }
  const useToolDef = DYNAMIC_TOOL_DEFINITIONS.find((t) => t.name === 'use_tool');
  if (useToolDef) {
    tools.register(useToolDef, (args, context) =>
      executeUseTool(tools, args as Record<string, unknown>, context)
    );
  }
  const batchUseToolDef = DYNAMIC_TOOL_DEFINITIONS.find((t) => t.name === 'batch_use_tool');
  if (batchUseToolDef) {
    tools.register(batchUseToolDef, (args, context) =>
      executeBatchUseTool(tools, args as Record<string, unknown>, context)
    );
  }

  // 3. Register active custom tools (user-created dynamic tools)
  const activeCustomToolDefs = await getActiveCustomToolDefinitions(userId);
  for (const toolDef of activeCustomToolDefs) {
    const qName = qualifyToolName(toolDef.name, 'custom');
    tools.register({ ...toolDef, name: qName }, async (args, _context): Promise<CoreToolResult> => {
      const startTime = trace
        ? traceToolCallStart(toolDef.name, args as Record<string, unknown>)
        : 0;

      const result = await executeActiveCustomTool(
        toolDef.name,
        args as Record<string, unknown>,
        userId,
        {
          callId: `call_${Date.now()}`,
          conversationId,
        }
      );

      if (trace)
        traceToolCallEnd(toolDef.name, startTime, result.success, result.result, result.error);

      return toToolResult(result);
    });
  }

  return activeCustomToolDefs;
}
