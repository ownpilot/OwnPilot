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
