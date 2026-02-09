/**
 * Agent management routes
 *
 * Agents are stored in SQLite database for persistence.
 * Runtime Agent instances are cached in memory for active use.
 */

import { Hono } from 'hono';
import { hasServiceRegistry, getServiceRegistry, Services } from '@ownpilot/core';
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
  type ToolExecutionResult as CoreToolResult,
  type ToolContext,
  type WorkspaceContext,
  unsafeToolId,
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
import { getToolSource } from '../services/tool-source.js';
import { createCustomToolsRepo } from '../db/repositories/custom-tools.js';
import { TRIGGER_TOOLS, executeTriggerTool, PLAN_TOOLS, executePlanTool } from '../tools/index.js';
import { CONFIG_TOOLS, executeConfigTool } from '../services/config-tools.js';
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
} from '../types/index.js';
import { apiResponse, apiError, ERROR_CODES, sanitizeId, notFoundError } from './helpers.js'
import { agentsRepo, localProvidersRepo, type AgentRecord } from '../db/repositories/index.js';
import { hasApiKey, getApiKey, resolveProviderAndModel, getDefaultProvider, getDefaultModel } from './settings.js';
import { gatewayConfigCenter } from '../services/config-center-impl.js';
import { getLog } from '../services/log.js';
import { getApprovalManager } from '../autonomy/index.js';
import { TOOL_ARGS_MAX_SIZE } from '../config/defaults.js';

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
- **Custom Data** — User-created tables with any schema (use \`search_tools("custom")\` to discover)
- **Memories** — Facts, preferences, and events you learn about the user

**Always use tools to access data.** Never fabricate, assume, or recall data from conversation history alone. Call the appropriate list/search tool to get the current state — data changes between conversations.

## Tool Improvement
- Use \`inspect_tool_source\` to view any tool's source code before suggesting improvements.
- For built-in tools: create an improved custom tool with \`create_tool\` that handles additional edge cases, better formatting, or extra features.
- For custom tools: use \`update_custom_tool\` to improve the existing code directly.
- Always explain what you improved and why before making changes.

## Memory Protocol
- Before answering questions about the user, call \`search_memories\` to recall relevant context.
- Search before creating to avoid duplicate memories.
- When you detect memorizable information (personal facts, preferences, events), do NOT save automatically. Instead, include a memory-save suggestion in your follow-up suggestions so the user can confirm.

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
- If you detected memorizable information, include a suggestion like {"title":"Remember this","detail":"Remember that I prefer dark roast coffee"}
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
  ];

  for (const group of groups) {
    for (const toolDef of group.definitions) {
      tools.register(toolDef, async (args): Promise<CoreToolResult> => {
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
    const msg = error instanceof Error ? error.message : 'Tool execution failed';
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
        const msg = error instanceof Error ? error.message : 'Execution failed';
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
    if (d.name === 'search_tools' || d.name === 'get_tool_help' || d.name === 'use_tool' || d.name === 'batch_use_tool') return false;
    if (filterCategory && d.category?.toLowerCase() !== filterCategory.toLowerCase()) return false;
    if (showAll) return true;

    const tags = TOOL_SEARCH_TAGS[d.name] ?? d.tags ?? [];
    const searchBlob = [
      d.name.toLowerCase().replace(/[_\-]/g, ' '),
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

  const lines = matches.map(d => `- **${d.name}**: ${d.description.slice(0, 100)}${d.description.length > 100 ? '...' : ''}`);
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

  // 1. Check if it's a custom tool
  const customTool = await customToolsRepo.getByName(tool_name);
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
 * Build memory context string from important memories
 */
async function buildMemoryContext(userId = 'default'): Promise<string> {
  const memoryService = getServiceRegistry().get(Services.Memory);

  // Get important memories
  const importantMemories = await memoryService.getImportantMemories(userId, { threshold: 0.5, limit: 10 });

  const sections: string[] = [];

  // Always include memory instructions
  sections.push(`## Memory System

You have access to a persistent memory system. Use it wisely:

**When to Remember (use the \`remember\` tool):**
- User's name, job, or personal details they share
- Preferences they express (likes, dislikes, communication style)
- Important dates (birthdays, deadlines, events)
- Goals they're working towards
- Skills or knowledge they demonstrate

**When to Recall (use the \`recall\` tool):**
- When you need to reference past information
- When answering questions about previous conversations
- When personalizing your responses

**Be selective** - only remember truly important information. Don't store trivial details.`);

  // Add existing memories if any
  if (importantMemories.length > 0) {
    sections.push('\n## What I Remember About You\n');

    // Group by type
    const facts = importantMemories.filter(m => m.type === 'fact');
    const preferences = importantMemories.filter(m => m.type === 'preference');
    const events = importantMemories.filter(m => m.type === 'event');
    const skills = importantMemories.filter(m => m.type === 'skill');

    if (facts.length > 0) {
      sections.push('**Facts:**');
      facts.forEach(m => sections.push(`- ${m.content}`));
    }

    if (preferences.length > 0) {
      sections.push('\n**Preferences:**');
      preferences.forEach(m => sections.push(`- ${m.content}`));
    }

    if (events.length > 0) {
      sections.push('\n**Important Events:**');
      events.forEach(m => sections.push(`- ${m.content}`));
    }

    if (skills.length > 0) {
      sections.push('\n**Learned Skills:**');
      skills.forEach(m => sections.push(`- ${m.content}`));
    }
  }

  return sections.join('\n') + '\n';
}

