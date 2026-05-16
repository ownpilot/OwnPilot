/**
 * Agent Tool Registry — Public Facade
 *
 * Re-exports the registry's surface area. Implementations live under
 * `./registry/`:
 *
 *   aliases.ts                 — LLM hallucination → canonical name map
 *   utils.ts                   — safeStringArray, stub-supersede, helpers
 *   core-registration.ts       — registerGatewayTools, registerDynamicTools
 *   external-registration.ts   — registerPluginTools, registerExtensionTools,
 *                                registerMcpTools
 *   meta-executors.ts          — use_tool / batch_use_tool / search_tools /
 *                                inspect_tool_source / get_tool_help
 */

import {
  registerAllTools,
  getToolDefinitions,
  MEMORY_TOOLS,
  GOAL_TOOLS,
  CUSTOM_DATA_TOOLS,
  PERSONAL_DATA_TOOLS,
  DYNAMIC_TOOL_DEFINITIONS,
} from '@ownpilot/core';
import {
  TRIGGER_TOOLS,
  PLAN_TOOLS,
  HEARTBEAT_TOOLS,
  EXTENSION_TOOLS,
  PULSE_TOOLS,
  NOTIFICATION_TOOLS,
  EVENT_TOOLS,
  SOUL_COMMUNICATION_TOOLS,
} from './index.js';
import { CONFIG_TOOLS } from '../services/config-tools.js';

export { safeStringArray } from './registry/utils.js';
export { registerGatewayTools, registerDynamicTools } from './registry/core-registration.js';
export {
  registerPluginTools,
  registerExtensionTools,
  registerMcpTools,
} from './registry/external-registration.js';
export {
  executeUseTool,
  executeBatchUseTool,
  executeSearchTools,
  executeInspectToolSource,
  executeGetToolHelp,
} from './registry/meta-executors.js';

// Re-export symbols used by agent-service.ts for agent creation
export {
  registerAllTools,
  getToolDefinitions,
  MEMORY_TOOLS,
  GOAL_TOOLS,
  CUSTOM_DATA_TOOLS,
  PERSONAL_DATA_TOOLS,
  DYNAMIC_TOOL_DEFINITIONS,
  EXTENSION_TOOLS,
  CONFIG_TOOLS,
  TRIGGER_TOOLS,
  PLAN_TOOLS,
  HEARTBEAT_TOOLS,
  PULSE_TOOLS,
  NOTIFICATION_TOOLS,
  EVENT_TOOLS,
  SOUL_COMMUNICATION_TOOLS,
};
