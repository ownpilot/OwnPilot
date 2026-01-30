/**
 * Custom Tools Routes
 *
 * API endpoints for managing LLM-created and user-defined custom tools.
 * Supports full CRUD, enable/disable, approval workflow, and execution.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  createCustomToolsRepo,
  type CustomToolRecord,
  type ToolPermission,
  type ToolStatus,
} from '../db/repositories/custom-tools.js';
import {
  createDynamicToolRegistry,
  ALL_TOOLS,
  type DynamicToolDefinition,
  type ToolDefinition,
} from '@ownpilot/core';
import type { ApiResponse } from '../types/index.js';
import { invalidateAgentCache } from './agents.js';
import {
  registerToolApiDependencies,
  unregisterDependencies,
} from '../services/api-service-registrar.js';

export const customToolsRoutes = new Hono();

// Create dynamic tool registry for execution, with all built-in tools available via callTool
const dynamicRegistry = createDynamicToolRegistry(ALL_TOOLS);

/**
 * Helper to get userId from context
 */
function getUserId(c: any): string {
  return c.get('userId') ?? 'default';
}

/**
 * Sync database tools with dynamic registry
 */
function syncToolToRegistry(tool: CustomToolRecord): void {
  if (tool.status === 'active') {
    const dynamicTool: DynamicToolDefinition = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as DynamicToolDefinition['parameters'],
      code: tool.code,
      category: tool.category,
      permissions: tool.permissions as DynamicToolDefinition['permissions'],
      requiresApproval: tool.requiresApproval,
    };
    dynamicRegistry.register(dynamicTool);
  } else {
    dynamicRegistry.unregister(tool.name);
  }
}

// =============================================================================
// ROUTES
// =============================================================================

/**
 * Get custom tools statistics
 */
