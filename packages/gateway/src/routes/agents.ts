/**
 * Agent management routes
 *
 * Agents are stored in the database for persistence.
 * Runtime Agent instances are cached in memory for active use.
 */

import { Hono } from 'hono';
import { hasServiceRegistry, getServiceRegistry, Services, generateId } from '@ownpilot/core';
import {
  Agent,
  createAgent,
  ToolRegistry,
  registerAllTools,
  getToolDefinitions,
  injectMemoryIntoPrompt,
  MEMORY_TOOLS,
  GOAL_TOOLS,
  CUSTOM_DATA_TOOLS,
  PERSONAL_DATA_TOOLS,
  DYNAMIC_TOOL_DEFINITIONS,
  TOOL_SEARCH_TAGS,
  applyToolLimits,
  TOOL_GROUPS,
  getProviderConfig as coreGetProviderConfig,
  findSimilarToolNames,
  formatFullToolHelp,
  buildToolHelpText,
  validateRequiredParams,
  type AgentConfig,
  type AIProvider,
  type ToolDefinition,
  type ToolExecutionResult as CoreToolResult,
  type ToolContext,
  type WorkspaceContext,
  unsafeToolId,
  qualifyToolName,
  getBaseName,
  getModelPricing,
} from '@ownpilot/core';
import { executeMemoryTool } from './memories.js';
import { executeGoalTool } from './goals.js';
import { executeCustomDataTool } from './custom-data.js';
import { executePersonalDataTool } from './personal-data-tools.js';
import {
  executeCustomToolTool,
  executeActiveCustomTool,
  getActiveCustomToolDefinitions,
  getCustomToolDynamicRegistry,
} from './custom-tools.js';
import { getToolSource } from '../services/tool-source.js';
import { getSharedToolRegistry } from '../services/tool-executor.js';
import { createCustomToolsRepo } from '../db/repositories/custom-tools.js';
import { TRIGGER_TOOLS, executeTriggerTool, PLAN_TOOLS, executePlanTool, HEARTBEAT_TOOLS, executeHeartbeatTool, SKILL_PACKAGE_TOOLS, executeSkillPackageTool } from '../tools/index.js';
import { CONFIG_TOOLS, executeConfigTool } from '../services/config-tools.js';
import { getSkillPackageService } from '../services/skill-package-service.js';
import {
  traceToolCallStart,
  traceToolCallEnd,
  traceDbWrite,
  traceDbRead,
} from '../tracing/index.js';
import type {
  CreateAgentRequest,
  UpdateAgentRequest,
  AgentInfo,
  SessionInfo,
} from '../types/index.js';
import { apiResponse, apiError, ERROR_CODES, sanitizeId, notFoundError, getErrorMessage, truncate } from './helpers.js'
import { agentsRepo, localProvidersRepo, type AgentRecord } from '../db/repositories/index.js';
import { getApiKey, resolveProviderAndModel, getDefaultProvider, getDefaultModel, getConfiguredProviderIds } from './settings.js';
import { gatewayConfigCenter } from '../services/config-center-impl.js';
import { getLog } from '../services/log.js';
import { wsGateway } from '../ws/server.js';
import { getApprovalManager } from '../autonomy/index.js';
import type { ActionCategory } from '../autonomy/types.js';
import {
  TOOL_ARGS_MAX_SIZE,
  MAX_AGENT_CACHE_SIZE,
  MAX_CHAT_AGENT_CACHE_SIZE,
  AGENT_DEFAULT_MAX_TOKENS,
  AGENT_CREATE_DEFAULT_MAX_TOKENS,
  AGENT_DEFAULT_TEMPERATURE,
  AGENT_DEFAULT_MAX_TURNS,
  AGENT_DEFAULT_MAX_TOOL_CALLS,
  MAX_BATCH_TOOL_CALLS,
  AI_META_TOOL_NAMES,
} from '../config/defaults.js';

const log = getLog('Agents');

/** Providers with built-in SDK support (non-native fall back to OpenAI-compatible) */
const NATIVE_PROVIDERS = new Set(['openai', 'anthropic', 'google', 'deepseek', 'groq', 'mistral', 'xai', 'together', 'fireworks', 'perplexity']);

/**
 * Base system prompt used for all agents.
 * Structured to establish identity, behavior, and output expectations.
 */
const BASE_SYSTEM_PROMPT = `You are OwnPilot, a privacy-first personal AI assistant.

## Identity
- You run on the user's own infrastructure. Their data never leaves their server.
- You have persistent memory across conversations and learn user preferences over time.
- You execute tools to take real actions: manage tasks, files, emails, calendar, etc.

## Tool System
You access all capabilities through 4 meta-tools: \`search_tools\`, \`get_tool_help\`, \`use_tool\`, and \`batch_use_tool\`.

**Tool namespaces:** All tools use dot-prefixed namespaces indicating their source:
- \`core.*\` — built-in tools (e.g. \`core.add_task\`, \`core.read_file\`, \`core.search_memories\`)
- \`custom.*\` — user-created tools (e.g. \`custom.my_parser\`)
- \`plugin.<id>.*\` — plugin-provided tools (e.g. \`plugin.telegram.send_message\`)
- \`skill.<id>.*\` — skill package tools (e.g. \`skill.web_search.search_web\`)
Always use the full qualified name with \`use_tool\`, e.g. \`use_tool("core.add_task", {"title": "..."})\`.

**Key principles:**
- Never guess tool names or parameters. Use \`search_tools\` to discover and \`get_tool_help\` to verify before calling unfamiliar tools.
- Use \`batch_use_tool\` for parallel execution when multiple independent operations are needed.
- On error, read the error message — it includes the correct parameter schema. Fix and retry once.

## Data Persistence
All personal data is stored in a local database and persists across conversations:
- **Tasks** — Todo items with priorities, due dates, categories
- **Notes** — Text notes with tags
- **Calendar** — Events and appointments
- **Contacts** — People with phone, email, address
- **Bookmarks** — Saved URLs with tags
- **Custom Data** — User-created tables with any schema (use \`search_tools("custom data")\` to discover)
- **Memories** — Facts, preferences, and events you learn about the user

**Always use tools to access data.** Never fabricate, assume, or recall data from conversation history alone. Call the appropriate list/search tool to get the current state — data changes between conversations.

## Tool Improvement
- Use \`core.inspect_tool_source\` to view any tool's source code before suggesting improvements.
- For built-in tools: create an improved custom tool with \`core.create_tool\` that handles additional edge cases, better formatting, or extra features.
- For custom tools: use \`core.update_custom_tool\` to improve the existing code directly.
- Always explain what you improved and why before making changes.

## Memory Protocol
- Before answering questions about the user, call \`core.search_memories\` to recall relevant context.
- When you detect memorizable information during conversation (personal facts, preferences, events, skills), embed them in a <memories> tag.
- Format as a JSON array of objects: <memories>[{"type":"fact","content":"User's name is Alex"},{"type":"preference","content":"User prefers dark mode"}]</memories>
- Valid types: fact, preference, conversation, event, skill
- Place the <memories> tag after your response content but before the <suggestions> tag.
- Only include genuinely new information — the system handles deduplication automatically.

## Behavior
- Be concise. Elaborate only when asked or when the task requires it.
- Act proactively: if the user says "remind me X tomorrow", create the task immediately.
- When ambiguous, make a reasonable assumption and state it.
- After tool operations, summarize what you did in 1-2 sentences.

## Output
- Markdown for structured content; plain text for simple answers.
- Bulleted lists for multiple items. Include dates, numbers, specifics.

## Follow-Up Suggestions
At the end of every response, include 2-3 contextual follow-up suggestions.
Format as a JSON array of objects inside a <suggestions> tag as the very last thing:

<suggestions>[{"title":"Short label","detail":"Full message to send"},{"title":"Another","detail":"Another detailed message"}]</suggestions>

Rules:
- title: concise chip label (under 40 chars)
- detail: the full message placed in the input for the user to review and send (under 200 chars)
- Max 5 suggestions, specific and actionable, not generic
- The <suggestions> tag must always be the very last thing in your response`;

