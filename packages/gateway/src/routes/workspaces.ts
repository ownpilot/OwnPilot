/**
 * User Workspace Routes
 *
 * API for managing isolated user workspaces with Docker container execution.
 * Provides workspace CRUD, file operations, and code execution.
 */

import { Hono } from 'hono';
import { WorkspacesRepository } from '../db/repositories/workspaces.js';
import {
  getOrchestrator,
  getWorkspaceStorage,
  isDockerAvailable,
  type CreateWorkspaceRequest,
  type UpdateWorkspaceRequest,
  type ExecuteCodeRequest,
  type ContainerConfig,
  type ExecutionLanguage,
  DEFAULT_CONTAINER_CONFIG,
  StorageSecurityError,
} from '@ownpilot/core';
import { apiResponse, apiError, getIntParam } from './helpers.js';

const app = new Hono();

// Default user ID (single-user mode for now, can be extended with auth)
const DEFAULT_USER_ID = 'default-user';

/**
 * Helper to get user ID from context (for future auth integration)
 */
function getUserId(c: { get: (key: string) => unknown }): string {
  return (c.get('userId') as string) || DEFAULT_USER_ID;
}

// ============================================
// Workspace CRUD
// ============================================

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
    return apiError(c, { code: 'WORKSPACE_LIST_ERROR', message: error instanceof Error ? error.message : 'Failed to list workspaces' }, 500);
  }
});

/**
 * POST /workspaces - Create a new workspace
 */
app.post('/', async (c) => {
  const userId = getUserId(c);
  const repo = new WorkspacesRepository(userId);

  try {
    const body = (await c.req.json()) as CreateWorkspaceRequest;

    if (!body.name) {
      return apiError(c, { code: 'INVALID_INPUT', message: 'Workspace name is required' }, 400);
    }

    // Check workspace limit
    const existingCount = await repo.count();

    const maxWorkspaces = 5; // Could be from settings
    if (existingCount >= maxWorkspaces) {
      return apiError(c, { code: 'WORKSPACE_LIMIT_EXCEEDED', message: `Maximum ${maxWorkspaces} workspaces allowed` }, 400);
    }

    // Create workspace storage
    const storage = getWorkspaceStorage();
    const workspaceId = crypto.randomUUID();
    const storagePath = await storage.createUserStorage(`${userId}/${workspaceId}`);

    const containerConfig: ContainerConfig = {
      ...DEFAULT_CONTAINER_CONFIG,
      ...body.containerConfig,
    };

    // Create workspace in repository
    const workspace = await repo.create({
      name: body.name,
      description: body.description,
      storagePath,
      containerConfig,
    });

    await repo.logAudit('create', 'workspace', workspace.id);

    return apiResponse(c, {
        id: workspace.id,
        userId: workspace.userId,
        name: workspace.name,
        description: workspace.description,
        status: workspace.status,
        storagePath: workspace.storagePath,
        containerConfig: workspace.containerConfig,
        containerStatus: workspace.containerStatus,
        createdAt: workspace.createdAt.toISOString(),
      }, 201);
  } catch (error) {
    await repo.logAudit('create', 'workspace', undefined, false, error instanceof Error ? error.message : 'Unknown error');
    return apiError(c, { code: 'WORKSPACE_CREATE_ERROR', message: error instanceof Error ? error.message : 'Failed to create workspace' }, 500);
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
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: 'WORKSPACE_FETCH_ERROR', message: error instanceof Error ? error.message : 'Failed to fetch workspace' }, 500);
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
    const body = (await c.req.json()) as UpdateWorkspaceRequest;

    // Check workspace exists and belongs to user
    const existing = await repo.get(workspaceId);

    if (!existing) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    // Build update input
    const updateInput: { name?: string; description?: string; containerConfig?: ContainerConfig } = {};

    if (body.name) {
      updateInput.name = body.name;
    }
    if (body.description !== undefined) {
      updateInput.description = body.description;
    }
    if (body.containerConfig) {
      updateInput.containerConfig = { ...existing.containerConfig, ...body.containerConfig };
    }

    if (Object.keys(updateInput).length > 0) {
      await repo.update(workspaceId, updateInput);
    }

    await repo.logAudit('write', 'workspace', workspaceId);

    return apiResponse(c, { updated: true });
  } catch (error) {
    return apiError(c, { code: 'WORKSPACE_UPDATE_ERROR', message: error instanceof Error ? error.message : 'Failed to update workspace' }, 500);
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
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
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

    return apiResponse(c, { deleted: true });
  } catch (error) {
    return apiError(c, { code: 'WORKSPACE_DELETE_ERROR', message: error instanceof Error ? error.message : 'Failed to delete workspace' }, 500);
  }
});