/**
 * Build goal context string from active goals
 */
async function buildGoalContext(userId = 'default'): Promise<string> {
  const goalService = getServiceRegistry().get(Services.Goal);

  // Get active goals (parallel — independent queries)
  const [activeGoals, nextActions] = await Promise.all([
    goalService.getActive(userId, 5),
    goalService.getNextActions(userId, 3),
  ]);

  const sections: string[] = [];

  // Always include goal system instructions
  sections.push(`## Goal Tracking System

You help the user track and achieve their goals. Use these tools:

**When to Create Goals (use \`create_goal\`):**
- User expresses a desire to achieve something
- User sets a deadline or target
- User mentions learning or improving at something

**When to Update Goals (use \`update_goal\`):**
- User reports progress
- User wants to pause, complete, or abandon a goal

**When to Decompose Goals (use \`decompose_goal\`):**
- User has a complex goal that needs planning
- User asks for help breaking down a task

**When to Get Next Actions (use \`get_next_actions\`):**
- User asks what to work on
- User seems unsure of priorities`);

  // Add active goals if any
  if (activeGoals.length > 0) {
    sections.push('\n## Current Active Goals\n');
    for (const goal of activeGoals) {
      const dueInfo = goal.dueDate ? ` (due: ${goal.dueDate})` : '';
      sections.push(`- **${goal.title}** - ${goal.progress}% complete${dueInfo} [Priority: ${goal.priority}/10]`);
    }
  }

  // Add next actions if any
  if (nextActions.length > 0) {
    sections.push('\n## Suggested Next Actions\n');
    for (const action of nextActions) {
      sections.push(`- ${action.title} (for: ${action.goalTitle})`);
    }
  }

  return sections.join('\n') + '\n';
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

/** Maximum number of tool calls in a single batch_use_tool invocation */
const MAX_BATCH_TOOL_CALLS = 20;

// Runtime agent cache (runtime instances, not serializable)
const agentCache = new Map<string, Agent>();
const agentConfigCache = new Map<string, AgentConfig>();
const chatAgentCache = new Map<string, Agent>(); // Chat agents keyed by provider:model
const MAX_AGENT_CACHE_SIZE = 100;
const MAX_CHAT_AGENT_CACHE_SIZE = 20;

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
  return `agent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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

  // Register dynamic tool meta-tools (create_tool, list_custom_tools, etc.)
  for (const toolDef of DYNAMIC_TOOL_DEFINITIONS) {
    // These tools have special executors registered separately below
    if (toolDef.name === 'search_tools' || toolDef.name === 'get_tool_help' || toolDef.name === 'use_tool' || toolDef.name === 'batch_use_tool' || toolDef.name === 'inspect_tool_source') continue;

    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const startTime = traceToolCallStart(toolDef.name, args as Record<string, unknown>);

      const result = await executeCustomToolTool(toolDef.name, args as Record<string, unknown>, userId);

      // Trace database operations
      if (toolDef.name === 'create_tool') {
        traceDbWrite('custom_tools', 'insert');
      } else if (toolDef.name === 'list_custom_tools') {
        traceDbRead('custom_tools', 'select');
      } else if (toolDef.name === 'delete_custom_tool') {
        traceDbWrite('custom_tools', 'delete');
      } else if (toolDef.name === 'toggle_custom_tool' || toolDef.name === 'update_custom_tool') {
        traceDbWrite('custom_tools', 'update');
      }

      traceToolCallEnd(toolDef.name, startTime, result.success, result.result, result.error);

      if (result.success) {
        return {
          content: typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result, null, 2),
        };
      }
      return {
        content: result.error ?? 'Unknown error',
        isError: true,
      };
    });
  }

  // Register search_tools — keyword/intent search across all registered tools
  const searchToolsDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'search_tools');
  if (searchToolsDef) {
    tools.register(searchToolsDef, (args) => executeSearchTools(tools, args as Record<string, unknown>));
  }

  // Register inspect_tool_source — view source code of any tool
  const inspectToolSourceDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'inspect_tool_source');
  if (inspectToolSourceDef) {
    tools.register(inspectToolSourceDef, (args) => executeInspectToolSource(tools, userId, args as Record<string, unknown>));
  }

  // Register get_tool_help — parameter docs for one or more tools
  const getToolHelpDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'get_tool_help');
  if (getToolHelpDef) {
    tools.register(getToolHelpDef, (args) => executeGetToolHelp(tools, args as Record<string, unknown>));
  }

  // Register use_tool proxy (executes any registered tool by name)
  // On failure, auto-includes tool parameter help so LLM can self-correct
  const useToolDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'use_tool');
  if (useToolDef) {
    tools.register(useToolDef, (args, context) => executeUseTool(tools, args as Record<string, unknown>, context));
  }

  // Register batch_use_tool — parallel execution of multiple tools
  const batchUseToolDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'batch_use_tool');
  if (batchUseToolDef) {
    tools.register(batchUseToolDef, (args, context) => executeBatchUseTool(tools, args as Record<string, unknown>, context));
  }

  // Register active custom tools (user-created dynamic tools)
  const activeCustomToolDefs = await getActiveCustomToolDefinitions(userId);
  for (const toolDef of activeCustomToolDefs) {
    tools.register(toolDef, async (args, _context): Promise<CoreToolResult> => {
      const startTime = traceToolCallStart(toolDef.name, args as Record<string, unknown>);

      const result = await executeActiveCustomTool(toolDef.name, args as Record<string, unknown>, userId, {
        callId: `call_${Date.now()}`,
        conversationId: record.id,
      });

      traceToolCallEnd(toolDef.name, startTime, result.success, result.result, result.error);

      if (result.success) {
        return {
          content: typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result, null, 2),
        };
      }
      return {
        content: result.error ?? 'Unknown error',
        isError: true,
      };
    });
  }
  log.info(`Registered ${activeCustomToolDefs.length} active custom tools`);

  // Register plugin tools
  const pluginService = getServiceRegistry().get(Services.Plugin);
  const pluginTools = pluginService.getAllTools();
  const pluginToolDefs: typeof MEMORY_TOOLS = [];

  let pluginOverrides = 0;
  for (const { definition, executor } of pluginTools) {
    const wrappedExecutor = async (args: unknown, context: ToolContext): Promise<CoreToolResult> => {
      const startTime = traceToolCallStart(definition.name, args as Record<string, unknown>);
      try {
        const result = await executor(args as Record<string, unknown>, context);
        traceToolCallEnd(definition.name, startTime, !result.isError, result.content, result.isError ? String(result.content) : undefined);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        traceToolCallEnd(definition.name, startTime, false, undefined, errorMsg);
        return { content: errorMsg, isError: true };
      }
    };

    if (tools.has(definition.name)) {
      // Plugin tool overrides a core stub — replace the executor
      tools.updateExecutor(definition.name, wrappedExecutor);
      pluginOverrides++;
    } else {
      tools.register(definition, wrappedExecutor);
    }
    pluginToolDefs.push(definition);
  }
  log.info(`Registered ${pluginTools.length} plugin tools (${pluginOverrides} overrides)`);

  // Remove core stub tools that overlap with plugin tools to prevent LLM confusion
  const pluginToolNames = new Set(pluginToolDefs.map(t => t.name));
  const removedStubs = removeSupersededCoreStubs(tools, pluginToolNames);
  if (removedStubs > 0) {
    log.info(`Removed ${removedStubs} superseded core stubs`);
  }

  // Separate standard tools (from TOOL_GROUPS) and special tools that bypass filtering
  // Filter getToolDefinitions() to exclude stubs that were unregistered above
  const coreToolDefs = getToolDefinitions().filter(t => tools.has(t.name));
  const standardToolDefs = [...coreToolDefs, ...MEMORY_TOOLS, ...GOAL_TOOLS, ...CUSTOM_DATA_TOOLS, ...PERSONAL_DATA_TOOLS, ...CONFIG_TOOLS, ...TRIGGER_TOOLS, ...PLAN_TOOLS];

  // These tools ALWAYS bypass toolGroup filtering:
  // - DYNAMIC_TOOL_DEFINITIONS: Meta-tools for managing custom tools (create_tool, etc.)
  // - activeCustomToolDefs: User's custom tools (always available when active)
  // - pluginToolDefs: Plugin-provided tools (explicitly installed by user)
  const alwaysIncludedToolDefs = [...DYNAMIC_TOOL_DEFINITIONS, ...activeCustomToolDefs, ...pluginToolDefs];

  // Filter tools based on agent's toolGroups configuration
  const configuredToolGroups = safeStringArray(record.config.toolGroups);
  const configuredTools = safeStringArray(record.config.tools);
  const allowedToolNames = new Set(resolveToolGroups(configuredToolGroups, configuredTools));

  // Only filter standard tools by toolGroups
  // Custom tools, dynamic tools, and plugin tools are ALWAYS included
  // If no toolGroups are configured, include all standard tools (backwards compatibility)
  const filteredStandardTools = allowedToolNames.size > 0
    ? standardToolDefs.filter(tool => allowedToolNames.has(tool.name))
    : standardToolDefs;

  const toolDefs = [...filteredStandardTools, ...alwaysIncludedToolDefs];

  // Build memory context from persistent memories
  const memoryContext = await buildMemoryContext('default');

  // Build goal context from active goals
  const goalContext = await buildGoalContext('default');

  // Inject memory and goal context into system prompt
  const basePrompt = record.systemPrompt ?? 'You are a helpful personal AI assistant.';
  const contextSections = [basePrompt];
  if (memoryContext) contextSections.push(memoryContext);
  if (goalContext) contextSections.push(goalContext);
  const promptWithContext = contextSections.join('\n\n');

  const { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(promptWithContext, {
    userId: 'default',
    tools: toolDefs,
    workspaceContext: getWorkspaceContext(),
    includeProfile: true,
    includeInstructions: true,
    includeTimeContext: true,
    includeToolDescriptions: true,
  });

  // Only expose meta-tools (search_tools, get_tool_help, use_tool) to the API.
  // This prevents 100+ tool schemas from consuming ~20K+ tokens per request.
  // All tools remain registered in the ToolRegistry and can be executed via use_tool proxy.
  const metaToolFilter = ['search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool'].map(
    n => unsafeToolId(n)
  );

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
      maxTokens: (record.config.maxTokens as number) ?? 8192,
      temperature: (record.config.temperature as number) ?? 0.7,
    },
    maxTurns: (record.config.maxTurns as number) ?? 25,
    maxToolCalls: (record.config.maxToolCalls as number) ?? 200,
    tools: metaToolFilter,
    // Bridge to ApprovalManager for local code execution approval
    requestApproval: async (category, actionType, description, params) => {
      const approvalMgr = getApprovalManager();
      const result = await approvalMgr.requestApproval(
        'default', // userId — agent record doesn't carry user context
        category as import('../autonomy/types.js').ActionCategory,
        actionType,
        description,
        params,
      );
      // null = auto-approved (low risk or remembered decision)
      if (!result) return true;
      // ApprovalRequest with rejected status = denied
      if (result.action.status === 'rejected') return false;
      // Pending = no real-time UI for in-tool approval, default deny
      return false;
    },
  };

  const agent = createAgent(config, { tools });

  // Evict oldest entry if cache is at capacity
  if (agentCache.size >= MAX_AGENT_CACHE_SIZE) {
    const oldestKey = agentCache.keys().next().value;
    if (oldestKey) {
      agentCache.delete(oldestKey);
      agentConfigCache.delete(oldestKey);
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
  const cached = agentCache.get(record.id);
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
    // Resolve tools from config (explicit tools and/or toolGroups)
    const configuredTools = safeStringArray(record.config.tools);
    const configuredToolGroups = safeStringArray(record.config.toolGroups);

    // Use resolveToolGroups to get all tools
    const tools = resolveToolGroups(configuredToolGroups, configuredTools);

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
      maxTokens: body.maxTokens ?? 4096,
      temperature: body.temperature ?? 0.7,
      maxTurns: body.maxTurns ?? 25,
      maxToolCalls: body.maxToolCalls ?? 200,
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

  // Resolve tools from config (explicit tools and/or toolGroups)
  const configuredTools = safeStringArray(record.config.tools);
  const configuredToolGroups = safeStringArray(record.config.toolGroups);

  // Use resolveToolGroups to get all tools (same logic as list endpoint)
  let tools: string[] = resolveToolGroups(configuredToolGroups, configuredTools);

  // If no tools configured, use defaults
  if (tools.length === 0) {
    tools = ['get_current_time', 'calculate'];
  }

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
    config: {
      maxTokens: (record.config.maxTokens as number) ?? 4096,
      temperature: (record.config.temperature as number) ?? 0.7,
      maxTurns: (record.config.maxTurns as number) ?? 25,
      maxToolCalls: (record.config.maxToolCalls as number) ?? 200,
      tools: configuredTools,
      toolGroups: configuredToolGroups,
    },
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
  agentCache.delete(id);
  agentConfigCache.delete(id);

  // Resolve tools from both explicit tools and toolGroups
  const configuredTools = safeStringArray(newConfig.tools);
  const configuredToolGroups = safeStringArray(newConfig.toolGroups);
  const tools = resolveToolGroups(configuredToolGroups, configuredTools);

  return apiResponse(c, {
    id: updated.id,
    name: updated.name,
    provider: updated.provider,
    model: updated.model,
    systemPrompt: updated.systemPrompt ?? '',
    tools,
    config: {
      maxTokens: (newConfig.maxTokens as number) ?? 4096,
      temperature: (newConfig.temperature as number) ?? 0.7,
      maxTurns: (newConfig.maxTurns as number) ?? 25,
      maxToolCalls: (newConfig.maxToolCalls as number) ?? 200,
      tools: configuredTools,
      toolGroups: configuredToolGroups,
    },
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
  agentCache.delete(id);
  agentConfigCache.delete(id);

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
        agentCache.delete(agent.id);
        agentConfigCache.delete(agent.id);
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
      errors.push(`${agent.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
  // First check cache
  const cached = agentCache.get(id);
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

  // Check cache first
  const cached = agentCache.get(defaultId);
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
          maxTokens: 8192,
          temperature: 0.7,
          maxTurns: 25,
          maxToolCalls: 200,
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

  // Check cache first
  const cached = chatAgentCache.get(cacheKey);
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

  // Register dynamic tool meta-tools (create_tool, list_custom_tools, etc.)
  for (const toolDef of DYNAMIC_TOOL_DEFINITIONS) {
    // These tools have special executors registered separately below
    if (toolDef.name === 'search_tools' || toolDef.name === 'get_tool_help' || toolDef.name === 'use_tool' || toolDef.name === 'batch_use_tool' || toolDef.name === 'inspect_tool_source') continue;

    tools.register(toolDef, async (args, _context): Promise<CoreToolResult> => {
      const result = await executeCustomToolTool(toolDef.name, args as Record<string, unknown>, userId);
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

  // Register search_tools — keyword/intent search across all registered tools
  const chatSearchToolsDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'search_tools');
  if (chatSearchToolsDef) {
    tools.register(chatSearchToolsDef, (args) => executeSearchTools(tools, args as Record<string, unknown>));
  }

  // Register inspect_tool_source — view source code of any tool
  const chatInspectToolSourceDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'inspect_tool_source');
  if (chatInspectToolSourceDef) {
    tools.register(chatInspectToolSourceDef, (args) => executeInspectToolSource(tools, userId, args as Record<string, unknown>));
  }

  // Register get_tool_help — parameter docs for one or more tools
  const chatGetToolHelpDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'get_tool_help');
  if (chatGetToolHelpDef) {
    tools.register(chatGetToolHelpDef, (args) => executeGetToolHelp(tools, args as Record<string, unknown>));
  }

  // Register use_tool proxy (executes any registered tool by name)
  // On failure, auto-includes tool parameter help so LLM can self-correct
  const chatUseToolDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'use_tool');
  if (chatUseToolDef) {
    tools.register(chatUseToolDef, (args, context) => executeUseTool(tools, args as Record<string, unknown>, context));
  }

  // Register batch_use_tool — parallel execution of multiple tools
  const chatBatchUseToolDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'batch_use_tool');
  if (chatBatchUseToolDef) {
    tools.register(chatBatchUseToolDef, (args, context) => executeBatchUseTool(tools, args as Record<string, unknown>, context));
  }

  // Register active custom tools (user-created dynamic tools)
  const activeCustomToolDefs = await getActiveCustomToolDefinitions(userId);
  for (const toolDef of activeCustomToolDefs) {
    tools.register(toolDef, async (args, _context): Promise<CoreToolResult> => {
      const result = await executeActiveCustomTool(toolDef.name, args as Record<string, unknown>, userId, {
        callId: `call_${Date.now()}`,
        conversationId: `chat_${provider}_${model}`,
      });
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

  // Register plugin tools
  const pluginService = getServiceRegistry().get(Services.Plugin);
  const pluginTools = pluginService.getAllTools();
  const pluginToolDefs: typeof MEMORY_TOOLS = [];

  for (const { definition, executor } of pluginTools) {
    const wrappedExecutor = async (args: unknown, context: ToolContext): Promise<CoreToolResult> => {
      try {
        const result = await executor(args as Record<string, unknown>, context);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return { content: errorMsg, isError: true };
      }
    };

    if (tools.has(definition.name)) {
      tools.updateExecutor(definition.name, wrappedExecutor);
    } else {
      tools.register(definition, wrappedExecutor);
    }
    pluginToolDefs.push(definition);
  }

  // Remove core stub tools that overlap with plugin tools
  const chatPluginToolNames = new Set(pluginToolDefs.map(t => t.name));
  removeSupersededCoreStubs(tools, chatPluginToolNames);

  // Get tool definitions for prompt injection (including all registered tools)
  // Filter getToolDefinitions() to exclude stubs removed above
  const chatCoreToolDefs = getToolDefinitions().filter(t => tools.has(t.name));
  const toolDefs = [...chatCoreToolDefs, ...MEMORY_TOOLS, ...GOAL_TOOLS, ...CUSTOM_DATA_TOOLS, ...PERSONAL_DATA_TOOLS, ...CONFIG_TOOLS, ...TRIGGER_TOOLS, ...PLAN_TOOLS, ...DYNAMIC_TOOL_DEFINITIONS, ...activeCustomToolDefs, ...pluginToolDefs];

  // Inject personal memory into system prompt
  const basePrompt = BASE_SYSTEM_PROMPT;
  const { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(basePrompt, {
    userId: 'default',
    tools: toolDefs,
    workspaceContext: getWorkspaceContext(),
    includeProfile: true,
    includeInstructions: true,
    includeTimeContext: true,
    includeToolDescriptions: true,
  });

  // Only expose meta-tools to the API to prevent token bloat from 100+ tool schemas.
  const chatMetaToolFilter = ['search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool'].map(
    n => unsafeToolId(n)
  );

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
      maxTokens: 8192,
      temperature: 0.7,
    },
    maxTurns: 25,
    maxToolCalls: 200,
    tools: chatMetaToolFilter,
    // Bridge to ApprovalManager for local code execution approval
    requestApproval: async (category, actionType, description, params) => {
      const approvalMgr = getApprovalManager();
      const result = await approvalMgr.requestApproval(
        'default',
        category as import('../autonomy/types.js').ActionCategory,
        actionType,
        description,
        params,
      );
      if (!result) return true;
      if (result.action.status === 'rejected') return false;
      return false;
    },
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
export function resetChatAgentContext(provider: string, model: string): boolean {
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
    return true;
  }

  return false;
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
  // Check all supported providers
  const providers = [
    'openai', 'anthropic', 'zhipu', 'deepseek', 'groq',
    'google', 'xai', 'mistral', 'together', 'fireworks', 'perplexity'
  ];

  for (const provider of providers) {
    if (await hasApiKey(provider)) {
      return false;
    }
  }
  return true;
}