/** Sanitize user-supplied IDs for safe interpolation in error messages */

/** Safely extract a string[] from unknown config values (DB records, etc.) */
function safeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Maps plugin tool names to the core stub tool names they supersede.
 * When a plugin provides a real implementation, the corresponding core stubs
 * are unregistered to prevent the LLM from seeing duplicate tools.
 */
const PLUGIN_SUPERSEDES_CORE: Record<string, string[]> = {
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
function removeSupersededCoreStubs(tools: ToolRegistry, pluginToolNames: Set<string>): number {
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

// =============================================================================
// Shared tool registration
// =============================================================================

type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  userId?: string
) => Promise<{ success: boolean; result?: unknown; error?: string }>;

interface ToolGroup {
  definitions: readonly import('@ownpilot/core').ToolDefinition[];
  executor: ToolExecutor;
  needsUserId: boolean;
}

/**
 * Convert a tool execution result to the CoreToolResult format.
 */
function toToolResult(result: { success: boolean; result?: unknown; error?: string }): CoreToolResult {
  if (result.success) {
    return {
      content: typeof result.result === 'string'
        ? result.result
        : JSON.stringify(result.result, null, 2),
    };
  }
  return { content: result.error ?? 'Unknown error', isError: true };
}

/**
 * Register all gateway domain tools (memory, goals, custom data, personal data,
 * config, triggers, plans) on the given ToolRegistry.
 *
 * When `trace` is true, each tool call is wrapped with traceToolCallStart/End.
 */
function registerGatewayTools(
  tools: ToolRegistry,
  userId: string,
  trace: boolean,
): void {
  const groups: ToolGroup[] = [
    { definitions: MEMORY_TOOLS, executor: executeMemoryTool, needsUserId: true },
    { definitions: GOAL_TOOLS, executor: executeGoalTool, needsUserId: true },
    { definitions: CUSTOM_DATA_TOOLS, executor: executeCustomDataTool as ToolExecutor, needsUserId: false },
    { definitions: PERSONAL_DATA_TOOLS, executor: executePersonalDataTool as ToolExecutor, needsUserId: false },
    { definitions: CONFIG_TOOLS, executor: executeConfigTool as ToolExecutor, needsUserId: false },
    { definitions: TRIGGER_TOOLS, executor: executeTriggerTool, needsUserId: true },
    { definitions: PLAN_TOOLS, executor: executePlanTool, needsUserId: true },
    { definitions: HEARTBEAT_TOOLS, executor: executeHeartbeatTool, needsUserId: true },
    { definitions: SKILL_PACKAGE_TOOLS, executor: executeSkillPackageTool, needsUserId: true },
  ];

  for (const group of groups) {
    for (const toolDef of group.definitions) {
      const qName = qualifyToolName(toolDef.name, 'core');
      tools.register({ ...toolDef, name: qName }, async (args): Promise<CoreToolResult> => {
        const startTime = trace ? traceToolCallStart(toolDef.name, args as Record<string, unknown>) : 0;

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
}

// =============================================================================
// Shared dynamic-tool & plugin-tool registration
// =============================================================================

/** Names of meta-tools that have dedicated executors (registered separately) */
const META_TOOL_NAMES = new Set([...AI_META_TOOL_NAMES, 'inspect_tool_source']);

/**
 * Register all dynamic tools: CRUD meta-tools, special meta-tools, and active custom tools.
 * Used by both agent and chat endpoints to avoid duplicating ~80 lines of registration logic.
 *
 * @returns The active custom tool definitions (needed for tool-list assembly).
 */
async function registerDynamicTools(
  tools: ToolRegistry,
  userId: string,
  conversationId: string,
  trace: boolean,
): Promise<ToolDefinition[]> {
  // 1. Register CRUD meta-tools (create_tool, list_custom_tools, etc.)
  for (const toolDef of DYNAMIC_TOOL_DEFINITIONS) {
    if (META_TOOL_NAMES.has(toolDef.name)) continue;

    const qName = qualifyToolName(toolDef.name, 'core');
    tools.register({ ...toolDef, name: qName }, async (args, _context): Promise<CoreToolResult> => {
      const startTime = trace ? traceToolCallStart(toolDef.name, args as Record<string, unknown>) : 0;
      const result = await executeCustomToolTool(toolDef.name, args as Record<string, unknown>, userId);

      if (trace) {
        if (toolDef.name === 'create_tool') traceDbWrite('custom_tools', 'insert');
        else if (toolDef.name === 'list_custom_tools') traceDbRead('custom_tools', 'select');
        else if (toolDef.name === 'delete_custom_tool') traceDbWrite('custom_tools', 'delete');
        else if (toolDef.name === 'toggle_custom_tool' || toolDef.name === 'update_custom_tool') traceDbWrite('custom_tools', 'update');
        traceToolCallEnd(toolDef.name, startTime, result.success, result.result, result.error);
      }

      return toToolResult(result);
    });
  }

  // 2. Register special meta-tools with dedicated executors
  //    search_tools, get_tool_help, use_tool, batch_use_tool stay unprefixed (LLM native API)
  //    inspect_tool_source gets core. prefix (accessed via use_tool)
  const searchToolsDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'search_tools');
  if (searchToolsDef) {
    tools.register(searchToolsDef, (args) => executeSearchTools(tools, args as Record<string, unknown>));
  }
  const inspectToolSourceDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'inspect_tool_source');
  if (inspectToolSourceDef) {
    const qName = qualifyToolName('inspect_tool_source', 'core');
    tools.register({ ...inspectToolSourceDef, name: qName }, (args) => executeInspectToolSource(tools, userId, args as Record<string, unknown>));
  }
  const getToolHelpDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'get_tool_help');
  if (getToolHelpDef) {
    tools.register(getToolHelpDef, (args) => executeGetToolHelp(tools, args as Record<string, unknown>));
  }
  const useToolDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'use_tool');
  if (useToolDef) {
    tools.register(useToolDef, (args, context) => executeUseTool(tools, args as Record<string, unknown>, context));
  }
  const batchUseToolDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'batch_use_tool');
  if (batchUseToolDef) {
    tools.register(batchUseToolDef, (args, context) => executeBatchUseTool(tools, args as Record<string, unknown>, context));
  }

  // 3. Register active custom tools (user-created dynamic tools)
  const activeCustomToolDefs = await getActiveCustomToolDefinitions(userId);
  for (const toolDef of activeCustomToolDefs) {
    const qName = qualifyToolName(toolDef.name, 'custom');
    tools.register({ ...toolDef, name: qName }, async (args, _context): Promise<CoreToolResult> => {
      const startTime = trace ? traceToolCallStart(toolDef.name, args as Record<string, unknown>) : 0;

      const result = await executeActiveCustomTool(toolDef.name, args as Record<string, unknown>, userId, {
        callId: `call_${Date.now()}`,
        conversationId,
      });

      if (trace) traceToolCallEnd(toolDef.name, startTime, result.success, result.result, result.error);

      return toToolResult(result);
    });
  }

  return activeCustomToolDefs;
}

/**
 * Register plugin-provided tools and remove superseded core stubs.
 * Used by both agent and chat endpoints.
 *
 * @returns The plugin tool definitions (needed for tool-list assembly).
 */
