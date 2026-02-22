/**
 * Agent tool registration and meta-tool executors.
 *
 * Extracted from agents.ts — contains all tool registration functions
 * and the shared meta-tool handlers (search_tools, use_tool, etc.).
 */

import {
  ToolRegistry,
  registerAllTools,
  getToolDefinitions,
  MEMORY_TOOLS,
  GOAL_TOOLS,
  CUSTOM_DATA_TOOLS,
  PERSONAL_DATA_TOOLS,
  DYNAMIC_TOOL_DEFINITIONS,
  TOOL_SEARCH_TAGS,
  applyToolLimits,
  findSimilarToolNames,
  formatFullToolHelp,
  buildToolHelpText,
  validateRequiredParams,
  type ToolDefinition,
  type ToolExecutionResult as CoreToolResult,
  type ToolContext,
  qualifyToolName,
  getBaseName,
  getServiceRegistry,
  Services,
} from '@ownpilot/core';
import { executeMemoryTool } from './memories.js';
import { executeGoalTool } from './goals.js';
import { executeCustomDataTool } from './custom-data.js';
import { executePersonalDataTool } from './personal-data-tools.js';
import {
  executeCustomToolTool,
  executeActiveCustomTool,
  getActiveCustomToolDefinitions,
} from './custom-tools.js';
import { getCustomToolDynamicRegistry } from '../services/custom-tool-registry.js';
import { getToolSource } from '../services/tool-source.js';
import { getSharedToolRegistry } from '../services/tool-executor.js';
import { createCustomToolsRepo } from '../db/repositories/custom-tools.js';
import {
  TRIGGER_TOOLS,
  executeTriggerTool,
  PLAN_TOOLS,
  executePlanTool,
  HEARTBEAT_TOOLS,
  executeHeartbeatTool,
  EXTENSION_TOOLS,
  executeExtensionTool,
} from '../tools/index.js';
import { CONFIG_TOOLS, executeConfigTool } from '../services/config-tools.js';
import type { ExtensionService } from '../services/extension-service.js';
import {
  traceToolCallStart,
  traceToolCallEnd,
  traceDbWrite,
  traceDbRead,
} from '../tracing/index.js';
import { getErrorMessage, truncate } from './helpers.js';
import {
  TOOL_ARGS_MAX_SIZE,
  MAX_BATCH_TOOL_CALLS,
  AI_META_TOOL_NAMES,
} from '../config/defaults.js';
import { getLog } from '../services/log.js';

const log = getLog('AgentTools');

// =============================================================================
// Helpers
// =============================================================================

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
  definitions: readonly ToolDefinition[];
  executor: ToolExecutor;
  needsUserId: boolean;
}

/**
 * Convert a tool execution result to the CoreToolResult format.
 */
