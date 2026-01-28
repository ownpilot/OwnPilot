/**
 * Agent management routes
 *
 * Agents are stored in SQLite database for persistence.
 * Runtime Agent instances are cached in memory for active use.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  Agent,
  createAgent,
  ToolRegistry,
  registerCoreTools,
  registerAllTools,
  getToolDefinitions,
  injectMemoryIntoPrompt,
  MEMORY_TOOLS,
  GOAL_TOOLS,
  CUSTOM_DATA_TOOLS,
  PERSONAL_DATA_TOOLS,
  DYNAMIC_TOOL_DEFINITIONS,
  getDefaultPluginRegistry,
  TOOL_GROUPS,
  type AgentConfig,
  type AIProvider,
  type ToolExecutionResult as CoreToolResult,
  type WorkspaceContext,
} from '@ownpilot/core';
import { executeMemoryTool } from './memories.js';
import { executeGoalTool } from './goals.js';
import { executeCustomDataTool } from './custom-data.js';
import { executePersonalDataTool } from './personal-data-tools.js';
import {
  executeCustomToolTool,
  executeActiveCustomTool,
  getActiveCustomToolDefinitions,
  isCustomTool,
} from './custom-tools.js';
import { CHANNEL_TOOLS, setChannelManager } from '../tools/index.js';
import { channelManager } from '../channels/manager.js';
import {
  traceToolCallStart,
  traceToolCallEnd,
  traceMemoryOp,
  traceDbWrite,
  traceDbRead,
} from '../tracing/index.js';
import type {
  ApiResponse,
  CreateAgentRequest,
  UpdateAgentRequest,
  AgentInfo,
  AgentDetail,
} from '../types/index.js';
import { agentsRepo, type AgentRecord, MemoriesRepository, GoalsRepository } from '../db/repositories/index.js';
import { hasApiKey, getApiKey, resolveProviderAndModel, getDefaultProvider, getDefaultModel } from './settings.js';

/**
 * Build memory context string from important memories
 */
