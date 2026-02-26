/**
 * Custom Tools Execution & Generation Routes
 *
 * Tool execution, testing, audit trail, and meta-tool executors for LLM.
 * Endpoints: POST /:id/execute, GET /:id/executions, POST /test
 * Exports: executeCustomToolTool, executeActiveCustomTool, getActiveCustomToolDefinitions
 */

import { Hono } from 'hono';
import {
  createCustomToolsRepo,
  type CustomToolRecord,
  type ToolPermission,
  type ToolStatus,
} from '../../db/repositories/custom-tools.js';
import {
  createDynamicToolRegistry,
  ALL_TOOLS,
  validateToolCode,
  type DynamicToolDefinition,
  type ToolDefinition,
} from '@ownpilot/core';
import { invalidateAgentCache } from '../agents.js';
import {
  registerToolConfigRequirements,
  unregisterDependencies,
} from '../../services/api-service-registrar.js';
import {
  syncToolToRegistry,
  executeCustomToolUnified,
  unregisterToolFromRegistries,
} from '../../services/custom-tool-registry.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getOptionalIntParam,
  sanitizeId,
  sanitizeText,
  notFoundError,
  getErrorMessage,
  parseJsonBody,
} from '../helpers.js';
import { TOOL_ARGS_MAX_SIZE } from '../../config/defaults.js';
import type { ToolExecutionResult as BaseToolExecutionResult } from '../../services/tool-executor.js';

export const generationRoutes = new Hono();

// =============================================================================
// EXECUTION
// =============================================================================

/**
 * Execute a custom tool
 */
generationRoutes.post('/:id/execute', async (c) => {
  const id = c.req.param('id');
  const body = (await parseJsonBody(c)) as {
    arguments?: Record<string, unknown>;
  } | null;
  if (!body) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON body' }, 400);
  }

  const repo = createCustomToolsRepo(getUserId(c));
  const tool = await repo.get(id);

  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  if (tool.status !== 'active') {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `Tool is not active. Current status: ${tool.status}`,
      },
      400
    );
  }

  // Validate arguments size to prevent abuse
  const argsStr = JSON.stringify(body.arguments ?? {});
  if (argsStr.length > TOOL_ARGS_MAX_SIZE) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_INPUT, message: 'Arguments payload too large (max 100KB)' },
      400
    );
  }

  // Ensure tool is registered
  syncToolToRegistry(tool);

  const startTime = Date.now();
  try {
    const result = await executeCustomToolUnified(tool.name, body.arguments ?? {}, {
      conversationId: 'direct-execution',
      userId: getUserId(c),
    });
    const duration = Date.now() - startTime;

    // Record usage
    await repo.recordUsage(id);

    // Record in audit trail
    recordExecution(id, body.arguments ?? {}, result, duration);

    return apiResponse(c, {
      tool: tool.name,
      result: result.content,
      isError: result.isError,
      duration,
      metadata: result.metadata,
    });
  } catch (execError) {
    const duration = Date.now() - startTime;
    const errorResult = {
      content: getErrorMessage(execError, 'Execution failed'),
      isError: true as const,
    };

    // Record failure in audit trail
    recordExecution(id, body.arguments ?? {}, errorResult, duration);

    return apiResponse(c, {
      tool: tool.name,
      result: errorResult.content,
      isError: true,
      duration,
      metadata: {},
    });
  }
});

/**
 * GET /custom-tools/:id/executions - View execution audit trail
 */
generationRoutes.get('/:id/executions', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.get(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  const limit = getOptionalIntParam(c, 'limit', 1, 100) ?? 50;
  const trail = executionAuditTrail.get(id) ?? [];
  const recent = trail.slice(-limit).reverse(); // Most recent first

  return apiResponse(c, {
    tool: tool.name,
    toolId: id,
    executions: recent,
    totalRecorded: trail.length,
  });
});

/**
 * Test a tool without saving (dry run)
 */
generationRoutes.post('/test', async (c) => {
  const body = (await parseJsonBody(c)) as {
    name: string;
    description: string;
    parameters: CustomToolRecord['parameters'];
    code: string;
    permissions?: ToolPermission[];
    testArguments?: Record<string, unknown>;
  } | null;
  if (!body) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON body' }, 400);
  }

  // Validate required fields
  if (!body.name || !body.description || !body.parameters || !body.code) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: 'Missing required fields: name, description, parameters, code',
      },
      400
    );
  }

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
  try {
    const result = await testRegistry.execute(body.name, body.testArguments ?? {}, {
      callId: `test_${Date.now()}`,
      conversationId: 'test-execution',
      userId: getUserId(c),
    });
    const duration = Date.now() - startTime;

    return apiResponse(c, {
      tool: body.name,
      result: result.content,
      isError: result.isError,
      duration,
      metadata: result.metadata,
      testMode: true,
    });
  } catch (execError) {
    const duration = Date.now() - startTime;
    return apiResponse(c, {
      tool: body.name,
      result: getErrorMessage(execError, 'Execution failed'),
      isError: true,
      duration,
      metadata: {},
      testMode: true,
    });
  }
});

