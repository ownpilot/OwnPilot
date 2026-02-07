/**
 * Agent management routes
 *
 * Agents are stored in SQLite database for persistence.
 * Runtime Agent instances are cached in memory for active use.
 */

import { Hono } from 'hono';
import * as path from 'path';
import { fileURLToPath } from 'url';
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
  TOOL_MAX_LIMITS,
  applyToolLimits,
  TOOL_GROUPS,
  getProviderConfig as coreGetProviderConfig,
  type AgentConfig,
  type AIProvider,
  type ToolExecutionResult as CoreToolResult,
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
import { apiResponse, apiError, ERROR_CODES } from './helpers.js'
import { agentsRepo, localProvidersRepo, type AgentRecord } from '../db/repositories/index.js';
import { hasApiKey, getApiKey, resolveProviderAndModel, getDefaultProvider, getDefaultModel } from './settings.js';
import { gatewayConfigCenter } from '../services/config-center-impl.js';
import { getLog } from '../services/log.js';

const log = getLog('Agents');

/** Sanitize user-supplied IDs for safe interpolation in error messages */
const sanitizeId = (id: string) => id.replace(/[^\w-]/g, '').slice(0, 100);

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
// Shared meta-tool helpers (used by both named-agent and chat-agent executors)
// =============================================================================

/**
 * Find similar tool names via substring/fuzzy matching.
 * Returns up to 5 suggestions sorted by relevance.
 */
function findSimilarTools(tools: ToolRegistry, query: string): string[] {
  const allDefs = tools.getDefinitions();
  const q = query.toLowerCase().replace(/[_\-]/g, ' ');
  const qWords = q.split(/\s+/).filter(Boolean);

  const scored = allDefs
    .filter(d => d.name !== 'search_tools' && d.name !== 'get_tool_help' && d.name !== 'use_tool' && d.name !== 'batch_use_tool')
    .map(d => {
      const name = d.name.toLowerCase();
      const nameWords = name.replace(/[_\-]/g, ' ');
      let score = 0;

      // Exact substring match in name
      if (name.includes(q.replace(/ /g, '_'))) score += 10;
      if (nameWords.includes(q)) score += 8;

      // Word-level matches
      for (const w of qWords) {
        if (name.includes(w)) score += 3;
        if (d.description.toLowerCase().includes(w)) score += 1;
      }

      // Levenshtein-like: shared prefix
      const minLen = Math.min(q.length, name.length);
      let prefix = 0;
      for (let i = 0; i < minLen; i++) {
        if (q[i] === name[i]) prefix++;
        else break;
      }
      if (prefix >= 3) score += prefix;

      return { name: d.name, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return scored.map(s => s.name);
}

/**
 * Recursively format a JSON Schema parameter for human-readable help output.
 * Handles nested objects, arrays with item schemas, enums, defaults.
 */
function formatParamSchema(
  name: string,
  schema: Record<string, unknown>,
  requiredSet: Set<string>,
  indent: string = '  ',
): string[] {
  const lines: string[] = [];
  const req = requiredSet.has(name) ? ' (REQUIRED)' : ' (optional)';
  const type = schema.type as string || 'any';
  const desc = schema.description ? ` — ${schema.description}` : '';
  const dflt = schema.default !== undefined ? ` [default: ${JSON.stringify(schema.default)}]` : '';

  if (Array.isArray(schema.enum)) {
    const enumVals = (schema.enum as string[]).map(v => JSON.stringify(v)).join(' | ');
    lines.push(`${indent}• ${name}: ${enumVals}${req}${desc}${dflt}`);
  } else if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items?.type === 'object' && items.properties) {
      // Array of objects — show nested structure
      lines.push(`${indent}• ${name}: array of objects${req}${desc}`);
      const itemProps = items.properties as Record<string, Record<string, unknown>>;
      const itemRequired = new Set<string>((items.required as string[]) || []);
      for (const [propName, propSchema] of Object.entries(itemProps)) {
        lines.push(...formatParamSchema(propName, propSchema, itemRequired, indent + '    '));
      }
    } else {
      const itemType = items ? (items.type as string || 'any') : 'any';
      lines.push(`${indent}• ${name}: array of ${itemType}${req}${desc}${dflt}`);
    }
  } else if (type === 'object' && schema.properties) {
    // Nested object with defined properties
    lines.push(`${indent}• ${name}: object${req}${desc}`);
    const nestedProps = schema.properties as Record<string, Record<string, unknown>>;
    const nestedRequired = new Set<string>((schema.required as string[]) || []);
    for (const [propName, propSchema] of Object.entries(nestedProps)) {
      lines.push(...formatParamSchema(propName, propSchema, nestedRequired, indent + '    '));
    }
  } else {
    lines.push(`${indent}• ${name}: ${type}${req}${desc}${dflt}`);
  }

  return lines;
}

/**
 * Build a realistic example value for a parameter based on its JSON Schema.
 */
function buildExampleValue(schema: Record<string, unknown>, name: string): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  const type = schema.type as string;
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items?.type === 'object' && items.properties) {
      // Build one example item with its required fields
      const itemProps = items.properties as Record<string, Record<string, unknown>>;
      const itemRequired = new Set<string>((items.required as string[]) || []);
      const example: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(itemProps)) {
        if (itemRequired.has(propName) || Object.keys(itemProps).length <= 3) {
          example[propName] = buildExampleValue(propSchema, propName);
        }
      }
      return [example];
    }
    return ['...'];
  }
  if (type === 'object') {
    if (schema.properties) {
      const nestedProps = schema.properties as Record<string, Record<string, unknown>>;
      const nestedRequired = new Set<string>((schema.required as string[]) || []);
      const example: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(nestedProps)) {
        if (nestedRequired.has(propName)) {
          example[propName] = buildExampleValue(propSchema, propName);
        }
      }
      return example;
    }
    return {};
  }
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return true;
  // String — try to generate a meaningful placeholder
  if (name.includes('email') || name === 'to' || name === 'replyTo') return 'user@example.com';
  if (name.includes('path') || name.includes('file')) return '/path/to/file';
  if (name.includes('url') || name.includes('link')) return 'https://example.com';
  if (name.includes('date')) return '2025-01-01';
  if (name.includes('id')) return 'some-id';
  return '...';
}