function buildMemoryContext(userId = 'default'): string {
  const repo = new MemoriesRepository(userId);

  // Get important memories
  const importantMemories = repo.getImportant(0.5, 10);

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
function buildGoalContext(userId = 'default'): string {
  const repo = new GoalsRepository(userId);

  // Get active goals
  const activeGoals = repo.getActive(5);
  const nextActions = repo.getNextActions(3);

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
const CONFIGS_DIR = path.join(__dirname, '..', '..', '..', 'core', 'src', 'agent', 'providers', 'configs');

// Provider config cache
const providerConfigCache = new Map<string, { baseUrl?: string; apiKeyEnv?: string }>();

/**
 * Load provider config from JSON file
 */
function loadProviderConfig(providerId: string): { baseUrl?: string; apiKeyEnv?: string } | null {
  if (providerConfigCache.has(providerId)) {
    return providerConfigCache.get(providerId)!;
  }

  try {
    const configPath = path.join(CONFIGS_DIR, `${providerId}.json`);
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const result = {
      baseUrl: config.baseUrl,
      apiKeyEnv: config.apiKeyEnv,
    };
    providerConfigCache.set(providerId, result);
    return result;
  } catch {
    return null;
  }
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
  // Resolve "default" provider/model to actual values
  const { provider: resolvedProvider, model: resolvedModel } = resolveProviderAndModel(
    record.provider,
    record.model
  );

  // Validate resolved values
  if (!resolvedProvider) {
    throw new Error('No provider configured. Configure a provider in Settings.');
  }
  if (!resolvedModel) {
    throw new Error(`No model configured for provider: ${resolvedProvider}`);
  }

  const apiKey = getProviderApiKey(resolvedProvider);
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

  // Register memory tools with gateway executors (with tracing)
  const userId = 'default';
  for (const toolDef of MEMORY_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const startTime = traceToolCallStart(toolDef.name, args as Record<string, unknown>);

      const result = executeMemoryTool(toolDef.name, args as Record<string, unknown>, userId);

      // Trace memory operation
      if (toolDef.name === 'remember') {
        traceMemoryOp('add', { content: (args as Record<string, unknown>).content });
        traceDbWrite('memories', 'insert');
      } else if (toolDef.name === 'recall') {
        traceMemoryOp('recall', { query: (args as Record<string, unknown>).query });
        traceDbRead('memories', 'search');
      } else if (toolDef.name === 'forget') {
        traceMemoryOp('delete', { id: (args as Record<string, unknown>).memoryId });
        traceDbWrite('memories', 'delete');
      } else if (toolDef.name === 'list_memories') {
        traceDbRead('memories', 'list');
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

  // Register goal tools with gateway executors (with tracing)
  for (const toolDef of GOAL_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const startTime = traceToolCallStart(toolDef.name, args as Record<string, unknown>);

      const result = executeGoalTool(toolDef.name, args as Record<string, unknown>, userId);

      // Trace goal/database operation
      if (toolDef.name === 'create_goal') {
        traceDbWrite('goals', 'insert');
      } else if (toolDef.name === 'list_goals' || toolDef.name === 'get_goal_details') {
        traceDbRead('goals', 'select');
      } else if (toolDef.name === 'update_goal' || toolDef.name === 'complete_step') {
        traceDbWrite('goals', 'update');
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

  // Register custom data tools with gateway executors (with tracing)
  for (const toolDef of CUSTOM_DATA_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const startTime = traceToolCallStart(toolDef.name, args as Record<string, unknown>);

      const result = executeCustomDataTool(toolDef.name, args as Record<string, unknown>);

      // Trace database operations
      if (toolDef.name === 'create_custom_table' || toolDef.name === 'delete_custom_table') {
        traceDbWrite('custom_tables', toolDef.name === 'create_custom_table' ? 'insert' : 'delete');
      } else if (toolDef.name === 'list_custom_tables' || toolDef.name === 'describe_custom_table') {
        traceDbRead('custom_tables', 'select');
      } else if (toolDef.name === 'add_custom_record') {
        traceDbWrite('custom_records', 'insert');
      } else if (toolDef.name === 'list_custom_records' || toolDef.name === 'search_custom_records' || toolDef.name === 'get_custom_record') {
        traceDbRead('custom_records', 'select');
      } else if (toolDef.name === 'update_custom_record') {
        traceDbWrite('custom_records', 'update');
      } else if (toolDef.name === 'delete_custom_record') {
        traceDbWrite('custom_records', 'delete');
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

  // Register personal data tools with gateway executors (with tracing)
  for (const toolDef of PERSONAL_DATA_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const startTime = traceToolCallStart(toolDef.name, args as Record<string, unknown>);

      const result = executePersonalDataTool(toolDef.name, args as Record<string, unknown>);

      // Trace database operations
      const toolName = toolDef.name;
      if (toolName.includes('task')) {
        traceDbWrite('tasks', toolName.includes('add') || toolName.includes('update') ? 'upsert' : toolName.includes('delete') ? 'delete' : 'select');
      } else if (toolName.includes('bookmark')) {
        traceDbWrite('bookmarks', toolName.includes('add') ? 'insert' : toolName.includes('delete') ? 'delete' : 'select');
      } else if (toolName.includes('note')) {
        traceDbWrite('notes', toolName.includes('add') || toolName.includes('update') ? 'upsert' : toolName.includes('delete') ? 'delete' : 'select');
      } else if (toolName.includes('calendar') || toolName.includes('event')) {
        traceDbWrite('calendar_events', toolName.includes('add') ? 'insert' : toolName.includes('delete') ? 'delete' : 'select');
      } else if (toolName.includes('contact')) {
        traceDbWrite('contacts', toolName.includes('add') || toolName.includes('update') ? 'upsert' : toolName.includes('delete') ? 'delete' : 'select');
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

  // Register dynamic tool meta-tools (create_tool, list_custom_tools, etc.)
  for (const toolDef of DYNAMIC_TOOL_DEFINITIONS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const startTime = traceToolCallStart(toolDef.name, args as Record<string, unknown>);

      const result = executeCustomToolTool(toolDef.name, args as Record<string, unknown>, userId);

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

  // Register active custom tools (user-created dynamic tools)
  const activeCustomToolDefs = getActiveCustomToolDefinitions(userId);
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
  console.log(`[Agents] Registered ${activeCustomToolDefs.length} active custom tools`);

  // Register channel tools
  setChannelManager(channelManager);
  for (const { definition, executor } of CHANNEL_TOOLS) {
    tools.register(definition, executor);
  }

  // Register plugin tools
  const pluginRegistry = await getDefaultPluginRegistry();
  const pluginTools = pluginRegistry.getAllTools();
  const pluginToolDefs: typeof MEMORY_TOOLS = [];

  for (const { definition, executor } of pluginTools) {
    tools.register(definition, async (args): Promise<CoreToolResult> => {
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
    });
    pluginToolDefs.push(definition);
  }
  console.log(`[Agents] Registered ${pluginTools.length} plugin tools`);

  // Get tool definitions for prompt injection
  const channelToolDefs = CHANNEL_TOOLS.map(t => t.definition);
  const allToolDefs = [...getToolDefinitions(), ...MEMORY_TOOLS, ...GOAL_TOOLS, ...CUSTOM_DATA_TOOLS, ...PERSONAL_DATA_TOOLS, ...DYNAMIC_TOOL_DEFINITIONS, ...activeCustomToolDefs, ...channelToolDefs, ...pluginToolDefs];

  // Filter tools based on agent's toolGroups configuration
  const configuredToolGroups = (record.config.toolGroups as string[] | undefined);
  const configuredTools = (record.config.tools as string[] | undefined);
  const allowedToolNames = new Set(resolveToolGroups(configuredToolGroups, configuredTools));

  // Only include tools that the agent is configured to use
  // If no toolGroups are configured, include all tools (for backwards compatibility)
  const toolDefs = allowedToolNames.size > 0
    ? allToolDefs.filter(tool => allowedToolNames.has(tool.name))
    : allToolDefs;

  // Build memory context from persistent memories
  const memoryContext = buildMemoryContext('default');

  // Build goal context from active goals
  const goalContext = buildGoalContext('default');

  // Inject memory and goal context into system prompt
  const basePrompt = record.systemPrompt ?? 'You are a helpful personal AI assistant.';
  const contextSections = [basePrompt];
  if (memoryContext) contextSections.push(memoryContext);
  if (goalContext) contextSections.push(goalContext);
  const promptWithContext = contextSections.join('\n\n');

  const { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(promptWithContext, {
    userId: 'default-user',
    tools: toolDefs,
    workspaceContext: getWorkspaceContext(),
    includeProfile: true,
    includeInstructions: true,
    includeTimeContext: true,
    includeToolDescriptions: true,
  });

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
  };

  const agent = createAgent(config, { tools });
  agentCache.set(record.id, agent);
  agentConfigCache.set(record.id, config);

  return agent;
}

/**
 * Get or create runtime Agent instance
 */
async function getOrCreateAgentInstance(record: AgentRecord): Promise<Agent> {
  let agent = agentCache.get(record.id);
  if (!agent) {
    agent = await createAgentFromRecord(record);
  }
  return agent;
}

export const agentRoutes = new Hono();

/**
 * List all agents
 */
agentRoutes.get('/', (c) => {
  const records = agentsRepo.getAll();

  const agentList: AgentInfo[] = records.map((record) => {
    // Resolve tools from config (explicit tools and/or toolGroups)
    const configuredTools = (record.config.tools as string[] | undefined);
    const configuredToolGroups = (record.config.toolGroups as string[] | undefined);

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

  const response: ApiResponse<AgentInfo[]> = {
    success: true,
    data: agentList,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Create a new agent
 */
agentRoutes.post('/', async (c) => {
  const body = await c.req.json<CreateAgentRequest>();

  // Validate request
  if (!body.name || !body.systemPrompt || !body.provider) {
    throw new HTTPException(400, {
      message: 'Missing required fields: name, systemPrompt, provider',
    });
  }

  // Check for API key
  const apiKey = getProviderApiKey(body.provider);
  if (!apiKey) {
    throw new HTTPException(400, {
      message: `API key not configured for provider: ${body.provider}`,
    });
  }

  // Generate agent ID
  const id = generateAgentId();
  const requestedModel = body.model ?? getDefaultModel(body.provider);

  // Validate model
  if (!requestedModel) {
    throw new HTTPException(400, {
      message: `No default model configured for provider: ${body.provider}. Specify a model or configure a default in Settings.`,
    });
  }
  const model = requestedModel;

  // Store in database
  const record = agentsRepo.create({
    id,
    name: body.name,
    systemPrompt: body.systemPrompt,
    provider: body.provider,
    model,
    config: {
      maxTokens: body.maxTokens ?? 4096,
      temperature: body.temperature ?? 0.7,
      maxTurns: body.maxTurns ?? 200,
      maxToolCalls: body.maxToolCalls ?? 200,
      tools: body.tools ?? [],
    },
  });

  // Create runtime instance
  const agent = await createAgentFromRecord(record);

  const response: ApiResponse<AgentInfo> = {
    success: true,
    data: {
      id: record.id,
      name: record.name,
      provider: record.provider,
      model: record.model,
      tools: agent.getTools().map((t) => t.name),
      createdAt: record.createdAt.toISOString(),
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response, 201);
});

/**
 * Get agent by ID (with full details)
 */
agentRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const record = agentsRepo.getById(id);

  if (!record) {
    throw new HTTPException(404, {
      message: `Agent not found: ${id}`,
    });
  }

  // Resolve tools from config (explicit tools and/or toolGroups)
  const configuredTools = (record.config.tools as string[] | undefined);
  const configuredToolGroups = (record.config.toolGroups as string[] | undefined);

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

  const response: ApiResponse<AgentDetail> = {
    success: true,
    data: {
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
      },
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Update agent
 */
agentRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateAgentRequest>();

  const existing = agentsRepo.getById(id);
  if (!existing) {
    throw new HTTPException(404, {
      message: `Agent not found: ${id}`,
    });
  }

  // If provider is being changed, validate API key
  if (body.provider && body.provider !== existing.provider) {
    const apiKey = getProviderApiKey(body.provider);
    if (!apiKey) {
      throw new HTTPException(400, {
        message: `API key not configured for provider: ${body.provider}`,
      });
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

  // Update database
  const updated = agentsRepo.update(id, {
    name: body.name,
    systemPrompt: body.systemPrompt,
    provider: body.provider,
    model: body.model,
    config: newConfig,
  });

  if (!updated) {
    throw new HTTPException(500, {
      message: 'Failed to update agent',
    });
  }

  // Invalidate cache to force recreation with new config
  agentCache.delete(id);
  agentConfigCache.delete(id);

  // Get tools from updated config
  const tools = (newConfig.tools as string[]) ?? ['get_current_time', 'calculate'];

  const response: ApiResponse<AgentDetail> = {
    success: true,
    data: {
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
      },
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Delete agent
 */
agentRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');

  const deleted = agentsRepo.delete(id);

  if (!deleted) {
    throw new HTTPException(404, {
      message: `Agent not found: ${id}`,
    });
  }

  // Clear from cache
  agentCache.delete(id);
  agentConfigCache.delete(id);

  const response: ApiResponse = {
    success: true,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Reset agent conversation
 */
agentRoutes.post('/:id/reset', async (c) => {
  const id = c.req.param('id');
  const record = agentsRepo.getById(id);

  if (!record) {
    throw new HTTPException(404, {
      message: `Agent not found: ${id}`,
    });
  }

  const agent = await getOrCreateAgentInstance(record);
  const conversation = agent.reset();

  const response: ApiResponse<{ conversationId: string }> = {
    success: true,
    data: {
      conversationId: conversation.id,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
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
      const existing = agentsRepo.getById(agent.id);

      if (existing) {
        // Update existing agent config with new toolGroups
        agentsRepo.update(agent.id, {
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
        agentsRepo.create({
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

  const response: ApiResponse = {
    success: true,
    data: {
      updated,
      created,
      total: defaultAgents.length,
      errors: errors.length > 0 ? errors : undefined,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get agent from store (database + cache)
 */
export async function getAgent(id: string): Promise<Agent | undefined> {
  // First check cache
  let agent = agentCache.get(id);
  if (agent) return agent;

  // Try to load from database
  const record = agentsRepo.getById(id);
  if (!record) return undefined;

  // Create runtime instance
  try {
    agent = await createAgentFromRecord(record);
    return agent;
  } catch {
    return undefined;
  }
}

/**
 * Get or create default agent
 */
export async function getOrCreateDefaultAgent(): Promise<Agent> {
  const defaultId = 'default';

  // Check cache first
  let defaultAgent = agentCache.get(defaultId);
  if (defaultAgent) return defaultAgent;

  // Check database
  let record = agentsRepo.getById(defaultId);

  if (!record) {
    // Find first configured provider dynamically
    const provider = getDefaultProvider();
    if (!provider) {
      throw new Error('No API key configured for any provider. Configure a provider in Settings.');
    }

    const model = getDefaultModel(provider);
    if (!model) {
      throw new Error(`No model available for provider: ${provider}`);
    }

    record = agentsRepo.create({
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
  defaultAgent = await createAgentFromRecord(record);
  return defaultAgent;
}

// Chat agent cache (keyed by provider:model)
const chatAgentCache = new Map<string, Agent>();

/**
 * Get or create an agent for chat with specific provider and model
 * This is used when the user selects a provider/model in the chat UI
 */
export async function getOrCreateChatAgent(provider: string, model: string): Promise<Agent> {
  const cacheKey = `chat:${provider}:${model}`;

  // Check cache first
  let agent = chatAgentCache.get(cacheKey);
  if (agent) return agent;

  // Get API key for the provider
  const apiKey = getProviderApiKey(provider);
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

  // Register memory tools with gateway executors
  const userId = 'default';
  for (const toolDef of MEMORY_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const result = executeMemoryTool(toolDef.name, args as Record<string, unknown>, userId);
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

  // Register goal tools with gateway executors
  for (const toolDef of GOAL_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const result = executeGoalTool(toolDef.name, args as Record<string, unknown>, userId);
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

  // Register custom data tools with gateway executors
  for (const toolDef of CUSTOM_DATA_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const result = executeCustomDataTool(toolDef.name, args as Record<string, unknown>);
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

  // Register personal data tools with gateway executors
  for (const toolDef of PERSONAL_DATA_TOOLS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const result = executePersonalDataTool(toolDef.name, args as Record<string, unknown>);
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

  // Register dynamic tool meta-tools (create_tool, list_custom_tools, etc.)
  for (const toolDef of DYNAMIC_TOOL_DEFINITIONS) {
    tools.register(toolDef, async (args): Promise<CoreToolResult> => {
      const result = executeCustomToolTool(toolDef.name, args as Record<string, unknown>, userId);
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

  // Register active custom tools (user-created dynamic tools)
  const activeCustomToolDefs = getActiveCustomToolDefinitions(userId);
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

  // Register channel tools
  setChannelManager(channelManager);
  for (const { definition, executor } of CHANNEL_TOOLS) {
    tools.register(definition, executor);
  }

  // Register plugin tools
  const pluginRegistry = await getDefaultPluginRegistry();
  const pluginTools = pluginRegistry.getAllTools();
  const pluginToolDefs: typeof MEMORY_TOOLS = [];

  for (const { definition, executor } of pluginTools) {
    tools.register(definition, async (args): Promise<CoreToolResult> => {
      try {
        const result = await executor(args as Record<string, unknown>, {} as import('@ownpilot/core').ToolContext);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return { content: errorMsg, isError: true };
      }
    });
    pluginToolDefs.push(definition);
  }

  // Get tool definitions for prompt injection (including all registered tools)
  const channelToolDefs = CHANNEL_TOOLS.map(t => t.definition);
  const toolDefs = [...getToolDefinitions(), ...MEMORY_TOOLS, ...GOAL_TOOLS, ...CUSTOM_DATA_TOOLS, ...PERSONAL_DATA_TOOLS, ...DYNAMIC_TOOL_DEFINITIONS, ...activeCustomToolDefs, ...channelToolDefs, ...pluginToolDefs];

  // Inject personal memory into system prompt
  const basePrompt = 'You are a helpful personal AI assistant. You help the user with their daily tasks, remember their preferences, and proactively assist them.';
  const { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(basePrompt, {
    userId: 'default-user',
    tools: toolDefs,
    workspaceContext: getWorkspaceContext(),
    includeProfile: true,
    includeInstructions: true,
    includeTimeContext: true,
    includeToolDescriptions: true,
  });

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
  };

  // Create and cache the agent
  agent = createAgent(config, { tools });
  chatAgentCache.set(cacheKey, agent);

  return agent;
}

/**
 * Helper: Get API key for a provider
 * Uses getApiKey from settings which checks both env vars and database
 */
export function getProviderApiKey(provider: string): string | undefined {
  return getApiKey(provider);
}

// getDefaultModel is imported from settings.ts
export { getDefaultModel } from './settings.js';

/**
 * Check if demo mode is enabled (no API keys configured)
 */
export function isDemoMode(): boolean {
  // Check all supported providers
  const providers = [
    'openai', 'anthropic', 'zhipu', 'deepseek', 'groq',
    'google', 'xai', 'mistral', 'together', 'fireworks', 'perplexity'
  ];

  return !providers.some(provider => hasApiKey(provider));
}