function registerPluginTools(
  tools: ToolRegistry,
  trace: boolean,
): ToolDefinition[] {
  const pluginService = getServiceRegistry().get(Services.Plugin);
  const pluginTools = pluginService.getAllTools();
  const pluginToolDefs: ToolDefinition[] = [];

  for (const { pluginId, definition, executor } of pluginTools) {
    const qName = qualifyToolName(definition.name, 'plugin', pluginId);
    const qDef = { ...definition, name: qName };
    const wrappedExecutor = async (args: unknown, context: ToolContext): Promise<CoreToolResult> => {
      const startTime = trace ? traceToolCallStart(definition.name, args as Record<string, unknown>) : 0;
      try {
        const result = await executor(args as Record<string, unknown>, context);
        if (trace) traceToolCallEnd(definition.name, startTime, !result.isError, result.content, result.isError ? String(result.content) : undefined);
        return result;
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        if (trace) traceToolCallEnd(definition.name, startTime, false, undefined, errorMsg);
        return { content: errorMsg, isError: true };
      }
    };

    if (tools.has(qName)) {
      tools.updateExecutor(qName, wrappedExecutor);
    } else {
      tools.register(qDef, wrappedExecutor);
    }
    pluginToolDefs.push(definition);
  }

  // Remove core stub tools that are superseded by plugin tools
  const pluginToolBaseNames = new Set(pluginToolDefs.map(t => getBaseName(t.name)));
  removeSupersededCoreStubs(tools, pluginToolBaseNames);

  return pluginToolDefs;
}

/**
 * Register skill package tools (from installed skill packages).
 * Skill tools are registered in the DynamicToolRegistry (same sandbox as custom tools)
 * and then exposed on the ToolRegistry for agent access.
 *
 * @returns The skill package tool definitions (needed for tool-list assembly).
 */
function registerSkillPackageTools(
  tools: ToolRegistry,
  _userId: string,
  trace: boolean,
): ToolDefinition[] {
  let service: ReturnType<typeof getSkillPackageService>;
  try {
    service = getSkillPackageService();
  } catch {
    log.debug('Skill package service not initialized, skipping tool registration');
    return [];
  }

  const skillToolDefs = service.getToolDefinitions();
  if (skillToolDefs.length === 0) return [];

  // Get the shared DynamicToolRegistry (same sandbox as custom tools)
  const dynamicRegistry = getCustomToolDynamicRegistry();

  const result: ToolDefinition[] = [];

  for (const def of skillToolDefs) {
    // Register in DynamicToolRegistry if not already there (uses base name)
    if (!dynamicRegistry.has(def.name)) {
      try {
        dynamicRegistry.register({
          name: def.name,
          description: def.description,
          parameters: def.skillTool.parameters as never,
          code: def.skillTool.code,
          permissions: def.skillTool.permissions as never,
        });
      } catch (error) {
        log.warn(`Failed to register skill tool "${def.name}"`, { error: String(error) });
        continue;
      }
    }

    const qName = qualifyToolName(def.name, 'skill', def.skillPackageId);
    const toolDef: ToolDefinition = {
      name: def.name,
      description: def.description,
      parameters: def.parameters as ToolDefinition['parameters'],
      category: def.category,
    };

    const registerResult = tools.register({ ...toolDef, name: qName }, async (args, context): Promise<CoreToolResult> => {
      const startTime = trace ? traceToolCallStart(def.name, args as Record<string, unknown>) : 0;
      try {
        const execResult = await dynamicRegistry.execute(def.name, args as Record<string, unknown>, context);
        if (trace) {
          traceToolCallEnd(def.name, startTime, !execResult.isError, execResult.content, execResult.isError ? String(execResult.content) : undefined);
        }
        return { content: execResult.isError ? String(execResult.content) : JSON.stringify(execResult.content), isError: execResult.isError };
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        if (trace) traceToolCallEnd(def.name, startTime, false, undefined, errorMsg);
        return { content: errorMsg, isError: true };
      }
    });

    if (!registerResult.ok) {
      log.warn(`Skill tool "${def.name}" skipped: ${registerResult.error.message}`);
      continue;
    }

    result.push(toolDef);
  }

  return result;
}

/**
 * Register MCP tools from connected external MCP servers.
 * Copies tools from the shared ToolRegistry (where mcpClientService registers them)
 * into the per-request ToolRegistry used by agents/chat.
 */
function registerMcpTools(
  tools: ToolRegistry,
  trace: boolean,
): ToolDefinition[] {
  const sharedRegistry = getSharedToolRegistry();
  const mcpTools = sharedRegistry.getToolsBySource('mcp');
  const mcpToolDefs: ToolDefinition[] = [];

  for (const registeredTool of mcpTools) {
    const { definition, executor } = registeredTool;

    const wrappedExecutor = async (args: unknown, context: ToolContext): Promise<CoreToolResult> => {
      const startTime = trace ? traceToolCallStart(getBaseName(definition.name), args as Record<string, unknown>) : 0;
      try {
        const result = await executor(args as Record<string, unknown>, context);
        if (trace) traceToolCallEnd(getBaseName(definition.name), startTime, !result.isError, result.content, result.isError ? String(result.content) : undefined);
        return result;
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        if (trace) traceToolCallEnd(getBaseName(definition.name), startTime, false, undefined, errorMsg);
        return { content: errorMsg, isError: true };
      }
    };

    if (!tools.has(definition.name)) {
      tools.register(definition, wrappedExecutor, {
        source: 'mcp',
        pluginId: registeredTool.pluginId,
        trustLevel: 'semi-trusted',
        providerName: registeredTool.providerName,
      });
    }
    mcpToolDefs.push(definition);
  }

  return mcpToolDefs;
}

// =============================================================================
// Shared meta-tool helpers — imported from @ownpilot/core/agent/tool-validation
// findSimilarToolNames, formatFullToolHelp, buildToolHelpText, validateRequiredParams
// =============================================================================

/** Compatibility wrapper: old 2-arg signature → new 3-arg from core */
function findSimilarTools(tools: ToolRegistry, query: string): string[] {
  return findSimilarToolNames(tools, query, 5);
}

/**
 * Shared use_tool executor — validates, caps, executes a single tool by name.
 * Used by both agent and chat tool registration paths.
 */