// =============================================================================
// EXECUTION AUDIT TRAIL
// =============================================================================

/** In-memory execution audit trail (per tool, capped) */
const executionAuditTrail = new Map<
  string,
  Array<{
    timestamp: string;
    argsHash: string;
    resultSummary: string;
    duration: number;
    success: boolean;
    error?: string;
  }>
>();

const MAX_AUDIT_ENTRIES_PER_TOOL = 100;

/**
 * Record a tool execution in the audit trail.
 */
function recordExecution(
  toolId: string,
  args: Record<string, unknown>,
  result: { content: unknown; isError: boolean },
  duration: number
): void {
  if (!executionAuditTrail.has(toolId)) {
    executionAuditTrail.set(toolId, []);
  }
  const trail = executionAuditTrail.get(toolId)!;

  // Hash args for privacy (don't store raw arguments)
  const argsStr = JSON.stringify(args);
  const argsHash =
    argsStr.length > 0
      ? `sha256:${Buffer.from(argsStr).toString('base64').slice(0, 16)}...`
      : 'empty';

  // Summarize result
  const resultStr =
    typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  const resultSummary = resultStr.length > 200 ? resultStr.slice(0, 200) + '...' : resultStr;

  trail.push({
    timestamp: new Date().toISOString(),
    argsHash,
    resultSummary: result.isError ? `ERROR: ${resultSummary}` : resultSummary,
    duration,
    success: !result.isError,
    error: result.isError ? resultSummary : undefined,
  });

  // Cap entries
  if (trail.length > MAX_AUDIT_ENTRIES_PER_TOOL) {
    trail.splice(0, trail.length - MAX_AUDIT_ENTRIES_PER_TOOL);
  }
}

// =============================================================================
// META-TOOL EXECUTORS (For LLM to create/manage custom tools)
// =============================================================================

interface ToolExecutionResult extends BaseToolExecutionResult {
  requiresApproval?: boolean;
  requiresConfirmation?: boolean;
  pendingToolId?: string;
}