// ============================================
// File Operations
// ============================================

/**
 * GET /workspaces/:id/files - List files in workspace
 */
app.get('/:id/files', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const path = c.req.query('path') || '.';
  const recursive = c.req.query('recursive') === 'true';
  const repo = new WorkspacesRepository(userId);

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    const storage = getWorkspaceStorage();
    const files = await storage.listFiles(`${userId}/${workspaceId}`, path, recursive);

    return apiResponse(c, {
        path,
        files,
        count: files.length,
      });
  } catch (error) {
    if (error instanceof StorageSecurityError) {
      return apiError(c, { code: 'ACCESS_DENIED', message: error.message }, 403);
    }
    return apiError(c, { code: 'FILE_LIST_ERROR', message: error instanceof Error ? error.message : 'Failed to list files' }, 500);
  }
});

/**
 * GET /workspaces/:id/files/* - Read a file
 */
app.get('/:id/files/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/workspaces/${workspaceId}/files/`, '');
  const repo = new WorkspacesRepository(userId);

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    const storage = getWorkspaceStorage();
    const content = await storage.readFile(`${userId}/${workspaceId}`, filePath);
    const fileInfo = await storage.getFileInfo(`${userId}/${workspaceId}`, filePath);

    await repo.logAudit('read', 'file', filePath);

    return apiResponse(c, {
        path: filePath,
        content,
        size: fileInfo.size,
        modifiedAt: fileInfo.modifiedAt,
      });
  } catch (error) {
    if (error instanceof StorageSecurityError) {
      return apiError(c, { code: 'ACCESS_DENIED', message: error.message }, 403);
    }
    return apiError(c, { code: 'FILE_READ_ERROR', message: error instanceof Error ? error.message : 'Failed to read file' }, 500);
  }
});

/**
 * PUT /workspaces/:id/files/* - Write a file
 */
app.put('/:id/files/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/workspaces/${workspaceId}/files/`, '');
  const repo = new WorkspacesRepository(userId);

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    const body = await c.req.json();
    const { content } = body;

    if (content === undefined) {
      return apiError(c, { code: 'INVALID_INPUT', message: 'Content is required' }, 400);
    }

    const storage = getWorkspaceStorage();
    await storage.writeFile(`${userId}/${workspaceId}`, filePath, content);

    await repo.logAudit('write', 'file', filePath);

    return apiResponse(c, {
        path: filePath,
        written: true,
      });
  } catch (error) {
    const repo = new WorkspacesRepository(userId);
    if (error instanceof StorageSecurityError) {
      await repo.logAudit('write', 'file', filePath, false, error.message);
      return apiError(c, { code: 'ACCESS_DENIED', message: error.message }, 403);
    }
    return apiError(c, { code: 'FILE_WRITE_ERROR', message: error instanceof Error ? error.message : 'Failed to write file' }, 500);
  }
});

/**
 * DELETE /workspaces/:id/files/* - Delete a file
 */
app.delete('/:id/files/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/workspaces/${workspaceId}/files/`, '');
  const repo = new WorkspacesRepository(userId);

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    const storage = getWorkspaceStorage();
    await storage.deleteFile(`${userId}/${workspaceId}`, filePath);

    await repo.logAudit('delete', 'file', filePath);

    return apiResponse(c, {
        path: filePath,
        deleted: true,
      });
  } catch (error) {
    if (error instanceof StorageSecurityError) {
      return apiError(c, { code: 'ACCESS_DENIED', message: error.message }, 403);
    }
    return apiError(c, { code: 'FILE_DELETE_ERROR', message: error instanceof Error ? error.message : 'Failed to delete file' }, 500);
  }
});

// ============================================
// Download Workspace
// ============================================

/**
 * GET /workspaces/:id/download - Download workspace as ZIP
 */