customToolsRoutes.get('/stats', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const stats = await repo.getStats();

  const response: ApiResponse = {
    success: true,
    data: stats,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * List custom tools with filtering
 */
customToolsRoutes.get('/', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));

  const status = c.req.query('status') as ToolStatus | undefined;
  const category = c.req.query('category');
  const createdBy = c.req.query('createdBy') as 'user' | 'llm' | undefined;
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
  const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined;

  const tools = await repo.list({ status, category, createdBy, limit, offset });

  const response: ApiResponse = {
    success: true,
    data: {
      tools,
      count: tools.length,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get pending approval tools
 */
customToolsRoutes.get('/pending', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const tools = await repo.getPendingApproval();

  const response: ApiResponse = {
    success: true,
    data: {
      tools,
      count: tools.length,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get a specific custom tool
 */
customToolsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.get(id);
  if (!tool) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

  const response: ApiResponse = {
    success: true,
    data: tool,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Create a new custom tool
 */
customToolsRoutes.post('/', async (c) => {
  const rawBody = await c.req.json();
  const { validateBody, createCustomToolSchema } = await import('../middleware/validation.js');
  const body = validateBody(createCustomToolSchema, rawBody) as {
    name: string;
    description: string;
    parameters: CustomToolRecord['parameters'];
    code: string;
    category?: string;
    permissions?: ToolPermission[];
    requiresApproval?: boolean;
    createdBy?: 'user' | 'llm';
    metadata?: Record<string, unknown>;
    requiredApiKeys?: CustomToolRecord['requiredApiKeys'];
  };

  // Validate code for dangerous patterns
  const dangerousPatterns = [
    /process\.exit/i,
    /require\s*\(/i,
    /import\s*\(/i,
    /__dirname/i,
    /__filename/i,
    /global\./i,
    /globalThis\./i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(body.code)) {
      throw new HTTPException(400, {
        message: `Tool code contains forbidden pattern: ${pattern.source}`,
      });
    }
  }

  const repo = createCustomToolsRepo(getUserId(c));

  // Check if tool name already exists
  const existing = await repo.getByName(body.name);
  if (existing) {
    throw new HTTPException(409, {
      message: `Tool with name '${body.name}' already exists`,
    });
  }

  const tool = await repo.create({
    name: body.name,
    description: body.description,
    parameters: body.parameters,
    code: body.code,
    category: body.category,
    permissions: body.permissions,
    requiresApproval: body.requiresApproval,
    createdBy: body.createdBy ?? 'user',
    metadata: body.metadata,
    requiredApiKeys: body.requiredApiKeys,
  });

  // Register API dependencies in API Center
  if (body.requiredApiKeys?.length) {
    await registerToolApiDependencies(tool.id, tool.name, body.requiredApiKeys);
  }

  // Sync to dynamic registry if active
  syncToolToRegistry(tool);

  // Invalidate agent cache so new tool is available
  invalidateAgentCache();

  const response: ApiResponse = {
    success: true,
    data: tool,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response, 201);
});

/**
 * Update a custom tool
 */
customToolsRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    description?: string;
    parameters?: CustomToolRecord['parameters'];
    code?: string;
    category?: string;
    permissions?: ToolPermission[];
    requiresApproval?: boolean;
    metadata?: Record<string, unknown>;
    requiredApiKeys?: CustomToolRecord['requiredApiKeys'];
  }>();

  const repo = createCustomToolsRepo(getUserId(c));

  // Validate tool name format if provided
  if (body.name && !/^[a-z][a-z0-9_]*$/.test(body.name)) {
    throw new HTTPException(400, {
      message: 'Invalid tool name format',
    });
  }

  // Validate code if provided
  if (body.code) {
    const dangerousPatterns = [
      /process\.exit/i,
      /require\s*\(/i,
      /import\s*\(/i,
      /__dirname/i,
      /__filename/i,
      /global\./i,
      /globalThis\./i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(body.code)) {
        throw new HTTPException(400, {
          message: `Tool code contains forbidden pattern: ${pattern.source}`,
        });
      }
    }
  }

  const tool = await repo.update(id, body);
  if (!tool) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

  // Re-register API dependencies if changed
  if (body.requiredApiKeys !== undefined) {
    await unregisterDependencies(id);
    if (body.requiredApiKeys?.length) {
      await registerToolApiDependencies(id, tool.name, body.requiredApiKeys);
    }
  }

  // Re-sync to dynamic registry
  syncToolToRegistry(tool);

  // Invalidate agent cache so tool changes take effect
  invalidateAgentCache();

  const response: ApiResponse = {
    success: true,
    data: tool,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Delete a custom tool
 */
customToolsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  // Get tool name for unregistering
  const tool = await repo.get(id);
  if (tool) {
    dynamicRegistry.unregister(tool.name);
  }

  // Unregister API dependencies
  await unregisterDependencies(id);

  const deleted = await repo.delete(id);
  if (!deleted) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

  // Invalidate agent cache so tool removal takes effect
  invalidateAgentCache();

  const response: ApiResponse = {
    success: true,
    data: { deleted: true },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

// =============================================================================
// STATUS MANAGEMENT
// =============================================================================

/**
 * Enable a custom tool
 */
customToolsRoutes.post('/:id/enable', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.enable(id);
  if (!tool) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

  syncToolToRegistry(tool);

  // Invalidate agent cache so enabled tool becomes available
  invalidateAgentCache();

  const response: ApiResponse = {
    success: true,
    data: tool,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Disable a custom tool
 */
customToolsRoutes.post('/:id/disable', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.disable(id);
  if (!tool) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

  syncToolToRegistry(tool);

  // Invalidate agent cache so disabled tool is removed
  invalidateAgentCache();

  const response: ApiResponse = {
    success: true,
    data: tool,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Approve a pending tool
 */
customToolsRoutes.post('/:id/approve', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.get(id);
  if (!tool) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

  if (tool.status !== 'pending_approval') {
    throw new HTTPException(400, {
      message: `Tool is not pending approval. Current status: ${tool.status}`,
    });
  }

  const approved = await repo.approve(id);
  if (approved) {
    syncToolToRegistry(approved);
    // Invalidate agent cache so approved tool becomes available
    invalidateAgentCache();
  }

  const response: ApiResponse = {
    success: true,
    data: approved,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Reject a pending tool
 */
customToolsRoutes.post('/:id/reject', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.get(id);
  if (!tool) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

  if (tool.status !== 'pending_approval') {
    throw new HTTPException(400, {
      message: `Tool is not pending approval. Current status: ${tool.status}`,
    });
  }

  const rejected = await repo.reject(id);

  const response: ApiResponse = {
    success: true,
    data: rejected,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

// =============================================================================
// EXECUTION
// =============================================================================

/**
 * Execute a custom tool
 */
customToolsRoutes.post('/:id/execute', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ arguments?: Record<string, unknown> }>();

  const repo = createCustomToolsRepo(getUserId(c));
  const tool = await repo.get(id);

  if (!tool) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

  if (tool.status !== 'active') {
    throw new HTTPException(400, {
      message: `Tool is not active. Current status: ${tool.status}`,
    });
  }

  // Ensure tool is registered
  syncToolToRegistry(tool);

  const startTime = Date.now();
  const result = await dynamicRegistry.execute(
    tool.name,
    body.arguments ?? {},
    {
      callId: `exec_${Date.now()}`,
      conversationId: 'direct-execution',
      userId: getUserId(c),
    }
  );
  const duration = Date.now() - startTime;

  // Record usage
  await repo.recordUsage(id);

  const response: ApiResponse = {
    success: true,
    data: {
      tool: tool.name,
      result: result.content,
      isError: result.isError,
      duration,
      metadata: result.metadata,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Test a tool without saving (dry run)
 */
customToolsRoutes.post('/test', async (c) => {
  const body = await c.req.json<{
    name: string;
    description: string;
    parameters: CustomToolRecord['parameters'];
    code: string;
    permissions?: ToolPermission[];
    testArguments?: Record<string, unknown>;
  }>();

  // Validate required fields
  if (!body.name || !body.description || !body.parameters || !body.code) {
    throw new HTTPException(400, {
      message: 'Missing required fields: name, description, parameters, code',
    });
  }

  // Validate code for dangerous patterns
  const dangerousPatterns = [
    /process\.exit/i,
    /require\s*\(/i,
    /import\s*\(/i,
    /__dirname/i,
    /__filename/i,
    /global\./i,
    /globalThis\./i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(body.code)) {
      throw new HTTPException(400, {
        message: `Tool code contains forbidden pattern: ${pattern.source}`,
      });
    }
  }

  // Create temporary registry for testing, with all built-in tools available via callTool
  const testRegistry = createDynamicToolRegistry(ALL_TOOLS);

  const testTool: DynamicToolDefinition = {
    name: body.name,
    description: body.description,
    parameters: body.parameters as DynamicToolDefinition['parameters'],
    code: body.code,
    permissions: body.permissions,
  };

  testRegistry.register(testTool);

  const startTime = Date.now();
  const result = await testRegistry.execute(
    body.name,
    body.testArguments ?? {},
    {
      callId: `test_${Date.now()}`,
      conversationId: 'test-execution',
      userId: getUserId(c),
    }
  );
  const duration = Date.now() - startTime;

  const response: ApiResponse = {
    success: true,
    data: {
      tool: body.name,
      result: result.content,
      isError: result.isError,
      duration,
      metadata: result.metadata,
      testMode: true,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get active tools for LLM context
 * Returns tools in a format suitable for LLM tool definitions
 */
customToolsRoutes.get('/active/definitions', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const tools = await repo.getActiveTools();

  const definitions = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    category: tool.category ?? 'Custom',
    requiresConfirmation: tool.requiresApproval,
  }));

  const response: ApiResponse = {
    success: true,
    data: {
      tools: definitions,
      count: definitions.length,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

// =============================================================================
// META-TOOL EXECUTORS (For LLM to create/manage custom tools)
// =============================================================================

interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  requiresApproval?: boolean;
  requiresConfirmation?: boolean;
  pendingToolId?: string;
}

// Dangerous patterns that are not allowed in tool code
const DANGEROUS_PATTERNS = [
  /process\.exit/i,
  /require\s*\(/i,
  /import\s*\(/i,
  /__dirname/i,
  /__filename/i,
  /global\./i,
  /globalThis\./i,
];

/**
 * Validate tool code for dangerous patterns
 */
function validateToolCode(code: string): { valid: boolean; error?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      return { valid: false, error: `Tool code contains forbidden pattern: ${pattern.source}` };
    }
  }
  return { valid: true };
}

/**
 * Execute custom tool management tools (meta-tools)
 * Used by LLM to create, list, delete, and toggle custom tools
 */
export async function executeCustomToolTool(
  toolId: string,
  params: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult> {
  const repo = createCustomToolsRepo(userId);

  try {
    switch (toolId) {
      case 'create_tool': {
        const { name, description, parameters: parametersInput, code, category, permissions, required_api_keys } = params as {
          name: string;
          description: string;
          parameters: string | { type: 'object'; properties: Record<string, unknown>; required?: string[] };
          code: string;
          category?: string;
          permissions?: string[];
          required_api_keys?: Array<{ name: string; displayName?: string; description?: string; category?: string; docsUrl?: string }>;
        };

        // Validate required fields
        if (!name || !description || !parametersInput || !code) {
          return { success: false, error: 'Missing required fields: name, description, parameters, code' };
        }

        // Parse parameters if it's a JSON string
        let parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
        if (typeof parametersInput === 'string') {
          try {
            parameters = JSON.parse(parametersInput);
          } catch {
            return { success: false, error: 'Invalid JSON in parameters field. Must be a valid JSON Schema object.' };
          }
        } else {
          parameters = parametersInput;
        }

        // Validate parameters structure
        if (!parameters || typeof parameters !== 'object' || parameters.type !== 'object') {
          return { success: false, error: 'Parameters must be a JSON Schema object with type: "object"' };
        }

        // Validate tool name format
        if (!/^[a-z][a-z0-9_]*$/.test(name)) {
          return {
            success: false,
            error: 'Tool name must start with lowercase letter and contain only lowercase letters, numbers, and underscores',
          };
        }

        // Check if tool already exists
        const existing = await repo.getByName(name);
        if (existing) {
          return { success: false, error: `Tool with name '${name}' already exists` };
        }

        // Validate code
        const codeValidation = validateToolCode(code);
        if (!codeValidation.valid) {
          return { success: false, error: codeValidation.error };
        }

        // Parse required_api_keys
        const requiredApiKeys = required_api_keys?.length ? required_api_keys : undefined;

        // Create the tool (LLM-created tools may need approval for dangerous permissions)
        const tool = await repo.create({
          name,
          description,
          parameters,
          code,
          category,
          permissions: (permissions ?? []) as ToolPermission[],
          requiresApproval: true, // All LLM-created tools require approval before each execution
          createdBy: 'llm',
          requiredApiKeys,
        });

        // Register config dependencies in Config Center
        if (requiredApiKeys?.length) {
          await registerToolApiDependencies(tool.id, tool.name, requiredApiKeys);
        }

        // If pending approval, notify user
        if (tool.status === 'pending_approval') {
          return {
            success: true,
            requiresApproval: true,
            pendingToolId: tool.id,
            result: {
              message: `Tool '${name}' created but requires user approval before it can be used. It has been flagged for review because it requests dangerous permissions (${permissions?.join(', ')}).`,
              toolId: tool.id,
              status: tool.status,
            },
          };
        }

        // Sync to registry if active
        syncToolToRegistry(tool);

        // Invalidate agent cache so new tool becomes available
        invalidateAgentCache();

        return {
          success: true,
          result: {
            message: `Tool '${name}' created successfully and is ready to use.`,
            toolId: tool.id,
            status: tool.status,
            description: tool.description,
          },
        };
      }

      case 'list_custom_tools': {
        const { category, status } = params as {
          category?: string;
          status?: 'active' | 'disabled' | 'pending_approval';
        };

        const tools = await repo.list({
          category,
          status: status as ToolStatus,
        });

        const stats = await repo.getStats();

        return {
          success: true,
          result: {
            message: `Found ${tools.length} custom tool(s).`,
            tools: tools.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              status: t.status,
              category: t.category,
              createdBy: t.createdBy,
              usageCount: t.usageCount,
            })),
            stats: {
              total: stats.total,
              active: stats.active,
              pendingApproval: stats.pendingApproval,
            },
          },
        };
      }

      case 'delete_custom_tool': {
        const { name, confirm } = params as { name: string; confirm?: boolean };

        if (!name) {
          return { success: false, error: 'Tool name is required' };
        }

        const tool = await repo.getByName(name);
        if (!tool) {
          return { success: false, error: `Tool '${name}' not found` };
        }

        // PROTECTION: LLM cannot delete user-created tools
        // Only tools created by LLM can be deleted by LLM
        if (tool.createdBy === 'user') {
          return {
            success: false,
            error: `Cannot delete tool '${name}' - this tool was created by the user and is protected. Only the user can delete it through the UI or API. If the user explicitly asked you to delete it, please inform them they need to delete it manually from the Custom Tools page.`,
          };
        }

        // For LLM-created tools, still require explicit confirmation
        if (!confirm) {
          return {
            success: false,
            requiresConfirmation: true,
            error: `Are you sure you want to delete the tool '${name}'? Call delete_custom_tool again with confirm: true to proceed.`,
          };
        }

        // Unregister from dynamic registry
        dynamicRegistry.unregister(name);

        // Unregister API dependencies
        await unregisterDependencies(tool.id);

        // Delete from database
        const deleted = await repo.delete(tool.id);

        // Invalidate agent cache so tool removal takes effect
        if (deleted) {
          invalidateAgentCache();
        }

        return {
          success: deleted,
          result: deleted
            ? { message: `Tool '${name}' deleted successfully.` }
            : { message: `Failed to delete tool '${name}'.` },
        };
      }

      case 'toggle_custom_tool': {
        const { name, enabled } = params as { name: string; enabled: boolean };

        if (!name || enabled === undefined) {
          return { success: false, error: 'Tool name and enabled status are required' };
        }

        const tool = await repo.getByName(name);
        if (!tool) {
          return { success: false, error: `Tool '${name}' not found` };
        }

        const updated = enabled ? await repo.enable(tool.id) : await repo.disable(tool.id);
        if (updated) {
          syncToolToRegistry(updated);
          // Invalidate agent cache so status change takes effect
          invalidateAgentCache();
        }

        return {
          success: true,
          result: {
            message: `Tool '${name}' ${enabled ? 'enabled' : 'disabled'} successfully.`,
            status: updated?.status,
          },
        };
      }

      default:
        return { success: false, error: `Unknown custom tool operation: ${toolId}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Execute an active custom tool by name
 * Used when LLM calls a dynamically created tool
 */
export async function executeActiveCustomTool(
  toolName: string,
  params: Record<string, unknown>,
  userId = 'default',
  context?: { callId?: string; conversationId?: string }
): Promise<ToolExecutionResult> {
  const repo = createCustomToolsRepo(userId);

  // Find tool by name
  const tool = await repo.getByName(toolName);
  if (!tool) {
    return { success: false, error: `Custom tool '${toolName}' not found` };
  }

  // Check if tool is active
  if (tool.status !== 'active') {
    if (tool.status === 'pending_approval') {
      return {
        success: false,
        requiresApproval: true,
        pendingToolId: tool.id,
        error: `Tool '${toolName}' is pending approval. Please approve it in the Custom Tools page before use.`,
      };
    }
    return { success: false, error: `Tool '${toolName}' is ${tool.status}` };
  }

  // Ensure tool is registered
  syncToolToRegistry(tool);

  try {
    // Execute the tool
    const result = await dynamicRegistry.execute(toolName, params, {
      callId: context?.callId ?? `exec_${Date.now()}`,
      conversationId: context?.conversationId ?? 'agent-execution',
      userId,
    });

    // Record usage
    await repo.recordUsage(tool.id);

    return {
      success: !result.isError,
      result: result.content,
      error: result.isError ? String(result.content) : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Get all active custom tool definitions for LLM
 */
export async function getActiveCustomToolDefinitions(userId = 'default'): Promise<ToolDefinition[]> {
  const repo = createCustomToolsRepo(userId);
  const tools = await repo.getActiveTools();

  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as ToolDefinition['parameters'],
    category: t.category ?? 'Custom',
    requiresConfirmation: t.requiresApproval,
  }));
}

/**
 * Check if a tool name is a custom tool
 */
export async function isCustomTool(toolName: string, userId = 'default'): Promise<boolean> {
  const repo = createCustomToolsRepo(userId);
  return (await repo.getByName(toolName)) !== null;
}