// Code validation is now centralized in @ownpilot/core (validateToolCode, MAX_TOOL_CODE_SIZE)

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
        const {
          name,
          description,
          parameters: parametersInput,
          code,
          category,
          permissions,
          required_api_keys,
        } = params as {
          name: string;
          description: string;
          parameters:
            | string
            | { type: 'object'; properties: Record<string, unknown>; required?: string[] };
          code: string;
          category?: string;
          permissions?: string[];
          required_api_keys?: Array<{
            name: string;
            displayName?: string;
            description?: string;
            category?: string;
            docsUrl?: string;
          }>;
        };

        // Validate required fields
        if (!name || !description || !parametersInput || !code) {
          return {
            success: false,
            error: 'Missing required fields: name, description, parameters, code',
          };
        }

        // Enforce length limits (same as Zod schema)
        if (typeof name !== 'string' || name.length > 100) {
          return { success: false, error: 'Tool name must be a string with max 100 characters' };
        }
        if (typeof description !== 'string' || description.length > 2000) {
          return { success: false, error: 'Description must be a string with max 2000 characters' };
        }
        if (typeof code !== 'string' || code.length > 50000) {
          return { success: false, error: 'Code must be a string with max 50000 characters' };
        }
        if (category !== undefined && (typeof category !== 'string' || category.length > 50)) {
          return { success: false, error: 'Category must be a string with max 50 characters' };
        }

        // Validate permissions enum
        const VALID_PERMISSIONS = [
          'network',
          'filesystem',
          'database',
          'shell',
          'email',
          'scheduling',
          'local',
        ];
        if (permissions) {
          if (!Array.isArray(permissions) || permissions.length > 7) {
            return { success: false, error: 'Permissions must be an array with max 7 entries' };
          }
          const invalid = permissions.filter((p) => !VALID_PERMISSIONS.includes(p));
          if (invalid.length > 0) {
            return {
              success: false,
              error: `Invalid permissions: ${invalid.join(', ')}. Allowed: ${VALID_PERMISSIONS.join(', ')}`,
            };
          }
        }

        // Parse parameters if it's a JSON string
        let parameters: {
          type: 'object';
          properties: Record<string, unknown>;
          required?: string[];
        };
        if (typeof parametersInput === 'string') {
          try {
            parameters = JSON.parse(parametersInput);
          } catch {
            return {
              success: false,
              error: 'Invalid JSON in parameters field. Must be a valid JSON Schema object.',
            };
          }
        } else {
          parameters = parametersInput;
        }

        // Validate parameters structure
        if (!parameters || typeof parameters !== 'object' || parameters.type !== 'object') {
          return {
            success: false,
            error: 'Parameters must be a JSON Schema object with type: "object"',
          };
        }

        // Validate tool name format
        if (!/^[a-z][a-z0-9_]*$/.test(name)) {
          return {
            success: false,
            error:
              'Tool name must start with lowercase letter and contain only lowercase letters, numbers, and underscores',
          };
        }

        // Check if tool already exists
        const existing = await repo.getByName(name);
        if (existing) {
          return { success: false, error: `Tool with name '${sanitizeText(name)}' already exists` };
        }

        // Validate code using centralized validator
        const codeValidation = validateToolCode(code);
        if (!codeValidation.valid) {
          return {
            success: false,
            error: `Tool code validation failed: ${codeValidation.errors[0]}`,
          };
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
          await registerToolConfigRequirements(tool.name, tool.id, 'custom', requiredApiKeys);
        }

        // If pending approval, notify user
        if (tool.status === 'pending_approval') {
          return {
            success: true,
            requiresApproval: true,
            pendingToolId: tool.id,
            result: {
              message: `Tool '${sanitizeText(name)}' created but requires user approval before it can be used. It has been flagged for review because it requests dangerous permissions (${permissions?.map((p) => sanitizeId(p)).join(', ')}).`,
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
            message: `Tool '${sanitizeText(name)}' created successfully and is ready to use.`,
            toolId: tool.id,
            status: tool.status,
            description: tool.description,
          },
        };
      }

      case 'list_custom_tools': {
        const { category, status } = params as {
          category?: string;
          status?: string;
        };

        // Validate status enum if provided
        const VALID_STATUSES = ['active', 'disabled', 'pending_approval', 'rejected'];
        if (status && !VALID_STATUSES.includes(status)) {
          return {
            success: false,
            error: `Invalid status '${status}'. Allowed: ${VALID_STATUSES.join(', ')}`,
          };
        }

        // Validate category length
        if (category && (typeof category !== 'string' || category.length > 50)) {
          return { success: false, error: 'Category must be a string with max 50 characters' };
        }

        const tools = await repo.list({
          category,
          status: status as ToolStatus | undefined,
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

        if (!name || typeof name !== 'string' || name.length > 100) {
          return {
            success: false,
            error: 'Tool name must be a non-empty string with max 100 characters',
          };
        }
        if (confirm !== undefined && typeof confirm !== 'boolean') {
          return { success: false, error: 'confirm must be a boolean' };
        }

        const tool = await repo.getByName(name);
        if (!tool) {
          return { success: false, error: `Tool '${sanitizeText(name)}' not found` };
        }

        // PROTECTION: LLM cannot delete user-created tools
        // Only tools created by LLM can be deleted by LLM
        if (tool.createdBy === 'user') {
          return {
            success: false,
            error: `Cannot delete tool '${sanitizeText(name)}' - this tool was created by the user and is protected. Only the user can delete it through the UI or API. If the user explicitly asked you to delete it, please inform them they need to delete it manually from the Custom Tools page.`,
          };
        }

        // For LLM-created tools, still require explicit confirmation
        if (!confirm) {
          return {
            success: false,
            requiresConfirmation: true,
            error: `Are you sure you want to delete the tool '${sanitizeText(name)}'? Call delete_custom_tool again with confirm: true to proceed.`,
          };
        }

        // Unregister from both registries
        unregisterToolFromRegistries(name);

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
            ? { message: `Tool '${sanitizeText(name)}' deleted successfully.` }
            : { message: `Failed to delete tool '${sanitizeText(name)}'.` },
        };
      }

      case 'toggle_custom_tool': {
        const { name, enabled } = params as { name: string; enabled: boolean };

        if (!name || typeof name !== 'string' || name.length > 100) {
          return {
            success: false,
            error: 'Tool name must be a non-empty string with max 100 characters',
          };
        }
        if (typeof enabled !== 'boolean') {
          return { success: false, error: 'enabled must be a boolean value (true or false)' };
        }

        const tool = await repo.getByName(name);
        if (!tool) {
          return { success: false, error: `Tool '${sanitizeText(name)}' not found` };
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
            message: `Tool '${sanitizeText(name)}' ${enabled ? 'enabled' : 'disabled'} successfully.`,
            status: updated?.status,
          },
        };
      }

      case 'update_custom_tool': {
        const { name, description, parameters, code, category, permissions } = params as {
          name: string;
          description?: string;
          parameters?: string;
          code?: string;
          category?: string;
          permissions?: ToolPermission[];
        };

        if (!name || typeof name !== 'string' || name.length > 100) {
          return {
            success: false,
            error: 'Tool name must be a non-empty string with max 100 characters',
          };
        }

        const tool = await repo.getByName(name);
        if (!tool) {
          return { success: false, error: `Tool '${sanitizeText(name)}' not found` };
        }

        // Build update object (only provided fields)
        const updateFields: Record<string, unknown> = {};

        if (description !== undefined && typeof description === 'string' && description.trim()) {
          updateFields.description = description.trim();
        }

        if (code !== undefined && typeof code === 'string' && code.trim()) {
          const codeValidation = validateToolCode(code);
          if (!codeValidation.valid) {
            return {
              success: false,
              error: `Tool code validation failed: ${codeValidation.errors[0]}`,
            };
          }
          updateFields.code = code;
        }

        if (parameters !== undefined) {
          try {
            const parsed = typeof parameters === 'string' ? JSON.parse(parameters) : parameters;
            if (!parsed || typeof parsed !== 'object' || parsed.type !== 'object') {
              return {
                success: false,
                error: 'Parameters must be a valid JSON Schema with type "object"',
              };
            }
            updateFields.parameters = parsed;
          } catch {
            return { success: false, error: 'Failed to parse parameters JSON' };
          }
        }

        if (category !== undefined && typeof category === 'string' && category.trim()) {
          updateFields.category = category.trim();
        }

        if (permissions !== undefined && Array.isArray(permissions)) {
          updateFields.permissions = permissions;
        }

        if (Object.keys(updateFields).length === 0) {
          return {
            success: false,
            error:
              'No fields provided to update. Provide at least one of: description, parameters, code, category, permissions.',
          };
        }

        const updated = await repo.update(tool.id, updateFields);
        if (!updated) {
          return { success: false, error: `Failed to update tool '${sanitizeText(name)}'` };
        }

        // Re-sync to dynamic registry
        syncToolToRegistry(updated);

        // Invalidate agent cache so tool changes take effect
        invalidateAgentCache();

        return {
          success: true,
          result: {
            message: `Tool '${sanitizeText(name)}' updated successfully (v${updated.version}).`,
            version: updated.version,
            status: updated.status,
            updatedFields: Object.keys(updateFields),
          },
        };
      }

      default:
        return { success: false, error: `Unknown custom tool operation: ${sanitizeId(toolId)}` };
    }
  } catch (error) {
    const message = getErrorMessage(error);
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
    return { success: false, error: `Custom tool '${sanitizeText(toolName)}' not found` };
  }

  // Check if tool is active
  if (tool.status !== 'active') {
    if (tool.status === 'pending_approval') {
      return {
        success: false,
        requiresApproval: true,
        pendingToolId: tool.id,
        error: `Tool '${sanitizeText(toolName)}' is pending approval. Please approve it in the Custom Tools page before use.`,
      };
    }
    return {
      success: false,
      error: `Tool '${sanitizeText(toolName)}' is ${sanitizeId(tool.status)}`,
    };
  }

  // Ensure tool is registered
  syncToolToRegistry(tool);

  try {
    // Execute via shared registry (middleware, scoped config, events)
    const result = await executeCustomToolUnified(toolName, params, {
      callId: context?.callId,
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
    const message = getErrorMessage(error);
    return { success: false, error: message };
  }
}

/**
 * Get all active custom tool definitions for LLM
 */
export async function getActiveCustomToolDefinitions(
  userId = 'default'
): Promise<ToolDefinition[]> {
  const repo = createCustomToolsRepo(userId);
  const tools = await repo.getActiveTools();

  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as ToolDefinition['parameters'],
    category: t.category ?? 'Custom',
    requiresConfirmation: t.requiresApproval,
    workflowUsable:
      t.metadata?.workflowUsable !== undefined ? Boolean(t.metadata.workflowUsable) : undefined,
  }));
}
