/**
 * Custom Tools CRUD Routes
 *
 * Core CRUD operations, status management, templates, and definitions.
 * Endpoints: GET /stats, GET /, GET /pending, GET /templates, GET /:id,
 *   POST /, PATCH /:id, DELETE /:id, PATCH /:id/workflow-usable,
 *   POST /:id/enable, POST /:id/disable, POST /templates/:templateId/create,
 *   GET /active/definitions
 */

import { Hono } from 'hono';
import {
  createCustomToolsRepo,
  type CustomToolRecord,
  type ToolPermission,
} from '../../db/repositories/custom-tools.js';
import { validateToolCode } from '@ownpilot/core';
import { invalidateAgentCache } from '../agents.js';
import {
  registerToolConfigRequirements,
  unregisterDependencies,
} from '../../services/api-service-registrar.js';
import {
  syncToolToRegistry,
  unregisterToolFromRegistries,
} from '../../services/custom-tool-registry.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getOptionalIntParam,
  sanitizeText,
  notFoundError,
  validateQueryEnum,
  parseJsonBody,
} from '../helpers.js';
import { TOOL_TEMPLATES } from '../tool-templates.js';
import { wsGateway } from '../../ws/server.js';

export const crudRoutes = new Hono();

// =============================================================================
// STATS & LISTING
// =============================================================================

/**
 * Get custom tools statistics
 */
crudRoutes.get('/stats', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const stats = await repo.getStats();

  return apiResponse(c, stats);
});

/**
 * List custom tools with filtering
 */
crudRoutes.get('/', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));

  const status = validateQueryEnum(c.req.query('status'), [
    'active',
    'disabled',
    'pending_approval',
    'rejected',
  ] as const);
  const category = c.req.query('category');
  const createdBy = validateQueryEnum(c.req.query('createdBy'), ['user', 'llm'] as const);
  const limit = getOptionalIntParam(c, 'limit', 1, 100);
  const offset = getOptionalIntParam(c, 'offset', 0);

  const tools = await repo.list({ status, category, createdBy, limit, offset });

  return apiResponse(c, {
    tools,
    count: tools.length,
  });
});

/**
 * Get pending approval tools
 */
crudRoutes.get('/pending', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const tools = await repo.getPendingApproval();

  return apiResponse(c, {
    tools,
    count: tools.length,
  });
});

/**
 * GET /custom-tools/templates - Get tool templates for safe starting points
 * NOTE: Must be registered BEFORE /:id to avoid Hono route shadowing
 */
crudRoutes.get('/templates', (c) => {
  const category = c.req.query('category');

  let templates = TOOL_TEMPLATES;
  if (category) {
    templates = templates.filter((t) => t.category.toLowerCase() === category.toLowerCase());
  }

  return apiResponse(c, {
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      category: t.category,
      permissions: t.permissions,
      parameters: t.parameters,
      code: t.code,
      requiredApiKeys: t.requiredApiKeys,
    })),
    count: templates.length,
    categories: [...new Set(TOOL_TEMPLATES.map((t) => t.category))],
  });
});

/**
 * Get a specific custom tool
 */
crudRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.get(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  return apiResponse(c, tool);
});

/**
 * Create a new custom tool
 */
crudRoutes.post('/', async (c) => {
  const rawBody = await parseJsonBody(c);
  const { validateBody, createCustomToolSchema } = await import('../../middleware/validation.js');
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

  // Validate code using centralized validator
  const codeValidation = validateToolCode(body.code);
  if (!codeValidation.valid) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: `Tool code validation failed: ${codeValidation.errors[0]}`,
      },
      400
    );
  }

  const repo = createCustomToolsRepo(getUserId(c));

  // Check if tool name already exists
  const existing = await repo.getByName(body.name);
  if (existing) {
    return apiError(
      c,
      {
        code: ERROR_CODES.ALREADY_EXISTS,
        message: `Tool with name '${sanitizeText(body.name)}' already exists`,
      },
      409
    );
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

  // Register config dependencies in Config Center
  if (body.requiredApiKeys?.length) {
    await registerToolConfigRequirements(tool.name, tool.id, 'custom', body.requiredApiKeys);
  }

  // Sync to dynamic registry if active
  syncToolToRegistry(tool);

  // Invalidate agent cache so new tool is available
  invalidateAgentCache();

  wsGateway.broadcast('data:changed', { entity: 'custom_tool', action: 'created', id: tool.id });

  return apiResponse(c, tool, 201);
});

/**
 * Update a custom tool
 */
crudRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const rawBody = await parseJsonBody(c);
  const { validateBody, updateCustomToolSchema } = await import('../../middleware/validation.js');
  const body = validateBody(updateCustomToolSchema, rawBody) as {
    name?: string;
    description?: string;
    parameters?: CustomToolRecord['parameters'];
    code?: string;
    category?: string;
    permissions?: ToolPermission[];
    requiresApproval?: boolean;
    metadata?: Record<string, unknown>;
    requiredApiKeys?: CustomToolRecord['requiredApiKeys'];
  };

  const repo = createCustomToolsRepo(getUserId(c));

  // Validate code if provided (centralized validator)
  if (body.code) {
    const codeValidation = validateToolCode(body.code);
    if (!codeValidation.valid) {
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_INPUT,
          message: `Tool code validation failed: ${codeValidation.errors[0]}`,
        },
        400
      );
    }
  }

  const tool = await repo.update(id, body);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  // Re-register config dependencies if changed
  if (body.requiredApiKeys !== undefined) {
    await unregisterDependencies(id);
    if (body.requiredApiKeys?.length) {
      await registerToolConfigRequirements(tool.name, id, 'custom', body.requiredApiKeys);
    }
  }

  // Re-sync to dynamic registry
  syncToolToRegistry(tool);

  // Invalidate agent cache so tool changes take effect
  invalidateAgentCache();

  wsGateway.broadcast('data:changed', { entity: 'custom_tool', action: 'updated', id });

  return apiResponse(c, tool);
});

