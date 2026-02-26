/**
 * Workspace CRUD Routes
 *
 * GET /    - List user's workspaces
 * POST /   - Create a new workspace
 * GET /:id - Get workspace details
 * PATCH /:id - Update workspace
 * DELETE /:id - Delete workspace
 */

import { Hono } from 'hono';
import { WorkspacesRepository } from '../../db/repositories/workspaces.js';
import {
  getOrchestrator,
  getWorkspaceStorage,
  type CreateWorkspaceRequest,
  type UpdateWorkspaceRequest,
  type ContainerConfig,
  DEFAULT_CONTAINER_CONFIG,
} from '@ownpilot/core';
import { apiResponse, apiError, ERROR_CODES, getUserId, getErrorMessage, parseJsonBody } from '../helpers.js';
import { wsGateway } from '../../ws/server.js';
import { sanitizeContainerConfig } from './shared.js';

const app = new Hono();

/**
 * GET /workspaces - List user's workspaces
 */
app.get('/', async (c) => {
  const userId = getUserId(c);
  const repo = new WorkspacesRepository(userId);

  try {
    const workspaces = await repo.list();

    return apiResponse(c, {
      workspaces: workspaces.map((w) => ({
        id: w.id,
        userId: w.userId,
        name: w.name,
        description: w.description,
        status: w.status,
        storagePath: w.storagePath,
        containerConfig: w.containerConfig,
        containerId: w.containerId,
        containerStatus: w.containerStatus,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
      })),
      count: workspaces.length,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.WORKSPACE_LIST_ERROR,
        message: getErrorMessage(error, 'Failed to list workspaces'),
      },
      500
    );
  }
});

/**
 * POST /workspaces - Create a new workspace
 */
app.post('/', async (c) => {
  const userId = getUserId(c);
  const repo = new WorkspacesRepository(userId);

  try {
    const rawBody = await parseJsonBody(c);

    if (!rawBody) {
      return apiError(
        c,
        { code: ERROR_CODES.INVALID_INPUT, message: 'Request body is required' },
        400
      );
    }

    const { validateBody, createWorkspaceSchema } = await import('../../middleware/validation.js');
    const body = validateBody(createWorkspaceSchema, rawBody) as CreateWorkspaceRequest;

    // Check workspace limit
    const existingCount = await repo.count();

    const maxWorkspaces = 5; // Could be from settings
    if (existingCount >= maxWorkspaces) {
      return apiError(
        c,
        {
          code: ERROR_CODES.WORKSPACE_LIMIT_EXCEEDED,
          message: `Maximum ${maxWorkspaces} workspaces allowed`,
        },
        400
      );
    }

    // Create workspace storage
    const storage = getWorkspaceStorage();
    const workspaceId = crypto.randomUUID();
    const storagePath = await storage.createUserStorage(`${userId}/${workspaceId}`);

    const containerConfig = sanitizeContainerConfig(DEFAULT_CONTAINER_CONFIG, body.containerConfig);

    // Create workspace in repository
    const workspace = await repo.create({
      name: body.name,
      description: body.description,
      storagePath,
      containerConfig,
    });

    await repo.logAudit('create', 'workspace', workspace.id);

    wsGateway.broadcast('data:changed', {
      entity: 'workspace',
      action: 'created',
      id: workspace.id,
    });

    return apiResponse(
      c,
      {
        id: workspace.id,
        userId: workspace.userId,
        name: workspace.name,
        description: workspace.description,
        status: workspace.status,
        storagePath: workspace.storagePath,
        containerConfig: workspace.containerConfig,
        containerStatus: workspace.containerStatus,
        createdAt: workspace.createdAt.toISOString(),
      },
      201
    );
  } catch (error) {
    const msg = getErrorMessage(error, 'Failed to create workspace');
    if (msg.startsWith('Validation failed:')) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: msg }, 400);
    }
    await repo.logAudit('create', 'workspace', undefined, false, msg);
    return apiError(c, { code: ERROR_CODES.WORKSPACE_CREATE_ERROR, message: msg }, 500);
  }
});

