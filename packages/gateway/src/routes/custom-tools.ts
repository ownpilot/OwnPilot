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
  type DynamicToolDefinition,
  type ToolDefinition,
} from '@ownpilot/core';
import type { ApiResponse } from '../types/index.js';

export const customToolsRoutes = new Hono();

// Create dynamic tool registry for execution
const dynamicRegistry = createDynamicToolRegistry();

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
customToolsRoutes.get('/stats', (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const stats = repo.getStats();

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
customToolsRoutes.get('/', (c) => {
  const repo = createCustomToolsRepo(getUserId(c));

  const status = c.req.query('status') as ToolStatus | undefined;
  const category = c.req.query('category');
  const createdBy = c.req.query('createdBy') as 'user' | 'llm' | undefined;
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
  const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined;

  const tools = repo.list({ status, category, createdBy, limit, offset });

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
customToolsRoutes.get('/pending', (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const tools = repo.getPendingApproval();

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
customToolsRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = repo.get(id);
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
  const body = await c.req.json<{
    name: string;
    description: string;
    parameters: CustomToolRecord['parameters'];
    code: string;
    category?: string;
    permissions?: ToolPermission[];
    requiresApproval?: boolean;
    createdBy?: 'user' | 'llm';
    metadata?: Record<string, unknown>;
  }>();

  // Validate required fields
  if (!body.name || !body.description || !body.parameters || !body.code) {
    throw new HTTPException(400, {
      message: 'Missing required fields: name, description, parameters, code',
    });
  }

  // Validate tool name format
  if (!/^[a-z][a-z0-9_]*$/.test(body.name)) {
    throw new HTTPException(400, {
      message: 'Invalid tool name. Must start with lowercase letter and contain only lowercase letters, numbers, and underscores.',
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

  const repo = createCustomToolsRepo(getUserId(c));

  // Check if tool name already exists
  const existing = repo.getByName(body.name);
  if (existing) {
    throw new HTTPException(409, {
      message: `Tool with name '${body.name}' already exists`,
    });
  }

  const tool = repo.create({
    name: body.name,
    description: body.description,
    parameters: body.parameters,
    code: body.code,
    category: body.category,
    permissions: body.permissions,
    requiresApproval: body.requiresApproval,
    createdBy: body.createdBy ?? 'user',
    metadata: body.metadata,
  });

  // Sync to dynamic registry if active
  syncToolToRegistry(tool);

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

  const tool = repo.update(id, body);
  if (!tool) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

  // Re-sync to dynamic registry
  syncToolToRegistry(tool);

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
customToolsRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  // Get tool name for unregistering
  const tool = repo.get(id);
  if (tool) {
    dynamicRegistry.unregister(tool.name);
  }

  const deleted = repo.delete(id);
  if (!deleted) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

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
customToolsRoutes.post('/:id/enable', (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = repo.enable(id);
  if (!tool) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

  syncToolToRegistry(tool);

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
customToolsRoutes.post('/:id/disable', (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = repo.disable(id);
  if (!tool) {
    throw new HTTPException(404, {
      message: `Custom tool not found: ${id}`,
    });
  }

  syncToolToRegistry(tool);

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
customToolsRoutes.post('/:id/approve', (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = repo.get(id);
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

  const approved = repo.approve(id);
  if (approved) {
    syncToolToRegistry(approved);
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
customToolsRoutes.post('/:id/reject', (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = repo.get(id);
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

  const rejected = repo.reject(id);

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
  const tool = repo.get(id);

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
  repo.recordUsage(id);

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

  // Create temporary registry for testing
  const testRegistry = createDynamicToolRegistry();

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
customToolsRoutes.get('/active/definitions', (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const tools = repo.getActiveTools();

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
export function executeCustomToolTool(
  toolId: string,
  params: Record<string, unknown>,
  userId = 'default'
): ToolExecutionResult {
  const repo = createCustomToolsRepo(userId);

  try {
    switch (toolId) {
      case 'create_tool': {
        const { name, description, parameters: parametersInput, code, category, permissions } = params as {
          name: string;
          description: string;
          parameters: string | { type: 'object'; properties: Record<string, unknown>; required?: string[] };
          code: string;
          category?: string;
          permissions?: string[];
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
        const existing = repo.getByName(name);
        if (existing) {
          return { success: false, error: `Tool with name '${name}' already exists` };
        }

        // Validate code
        const codeValidation = validateToolCode(code);
        if (!codeValidation.valid) {
          return { success: false, error: codeValidation.error };
        }

        // Create the tool (LLM-created tools may need approval for dangerous permissions)
        const tool = repo.create({
          name,
          description,
          parameters,
          code,
          category,
          permissions: (permissions ?? []) as ToolPermission[],
          requiresApproval: true, // All LLM-created tools require approval before each execution
          createdBy: 'llm',
        });

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

        const tools = repo.list({
          category,
          status: status as ToolStatus,
        });

        const stats = repo.getStats();

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
        const { name } = params as { name: string };

        if (!name) {
          return { success: false, error: 'Tool name is required' };
        }

        const tool = repo.getByName(name);
        if (!tool) {
          return { success: false, error: `Tool '${name}' not found` };
        }

        // Unregister from dynamic registry
        dynamicRegistry.unregister(name);

        // Delete from database
        const deleted = repo.delete(tool.id);

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

        const tool = repo.getByName(name);
        if (!tool) {
          return { success: false, error: `Tool '${name}' not found` };
        }

        const updated = enabled ? repo.enable(tool.id) : repo.disable(tool.id);
        if (updated) {
          syncToolToRegistry(updated);
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
  const tool = repo.getByName(toolName);
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
    repo.recordUsage(tool.id);

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
export function getActiveCustomToolDefinitions(userId = 'default'): ToolDefinition[] {
  const repo = createCustomToolsRepo(userId);
  const tools = repo.getActiveTools();

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
export function isCustomTool(toolName: string, userId = 'default'): boolean {
  const repo = createCustomToolsRepo(userId);
  return repo.getByName(toolName) !== null;
}
