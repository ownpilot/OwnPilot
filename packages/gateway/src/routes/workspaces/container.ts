/**
 * Workspace Container Routes
 *
 * POST /:id/container/start   - Start container
 * POST /:id/container/stop    - Stop container
 * GET /:id/container/status   - Get container status
 * GET /:id/container/logs     - Get container logs
 * GET /system/status           - Get sandbox system status
 */

import { Hono } from 'hono';
import { WorkspacesRepository } from '../../db/repositories/workspaces.js';
import {
  getOrchestrator,
  isDockerAvailable,
  type ContainerConfig,
} from '@ownpilot/core';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getIntParam,
  getUserId,
  getErrorMessage,
} from '../helpers.js';

const app = new Hono();

/**
 * POST /workspaces/:id/container/start - Start container
 */
app.post('/:id/container/start', async (c) => {
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

    // Check if already running
    if (workspace.containerStatus === 'running' && workspace.containerId) {
      return apiResponse(c, {
        containerId: workspace.containerId,
        status: 'running',
        message: 'Container already running',
      });
    }

    const orchestrator = getOrchestrator();
    const containerConfig: ContainerConfig = workspace.containerConfig;

    const containerId = await orchestrator.createContainer(
      userId,
      workspaceId,
      workspace.storagePath,
      containerConfig
    );

    // Update workspace
    await repo.updateContainerStatus(workspaceId, containerId, 'running');

    await repo.logAudit('start', 'container', workspaceId);

    return apiResponse(c, {
      containerId,
      status: 'running',
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CONTAINER_START_ERROR,
        message: getErrorMessage(error, 'Failed to start container'),
      },
      500
    );
  }
});

/**
 * POST /workspaces/:id/container/stop - Stop container
 */
app.post('/:id/container/stop', async (c) => {
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

    if (workspace.containerId) {
      const orchestrator = getOrchestrator();
      await orchestrator.stopContainer(workspace.containerId);
    }

    // Update workspace
    await repo.updateContainerStatus(workspaceId, null, 'stopped');

    await repo.logAudit('stop', 'container', workspaceId);

    return apiResponse(c, {
      status: 'stopped',
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CONTAINER_STOP_ERROR,
        message: getErrorMessage(error, 'Failed to stop container'),
      },
      500
    );
  }
});

/**
 * GET /workspaces/:id/container/status - Get container status
 */
app.get('/:id/container/status', async (c) => {
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

    let status = workspace.containerStatus;
    let resourceUsage = null;

    if (workspace.containerId) {
      const orchestrator = getOrchestrator();
      status = await orchestrator.getContainerStatus(workspace.containerId);
      resourceUsage = await orchestrator.getResourceUsage(workspace.containerId);

      // Update status in DB if changed
      if (status !== workspace.containerStatus) {
        await repo.updateContainerStatus(
          workspaceId,
          workspace.containerId,
          status as 'running' | 'stopped' | 'error'
        );
      }
    }

    return apiResponse(c, {
      containerId: workspace.containerId,
      status,
      resourceUsage,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CONTAINER_STATUS_ERROR,
        message: getErrorMessage(error, 'Failed to get container status'),
      },
      500
    );
  }
});

/**
 * GET /workspaces/:id/container/logs - Get container logs
 */
app.get('/:id/container/logs', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const tail = getIntParam(c, 'tail', 100, 1, 1000);
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

    let logs = '';
    if (workspace.containerId) {
      const orchestrator = getOrchestrator();
      logs = await orchestrator.getContainerLogs(workspace.containerId, tail);
    }

    return apiResponse(c, {
      logs,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CONTAINER_LOGS_ERROR,
        message: getErrorMessage(error, 'Failed to get container logs'),
      },
      500
    );
  }
});

// ============================================
// System Info
// ============================================

/**
 * GET /workspaces/system/status - Get sandbox system status
 */
app.get('/system/status', async (c) => {
  try {
    const dockerAvailable = await isDockerAvailable();
    const orchestrator = getOrchestrator();
    const activeContainers = orchestrator.getActiveContainers();

    return apiResponse(c, {
      dockerAvailable,
      activeContainers: activeContainers.length,
      containers: activeContainers.map((c) => ({
        userId: c.userId,
        workspaceId: c.workspaceId,
        status: c.status,
        startedAt: c.startedAt,
        lastActivityAt: c.lastActivityAt,
      })),
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.SYSTEM_STATUS_ERROR,
        message: getErrorMessage(error, 'Failed to get system status'),
      },
      500
    );
  }
});

export const workspaceContainerRoutes = app;