/** Shape of a JSON Schema object stored in ToolDefinition.parameters (trusted internal data).
 * Uses Record<string, unknown> for properties to stay compatible with formatParamSchema/buildExampleValue. */
interface ToolParameterSchema {
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
}

/**
 * Build full tool help text for error recovery.
 * Includes description, parameters with nested schemas, and a ready-to-use example.
 */
function buildToolHelpText(tools: ToolRegistry, toolName: string): string {
  const def = tools.getDefinition(toolName);
  if (!def?.parameters) return '';
  // Safe: def.parameters is a JSON Schema object with properties/required fields
  const params = def.parameters as unknown as ToolParameterSchema;
  if (!params.properties) return '';

  const requiredSet = new Set(params.required || []);
  const lines = [
    `\n\n--- TOOL HELP (${toolName}) ---`,
    def.description,
    '',
    'Parameters:',
  ];

  const exampleArgs: Record<string, unknown> = {};

  for (const [name, schema] of Object.entries(params.properties)) {
    lines.push(...formatParamSchema(name, schema, requiredSet));
    if (requiredSet.has(name)) {
      exampleArgs[name] = buildExampleValue(schema, name);
    }
  }

  lines.push('');
  lines.push(`Example: use_tool("${toolName}", ${JSON.stringify(exampleArgs)})`);
  lines.push('Fix your parameters and retry immediately.');
  return lines.join('\n');
}

/**
 * Build comprehensive help output for get_tool_help.
 * Richer than buildToolHelpText — includes ALL parameters (not just required) in example.
 */
