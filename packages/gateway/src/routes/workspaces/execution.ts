/**
 * Workspace Execution Routes
 *
 * GET /:id/stats       - Get workspace statistics
 * POST /:id/execute    - Execute code in workspace
 * GET /:id/executions  - List executions
 */

import { Hono } from 'hono';
import { WorkspacesRepository } from '../../db/repositories/workspaces.js';
import {
  getOrchestrator,
  getWorkspaceStorage,
  isDockerAvailable,
  type ExecuteCodeRequest,
  type ContainerConfig,
} from '@ownpilot/core';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getIntParam,
  getUserId,
  zodValidationError,
  getErrorMessage,
  parseJsonBody,
} from '../helpers.js';

const app = new Hono();

/**
 * GET /workspaces/:id/stats - Get workspace statistics
 */
app.get('/:id/stats', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const repo = new WorkspacesRepository(userId);

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(
        c,
        { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' },
        404
      );
    }

    const storage = getWorkspaceStorage();
    const files = await storage.listFiles(`${userId}/${workspaceId}`, '.', true);
    const storageUsage = await storage.getStorageUsage(`${userId}/${workspaceId}`);

    // Count file types
    const fileTypes: Record<string, number> = {};
    let totalFiles = 0;
    let totalDirectories = 0;

    for (const file of files) {
      if (file.isDirectory) {
        totalDirectories++;
      } else {
        totalFiles++;
        const ext = file.name.split('.').pop()?.toLowerCase() || 'unknown';
        fileTypes[ext] = (fileTypes[ext] || 0) + 1;
      }
    }

    // Get execution count
    const executionCount = await repo.countExecutions(workspaceId);

    return apiResponse(c, {
      fileCount: totalFiles,
      directoryCount: totalDirectories,
      storageUsage,
      fileTypes,
      executionCount,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.STATS_ERROR,
        message: getErrorMessage(error, 'Failed to get workspace stats'),
      },
      500
    );
  }
});

// ============================================
// Code Execution
// ============================================

/**
 * POST /workspaces/:id/execute - Execute code in workspace
 */
app.post('/:id/execute', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const repo = new WorkspacesRepository(userId);

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(
        c,
        { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' },
        404
      );
    }

    // Check if Docker is available
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      return apiError(
        c,
        {
          code: ERROR_CODES.DOCKER_UNAVAILABLE,
          message: 'Docker is not available. Please ensure Docker is installed and running.',
        },
        503
      );
    }

    const rawBody = await parseJsonBody(c);
    const { workspaceExecuteCodeSchema } = await import('../../middleware/validation.js');
    const parsed = workspaceExecuteCodeSchema.safeParse(rawBody);

    if (!parsed.success) {
      return zodValidationError(c, parsed.error.issues);
    }

    const body = parsed.data as ExecuteCodeRequest;

    const orchestrator = getOrchestrator();
    const containerConfig: ContainerConfig = workspace.containerConfig;

    // Create files if provided
    if (body.files && body.files.length > 0) {
      const storage = getWorkspaceStorage();
      for (const file of body.files) {
        await storage.writeFile(`${userId}/${workspaceId}`, file.path, file.content);
      }
    }

    // Get or create container
    let containerId = workspace.containerId;
    if (!containerId) {
      containerId = await orchestrator.createContainer(
        userId,
        workspaceId,
        workspace.storagePath,
        containerConfig,
        body.language
      );

      // Update workspace with container ID
      await repo.updateContainerStatus(workspaceId, containerId, 'running');
    }

    // Record execution
    const execution = await repo.createExecution(workspaceId, body.language, body.code);

    // Execute code
    const timeout = body.timeout || containerConfig.timeoutMs || 30000;
    const result = await orchestrator.executeInContainer(
      containerId,
      body.code,
      body.language,
      timeout
    );

    // Update execution record
    await repo.updateExecution(
      execution.id,
      result.status as 'completed' | 'failed' | 'timeout',
      result.stdout,
      result.stderr,
      result.exitCode,
      result.executionTimeMs
    );

    await repo.logAudit(
      'execute',
      'execution',
      `${body.language}:${execution.codeHash.substring(0, 8)}`
    );

    return apiResponse(c, {
      executionId: execution.id,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      executionTimeMs: result.executionTimeMs,
    });
  } catch (error) {
    await repo.logAudit('execute', 'execution', undefined, false, getErrorMessage(error));
    return apiError(
      c,
      {
        code: ERROR_CODES.EXECUTION_ERROR,
        message: getErrorMessage(error, 'Failed to execute code'),
      },
      500
    );
  }
});

/**
 * GET /workspaces/:id/executions - List executions
 */
app.get('/:id/executions', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const limit = getIntParam(c, 'limit', 50, 1, 200);
  const repo = new WorkspacesRepository(userId);

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(
        c,
        { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' },
        404
      );
    }

    const executions = await repo.listExecutions(workspaceId, limit);

    return apiResponse(c, {
      executions: executions.map((e) => ({
        id: e.id,
        workspaceId: e.workspaceId,
        userId: e.userId,
        language: e.language,
        codeHash: e.codeHash,
        status: e.status,
        stdout: e.stdout,
        stderr: e.stderr,
        exitCode: e.exitCode,
        executionTimeMs: e.executionTimeMs,
        createdAt: e.createdAt.toISOString(),
      })),
      count: executions.length,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.EXECUTIONS_LIST_ERROR,
        message: getErrorMessage(error, 'Failed to list executions'),
      },
      500
    );
  }
});

export const workspaceExecutionRoutes = app;
