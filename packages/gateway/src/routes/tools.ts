/**
 * Tools routes
 * Provides endpoints for listing, executing, and managing tools
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import {
  CORE_TOOLS,
  ToolRegistry,
  registerCoreTools,
  MEMORY_TOOLS,
  GOAL_TOOLS,
  CUSTOM_DATA_TOOLS,
  PERSONAL_DATA_TOOLS,
  TOOL_GROUPS,
  getDefaultPluginRegistry,
  type ToolDefinition,
} from '@ownpilot/core';
import type { ApiResponse, ToolInfo } from '../types/index.js';
import { getAgent } from './agents.js';
import { initializeToolOverrides } from '../services/tool-overrides.js';
import { gatewayConfigCenter as gatewayApiKeyCenter } from '../services/config-center-impl.js';
import { getSharedToolRegistry } from '../services/tool-executor.js';
import { initToolSourceMappings, getToolSource } from '../services/tool-source.js';
import { TRIGGER_TOOLS, PLAN_TOOLS } from '../tools/index.js';

export const toolsRoutes = new Hono();

// Initialize tool source mappings at module load
initToolSourceMappings({
  memoryNames: MEMORY_TOOLS.map(t => t.name),
  goalNames: GOAL_TOOLS.map(t => t.name),
  customDataNames: CUSTOM_DATA_TOOLS.map(t => t.name),
  personalDataNames: PERSONAL_DATA_TOOLS.map(t => t.name),
  triggerNames: TRIGGER_TOOLS.map(t => t.name),
  planNames: PLAN_TOOLS.map(t => t.name),
});

// Standalone tool registry for direct execution (no agent required)
let toolRegistry: ToolRegistry | undefined;
let toolOverridesInitialized = false;

function getToolRegistry(): ToolRegistry {
  if (!toolRegistry) {
    toolRegistry = new ToolRegistry();
    registerCoreTools(toolRegistry);
    toolRegistry.setApiKeyCenter(gatewayApiKeyCenter);

    // Initialize tool overrides (Gmail, Media, etc.)
    if (!toolOverridesInitialized) {
      try {
        initializeToolOverrides(toolRegistry);
        toolOverridesInitialized = true;
      } catch (error) {
        console.error('[tools] Failed to initialize tool overrides:', error);
      }
    }
  }
  return toolRegistry;
}

// Tool categories with icons
const CATEGORY_INFO: Record<string, { icon: string; description: string }> = {
  core: { icon: '⚙️', description: 'Essential utilities' },
  filesystem: { icon: '📁', description: 'File operations' },
  memory: { icon: '🧠', description: 'AI memory persistence' },
  goals: { icon: '🎯', description: 'Long-term objectives' },
  tasks: { icon: '📋', description: 'Task management' },
  bookmarks: { icon: '🔖', description: 'URL bookmarks' },
  notes: { icon: '📝', description: 'Note taking' },
  calendar: { icon: '📅', description: 'Event scheduling' },
  contacts: { icon: '👥', description: 'Contact management' },
  customData: { icon: '💾', description: 'Dynamic data tables' },
  textUtils: { icon: '🔧', description: 'Text processing' },
  dateTime: { icon: '⏰', description: 'Date operations' },
  conversion: { icon: '🔄', description: 'Unit conversion' },
  generation: { icon: '🎲', description: 'Data generation' },
  extraction: { icon: '🔍', description: 'Data extraction' },
  validation: { icon: '✅', description: 'Data validation' },
  listOps: { icon: '📊', description: 'List operations' },
  mathStats: { icon: '📈', description: 'Math & statistics' },
  plugins: { icon: '🔌', description: 'Plugin tools' },
  email: { icon: '📧', description: 'Email operations' },
  image: { icon: '🖼️', description: 'Image generation & analysis' },
  audio: { icon: '🔊', description: 'Audio & speech' },
  weather: { icon: '🌤️', description: 'Weather information' },
  automation: { icon: '🤖', description: 'Triggers & plans' },
};

/**
 * Resolve and execute a tool from the shared registry or plugin registry.
 * Throws HTTPException 404 if the tool is not found in either.
 */