function formatFullToolHelp(tools: ToolRegistry, toolName: string): string {
  const def = tools.getDefinition(toolName);
  if (!def) return `Tool '${toolName}' not found.`;

  // Safe: def.parameters is a JSON Schema object with properties/required fields
  const params = def.parameters as unknown as ToolParameterSchema;

  const lines = [
    `## ${def.name}`,
    def.description,
    '',
  ];

  if (!params?.properties || Object.keys(params.properties).length === 0) {
    lines.push('No parameters required.');
    lines.push('');
    lines.push('### Example');
    lines.push(`use_tool("${def.name}", {})`);
    return lines.join('\n');
  }

  const requiredSet = new Set(params.required || []);
  const requiredNames = Object.keys(params.properties).filter(n => requiredSet.has(n));
  const optionalNames = Object.keys(params.properties).filter(n => !requiredSet.has(n));

  // Required parameters first
  if (requiredNames.length > 0) {
    lines.push('### Required Parameters');
    for (const name of requiredNames) {
      lines.push(...formatParamSchema(name, params.properties[name]!, requiredSet));
    }
    lines.push('');
  }

  // Optional parameters
  if (optionalNames.length > 0) {
    lines.push('### Optional Parameters');
    for (const name of optionalNames) {
      lines.push(...formatParamSchema(name, params.properties[name]!, requiredSet));
    }
    lines.push('');
  }

  // Build example with required params
  const exampleArgs: Record<string, unknown> = {};
  for (const name of requiredNames) {
    exampleArgs[name] = buildExampleValue(params.properties[name]!, name);
  }

  lines.push('### Example Call');
  lines.push(`use_tool("${def.name}", ${JSON.stringify(exampleArgs, null, 2)})`);

  // Add tool-specific max limit info if available
  const toolLimit = TOOL_MAX_LIMITS[toolName];
  if (toolLimit) {
    lines.push('');
    lines.push(`Note: "${toolLimit.paramName}" parameter is capped at max ${toolLimit.maxValue} (default: ${toolLimit.defaultValue}).`);
  }

  return lines.join('\n');
}

/**
 * Validate required parameters are present before tool execution.
 * Returns null if valid, or an error message string if invalid.
 */