async function executeUseTool(
  tools: ToolRegistry,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<CoreToolResult> {
  const { tool_name, arguments: toolArgs } = args as { tool_name: string; arguments: Record<string, unknown> };

  // Check if tool exists — suggest similar names if not
  if (!tools.has(tool_name)) {
    const similar = findSimilarTools(tools, tool_name);
    const hint = similar.length > 0
      ? `\n\nDid you mean one of these?\n${similar.map(s => `  • ${s}`).join('\n')}\n\nCall get_tool_help("tool_name") to see parameters, then retry with the correct name.`
      : '\n\nUse search_tools("keyword") to find the correct tool name.';
    return { content: `Tool '${tool_name}' not found.${hint}`, isError: true };
  }

  // Pre-validate required parameters before execution
  const missingError = validateRequiredParams(tools, tool_name, toolArgs || {});
  if (missingError) {
    return { content: `${missingError}${buildToolHelpText(tools, tool_name)}`, isError: true };
  }

  try {
    // Validate tool arguments payload size
    const argsStr = JSON.stringify(toolArgs ?? {});
    if (argsStr.length > TOOL_ARGS_MAX_SIZE) {
      return { content: 'Tool arguments payload too large (max 100KB)', isError: true };
    }

    // Apply max limits for list-returning tools (e.g. cap list_emails limit to 50)
    const cappedArgs = applyToolLimits(tool_name, toolArgs);
    // Forward the parent context so inner tools inherit executionPermissions, requestApproval, etc.
    const result = await tools.execute(tool_name, cappedArgs, context);
    if (result.ok) {
      return result.value;
    }
    // Include parameter help on execution error so LLM can retry correctly
    return { content: result.error.message + buildToolHelpText(tools, tool_name), isError: true };
  } catch (error) {
    const msg = getErrorMessage(error, 'Tool execution failed');
    return { content: msg + buildToolHelpText(tools, tool_name), isError: true };
  }
}

/**
 * Shared batch_use_tool executor — validates and executes multiple tools in parallel.
 * Used by both agent and chat tool registration paths.
 */
async function executeBatchUseTool(
  tools: ToolRegistry,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<CoreToolResult> {
  const { calls } = args as { calls: Array<{ tool_name: string; arguments: Record<string, unknown> }> };

  if (!calls?.length) {
    return { content: 'Provide a "calls" array with at least one tool call.', isError: true };
  }

  if (calls.length > MAX_BATCH_TOOL_CALLS) {
    return { content: `Batch size ${calls.length} exceeds maximum of ${MAX_BATCH_TOOL_CALLS}. Split into smaller batches.`, isError: true };
  }

  // Execute all tool calls in parallel
  const results = await Promise.allSettled(
    calls.map(async (call, idx) => {
      const { tool_name, arguments: toolArgs } = call;

      // Check tool exists
      if (!tools.has(tool_name)) {
        const similar = findSimilarTools(tools, tool_name);
        const hint = similar.length > 0
          ? ` Did you mean: ${similar.join(', ')}?`
          : '';
        return { idx, tool_name, ok: false, content: `Tool '${tool_name}' not found.${hint}` };
      }

      // Validate required params
      const missingError = validateRequiredParams(tools, tool_name, toolArgs || {});
      if (missingError) {
        return { idx, tool_name, ok: false, content: missingError };
      }

      try {
        // Validate tool arguments payload size
        const argsStr = JSON.stringify(toolArgs ?? {});
        if (argsStr.length > TOOL_ARGS_MAX_SIZE) {
          return { idx, tool_name, ok: false, content: 'Tool arguments payload too large (max 100KB)' };
        }

        const cappedArgs = applyToolLimits(tool_name, toolArgs);
        // Forward the parent context so inner tools inherit executionPermissions, etc.
        const result = await tools.execute(tool_name, cappedArgs, context);
        if (result.ok) {
          return { idx, tool_name, ok: true, content: typeof result.value.content === 'string' ? result.value.content : JSON.stringify(result.value.content, null, 2) };
        }
        return { idx, tool_name, ok: false, content: result.error.message };
      } catch (error) {
        const msg = getErrorMessage(error, 'Execution failed');
        return { idx, tool_name, ok: false, content: msg };
      }
    })
  );

  // Format combined results
  const sections = results.map((r, i) => {
    const call = calls[i]!;
    if (r.status === 'fulfilled') {
      const v = r.value;
      const status = v.ok ? '✓' : '✗';
      return `### ${i + 1}. ${call.tool_name} ${status}\n${v.content}`;
    }
    return `### ${i + 1}. ${call.tool_name} ✗\nUnexpected error: ${r.reason}`;
  });

  const hasErrors = results.some(r =>
    r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)
  );

  return {
    content: `[Batch: ${calls.length} tool calls]\n\n${sections.join('\n\n---\n\n')}`,
    isError: hasErrors && results.every(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)),
  };
}

/**
 * Shared handler for search_tools meta-tool
 */
async function executeSearchTools(
  tools: ToolRegistry,
  args: Record<string, unknown>,
): Promise<CoreToolResult> {
  const { query, category: filterCategory, include_params } = args as { query: string; category?: string; include_params?: boolean };
  const allDefs = tools.getDefinitions();
  const q = query.trim().toLowerCase();

  const showAll = q === 'all' || q === '*';
  const queryWords = q.split(/\s+/).filter(Boolean);

  const matches = allDefs.filter(d => {
    if (AI_META_TOOL_NAMES.includes(d.name as typeof AI_META_TOOL_NAMES[number])) return false;
    if (filterCategory && d.category?.toLowerCase() !== filterCategory.toLowerCase()) return false;
    if (showAll) return true;

    const baseName = getBaseName(d.name);
    const tags = TOOL_SEARCH_TAGS[baseName] ?? d.tags ?? [];
    const searchBlob = [
      baseName.toLowerCase().replace(/[_\-]/g, ' '),
      d.name.toLowerCase().replace(/[_.]/g, ' '),
      d.name.toLowerCase(),
      d.description.toLowerCase(),
      (d.category ?? '').toLowerCase(),
      ...tags.map(tag => tag.toLowerCase()),
    ].join(' ');
    return queryWords.every(word => searchBlob.includes(word));
  });

  if (matches.length === 0) {
    return { content: `No tools found for "${query}". Tips:\n- Search by individual keywords: "email" or "send"\n- Use multiple words for AND search: "email send" finds send_email\n- Use "all" to list every available tool\n- Try broad keywords: "task", "file", "web", "memory", "note", "calendar"` };
  }

  if (include_params !== false) {
    const sections = matches.map(d => formatFullToolHelp(tools, d.name));
    return { content: [`Found ${matches.length} tool(s) for "${query}" (with parameters):`, '', ...sections.join('\n\n---\n\n').split('\n')].join('\n') };
  }

  const lines = matches.map(d => `- **${d.name}**: ${truncate(d.description, 100)}`);
  return { content: [`Found ${matches.length} tool(s) for "${query}":`, '', ...lines].join('\n') };
}

/**
 * Shared handler for inspect_tool_source meta-tool
 */
async function executeInspectToolSource(
  tools: ToolRegistry,
  userId: string,
  args: Record<string, unknown>,
): Promise<CoreToolResult> {
  const { tool_name } = args as { tool_name: string };
  if (!tool_name || typeof tool_name !== 'string') {
    return { content: 'Provide a "tool_name" parameter.', isError: true };
  }

  const customToolsRepo = createCustomToolsRepo(userId);
  const baseName = getBaseName(tool_name);

  // 1. Check if it's a custom tool (DB stores base names)
  const customTool = await customToolsRepo.getByName(baseName);
  if (customTool) {
    const sections: string[] = [
      `## Tool: ${customTool.name}`,
      `**Category:** ${customTool.category ?? 'Custom'}`,
      `**Type:** custom (v${customTool.version}, created by ${customTool.createdBy})`,
      `**Status:** ${customTool.status}`,
      '',
      '### Description',
      customTool.description,
      '',
      '### Parameters',
      '```json',
      JSON.stringify(customTool.parameters, null, 2),
      '```',
      '',
      '### Source Code',
      '```javascript',
      customTool.code,
      '```',
    ];
    if (customTool.permissions?.length) {
      sections.push('', `**Permissions:** ${customTool.permissions.join(', ')}`);
    }
    sections.push('', '### Improvement Tips', '- You can update this tool directly with `update_custom_tool`.');
    return { content: sections.join('\n') };
  }

  // 2. Check if it's a built-in tool
  const def = tools.getDefinition(tool_name);
  if (def) {
    const source = getToolSource(tool_name);
    const sections: string[] = [
      `## Tool: ${def.name}`,
      `**Category:** ${def.category ?? 'Unknown'}`,
      `**Type:** built-in`,
      '',
      '### Description',
      def.description,
      '',
      '### Parameters',
      '```json',
      JSON.stringify(def.parameters, null, 2),
      '```',
    ];
    if (source) {
      sections.push('', '### Source Code', '```typescript', source, '```');
    } else {
      sections.push('', '*Source code not available for this tool.*');
    }
    sections.push('', '### Improvement Tips', '- Built-in tools cannot be modified directly. Use `create_tool` to create an improved custom version that overrides or extends this tool.');
    return { content: sections.join('\n') };
  }

  // 3. Not found — suggest similar tools
  const similar = findSimilarTools(tools, tool_name);
  const hint = similar.length > 0
    ? `\n\nDid you mean one of these?\n${similar.map(s => `  - ${s}`).join('\n')}`
    : '\n\nUse search_tools("keyword") to find the correct tool name.';
  return { content: `Tool '${tool_name}' not found.${hint}`, isError: true };
}

/**
 * Shared handler for get_tool_help meta-tool
 */
async function executeGetToolHelp(
  tools: ToolRegistry,
  args: Record<string, unknown>,
): Promise<CoreToolResult> {
  const { tool_name, tool_names } = args as { tool_name?: string; tool_names?: string[] };

  const names: string[] = tool_names?.length ? tool_names : tool_name ? [tool_name] : [];
  if (names.length === 0) {
    return { content: 'Provide either "tool_name" (string) or "tool_names" (array) parameter.', isError: true };
  }

  const results: string[] = [];
  const notFound: string[] = [];
  for (const name of names) {
    if (!tools.getDefinition(name)) {
      notFound.push(name);
      continue;
    }
    results.push(formatFullToolHelp(tools, name));
  }

  if (notFound.length > 0) {
    const similar = notFound.flatMap(n => findSimilarTools(tools, n));
    const hintText = similar.length > 0
      ? `\nDid you mean one of these?\n${[...new Set(similar)].map(s => `  • ${s}`).join('\n')}\n\nUse search_tools("keyword") to find the correct tool name.`
      : '\nUse search_tools("keyword") to discover available tools.';
    results.push(`Tools not found: ${notFound.join(', ')}${hintText}`);
  }

  return { content: results.join('\n\n---\n\n'), isError: notFound.length > 0 && results.length === notFound.length };
}

