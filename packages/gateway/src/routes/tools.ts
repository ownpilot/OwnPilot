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

export const toolsRoutes = new Hono();

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
};

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
  const allTools: Array<ToolDefinition & { category: string; source: string }> = [];
  const seen = new Set<string>();

  // Core tools
  for (const tool of CORE_TOOLS) {
    if (!seen.has(tool.name)) {
      allTools.push({ ...tool, category: getCategoryForTool(tool.name), source: 'core' });
      seen.add(tool.name);
    }
  }

  // Memory tools
  for (const tool of MEMORY_TOOLS) {
    if (!seen.has(tool.name)) {
      allTools.push({ ...tool, category: 'memory', source: 'memory' });
      seen.add(tool.name);
    }
  }

  // Goal tools
  for (const tool of GOAL_TOOLS) {
    if (!seen.has(tool.name)) {
      allTools.push({ ...tool, category: 'goals', source: 'goals' });
      seen.add(tool.name);
    }
  }

  // Custom data tools
  for (const tool of CUSTOM_DATA_TOOLS) {
    if (!seen.has(tool.name)) {
      allTools.push({ ...tool, category: 'customData', source: 'customData' });
      seen.add(tool.name);
    }
  }

  // Personal data tools
  for (const tool of PERSONAL_DATA_TOOLS) {
    if (!seen.has(tool.name)) {
      const category = tool.name.includes('task') ? 'tasks'
        : tool.name.includes('bookmark') ? 'bookmarks'
        : tool.name.includes('note') ? 'notes'
        : tool.name.includes('calendar') || tool.name.includes('event') ? 'calendar'
        : tool.name.includes('contact') ? 'contacts'
        : 'other';
      allTools.push({ ...tool, category, source: 'personalData' });
      seen.add(tool.name);
    }
  }

  // Plugin tools
  try {
    const pluginRegistry = await getDefaultPluginRegistry();
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
 * Get tool details
 */
toolsRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  const agentId = c.req.query('agentId');

  let tool;

  if (agentId) {
    const agent = await getAgent(agentId);
    if (!agent) {
      throw new HTTPException(404, {
        message: `Agent not found: ${agentId}`,
      });
    }
    tool = agent.getTools().find((t) => t.name === name);
  } else {
    tool = CORE_TOOLS.find((t) => t.name === name);
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

  // Use standalone tool registry (no agent required)
  const registry = getToolRegistry();

  if (!registry.has(name)) {
    throw new HTTPException(404, {
      message: `Tool not found: ${name}`,
    });
  }

  const startTime = Date.now();
  const result = await registry.execute(name, body.arguments ?? {}, {
    conversationId: 'direct-execution',
  });
  const duration = Date.now() - startTime;

  if (!result.ok) {
    throw new HTTPException(500, {
      message: result.error.message,
    });
  }

  const response: ApiResponse = {
    success: true,
    data: {
      tool: name,
      result: result.value.content,
      isError: result.value.isError,
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

  const registry = getToolRegistry();

  if (!registry.has(name)) {
    throw new HTTPException(404, {
      message: `Tool not found: ${name}`,
    });
  }

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

      // Execute tool
      const result = await registry.execute(name, body.arguments ?? {}, {
        conversationId: 'stream-execution',
      });
      const duration = Date.now() - startTime;

      if (!result.ok) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            success: false,
            error: result.error.message,
            duration,
          }),
        });
        return;
      }

      // Send result event
      await stream.writeSSE({
        event: 'result',
        data: JSON.stringify({
          success: true,
          result: result.value.content,
          isError: result.value.isError,
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

  const registry = getToolRegistry();
  const startTime = Date.now();

  const executeOne = async (exec: { tool: string; arguments: Record<string, unknown> }) => {
    const toolStartTime = Date.now();

    if (!registry.has(exec.tool)) {
      return {
        tool: exec.tool,
        success: false,
        result: null,
        error: `Tool not found: ${exec.tool}`,
        duration: Date.now() - toolStartTime,
      };
    }

    try {
      const result = await registry.execute(exec.tool, exec.arguments ?? {}, {
        conversationId: 'batch-execution',
      });

      if (!result.ok) {
        return {
          tool: exec.tool,
          success: false,
          result: null,
          error: result.error.message,
          duration: Date.now() - toolStartTime,
        };
      }

      return {
        tool: exec.tool,
        success: true,
        result: result.value.content,
        isError: result.value.isError,
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