async function resolveAndExecuteTool(
  name: string,
  args: Record<string, unknown>,
  conversationId: string,
): Promise<{ content: unknown; isError?: boolean }> {
  const registry = getSharedToolRegistry();

  // Single dispatch — all tools (core, gateway, plugin, custom) are in one registry
  if (!registry.has(name)) {
    throw new HTTPException(404, { message: `Tool not found: ${name}` });
  }

  const result = await registry.execute(name, args, { conversationId });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function getCategoryForTool(toolName: string): string {
  for (const [groupId, group] of Object.entries(TOOL_GROUPS)) {
    if (group.tools.includes(toolName)) {
      return groupId;
    }
  }
  return 'other';
}

// Get all tools from all sources
async function getAllTools(): Promise<Array<ToolDefinition & { category: string; source: string }>> {
  const registry = getSharedToolRegistry();
  const allTools: Array<ToolDefinition & { category: string; source: string }> = [];

  for (const def of registry.getDefinitions()) {
    const tool = registry.getRegisteredTool(def.name);
    allTools.push({
      ...def,
      category: def.category ?? getCategoryForTool(def.name),
      source: tool?.source ?? 'core',
    });
  }

  // Fallback: also check plugin registry for tools not yet in shared registry
  // (e.g. if plugins initialized after registry was created)
  try {
    const pluginRegistry = await getDefaultPluginRegistry();
    const seen = new Set(allTools.map(t => t.name));
    const pluginTools = pluginRegistry.getAllTools();
    for (const { definition } of pluginTools) {
      if (!seen.has(definition.name)) {
        allTools.push({ ...definition, category: 'plugins', source: 'plugin' });
        seen.add(definition.name);
      }
    }
  } catch {
    // Plugins not initialized yet
  }

  return allTools;
}

/**
 * Get tool categories with info
 * NOTE: Must be defined BEFORE /:name to avoid route collision
 */
toolsRoutes.get('/meta/categories', async (c) => {
  const tools = await getAllTools();
  const categories: Record<string, { icon: string; description: string; count: number }> = {};

  for (const tool of tools) {
    if (!categories[tool.category]) {
      const info = CATEGORY_INFO[tool.category] || { icon: '🔧', description: 'Other tools' };
      categories[tool.category] = { ...info, count: 0 };
    }
    categories[tool.category]!.count++;
  }

  const response: ApiResponse = {
    success: true,
    data: categories,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get ALL tools grouped by category
 * NOTE: Must be defined BEFORE /:name to avoid route collision
 */
toolsRoutes.get('/meta/grouped', async (c) => {
  const tools = await getAllTools();

  const byCategory: Record<string, {
    info: { icon: string; description: string };
    tools: Array<{ name: string; description: string; parameters: unknown; source: string }>;
  }> = {};

  for (const tool of tools) {
    if (!byCategory[tool.category]) {
      const info = CATEGORY_INFO[tool.category] || { icon: '🔧', description: 'Other tools' };
      byCategory[tool.category] = { info, tools: [] };
    }
    byCategory[tool.category]!.tools.push({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      source: tool.source,
    });
  }

  const response: ApiResponse = {
    success: true,
    data: {
      categories: byCategory,
      totalTools: tools.length,
      totalCategories: Object.keys(byCategory).length,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * List available tools
 */
toolsRoutes.get('/', async (c) => {
  const agentId = c.req.query('agentId');
  const grouped = c.req.query('grouped') === 'true';

  // Get tools from agent or use all tools
  let tools: Array<ToolInfo & { source?: string }>;

  if (agentId) {
    const agent = await getAgent(agentId);
    if (!agent) {
      throw new HTTPException(404, {
        message: `Agent not found: ${agentId}`,
      });
    }

    tools = agent.getTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      category: t.category,
    }));
  } else {
    // Return ALL tools
    const allTools = await getAllTools();
    tools = allTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      category: t.category,
      source: t.source,
    }));
  }

  // If grouped query param, return grouped by category
  if (grouped) {
    const byCategory: Record<string, {
      info: { icon: string; description: string };
      tools: typeof tools;
    }> = {};

    for (const tool of tools) {
      const category = tool.category || 'other';
      if (!byCategory[category]) {
        const info = CATEGORY_INFO[category] || { icon: '🔧', description: 'Other tools' };
        byCategory[category] = { info, tools: [] };
      }
      byCategory[category]!.tools.push(tool);
    }

    const response: ApiResponse = {
      success: true,
      data: {
        categories: byCategory,
        totalTools: tools.length,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  }

  const response: ApiResponse<typeof tools> = {
    success: true,
    data: tools,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get tool executor source code
 */
toolsRoutes.get('/:name/source', async (c) => {
  const name = c.req.param('name');
  const registry = getSharedToolRegistry();
  const registered = registry.get(name);

  // Build fallback: shared registry first, then plugin registry
  let fallbackToString: (() => string) | undefined;
  if (registered) {
    fallbackToString = () => registered.executor.toString();
  } else {
    // Check plugin registry for plugin-provided tools
    const pluginRegistry = await getDefaultPluginRegistry();
    const pluginTool = pluginRegistry.getTool(name);
    if (pluginTool) {
      fallbackToString = () => pluginTool.executor.toString();
    }
  }

  // Try TypeScript source first, fall back to executor.toString()
  const source = getToolSource(name, fallbackToString);
  if (!source) {
    throw new HTTPException(404, { message: `Tool not found: ${name}` });
  }

  const response: ApiResponse<{ name: string; source: string }> = {
    success: true,
    data: { name, source },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get tool details
 */
toolsRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  const agentId = c.req.query('agentId');

  let tool: ToolDefinition | undefined;

  if (agentId) {
    const agent = await getAgent(agentId);
    if (!agent) {
      throw new HTTPException(404, {
        message: `Agent not found: ${agentId}`,
      });
    }
    tool = agent.getTools().find((t) => t.name === name);
  } else {
    // Search all tool sources (core, memory, goal, custom data, personal data, triggers, plans, plugins)
    const allTools = await getAllTools();
    tool = allTools.find((t) => t.name === name);
  }

  if (!tool) {
    throw new HTTPException(404, {
      message: `Tool not found: ${name}`,
    });
  }

  const response: ApiResponse<ToolInfo> = {
    success: true,
    data: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      category: tool.category,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Execute a tool directly (for testing)
 */
toolsRoutes.post('/:name/execute', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json<{ arguments: Record<string, unknown> }>();

  const startTime = Date.now();
  const result = await resolveAndExecuteTool(name, body.arguments ?? {}, 'direct-execution');
  const duration = Date.now() - startTime;

  const response: ApiResponse = {
    success: true,
    data: {
      tool: name,
      result: result.content,
      isError: result.isError,
      duration,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Execute a tool with streaming output
 */
toolsRoutes.post('/:name/stream', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json<{ arguments: Record<string, unknown> }>();

  return streamSSE(c, async (stream) => {
    const startTime = Date.now();

    try {
      // Send start event
      await stream.writeSSE({
        event: 'start',
        data: JSON.stringify({
          tool: name,
          arguments: body.arguments,
          timestamp: new Date().toISOString(),
        }),
      });

      // Execute tool (shared registry + plugin fallback)
      const result = await resolveAndExecuteTool(name, body.arguments ?? {}, 'stream-execution');
      const duration = Date.now() - startTime;

      // Send result event
      await stream.writeSSE({
        event: 'result',
        data: JSON.stringify({
          success: true,
          result: result.content,
          isError: result.isError,
          duration,
        }),
      });

      // Send complete event
      await stream.writeSSE({
        event: 'complete',
        data: JSON.stringify({
          duration,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (err: any) {
      const duration = Date.now() - startTime;

      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          success: false,
          error: err.message,
          duration,
        }),
      });
    }
  });
});

/**
 * Batch execute multiple tools
 */
toolsRoutes.post('/batch', async (c) => {
  const body = await c.req.json<{
    executions: Array<{ tool: string; arguments: Record<string, unknown> }>;
    parallel?: boolean;
  }>();

  if (!body.executions || !Array.isArray(body.executions)) {
    throw new HTTPException(400, {
      message: 'Missing required field: executions (array)',
    });
  }

  const startTime = Date.now();

  const executeOne = async (exec: { tool: string; arguments: Record<string, unknown> }) => {
    const toolStartTime = Date.now();

    try {
      const result = await resolveAndExecuteTool(exec.tool, exec.arguments ?? {}, 'batch-execution');
      return {
        tool: exec.tool,
        success: true,
        result: result.content,
        isError: result.isError,
        duration: Date.now() - toolStartTime,
      };
    } catch (err: any) {
      return {
        tool: exec.tool,
        success: false,
        result: null,
        error: err.message,
        duration: Date.now() - toolStartTime,
      };
    }
  };

  let results;

  if (body.parallel !== false) {
    // Execute in parallel (default)
    results = await Promise.all(body.executions.map(executeOne));
  } else {
    // Execute sequentially
    results = [];
    for (const exec of body.executions) {
      results.push(await executeOne(exec));
    }
  }

  const totalDuration = Date.now() - startTime;

  const response: ApiResponse = {
    success: true,
    data: {
      results,
      totalDuration,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Export tool registry for use in other modules
 */
export { getToolRegistry };
