/**
 * Custom Tool Executors
 *
 * Meta-tools that let the LLM create, list, update, delete, and toggle
 * user-custom tools, plus the dispatcher that executes an active custom
 * tool by name and the helper that lists active tools for the agent.
 *
 * Extracted from `routes/custom-tools/generation.ts` so the tool registry
 * doesn't have to reach back into the routes/ layer for executors.
 * `routes/custom-tools/generation.ts` keeps the REST handlers (execute,
 * test, audit trail) and re-exports these for legacy callers.
 */

import {
  createCustomToolsRepo,
  type ToolPermission,
  type ToolStatus,
} from '../db/repositories/custom/tools.js';
import { validateToolCode, type ToolDefinition } from '@ownpilot/core';
import { invalidateAgentCache } from '../services/agent/cache.js';
import {
  registerToolConfigRequirements,
  unregisterDependencies,
} from '../services/api-service-registrar.js';
import {
  syncToolToRegistry,
  executeCustomToolUnified,
  unregisterToolFromRegistries,
} from '../services/custom/tool-registry.js';
import { sanitizeId, sanitizeText, getErrorMessage } from '../utils/common.js';
import type { ToolExecutionResult as BaseToolExecutionResult } from '../services/tool/executor.js';

/**
 * Result shape for the meta-tool executors. Extends the base shape with
 * approval/confirmation flags that the LLM-facing flow needs.
 */
interface ToolExecutionResult extends BaseToolExecutionResult {
  requiresApproval?: boolean;
  requiresConfirmation?: boolean;
  pendingToolId?: string;
}

/**
 * Execute custom tool management tools (meta-tools).
 * Used by LLM to create, list, delete, and toggle custom tools.
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

        if (!name || !description || !parametersInput || !code) {
          return {
            success: false,
            error: 'Missing required fields: name, description, parameters, code',
          };
        }

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

        if (!parameters || typeof parameters !== 'object' || parameters.type !== 'object') {
          return {
            success: false,
            error: 'Parameters must be a JSON Schema object with type: "object"',
          };
        }

        if (!/^[a-z][a-z0-9_]*$/.test(name)) {
          return {
            success: false,
            error:
              'Tool name must start with lowercase letter and contain only lowercase letters, numbers, and underscores',
          };
        }

        const existing = await repo.getByName(name);
        if (existing) {
          return { success: false, error: `Tool with name '${sanitizeText(name)}' already exists` };
        }

        const codeValidation = validateToolCode(code);
        if (!codeValidation.valid) {
          return {
            success: false,
            error: `Tool code validation failed: ${codeValidation.errors[0]}`,
          };
        }

        const requiredApiKeys = required_api_keys?.length ? required_api_keys : undefined;

        const tool = await repo.create({
          name,
          description,
          parameters,
          code,
          category,
          permissions: (permissions ?? []) as ToolPermission[],
          requiresApproval: true,
          createdBy: 'llm',
          requiredApiKeys,
        });

        if (requiredApiKeys?.length) {
          await registerToolConfigRequirements(tool.name, tool.id, 'custom', requiredApiKeys);
        }

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

        syncToolToRegistry(tool);

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

        const VALID_STATUSES = ['active', 'disabled', 'pending_approval', 'rejected'];
        if (status && !VALID_STATUSES.includes(status)) {
          return {
            success: false,
            error: `Invalid status '${status}'. Allowed: ${VALID_STATUSES.join(', ')}`,
          };
        }

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

        if (tool.createdBy === 'user') {
          return {
            success: false,
            error: `Cannot delete tool '${sanitizeText(name)}' - this tool was created by the user and is protected. Only the user can delete it through the UI or API. If the user explicitly asked you to delete it, please inform them they need to delete it manually from the Custom Tools page.`,
          };
        }

        if (!confirm) {
          return {
            success: false,
            requiresConfirmation: true,
            error: `Are you sure you want to delete the tool '${sanitizeText(name)}'? Call delete_custom_tool again with confirm: true to proceed.`,
          };
        }

        unregisterToolFromRegistries(name);

        await unregisterDependencies(tool.id);

        const deleted = await repo.delete(tool.id);

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

        syncToolToRegistry(updated);

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
 * Execute an active custom tool by name.
 * Used when LLM calls a dynamically created tool.
 */
export async function executeActiveCustomTool(
  toolName: string,
  params: Record<string, unknown>,
  userId = 'default',
  context?: { callId?: string; conversationId?: string }
): Promise<ToolExecutionResult> {
  const repo = createCustomToolsRepo(userId);

  const tool = await repo.getByName(toolName);
  if (!tool) {
    return { success: false, error: `Custom tool '${sanitizeText(toolName)}' not found` };
  }

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

  syncToolToRegistry(tool);

  try {
    const result = await executeCustomToolUnified(toolName, params, {
      callId: context?.callId,
      conversationId: context?.conversationId ?? 'agent-execution',
      userId,
    });

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
 * Get all active custom tool definitions for LLM.
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