/**
 * Get workspace context for file operations
 * @param sessionWorkspaceDir Optional session-specific workspace directory
 */
export function getWorkspaceContext(sessionWorkspaceDir?: string): WorkspaceContext {
  const workspaceDir = sessionWorkspaceDir ?? process.env.WORKSPACE_DIR ?? process.cwd();
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? undefined;
  const tempDir = process.platform === 'win32' ? 'C:\\Temp' : '/tmp';

  return {
    workspaceDir,
    homeDir,
    tempDir,
  };
}

// Path to provider configs
/**
 * Load provider config from core module
 * Uses the core's getProviderConfig which properly resolves JSON paths
 */
function loadProviderConfig(providerId: string): { baseUrl?: string; apiKeyEnv?: string; type?: string } | null {
  // 1. Check builtin provider configs
  const config = coreGetProviderConfig(providerId);
  if (config) {
    return {
      baseUrl: config.baseUrl,
      apiKeyEnv: config.apiKeyEnv,
      type: config.type,
    };
  }

  // 2. Check local providers (sync access via cache)
  const localProv = localProvidersRepo.getProviderSync(providerId);
  if (localProv) {
    // Ensure baseUrl ends with /v1 for OpenAI-compatible chat/completions endpoint
    // Discovery uses its own endpoint paths, but the provider SDK appends /chat/completions
    const base = localProv.baseUrl.replace(/\/+$/, '');
    const baseUrl = base.endsWith('/v1') ? base : `${base}/v1`;
    return {
      baseUrl,
      apiKeyEnv: undefined,
      type: 'openai-compatible',
    };
  }

  return null;
}

/**
 * Resolve toolGroups to individual tool names
 */
function resolveToolGroups(toolGroups: string[] | undefined, explicitTools: string[] | undefined): string[] {
  const tools = new Set<string>();

  // Add explicit tools first
  if (explicitTools && explicitTools.length > 0) {
    for (const tool of explicitTools) {
      tools.add(tool);
    }
  }

  // Add tools from groups
  if (toolGroups && toolGroups.length > 0) {
    for (const groupId of toolGroups) {
      const group = TOOL_GROUPS[groupId];
      if (group) {
        for (const tool of group.tools) {
          tools.add(tool);
        }
      }
    }
  }

  return Array.from(tools);
}


// Runtime agent cache (runtime instances, not serializable)
const agentCache = new Map<string, Agent>();
const agentConfigCache = new Map<string, AgentConfig>();
const chatAgentCache = new Map<string, Agent>(); // Chat agents keyed by provider:model
// Cache size limits imported from config/defaults.ts