/**
 * GET /workspaces/:id - Get workspace details
 */
app.get('/:id', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const repo = new WorkspacesRepository(userId);

  try {
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(
        c,
        { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' },
        404
      );
    }

    // Get storage usage
    const storage = getWorkspaceStorage();
    const storageUsage = await storage.getStorageUsage(`${userId}/${workspaceId}`);

    return apiResponse(c, {
      id: workspace.id,
      userId: workspace.userId,
      name: workspace.name,
      description: workspace.description,
      status: workspace.status,
      storagePath: workspace.storagePath,
      containerConfig: workspace.containerConfig,
      containerId: workspace.containerId,
      containerStatus: workspace.containerStatus,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
      storageUsage,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.WORKSPACE_FETCH_ERROR,
        message: getErrorMessage(error, 'Failed to fetch workspace'),
      },
      500
    );
  }
});

/**
 * PATCH /workspaces/:id - Update workspace
 */
app.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const repo = new WorkspacesRepository(userId);

  try {
    const rawBody = await parseJsonBody(c);

    if (!rawBody) {
      return apiError(
        c,
        { code: ERROR_CODES.INVALID_INPUT, message: 'Request body is required' },
        400
      );
    }

    const { validateBody, updateWorkspaceSchema } = await import('../../middleware/validation.js');
    const body = validateBody(updateWorkspaceSchema, rawBody) as UpdateWorkspaceRequest;

    // Check workspace exists and belongs to user
    const existing = await repo.get(workspaceId);

    if (!existing) {
      return apiError(
        c,
        { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' },
        404
      );
    }

    // Build update input
    const updateInput: { name?: string; description?: string; containerConfig?: ContainerConfig } =
      {};

    if (body.name) {
      updateInput.name = body.name;
    }
    if (body.description !== undefined) {
      updateInput.description = body.description;
    }
    if (body.containerConfig) {
      updateInput.containerConfig = sanitizeContainerConfig(
        existing.containerConfig,
        body.containerConfig
      );
    }

    if (Object.keys(updateInput).length > 0) {
      await repo.update(workspaceId, updateInput);
    }

    await repo.logAudit('write', 'workspace', workspaceId);

    wsGateway.broadcast('data:changed', {
      entity: 'workspace',
      action: 'updated',
      id: workspaceId,
    });

    return apiResponse(c, { updated: true });
  } catch (error) {
    const msg = getErrorMessage(error, 'Failed to update workspace');
    if (msg.startsWith('Validation failed:')) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: msg }, 400);
    }
    return apiError(c, { code: ERROR_CODES.WORKSPACE_UPDATE_ERROR, message: msg }, 500);
  }
});

/**
 * DELETE /workspaces/:id - Delete workspace
 */
app.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const repo = new WorkspacesRepository(userId);

  try {
    // Check workspace exists and belongs to user
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(
        c,
        { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' },
        404
      );
    }

    // Stop container if running
    if (workspace.containerId) {
      const orchestrator = getOrchestrator();
      await orchestrator.stopContainer(workspace.containerId);
    }

    // Soft delete (set status to deleted)
    await repo.delete(workspaceId);

    // Optionally delete storage
    // const storage = getWorkspaceStorage();
    // await storage.deleteUserStorage(`${userId}/${workspaceId}`);

    await repo.logAudit('delete', 'workspace', workspaceId);

    wsGateway.broadcast('data:changed', {
      entity: 'workspace',
      action: 'deleted',
      id: workspaceId,
    });

    return apiResponse(c, { deleted: true });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.WORKSPACE_DELETE_ERROR,
        message: getErrorMessage(error, 'Failed to delete workspace'),
      },
      500
    );
  }
});

export const workspaceCrudRoutes = app;