/**
 * Delete a custom tool
 */
crudRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  // Get tool name for unregistering
  const tool = await repo.get(id);
  if (tool) {
    unregisterToolFromRegistries(tool.name);
  }

  // Unregister API dependencies
  await unregisterDependencies(id);

  const deleted = await repo.delete(id);
  if (!deleted) {
    return notFoundError(c, 'Custom tool', id);
  }

  // Invalidate agent cache so tool removal takes effect
  invalidateAgentCache();

  wsGateway.broadcast('data:changed', { entity: 'custom_tool', action: 'deleted', id });

  return apiResponse(c, { deleted: true });
});

// =============================================================================
// WORKFLOW USABLE TOGGLE
// =============================================================================

/**
 * Toggle workflowUsable flag for a custom tool
 */
crudRoutes.patch('/:id/workflow-usable', async (c) => {
  const id = c.req.param('id');
  const body = await parseJsonBody(c) as { enabled: boolean } | null;
  if (!body || typeof body.enabled !== 'boolean') {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_INPUT, message: 'enabled (boolean) is required' },
      400
    );
  }

  const repo = createCustomToolsRepo(getUserId(c));
  const tool = await repo.get(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  const metadata = { ...tool.metadata, workflowUsable: body.enabled };
  const updated = await repo.update(id, { metadata });
  if (updated) {
    syncToolToRegistry(updated);
    invalidateAgentCache();
  }

  return apiResponse(c, { workflowUsable: body.enabled });
});

// =============================================================================
// STATUS MANAGEMENT
// =============================================================================

/**
 * Enable a custom tool
 */
crudRoutes.post('/:id/enable', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.enable(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  syncToolToRegistry(tool);

  // Invalidate agent cache so enabled tool becomes available
  invalidateAgentCache();

  wsGateway.broadcast('data:changed', { entity: 'custom_tool', action: 'updated', id });

  return apiResponse(c, tool);
});

/**
 * Disable a custom tool
 */
crudRoutes.post('/:id/disable', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.disable(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  syncToolToRegistry(tool);

  // Invalidate agent cache so disabled tool is removed
  invalidateAgentCache();

  wsGateway.broadcast('data:changed', { entity: 'custom_tool', action: 'updated', id });

  return apiResponse(c, tool);
});

// =============================================================================
// TEMPLATES
// =============================================================================

/**
 * POST /custom-tools/templates/:id/create - Create a tool from a template
 */
crudRoutes.post('/templates/:templateId/create', async (c) => {
  const templateId = c.req.param('templateId');
  const body = await parseJsonBody(c) as {
    name?: string;
    description?: string;
    code?: string;
    permissions?: ToolPermission[];
    requiredApiKeys?: CustomToolRecord['requiredApiKeys'];
  } | null;

  const template = TOOL_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return notFoundError(c, 'Template', templateId);
  }

  // Merge template with overrides (body may be null if no overrides provided)
  const overrides = body ?? {};
  const toolName = overrides.name ?? template.name;
  const toolCode = overrides.code ?? template.code;

  // Validate the final code
  const codeValidation = validateToolCode(toolCode);
  if (!codeValidation.valid) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: `Tool code validation failed: ${codeValidation.errors[0]}`,
      },
      400
    );
  }

  const repo = createCustomToolsRepo(getUserId(c));

  // Check duplicate
  const existing = await repo.getByName(toolName);
  if (existing) {
    return apiError(
      c,
      { code: ERROR_CODES.ALREADY_EXISTS, message: `Tool with name '${toolName}' already exists` },
      409
    );
  }

  const tool = await repo.create({
    name: toolName,
    description: overrides.description ?? template.description,
    parameters: template.parameters as CustomToolRecord['parameters'],
    code: toolCode,
    category: template.category,
    permissions: (overrides.permissions ?? template.permissions) as ToolPermission[],
    requiresApproval: false,
    createdBy: 'user',
    requiredApiKeys: overrides.requiredApiKeys ?? template.requiredApiKeys,
  });

  // Register config dependencies
  if (tool.requiredApiKeys?.length) {
    await registerToolConfigRequirements(tool.name, tool.id, 'custom', tool.requiredApiKeys);
  }

  syncToolToRegistry(tool);
  invalidateAgentCache();

  wsGateway.broadcast('data:changed', { entity: 'custom_tool', action: 'created', id: tool.id });

  return apiResponse(c, tool, 201);
});

// =============================================================================
// DEFINITIONS
// =============================================================================

/**
 * Get active tools for LLM context
 * Returns tools in a format suitable for LLM tool definitions
 */
crudRoutes.get('/active/definitions', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const tools = await repo.getActiveTools();

  const definitions = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    category: tool.category ?? 'Custom',
    requiresConfirmation: tool.requiresApproval,
    workflowUsable:
      tool.metadata?.workflowUsable !== undefined
        ? Boolean(tool.metadata.workflowUsable)
        : undefined,
  }));

  return apiResponse(c, {
    tools: definitions,
    count: definitions.length,
  });
});