/** LRU touch: move entry to end of Map iteration order */
function lruGet<V>(cache: Map<string, V>, key: string): V | undefined {
  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

// In-flight creation promises to prevent duplicate concurrent creation
const pendingAgents = new Map<string, Promise<Agent>>();
const pendingChatAgents = new Map<string, Promise<Agent>>();

/**
 * Clear all agent caches
 * Call this when custom tools, plugins, or other dynamic resources change
 */
export function invalidateAgentCache(): void {
  agentCache.clear();
  agentConfigCache.clear();
  chatAgentCache.clear();
  pendingAgents.clear();
  pendingChatAgents.clear();
  log.info('Agent cache invalidated due to tool/plugin changes');
}

/**
 * Generate unique agent ID
 */
function generateAgentId(): string {
  return generateId('agent');
}

/**
 * Create a requestApproval callback for agent configs.
 * Bridges the Agent tool system to the ApprovalManager.
 */
function createApprovalCallback(): AgentConfig['requestApproval'] {
  return async (category, actionType, description, params) => {
    const approvalMgr = getApprovalManager();
    const result = await approvalMgr.requestApproval(
      'default',
      category as ActionCategory,
      actionType,
      description,
      params,
    );
    if (!result) return true;
    if (result.action.status === 'rejected') return false;
    return false;
  };
}

/** Resolve configured tools and toolGroups from an agent record's config */
function resolveRecordTools(config: Record<string, unknown>): {
  configuredTools: string[] | undefined;
  configuredToolGroups: string[] | undefined;
  tools: string[];
} {
  const configuredTools = safeStringArray(config.tools);
  const configuredToolGroups = safeStringArray(config.toolGroups);
  const tools = resolveToolGroups(configuredToolGroups, configuredTools);
  return { configuredTools, configuredToolGroups, tools };
}

/** Build standardized agent config response object */
function buildAgentConfigResponse(config: Record<string, unknown>, configuredTools: string[] | undefined, configuredToolGroups: string[] | undefined) {
  return {
    maxTokens: (config.maxTokens as number) ?? AGENT_CREATE_DEFAULT_MAX_TOKENS,
    temperature: (config.temperature as number) ?? AGENT_DEFAULT_TEMPERATURE,
    maxTurns: (config.maxTurns as number) ?? AGENT_DEFAULT_MAX_TURNS,
    maxToolCalls: (config.maxToolCalls as number) ?? AGENT_DEFAULT_MAX_TOOL_CALLS,
    tools: configuredTools,
    toolGroups: configuredToolGroups,
  };
}

/** Invalidate both agent caches for a given agent ID */
function evictAgentFromCache(id: string): void {
  agentCache.delete(id);
  agentConfigCache.delete(id);
}

/**
 * Create runtime Agent instance from database record
 */
async function createAgentFromRecord(record: AgentRecord): Promise<Agent> {
  // Resolve "default" provider/model to actual values via IProviderService
  const providerSvc = hasServiceRegistry()
    ? getServiceRegistry().tryGet(Services.Provider)
    : null;

  const { provider: resolvedProvider, model: resolvedModel } = providerSvc
    ? await providerSvc.resolve({ provider: record.provider, model: record.model })
    : await resolveProviderAndModel(record.provider, record.model);

  // Validate resolved values
  if (!resolvedProvider) {
    throw new Error('No provider configured. Configure a provider in Settings.');
  }
  if (!resolvedModel) {
    throw new Error(`No model configured for provider: ${resolvedProvider}`);
  }

  const apiKey = await getProviderApiKey(resolvedProvider);
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${resolvedProvider}`);
  }

  // Load provider config to get baseUrl for non-native providers
  const providerConfig = loadProviderConfig(resolvedProvider);
  const baseUrl = providerConfig?.baseUrl;

  // Determine the actual provider type for the core library
  const providerType = NATIVE_PROVIDERS.has(resolvedProvider) ? resolvedProvider : 'openai';

  // Create tool registry with ALL tools (not just core)
  const tools = new ToolRegistry();
  registerAllTools(tools);
  tools.setConfigCenter(gatewayConfigCenter);

  // Register all gateway domain tools (memory, goals, etc.) with tracing
  const userId = 'default';
  registerGatewayTools(tools, userId, true);

  // Register dynamic tools (CRUD meta-tools, special meta-tools, active custom tools)
  const activeCustomToolDefs = await registerDynamicTools(tools, userId, record.id, true);
  log.info(`Registered ${activeCustomToolDefs.length} active custom tools`);

  // Register plugin tools and remove superseded core stubs
  const pluginToolDefs = registerPluginTools(tools, true);
  log.info(`Registered ${pluginToolDefs.length} plugin tools`);

  // Register skill package tools (from installed skill packages)
  const skillPackageToolDefs = registerSkillPackageTools(tools, userId, true);
  if (skillPackageToolDefs.length > 0) {
    log.info(`Registered ${skillPackageToolDefs.length} skill package tools`);
  }

  // Register MCP tools from connected external MCP servers
  const mcpToolDefs = registerMcpTools(tools, true);
  if (mcpToolDefs.length > 0) {
    log.info(`Registered ${mcpToolDefs.length} MCP tools`);
  }

  // Separate standard tools (from TOOL_GROUPS) and special tools that bypass filtering
  // Filter getToolDefinitions() to exclude stubs that were unregistered above
  const coreToolDefs = getToolDefinitions().filter(t => tools.has(t.name));
  const standardToolDefs = [...coreToolDefs, ...MEMORY_TOOLS, ...GOAL_TOOLS, ...CUSTOM_DATA_TOOLS, ...PERSONAL_DATA_TOOLS, ...CONFIG_TOOLS, ...TRIGGER_TOOLS, ...PLAN_TOOLS, ...HEARTBEAT_TOOLS, ...SKILL_PACKAGE_TOOLS];

  // These tools ALWAYS bypass toolGroup filtering:
  // - DYNAMIC_TOOL_DEFINITIONS: Meta-tools for managing custom tools (create_tool, etc.)
  // - activeCustomToolDefs: User's custom tools (always available when active)
  // - pluginToolDefs: Plugin-provided tools (explicitly installed by user)
  // - skillPackageToolDefs: Skill package tools (explicitly installed by user)
  // - mcpToolDefs: MCP tools from connected external servers
  const alwaysIncludedToolDefs = [...DYNAMIC_TOOL_DEFINITIONS, ...activeCustomToolDefs, ...pluginToolDefs, ...skillPackageToolDefs, ...mcpToolDefs];

  // Filter tools based on agent's toolGroups configuration
  const { tools: resolvedToolNames } = resolveRecordTools(record.config);
  const allowedToolNames = new Set(resolvedToolNames);

  // Only filter standard tools by toolGroups
  // Custom tools, dynamic tools, plugin tools, and skill package tools are ALWAYS included
  // If no toolGroups are configured, include all standard tools (backwards compatibility)
  const filteredStandardTools = allowedToolNames.size > 0
    ? standardToolDefs.filter(tool => allowedToolNames.has(tool.name) || allowedToolNames.has(getBaseName(tool.name)))
    : standardToolDefs;

  const toolDefs = [...filteredStandardTools, ...alwaysIncludedToolDefs];

  // Note: Memory/goal context is NOT injected here at agent creation time.
  // The MessageBus context-injection middleware (or buildEnhancedSystemPrompt)
  // injects fresh memory/goal context per-request, avoiding duplicate DB fetches.
  const basePrompt = record.systemPrompt ?? 'You are a helpful personal AI assistant.';

  let { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(basePrompt, {
    userId: 'default',
    tools: toolDefs,
    workspaceContext: getWorkspaceContext(),
    includeProfile: true,
    includeInstructions: true,
    includeTimeContext: true,
    includeToolDescriptions: true,
  });

  // Inject skill package system prompts
  try {
    const skillPromptSections = getSkillPackageService().getSystemPromptSections();
    if (skillPromptSections.length > 0) {
      enhancedPrompt += '\n\n' + skillPromptSections.join('\n\n');
    }
  } catch {
    log.debug('Skill package service not initialized, skipping system prompt injection');
  }

  // Only expose meta-tools (search_tools, get_tool_help, use_tool) to the API.
  // This prevents 100+ tool schemas from consuming ~20K+ tokens per request.
  // All tools remain registered in the ToolRegistry and can be executed via use_tool proxy.
  const metaToolFilter = AI_META_TOOL_NAMES.map(n => unsafeToolId(n));

  const config: AgentConfig = {
    name: record.name,
    systemPrompt: enhancedPrompt,
    provider: {
      provider: providerType as AIProvider,
      apiKey,
      baseUrl,
    },
    model: {
      model: resolvedModel,
      maxTokens: (record.config.maxTokens as number) ?? AGENT_DEFAULT_MAX_TOKENS,
      temperature: (record.config.temperature as number) ?? AGENT_DEFAULT_TEMPERATURE,
    },
    maxTurns: (record.config.maxTurns as number) ?? AGENT_DEFAULT_MAX_TURNS,
    maxToolCalls: (record.config.maxToolCalls as number) ?? AGENT_DEFAULT_MAX_TOOL_CALLS,
    tools: metaToolFilter,
    requestApproval: createApprovalCallback(),
  };

  const agent = createAgent(config, { tools });

  // Evict oldest entry if cache is at capacity
  if (agentCache.size >= MAX_AGENT_CACHE_SIZE) {
    const oldestKey = agentCache.keys().next().value;
    if (oldestKey) {
      evictAgentFromCache(oldestKey);
    }
  }

  agentCache.set(record.id, agent);
  agentConfigCache.set(record.id, config);

  return agent;
}

/**
 * Get or create runtime Agent instance.
 * Uses promise-based deduplication so concurrent requests for the same agent
 * share a single createAgentFromRecord call instead of racing.
 */
async function getOrCreateAgentInstance(record: AgentRecord): Promise<Agent> {
  const cached = lruGet(agentCache, record.id);
  if (cached) return cached;

  // Check if creation is already in-flight
  const pending = pendingAgents.get(record.id);
  if (pending) return pending;

  // Start creation and store the promise for deduplication
  const promise = createAgentFromRecord(record).finally(() => {
    pendingAgents.delete(record.id);
  });
  pendingAgents.set(record.id, promise);

  return promise;
}

export const agentRoutes = new Hono();

/**
 * List all agents (capped at 100)
 */
agentRoutes.get('/', async (c) => {
  const allRecords = await agentsRepo.getAll();
  const total = allRecords.length;
  const records = allRecords.slice(0, 100);

  const agentList: AgentInfo[] = records.map((record) => {
    const { tools } = resolveRecordTools(record.config);

    return {
      id: record.id,
      name: record.name,
      provider: record.provider,
      model: record.model,
      tools,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  });

  return apiResponse(c, { items: agentList, total, limit: 100, hasMore: total > 100 });
});

/**
 * Create a new agent
 *
 * Provider and model default to 'default' which resolves to user's configured defaults at runtime.
 * Tools can be specified explicitly via 'tools' array or via 'toolGroups' array.
 */
agentRoutes.post('/', async (c) => {
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, createAgentSchema } = await import('../middleware/validation.js');
  const body = validateBody(createAgentSchema, rawBody) as CreateAgentRequest;

  // Default to 'default' for provider and model
  // These will be resolved to actual values at runtime when the agent is used
  const provider = body.provider ?? 'default';
  const model = body.model ?? 'default';

  // Note: API key validation is skipped during agent creation
  // The key is only required when actually using the agent

  // Generate agent ID
  const id = generateAgentId();

  // Store in database with both tools and toolGroups
  const record = await agentsRepo.create({
    id,
    name: body.name,
    systemPrompt: body.systemPrompt,
    provider,
    model,
    config: {
      maxTokens: body.maxTokens ?? AGENT_CREATE_DEFAULT_MAX_TOKENS,
      temperature: body.temperature ?? AGENT_DEFAULT_TEMPERATURE,
      maxTurns: body.maxTurns ?? AGENT_DEFAULT_MAX_TURNS,
      maxToolCalls: body.maxToolCalls ?? AGENT_DEFAULT_MAX_TOOL_CALLS,
      tools: body.tools,
      toolGroups: body.toolGroups,
    },
  });

  // Return the stored record without creating runtime agent
  // Runtime agent will be created on-demand when the agent is used
  const config = record.config as Record<string, unknown>;
  const configuredTools = safeStringArray(config.tools);
  const configuredToolGroups = safeStringArray(config.toolGroups);
  const tools = resolveToolGroups(configuredToolGroups, configuredTools);

  wsGateway.broadcast('data:changed', { entity: 'agent', action: 'created', id: record.id });
  return apiResponse(c, {
    id: record.id,
    name: record.name,
    provider: record.provider,
    model: record.model,
    tools,
    createdAt: record.createdAt.toISOString(),
  }, 201);
});

/**
 * Get agent by ID (with full details)
 */
agentRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const record = await agentsRepo.getById(id);

  if (!record) {
    return notFoundError(c, 'Agent', id);
  }

  const { configuredTools, configuredToolGroups, tools: resolvedTools } = resolveRecordTools(record.config);
  let tools = resolvedTools.length > 0 ? resolvedTools : ['get_current_time', 'calculate'];

  // Try to get actual tools from runtime instance (if agent was already created)
  try {
    const cachedAgent = agentCache.get(record.id);
    if (cachedAgent) {
      tools = cachedAgent.getTools().map((t) => t.name);
    }
  } catch {
    // Use resolved tools from config
  }

  return apiResponse(c, {
    id: record.id,
    name: record.name,
    provider: record.provider,
    model: record.model,
    systemPrompt: record.systemPrompt ?? '',
    tools,
    config: buildAgentConfigResponse(record.config, configuredTools, configuredToolGroups),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
});

/**
 * Update agent
 *
 * Provider/model can be set to 'default' to use user's configured defaults.
 * Tools can be updated via 'tools' array or 'toolGroups' array.
 */
agentRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, updateAgentSchema } = await import('../middleware/validation.js');
  const body = validateBody(updateAgentSchema, rawBody) as UpdateAgentRequest;

  const existing = await agentsRepo.getById(id);
  if (!existing) {
    return notFoundError(c, 'Agent', id);
  }

  // If provider is being changed to a specific provider (not 'default'), validate API key
  if (body.provider && body.provider !== 'default' && body.provider !== existing.provider) {
    const apiKey = await getProviderApiKey(body.provider);
    if (!apiKey) {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: `API key not configured for provider: ${sanitizeId(body.provider)}` }, 400);
    }
  }

  // Build config updates
  const existingConfig = existing.config as Record<string, unknown>;
  const newConfig = { ...existingConfig };

  if (body.maxTokens !== undefined) newConfig.maxTokens = body.maxTokens;
  if (body.temperature !== undefined) newConfig.temperature = body.temperature;
  if (body.maxTurns !== undefined) newConfig.maxTurns = body.maxTurns;
  if (body.maxToolCalls !== undefined) newConfig.maxToolCalls = body.maxToolCalls;
  if (body.tools !== undefined) newConfig.tools = body.tools;
  if (body.toolGroups !== undefined) newConfig.toolGroups = body.toolGroups;

  // Update database
  const updated = await agentsRepo.update(id, {
    name: body.name,
    systemPrompt: body.systemPrompt,
    provider: body.provider,
    model: body.model,
    config: newConfig,
  });

  if (!updated) {
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: 'Failed to update agent' }, 500);
  }

  // Invalidate cache to force recreation with new config
  evictAgentFromCache(id);

  const { configuredTools, configuredToolGroups, tools } = resolveRecordTools(newConfig);

  wsGateway.broadcast('data:changed', { entity: 'agent', action: 'updated', id });
  return apiResponse(c, {
    id: updated.id,
    name: updated.name,
    provider: updated.provider,
    model: updated.model,
    systemPrompt: updated.systemPrompt ?? '',
    tools,
    config: buildAgentConfigResponse(newConfig, configuredTools, configuredToolGroups),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

/**
 * Delete agent
 */
agentRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const deleted = await agentsRepo.delete(id);

  if (!deleted) {
    return notFoundError(c, 'Agent', id);
  }

  // Clear from cache
  evictAgentFromCache(id);

  wsGateway.broadcast('data:changed', { entity: 'agent', action: 'deleted', id });
  return apiResponse(c, {});
});

/**
 * Reset agent conversation
 */
agentRoutes.post('/:id/reset', async (c) => {
  const id = c.req.param('id');
  const record = await agentsRepo.getById(id);

  if (!record) {
    return notFoundError(c, 'Agent', id);
  }

  const agent = await getOrCreateAgentInstance(record);
  const conversation = agent.reset();

  return apiResponse(c, {
    conversationId: conversation.id,
  });
});

/**
 * Resync agents from default JSON file
 * Updates existing agents with new toolGroups configuration
 */
agentRoutes.post('/resync', async (c) => {
  const { getDefaultAgents } = await import('../db/seeds/default-agents.js');
  const defaultAgents = getDefaultAgents();

  let updated = 0;
  let created = 0;
  const errors: string[] = [];

  for (const agent of defaultAgents) {
    try {
      const existing = await agentsRepo.getById(agent.id);

      if (existing) {
        // Update existing agent config with new toolGroups
        await agentsRepo.update(agent.id, {
          config: {
            ...existing.config,
            ...agent.config,
          },
        });
        // Clear cache to force recreation
        evictAgentFromCache(agent.id);
        updated++;
      } else {
        // Create new agent
        await agentsRepo.create({
          id: agent.id,
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          provider: agent.provider,
          model: agent.model,
          config: agent.config,
        });
        created++;
      }
    } catch (error) {
      errors.push(`${agent.id}: ${getErrorMessage(error)}`);
    }
  }

  return apiResponse(c, {
    updated,
    created,
    total: defaultAgents.length,
    errors: errors.length > 0 ? errors : undefined,
  });
});

/**
 * Get agent from store (database + cache).
 * Uses promise-based deduplication to prevent concurrent creation races.
 */
export async function getAgent(id: string): Promise<Agent | undefined> {
  // First check cache (LRU touch)
  const cached = lruGet(agentCache, id);
  if (cached) return cached;

  // Check if creation is already in-flight
  const pending = pendingAgents.get(id);
  if (pending) {
    try {
      return await pending;
    } catch {
      return undefined;
    }
  }

  // Try to load from database
  const record = await agentsRepo.getById(id);
  if (!record) return undefined;

  // Create runtime instance with deduplication
  const promise = createAgentFromRecord(record).finally(() => {
    pendingAgents.delete(id);
  });
  pendingAgents.set(id, promise);

  try {
    return await promise;
  } catch {
    return undefined;
  }
}

/**
 * Get or create default agent.
 * Uses promise-based deduplication to prevent concurrent creation races.
 */
export async function getOrCreateDefaultAgent(): Promise<Agent> {
  const defaultId = 'default';

  // Check cache first (LRU touch)
  const cached = lruGet(agentCache, defaultId);
  if (cached) return cached;

  // Check if creation is already in-flight
  const pending = pendingAgents.get(defaultId);
  if (pending) return pending;

  // Start creation and store the promise for deduplication
  const promise = (async () => {
    // Check database
    let record = await agentsRepo.getById(defaultId);

    if (!record) {
      // Find first configured provider dynamically
      const provider = await getDefaultProvider();
      if (!provider) {
        throw new Error('No API key configured for any provider. Configure a provider in Settings.');
      }

      const model = await getDefaultModel(provider);
      if (!model) {
        throw new Error(`No model available for provider: ${provider}`);
      }

      record = await agentsRepo.create({
        id: defaultId,
        name: 'Personal Assistant',
        systemPrompt: BASE_SYSTEM_PROMPT,
        provider,
        model,
        config: {
          maxTokens: AGENT_DEFAULT_MAX_TOKENS,
          temperature: AGENT_DEFAULT_TEMPERATURE,
          maxTurns: AGENT_DEFAULT_MAX_TURNS,
          maxToolCalls: AGENT_DEFAULT_MAX_TOOL_CALLS,
        },
      });
    }

    // Create runtime instance with memory injection
    return createAgentFromRecord(record);
  })().finally(() => {
    pendingAgents.delete(defaultId);
  });
  pendingAgents.set(defaultId, promise);

  return promise;
}

/**
 * Get or create an agent for chat with specific provider and model.
 * This is used when the user selects a provider/model in the chat UI.
 * Uses promise-based deduplication to prevent concurrent creation races.
 */
export async function getOrCreateChatAgent(provider: string, model: string): Promise<Agent> {
  const cacheKey = `chat|${provider.replace(/\|/g, '_')}|${model.replace(/\|/g, '_')}`;

  // Check cache first (LRU touch)
  const cached = lruGet(chatAgentCache, cacheKey);
  if (cached) return cached;

  // Check if creation is already in-flight
  const pending = pendingChatAgents.get(cacheKey);
  if (pending) return pending;

  // Start creation and store the promise for deduplication
  const promise = createChatAgentInstance(provider, model, cacheKey).finally(() => {
    pendingChatAgents.delete(cacheKey);
  });
  pendingChatAgents.set(cacheKey, promise);

  return promise;
}

/**
 * Internal: Create a chat agent instance (extracted for deduplication wrapper).
 */
async function createChatAgentInstance(provider: string, model: string, cacheKey: string): Promise<Agent> {
  // Get API key for the provider
  const apiKey = await getProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${provider}`);
  }

  // Load provider config to get baseUrl
  const providerConfig = loadProviderConfig(provider);
  const baseUrl = providerConfig?.baseUrl;

  // Determine the actual provider type for the core library
  // Native providers: openai, anthropic, google, etc.
  // Others use 'openai' type with custom baseUrl (openai-compatible)
  const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';

  // Create tools registry with ALL tools
  const tools = new ToolRegistry();
  registerAllTools(tools);
  tools.setConfigCenter(gatewayConfigCenter);

  // Register all gateway domain tools (memory, goals, etc.) without tracing
  const userId = 'default';
  registerGatewayTools(tools, userId, false);

  // Register dynamic tools (CRUD meta-tools, special meta-tools, active custom tools)
  const activeCustomToolDefs = await registerDynamicTools(tools, userId, `chat_${provider}_${model}`, false);

  // Register plugin tools and remove superseded core stubs
  const pluginToolDefs = registerPluginTools(tools, false);

  // Register skill package tools (from installed skill packages)
  const skillPackageToolDefs = registerSkillPackageTools(tools, userId, false);

  // Register MCP tools from connected external MCP servers
  const mcpToolDefs = registerMcpTools(tools, false);

  // Get tool definitions for prompt injection (including all registered tools)
  // Filter getToolDefinitions() to exclude stubs removed above
  const chatCoreToolDefs = getToolDefinitions().filter(t => tools.has(t.name));
  const toolDefs = [...chatCoreToolDefs, ...MEMORY_TOOLS, ...GOAL_TOOLS, ...CUSTOM_DATA_TOOLS, ...PERSONAL_DATA_TOOLS, ...CONFIG_TOOLS, ...TRIGGER_TOOLS, ...PLAN_TOOLS, ...HEARTBEAT_TOOLS, ...SKILL_PACKAGE_TOOLS, ...DYNAMIC_TOOL_DEFINITIONS, ...activeCustomToolDefs, ...pluginToolDefs, ...skillPackageToolDefs, ...mcpToolDefs];

  // Inject personal memory into system prompt
  const basePrompt = BASE_SYSTEM_PROMPT;
  let { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(basePrompt, {
    userId: 'default',
    tools: toolDefs,
    workspaceContext: getWorkspaceContext(),
    includeProfile: true,
    includeInstructions: true,
    includeTimeContext: true,
    includeToolDescriptions: true,
  });

  // Inject skill package system prompts
  try {
    const skillPromptSections = getSkillPackageService().getSystemPromptSections();
    if (skillPromptSections.length > 0) {
      enhancedPrompt += '\n\n' + skillPromptSections.join('\n\n');
    }
  } catch {
    log.debug('Skill package service not initialized, skipping system prompt injection');
  }

  // Only expose meta-tools to the API to prevent token bloat from 100+ tool schemas.
  const chatMetaToolFilter = AI_META_TOOL_NAMES.map(n => unsafeToolId(n));

  // Create agent config
  const config: AgentConfig = {
    name: `Personal Assistant (${provider})`,
    systemPrompt: enhancedPrompt,
    provider: {
      provider: providerType as AIProvider,
      apiKey,
      baseUrl, // Pass baseUrl for custom/compatible providers
    },
    model: {
      model,
      maxTokens: AGENT_DEFAULT_MAX_TOKENS,
      temperature: AGENT_DEFAULT_TEMPERATURE,
    },
    maxTurns: AGENT_DEFAULT_MAX_TURNS,
    maxToolCalls: AGENT_DEFAULT_MAX_TOOL_CALLS,
    tools: chatMetaToolFilter,
    requestApproval: createApprovalCallback(),
  };

  // Create and cache the agent (evict oldest if at capacity)
  if (chatAgentCache.size >= MAX_CHAT_AGENT_CACHE_SIZE) {
    const oldestKey = chatAgentCache.keys().next().value;
    if (oldestKey) chatAgentCache.delete(oldestKey);
  }

  const agent = createAgent(config, { tools });
  chatAgentCache.set(cacheKey, agent);

  return agent;
}