app.get('/:id/download', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const repo = new WorkspacesRepository(userId);

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    const storage = getWorkspaceStorage();
    const files = await storage.listFiles(`${userId}/${workspaceId}`, '.', true);

    if (files.length === 0) {
      return apiError(c, { code: 'WORKSPACE_EMPTY', message: 'Workspace has no files to download' }, 400);
    }

    // Create a simple JSON manifest of files (since we can't create ZIP in pure Node without deps)
    // The client can use this to fetch files individually or we can return a tar-like format
    const fileContents: Array<{ path: string; content: string; size: number }> = [];

    for (const file of files) {
      if (!file.isDirectory) {
        try {
          const content = await storage.readFile(`${userId}/${workspaceId}`, file.path);
          fileContents.push({
            path: file.path,
            content: String(content),
            size: file.size,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }

    await repo.logAudit('download', 'workspace', workspaceId);

    // Return as JSON archive (can be processed client-side)
    const sanitizedName = workspace.name.replace(/[^a-zA-Z0-9-_]/g, '_');
    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="${sanitizedName}-workspace.json"`);

    return c.json({
      name: workspace.name,
      id: workspaceId,
      exportedAt: new Date().toISOString(),
      files: fileContents,
      totalFiles: fileContents.length,
    });
  } catch (error) {
    return apiError(c, { code: 'DOWNLOAD_ERROR', message: error instanceof Error ? error.message : 'Failed to download workspace' }, 500);
  }
});

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
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: 'STATS_ERROR', message: error instanceof Error ? error.message : 'Failed to get workspace stats' }, 500);
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
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    // Check if Docker is available
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      return apiError(c, { code: 'DOCKER_UNAVAILABLE', message: 'Docker is not available. Please ensure Docker is installed and running.' }, 503);
    }

    const body = (await c.req.json()) as ExecuteCodeRequest;

    if (!body.code || !body.language) {
      return apiError(c, { code: 'INVALID_INPUT', message: 'Code and language are required' }, 400);
    }

    const validLanguages: ExecutionLanguage[] = ['python', 'javascript', 'shell'];
    if (!validLanguages.includes(body.language)) {
      return apiError(c, { code: 'INVALID_LANGUAGE', message: `Unsupported language. Supported: ${validLanguages.join(', ')}` }, 400);
    }

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

    await repo.logAudit('execute', 'execution', `${body.language}:${execution.codeHash.substring(0, 8)}`);

    return apiResponse(c, {
        executionId: execution.id,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTimeMs: result.executionTimeMs,
      });
  } catch (error) {
    await repo.logAudit('execute', 'execution', undefined, false, error instanceof Error ? error.message : 'Unknown error');
    return apiError(c, { code: 'EXECUTION_ERROR', message: error instanceof Error ? error.message : 'Failed to execute code' }, 500);
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
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: 'EXECUTIONS_LIST_ERROR', message: error instanceof Error ? error.message : 'Failed to list executions' }, 500);
  }
});

// ============================================
// Container Management
// ============================================

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
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    // Check if already running
    if (workspace.containerStatus === 'running' && workspace.containerId) {
      return apiResponse(c, { data: {
          containerId: workspace.containerId,
          status: 'running',
          message: 'Container already running',
        },
        meta: {
          requestId: c.get('requestId') ?? 'unknown',
          timestamp: new Date().toISOString(),
        }, });
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
    return apiError(c, { code: 'CONTAINER_START_ERROR', message: error instanceof Error ? error.message : 'Failed to start container' }, 500);
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
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: 'CONTAINER_STOP_ERROR', message: error instanceof Error ? error.message : 'Failed to stop container' }, 500);
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
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    let status = workspace.containerStatus;
    let resourceUsage = null;

    if (workspace.containerId) {
      const orchestrator = getOrchestrator();
      status = await orchestrator.getContainerStatus(workspace.containerId);
      resourceUsage = await orchestrator.getResourceUsage(workspace.containerId);

      // Update status in DB if changed
      if (status !== workspace.containerStatus) {
        await repo.updateContainerStatus(workspaceId, workspace.containerId, status as 'running' | 'stopped' | 'error');
      }
    }

    return apiResponse(c, {
        containerId: workspace.containerId,
        status,
        resourceUsage,
      });
  } catch (error) {
    return apiError(c, { code: 'CONTAINER_STATUS_ERROR', message: error instanceof Error ? error.message : 'Failed to get container status' }, 500);
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
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: 'CONTAINER_LOGS_ERROR', message: error instanceof Error ? error.message : 'Failed to get container logs' }, 500);
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
    return apiError(c, { code: 'SYSTEM_STATUS_ERROR', message: error instanceof Error ? error.message : 'Failed to get system status' }, 500);
  }
});

export const workspaceRoutes = app;