function validateRequiredParams(tools: ToolRegistry, toolName: string, args: Record<string, unknown>): string | null {
  const def = tools.getDefinition(toolName);
  if (!def?.parameters) return null;
  const required = def.parameters.required as string[] | undefined;
  if (!required || required.length === 0) return null;

  const missing = required.filter(p => args[p] === undefined || args[p] === null);
  if (missing.length === 0) return null;

  return `Missing required parameter(s): ${missing.join(', ')}`;
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const nativeProviders = ['openai', 'anthropic', 'google', 'deepseek', 'groq', 'mistral', 'xai', 'together', 'fireworks', 'perplexity'];
  const providerType = nativeProviders.includes(resolvedProvider) ? resolvedProvider : 'openai';

  // Create tool registry with ALL tools (not just core)
  const tools = new ToolRegistry();
  registerAllTools(tools);
  tools.setConfigCenter(gatewayConfigCenter);

  // Register all gateway domain tools (memory, goals, etc.) with tracing
  const userId = 'default';
  registerGatewayTools(tools, userId, true);

  // Register dynamic tool meta-tools (create_tool, list_custom_tools, etc.)
  for (const toolDef of DYNAMIC_TOOL_DEFINITIONS) {
    // search_tools, get_tool_help and use_tool have special executors (registered below)
    if (toolDef.name === 'search_tools' || toolDef.name === 'get_tool_help' || toolDef.name === 'use_tool' || toolDef.name === 'batch_use_tool') continue;

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
      } else if (toolDef.name === 'toggle_custom_tool') {
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
    tools.register(searchToolsDef, async (args): Promise<CoreToolResult> => {
      const { query, category: filterCategory, include_params } = args as { query: string; category?: string; include_params?: boolean };
      const allDefs = tools.getDefinitions();
      const q = query.trim().toLowerCase();

      // "all" or "*" returns everything
      const showAll = q === 'all' || q === '*';

      // Split query into individual words for AND matching
      const queryWords = q.split(/\s+/).filter(Boolean);

      const matches = allDefs.filter(d => {
        // Skip meta-tools from results
        if (d.name === 'search_tools' || d.name === 'get_tool_help' || d.name === 'use_tool' || d.name === 'batch_use_tool') return false;
        // Category filter
        if (filterCategory && d.category?.toLowerCase() !== filterCategory.toLowerCase()) return false;

        if (showAll) return true;

        // Build searchable text: split underscored names into words
        const tags = TOOL_SEARCH_TAGS[d.name] ?? d.tags ?? [];
        const searchBlob = [
          d.name.toLowerCase().replace(/[_\-]/g, ' '),
          d.name.toLowerCase(),
          d.description.toLowerCase(),
          (d.category ?? '').toLowerCase(),
          ...tags.map(tag => tag.toLowerCase()),
        ].join(' ');

        // Every query word must appear somewhere in the search blob
        return queryWords.every(word => searchBlob.includes(word));
      });

      if (matches.length === 0) {
        return { content: `No tools found for "${query}". Tips:\n- Search by individual keywords: "email" or "send"\n- Use multiple words for AND search: "email send" finds send_email\n- Use "all" to list every available tool\n- Try broad keywords: "task", "file", "web", "memory", "note", "calendar"` };
      }

      // When include_params is true, return full parameter docs for each match
      if (include_params) {
        const sections = matches.map(d => formatFullToolHelp(tools, d.name));
        return { content: [`Found ${matches.length} tool(s) for "${query}" (with parameters):`, '', ...sections.join('\n\n---\n\n').split('\n')].join('\n') };
      }

      const lines = matches.map(d => `- **${d.name}**: ${d.description.slice(0, 100)}${d.description.length > 100 ? '...' : ''}`);
      return { content: [`Found ${matches.length} tool(s) for "${query}":`, '', ...lines, '', 'Tip: Add include_params=true to get full parameter docs, or use get_tool_help(tool_name).'].join('\n') };
    });
  }

  // Register get_tool_help with a closure over the tools registry
  // Supports both single tool_name and batch tool_names array
  const getToolHelpDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'get_tool_help');
  if (getToolHelpDef) {
    tools.register(getToolHelpDef, async (args): Promise<CoreToolResult> => {
      const { tool_name, tool_names } = args as { tool_name?: string; tool_names?: string[] };

      // Resolve list of tool names (batch or single)
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
        const hint = similar.length > 0
          ? `\nDid you mean one of these?\n${[...new Set(similar)].map(s => `  • ${s}`).join('\n')}\n\nUse search_tools("keyword") to find the correct tool name.`
          : '\nUse search_tools("keyword") to discover available tools.';
        results.push(`Tools not found: ${notFound.join(', ')}${hint}`);
      }

      return { content: results.join('\n\n---\n\n'), isError: notFound.length > 0 && results.length === notFound.length };
    });
  }

  // Register use_tool proxy (executes any registered tool by name)
  // On failure, auto-includes tool parameter help so LLM can self-correct
  const useToolDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'use_tool');
  if (useToolDef) {
    tools.register(useToolDef, async (args): Promise<CoreToolResult> => {
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
        if (argsStr.length > 100000) {
          return { content: 'Tool arguments payload too large (max 100KB)', isError: true };
        }

        // Apply max limits for list-returning tools (e.g. cap list_emails limit to 50)
        const cappedArgs = applyToolLimits(tool_name, toolArgs);
        const result = await tools.execute(tool_name, cappedArgs, {} as import('@ownpilot/core').ToolContext);
        if (result.ok) {
          return result.value;
        }
        // Include parameter help on execution error so LLM can retry correctly
        return { content: result.error.message + buildToolHelpText(tools, tool_name), isError: true };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Tool execution failed';
        return { content: msg + buildToolHelpText(tools, tool_name), isError: true };
      }
    });
  }

  // Register batch_use_tool — parallel execution of multiple tools
  const batchUseToolDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'batch_use_tool');
  if (batchUseToolDef) {
    tools.register(batchUseToolDef, async (args): Promise<CoreToolResult> => {
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
            if (argsStr.length > 100000) {
              return { idx, tool_name, ok: false, content: 'Tool arguments payload too large (max 100KB)' };
            }

            const cappedArgs = applyToolLimits(tool_name, toolArgs);
            const result = await tools.execute(tool_name, cappedArgs, {} as import('@ownpilot/core').ToolContext);
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
    });
  }

  // Register active custom tools (user-created dynamic tools)
  const activeCustomToolDefs = await getActiveCustomToolDefinitions(userId);
  for (const toolDef of activeCustomToolDefs) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
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
    const wrappedExecutor = async (args: unknown): Promise<CoreToolResult> => {
      const startTime = traceToolCallStart(definition.name, args as Record<string, unknown>);
      try {
        const result = await executor(args as Record<string, unknown>, {} as import('@ownpilot/core').ToolContext);
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
  };

  const agent = createAgent(config, { tools });
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Agent not found: ${sanitizeId(id)}` }, 404);
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Agent not found: ${sanitizeId(id)}` }, 404);
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Agent not found: ${sanitizeId(id)}` }, 404);
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Agent not found: ${sanitizeId(id)}` }, 404);
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
        systemPrompt: 'You are a helpful personal AI assistant. You help the user with their daily tasks, remember their preferences, and proactively assist them.',
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
  const nativeProviders = ['openai', 'anthropic', 'google', 'deepseek', 'groq', 'mistral', 'xai', 'together', 'fireworks', 'perplexity'];
  const providerType = nativeProviders.includes(provider) ? provider : 'openai';

  // Create tools registry with ALL tools
  const tools = new ToolRegistry();
  registerAllTools(tools);
  tools.setConfigCenter(gatewayConfigCenter);

  // Register all gateway domain tools (memory, goals, etc.) without tracing
  const userId = 'default';
  registerGatewayTools(tools, userId, false);

  // Register dynamic tool meta-tools (create_tool, list_custom_tools, etc.)
  for (const toolDef of DYNAMIC_TOOL_DEFINITIONS) {
    // search_tools, get_tool_help and use_tool have special executors (registered below)
    if (toolDef.name === 'search_tools' || toolDef.name === 'get_tool_help' || toolDef.name === 'use_tool' || toolDef.name === 'batch_use_tool') continue;

    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
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
    tools.register(chatSearchToolsDef, async (args): Promise<CoreToolResult> => {
      const { query, category: filterCategory, include_params } = args as { query: string; category?: string; include_params?: boolean };
      const allDefs = tools.getDefinitions();
      const q = query.trim().toLowerCase();

      // "all" or "*" returns everything
      const showAll = q === 'all' || q === '*';

      // Split query into individual words for AND matching
      const queryWords = q.split(/\s+/).filter(Boolean);

      const matches = allDefs.filter(d => {
        if (d.name === 'search_tools' || d.name === 'get_tool_help' || d.name === 'use_tool' || d.name === 'batch_use_tool') return false;
        if (filterCategory && d.category?.toLowerCase() !== filterCategory.toLowerCase()) return false;

        if (showAll) return true;

        // Build searchable text: split underscored names into words
        const tags = TOOL_SEARCH_TAGS[d.name] ?? d.tags ?? [];
        const searchBlob = [
          d.name.toLowerCase().replace(/[_\-]/g, ' '),
          d.name.toLowerCase(),
          d.description.toLowerCase(),
          (d.category ?? '').toLowerCase(),
          ...tags.map(tag => tag.toLowerCase()),
        ].join(' ');

        // Every query word must appear somewhere in the search blob
        return queryWords.every(word => searchBlob.includes(word));
      });

      if (matches.length === 0) {
        return { content: `No tools found for "${query}". Tips:\n- Search by individual keywords: "email" or "send"\n- Use multiple words for AND search: "email send" finds send_email\n- Use "all" to list every available tool\n- Try broad keywords: "task", "file", "web", "memory", "note", "calendar"` };
      }

      // When include_params is true, return full parameter docs for each match
      if (include_params) {
        const sections = matches.map(d => formatFullToolHelp(tools, d.name));
        return { content: [`Found ${matches.length} tool(s) for "${query}" (with parameters):`, '', ...sections.join('\n\n---\n\n').split('\n')].join('\n') };
      }

      const lines = matches.map(d => `- **${d.name}**: ${d.description.slice(0, 100)}${d.description.length > 100 ? '...' : ''}`);
      return { content: [`Found ${matches.length} tool(s) for "${query}":`, '', ...lines, '', 'Tip: Add include_params=true to get full parameter docs, or use get_tool_help(tool_name).'].join('\n') };
    });
  }

  // Register get_tool_help with a closure over the tools registry
  // Supports both single tool_name and batch tool_names array
  const chatGetToolHelpDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'get_tool_help');
  if (chatGetToolHelpDef) {
    tools.register(chatGetToolHelpDef, async (args): Promise<CoreToolResult> => {
      const { tool_name, tool_names } = args as { tool_name?: string; tool_names?: string[] };

      // Resolve list of tool names (batch or single)
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
        const hint = similar.length > 0
          ? `\nDid you mean one of these?\n${[...new Set(similar)].map(s => `  • ${s}`).join('\n')}\n\nUse search_tools("keyword") to find the correct tool name.`
          : '\nUse search_tools("keyword") to discover available tools.';
        results.push(`Tools not found: ${notFound.join(', ')}${hint}`);
      }

      return { content: results.join('\n\n---\n\n'), isError: notFound.length > 0 && results.length === notFound.length };
    });
  }

  // Register use_tool proxy (executes any registered tool by name)
  // On failure, auto-includes tool parameter help so LLM can self-correct
  const chatUseToolDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'use_tool');
  if (chatUseToolDef) {
    tools.register(chatUseToolDef, async (args): Promise<CoreToolResult> => {
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
        if (argsStr.length > 100000) {
          return { content: 'Tool arguments payload too large (max 100KB)', isError: true };
        }

        // Apply max limits for list-returning tools (e.g. cap list_emails limit to 50)
        const cappedArgs = applyToolLimits(tool_name, toolArgs);
        const result = await tools.execute(tool_name, cappedArgs, {} as import('@ownpilot/core').ToolContext);
        if (result.ok) {
          return result.value;
        }
        // Include parameter help on execution error so LLM can retry correctly
        return { content: result.error.message + buildToolHelpText(tools, tool_name), isError: true };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Tool execution failed';
        return { content: msg + buildToolHelpText(tools, tool_name), isError: true };
      }
    });
  }

  // Register batch_use_tool — parallel execution of multiple tools
  const chatBatchUseToolDef = DYNAMIC_TOOL_DEFINITIONS.find(t => t.name === 'batch_use_tool');
  if (chatBatchUseToolDef) {
    tools.register(chatBatchUseToolDef, async (args): Promise<CoreToolResult> => {
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

          if (!tools.has(tool_name)) {
            const similar = findSimilarTools(tools, tool_name);
            const hint = similar.length > 0
              ? ` Did you mean: ${similar.join(', ')}?`
              : '';
            return { idx, tool_name, ok: false, content: `Tool '${tool_name}' not found.${hint}` };
          }

          const missingError = validateRequiredParams(tools, tool_name, toolArgs || {});
          if (missingError) {
            return { idx, tool_name, ok: false, content: missingError };
          }

          try {
            // Validate tool arguments payload size
            const argsStr = JSON.stringify(toolArgs ?? {});
            if (argsStr.length > 100000) {
              return { idx, tool_name, ok: false, content: 'Tool arguments payload too large (max 100KB)' };
            }

            const cappedArgs = applyToolLimits(tool_name, toolArgs);
            const result = await tools.execute(tool_name, cappedArgs, {} as import('@ownpilot/core').ToolContext);
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
    });
  }

  // Register active custom tools (user-created dynamic tools)
  const activeCustomToolDefs = await getActiveCustomToolDefinitions(userId);
  for (const toolDef of activeCustomToolDefs) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
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
    const wrappedExecutor = async (args: unknown): Promise<CoreToolResult> => {
      try {
        const result = await executor(args as Record<string, unknown>, {} as import('@ownpilot/core').ToolContext);
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
  const basePrompt = 'You are a helpful personal AI assistant. You help the user with their daily tasks, remember their preferences, and proactively assist them.';
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
  };

  // Create and cache the agent
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
export async function getProviderApiKey(provider: string): Promise<string | undefined> {
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