/**
 * Reset chat agent context - clears conversation memory
 * Call this when user starts a "New Chat"
 */
export function resetChatAgentContext(provider: string, model: string): { reset: boolean; newSessionId?: string } {
  const cacheKey = `chat|${provider.replace(/\|/g, '_')}|${model.replace(/\|/g, '_')}`;
  const agent = chatAgentCache.get(cacheKey);

  if (agent) {
    // Clear the conversation memory and create a fresh conversation
    const memory = agent.getMemory();
    const currentConversation = agent.getConversation();

    // Delete the old conversation
    memory.delete(currentConversation.id);

    // Create a new conversation with the same system prompt
    const newConversation = memory.create(currentConversation.systemPrompt);
    agent.loadConversation(newConversation.id);

    log.info(`Reset context for ${provider}/${model}, new conversation: ${newConversation.id}`);
    return { reset: true, newSessionId: newConversation.id };
  }

  return { reset: false };
}

/**
 * Get session info (context usage) for an agent's current conversation.
 * Uses ConversationMemory.getStats() for token estimation and getModelPricing() for context window size.
 */
export function getSessionInfo(agent: Agent, provider: string, model: string): SessionInfo {
  const conversation = agent.getConversation();
  const memory = agent.getMemory();
  const stats = memory.getStats(conversation.id);
  const pricing = getModelPricing(provider as AIProvider, model);
  const maxCtx = pricing?.contextWindow ?? 128_000;
  const estimated = stats?.estimatedTokens ?? 0;

  return {
    sessionId: conversation.id,
    messageCount: stats?.messageCount ?? 0,
    estimatedTokens: estimated,
    maxContextTokens: maxCtx,
    contextFillPercent: Math.min(100, Math.round((estimated / maxCtx) * 100)),
  };
}