function toToolResult(result: {
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

/**
 * Register plugin-provided tools and remove superseded core stubs.
 * Used by both agent and chat endpoints.
 *
 * @returns The plugin tool definitions (needed for tool-list assembly).
 */
export function registerPluginTools(tools: ToolRegistry, trace: boolean): ToolDefinition[] {
  const pluginService = getServiceRegistry().get(Services.Plugin);
  const pluginTools = pluginService.getAllTools();
  const pluginToolDefs: ToolDefinition[] = [];

  // Collect core-category plugin IDs — their tools are already registered by registerAllTools()
  // as core.* (same logic as tool-executor.ts line 132)
  const corePluginIds = new Set(
    pluginService
      .getEnabled()
      .filter((p: { manifest: { category?: string } }) => p.manifest.category === 'core')
      .map((p: { manifest: { id: string } }) => p.manifest.id)
  );

  for (const { pluginId, definition, executor } of pluginTools) {
    // Skip core-category plugins — their tools are already registered by registerAllTools()
    if (corePluginIds.has(pluginId)) continue;

    const qName = qualifyToolName(definition.name, 'plugin', pluginId);
    const qDef = { ...definition, name: qName };
    const wrappedExecutor = async (
      args: unknown,
      context: ToolContext
    ): Promise<CoreToolResult> => {
      const startTime = trace
        ? traceToolCallStart(definition.name, args as Record<string, unknown>)
        : 0;
      try {
        const result = await executor(args as Record<string, unknown>, context);
        if (trace)
          traceToolCallEnd(
            definition.name,
            startTime,
            !result.isError,
            result.content,
            result.isError ? String(result.content) : undefined
          );
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
  const pluginToolBaseNames = new Set(pluginToolDefs.map((t) => getBaseName(t.name)));
  removeSupersededCoreStubs(tools, pluginToolBaseNames);

  return pluginToolDefs;
}

/**
 * Register extension tools (from installed user extensions).
 * Extension tools are registered in the DynamicToolRegistry (same sandbox as custom tools)
 * and then exposed on the ToolRegistry for agent access.
 *
 * @returns The extension tool definitions (needed for tool-list assembly).
 */
export function registerExtensionTools(
  tools: ToolRegistry,
  _userId: string,
  trace: boolean
): ToolDefinition[] {
  let service: ExtensionService;
  try {
    service = getServiceRegistry().get(Services.Extension) as ExtensionService;
  } catch {
    log.debug('Extension service not initialized, skipping tool registration');
    return [];
  }

  const extToolDefs = service.getToolDefinitions();
  if (extToolDefs.length === 0) return [];

  // Get the shared DynamicToolRegistry (same sandbox as custom tools)
  const dynamicRegistry = getCustomToolDynamicRegistry();

  const result: ToolDefinition[] = [];

  for (const def of extToolDefs) {
    // Register in DynamicToolRegistry if not already there (uses base name)
    if (!dynamicRegistry.has(def.name)) {
      try {
        dynamicRegistry.register({
          name: def.name,
          description: def.description,
          parameters: def.extensionTool.parameters as never,
          code: def.extensionTool.code,
          permissions: def.extensionTool.permissions as never,
        });
      } catch (error) {
        log.warn(`Failed to register extension tool "${def.name}"`, { error: String(error) });
        continue;
      }
    }

    // Choose namespace based on format: ownpilot → ext.*, agentskills → skill.*
    const nsPrefix = def.format === 'agentskills' ? 'skill' : 'ext';
    const qName = qualifyToolName(def.name, nsPrefix, def.extensionId);
    const toolDef: ToolDefinition = {
      name: def.name,
      description: def.description,
      parameters: def.parameters as ToolDefinition['parameters'],
      category: def.category,
    };

    const pluginId = `${nsPrefix}:${def.extensionId}` as import('@ownpilot/core').PluginId;
    const registerResult = tools.register(
      { ...toolDef, name: qName },
      async (args, context): Promise<CoreToolResult> => {
        const startTime = trace ? traceToolCallStart(def.name, args as Record<string, unknown>) : 0;
        try {
          const execResult = await dynamicRegistry.execute(
            def.name,
            args as Record<string, unknown>,
            context
          );
          if (trace) {
            traceToolCallEnd(
              def.name,
              startTime,
              !execResult.isError,
              execResult.content,
              execResult.isError ? String(execResult.content) : undefined
            );
          }
          return {
            content: execResult.isError
              ? String(execResult.content)
              : JSON.stringify(execResult.content),
            isError: execResult.isError,
          };
        } catch (error) {
          const errorMsg = getErrorMessage(error);
          if (trace) traceToolCallEnd(def.name, startTime, false, undefined, errorMsg);
          return { content: errorMsg, isError: true };
        }
      },
      {
        source: 'dynamic',
        pluginId,
        trustLevel: 'sandboxed',
        providerName: `${nsPrefix}:${def.extensionId}`,
      }
    );

    if (!registerResult.ok) {
      log.warn(`Extension tool "${def.name}" skipped: ${registerResult.error.message}`);
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
export function registerMcpTools(tools: ToolRegistry, trace: boolean): ToolDefinition[] {
  const sharedRegistry = getSharedToolRegistry();
  const mcpTools = sharedRegistry.getToolsBySource('mcp');
  const mcpToolDefs: ToolDefinition[] = [];

  for (const registeredTool of mcpTools) {
    const { definition, executor } = registeredTool;

    const wrappedExecutor = async (
      args: unknown,
      context: ToolContext
    ): Promise<CoreToolResult> => {
      const startTime = trace
        ? traceToolCallStart(getBaseName(definition.name), args as Record<string, unknown>)
        : 0;
      try {
        const result = await executor(args as Record<string, unknown>, context);
        if (trace)
          traceToolCallEnd(
            getBaseName(definition.name),
            startTime,
            !result.isError,
            result.content,
            result.isError ? String(result.content) : undefined
          );
        return result;
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        if (trace)
          traceToolCallEnd(getBaseName(definition.name), startTime, false, undefined, errorMsg);
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
// Meta-tool executors
// =============================================================================

/** Compatibility wrapper: old 2-arg signature → new 3-arg from core */
function findSimilarTools(tools: ToolRegistry, query: string): string[] {
  return findSimilarToolNames(tools, query, 5);
}

/**
 * Shared use_tool executor — validates, caps, executes a single tool by name.
 * Used by both agent and chat tool registration paths.
 */
export async function executeUseTool(
  tools: ToolRegistry,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<CoreToolResult> {
  const { tool_name, arguments: toolArgs } = args as {
    tool_name: string;
    arguments: Record<string, unknown>;
  };

  // Check if tool exists — suggest similar names if not
  if (!tools.has(tool_name)) {
    const similar = findSimilarTools(tools, tool_name);
    const hint =
      similar.length > 0
        ? `\n\nDid you mean one of these?\n${similar.map((s) => `  • ${s}`).join('\n')}\n\nCall get_tool_help("tool_name") to see parameters, then retry with the correct name.`
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
export async function executeBatchUseTool(
  tools: ToolRegistry,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<CoreToolResult> {
  const { calls } = args as {
    calls: Array<{ tool_name: string; arguments: Record<string, unknown> }>;
  };

  if (!calls?.length) {
    return { content: 'Provide a "calls" array with at least one tool call.', isError: true };
  }

  if (calls.length > MAX_BATCH_TOOL_CALLS) {
    return {
      content: `Batch size ${calls.length} exceeds maximum of ${MAX_BATCH_TOOL_CALLS}. Split into smaller batches.`,
      isError: true,
    };
  }

  // Execute all tool calls in parallel
  const results = await Promise.allSettled(
    calls.map(async (call, idx) => {
      const { tool_name, arguments: toolArgs } = call;

      // Check tool exists
      if (!tools.has(tool_name)) {
        const similar = findSimilarTools(tools, tool_name);
        const hint = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
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
          return {
            idx,
            tool_name,
            ok: false,
            content: 'Tool arguments payload too large (max 100KB)',
          };
        }

        const cappedArgs = applyToolLimits(tool_name, toolArgs);
        // Forward the parent context so inner tools inherit executionPermissions, etc.
        const result = await tools.execute(tool_name, cappedArgs, context);
        if (result.ok) {
          return {
            idx,
            tool_name,
            ok: true,
            content:
              typeof result.value.content === 'string'
                ? result.value.content
                : JSON.stringify(result.value.content, null, 2),
          };
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

  const hasErrors = results.some(
    (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)
  );

  return {
    content: `[Batch: ${calls.length} tool calls]\n\n${sections.join('\n\n---\n\n')}`,
    isError:
      hasErrors &&
      results.every((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)),
  };
}

/**
 * Shared handler for search_tools meta-tool
 */
export async function executeSearchTools(
  tools: ToolRegistry,
  args: Record<string, unknown>
): Promise<CoreToolResult> {
  const {
    query,
    category: filterCategory,
    include_params,
  } = args as { query: string; category?: string; include_params?: boolean };
  const allDefs = tools.getDefinitions();
  const q = query.trim().toLowerCase();

  const showAll = q === 'all' || q === '*';
  const queryWords = q.split(/\s+/).filter(Boolean);

  const matches = allDefs.filter((d) => {
    if (AI_META_TOOL_NAMES.includes(d.name as (typeof AI_META_TOOL_NAMES)[number])) return false;
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
      ...tags.map((tag) => tag.toLowerCase()),
    ].join(' ');
    return queryWords.every((word) => searchBlob.includes(word));
  });

  if (matches.length === 0) {
    return {
      content: `No tools found for "${query}". Tips:\n- Search by individual keywords: "email" or "send"\n- Use multiple words for AND search: "email send" finds send_email\n- Use "all" to list every available tool\n- Try broad keywords: "task", "file", "web", "memory", "note", "calendar"`,
    };
  }

  if (include_params !== false) {
    const sections = matches.map((d) => formatFullToolHelp(tools, d.name));
    return {
      content: [
        `Found ${matches.length} tool(s) for "${query}" (with parameters):`,
        '',
        ...sections.join('\n\n---\n\n').split('\n'),
      ].join('\n'),
    };
  }

  const lines = matches.map((d) => `- **${d.name}**: ${truncate(d.description, 100)}`);
  return { content: [`Found ${matches.length} tool(s) for "${query}":`, '', ...lines].join('\n') };
}

/**
 * Shared handler for inspect_tool_source meta-tool
 */
export async function executeInspectToolSource(
  tools: ToolRegistry,
  userId: string,
  args: Record<string, unknown>
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
    sections.push(
      '',
      '### Improvement Tips',
      '- You can update this tool directly with `update_custom_tool`.'
    );
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
    sections.push(
      '',
      '### Improvement Tips',
      '- Built-in tools cannot be modified directly. Use `create_tool` to create an improved custom version that overrides or extends this tool.'
    );
    return { content: sections.join('\n') };
  }

  // 3. Not found — suggest similar tools
  const similar = findSimilarTools(tools, tool_name);
  const hint =
    similar.length > 0
      ? `\n\nDid you mean one of these?\n${similar.map((s) => `  - ${s}`).join('\n')}`
      : '\n\nUse search_tools("keyword") to find the correct tool name.';
  return { content: `Tool '${tool_name}' not found.${hint}`, isError: true };
}

/**
 * Shared handler for get_tool_help meta-tool
 */
export async function executeGetToolHelp(
  tools: ToolRegistry,
  args: Record<string, unknown>
): Promise<CoreToolResult> {
  const { tool_name, tool_names } = args as { tool_name?: string; tool_names?: string[] };

  const names: string[] = tool_names?.length ? tool_names : tool_name ? [tool_name] : [];
  if (names.length === 0) {
    return {
      content: 'Provide either "tool_name" (string) or "tool_names" (array) parameter.',
      isError: true,
    };
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
    const similar = notFound.flatMap((n) => findSimilarTools(tools, n));
    const hintText =
      similar.length > 0
        ? `\nDid you mean one of these?\n${[...new Set(similar)].map((s) => `  • ${s}`).join('\n')}\n\nUse search_tools("keyword") to find the correct tool name.`
        : '\nUse search_tools("keyword") to discover available tools.';
    results.push(`Tools not found: ${notFound.join(', ')}${hintText}`);
  }

  return {
    content: results.join('\n\n---\n\n'),
    isError: notFound.length > 0 && results.length === notFound.length,
  };
}

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
};