/**
 * Clear all chat agent caches - useful for full reset
 */
export function clearAllChatAgentCaches(): number {
  const count = chatAgentCache.size;
  chatAgentCache.clear();
  log.info(`Cleared ${count} cached chat agents`);
  return count;
}

/**
 * Helper: Get API key for a provider
 * Uses getApiKey from settings which checks both env vars and database
 */
async function getProviderApiKey(provider: string): Promise<string | undefined> {
  // Check local provider first (may have its own API key, or none required)
  const localProv = await localProvidersRepo.getProvider(provider);
  if (localProv) {
    // Local providers may not require API key; return key or a dummy placeholder
    return localProv.apiKey || 'local-no-key';
  }
  // Fallback to remote provider API key
  return await getApiKey(provider);
}

// getDefaultModel is imported from settings.ts
export { getDefaultModel } from './settings.js';

/**
 * Check if demo mode is enabled (no API keys configured)
 */
export async function isDemoMode(): Promise<boolean> {
  // Batch-check all providers in one query instead of 11 sequential queries
  const configured = await getConfiguredProviderIds();
  const providers = [
    'openai', 'anthropic', 'zhipu', 'deepseek', 'groq',
    'google', 'xai', 'mistral', 'together', 'fireworks', 'perplexity'
  ];
  return !providers.some(p => configured.has(p));
}
