/**
 * User Workspace Routes
 *
 * API for managing isolated user workspaces with Docker container execution.
 * Provides workspace CRUD, file operations, and code execution.
 */

import path from 'node:path';
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
  DEFAULT_CONTAINER_CONFIG,
  StorageSecurityError,
} from '@ownpilot/core';
import { apiResponse, apiError, ERROR_CODES, getIntParam, getUserId, zodValidationError, getErrorMessage } from './helpers.js';

const app = new Hono();

// ============================================
// Path traversal protection
// ============================================

/**
 * Sanitize file paths to prevent directory traversal attacks.
 * Ensures the resolved path stays within the workspace root.
 *
 * Returns the normalized relative path, or null if the path
 * attempts to escape the workspace directory.
 */
function sanitizeFilePath(filePath: string): string | null {
  // Normalize the path using posix to get consistent forward slashes,
  // then resolve any ../ sequences
  const normalized = path.posix.normalize(filePath);

  // Reject if path tries to escape (starts with .. or is exactly '..')
  if (normalized.startsWith('..') || normalized === '..') {
    return null;
  }

  // Strip leading slashes to ensure the path is relative
  const relative = normalized.replace(/^\/+/, '');

  // After stripping, re-check (e.g. "/../foo" normalizes to "../foo")
  if (relative.startsWith('..')) {
    return null;
  }

  return relative;
}

// ============================================
// Container config limits
// ============================================

const CONTAINER_LIMITS = {
  memoryMB: { min: 64, max: 2048 },
  cpuCores: { min: 0.25, max: 4 },
  storageGB: { min: 1, max: 10 },
  timeoutMs: { min: 5000, max: 120000 },
} as const;

const VALID_NETWORK_POLICIES = ['none', 'restricted', 'full'] as const;

/**
 * Validate and clamp user-supplied container config against safe limits
 */
function sanitizeContainerConfig(
  base: ContainerConfig,
  userConfig?: Partial<ContainerConfig>
): ContainerConfig {
  if (!userConfig || typeof userConfig !== 'object') return { ...base };

  const clamp = (val: unknown, limits: { min: number; max: number }, fallback: number): number =>
    typeof val === 'number' ? Math.max(limits.min, Math.min(limits.max, val)) : fallback;

  return {
    memoryMB: clamp(userConfig.memoryMB, CONTAINER_LIMITS.memoryMB, base.memoryMB),
    cpuCores: clamp(userConfig.cpuCores, CONTAINER_LIMITS.cpuCores, base.cpuCores),
    storageGB: clamp(userConfig.storageGB, CONTAINER_LIMITS.storageGB, base.storageGB),
    timeoutMs: clamp(userConfig.timeoutMs, CONTAINER_LIMITS.timeoutMs, base.timeoutMs),
    networkPolicy: VALID_NETWORK_POLICIES.includes(userConfig.networkPolicy as typeof VALID_NETWORK_POLICIES[number])
      ? (userConfig.networkPolicy as ContainerConfig['networkPolicy'])
      : base.networkPolicy,
    ...(userConfig.allowedHosts && Array.isArray(userConfig.allowedHosts)
      ? { allowedHosts: userConfig.allowedHosts.filter((h): h is string => typeof h === 'string').slice(0, 50) }
      : {}),
  };
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
    return apiError(c, { code: ERROR_CODES.WORKSPACE_LIST_ERROR, message: getErrorMessage(error, 'Failed to list workspaces') }, 500);
  }
});

/**
 * POST /workspaces - Create a new workspace
 */
app.post('/', async (c) => {
  const userId = getUserId(c);
  const repo = new WorkspacesRepository(userId);

  try {
    const rawBody = await c.req.json().catch(() => null);

    if (!rawBody) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Request body is required' }, 400);
    }

    const { validateBody, createWorkspaceSchema } = await import('../middleware/validation.js');
    const body = validateBody(createWorkspaceSchema, rawBody) as CreateWorkspaceRequest;

    // Check workspace limit
    const existingCount = await repo.count();

    const maxWorkspaces = 5; // Could be from settings
    if (existingCount >= maxWorkspaces) {
      return apiError(c, { code: ERROR_CODES.WORKSPACE_LIMIT_EXCEEDED, message: `Maximum ${maxWorkspaces} workspaces allowed` }, 400);
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
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: ERROR_CODES.WORKSPACE_FETCH_ERROR, message: getErrorMessage(error, 'Failed to fetch workspace') }, 500);
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
    const rawBody = await c.req.json().catch(() => null);

    if (!rawBody) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Request body is required' }, 400);
    }

    const { validateBody, updateWorkspaceSchema } = await import('../middleware/validation.js');
    const body = validateBody(updateWorkspaceSchema, rawBody) as UpdateWorkspaceRequest;

    // Check workspace exists and belongs to user
    const existing = await repo.get(workspaceId);

    if (!existing) {
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
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
      updateInput.containerConfig = sanitizeContainerConfig(existing.containerConfig, body.containerConfig);
    }

    if (Object.keys(updateInput).length > 0) {
      await repo.update(workspaceId, updateInput);
    }

    await repo.logAudit('write', 'workspace', workspaceId);

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
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: ERROR_CODES.WORKSPACE_DELETE_ERROR, message: getErrorMessage(error, 'Failed to delete workspace') }, 500);
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
  const rawPath = c.req.query('path') || '.';
  const recursive = c.req.query('recursive') === 'true';
  const repo = new WorkspacesRepository(userId);

  // Validate path to prevent directory traversal
  const safePath = rawPath === '.' ? '.' : sanitizeFilePath(rawPath);
  if (safePath === null) {
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Invalid file path' }, 400);
  }

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
    }

    const storage = getWorkspaceStorage();
    const files = await storage.listFiles(`${userId}/${workspaceId}`, safePath, recursive);

    return apiResponse(c, {
        path: safePath,
        files,
        count: files.length,
      });
  } catch (error) {
    if (error instanceof StorageSecurityError) {
      return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: error.message }, 403);
    }
    return apiError(c, { code: ERROR_CODES.FILE_LIST_ERROR, message: getErrorMessage(error, 'Failed to list files') }, 500);
  }
});

/**
 * GET /workspaces/:id/files/* - Read a file
 */
app.get('/:id/files/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const rawPath = c.req.path.replace(`/workspaces/${workspaceId}/files/`, '');
  const repo = new WorkspacesRepository(userId);

  // Validate path to prevent directory traversal
  const filePath = sanitizeFilePath(rawPath);
  if (filePath === null) {
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Invalid file path' }, 400);
  }

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
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
      return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: error.message }, 403);
    }
    return apiError(c, { code: ERROR_CODES.FILE_READ_ERROR, message: getErrorMessage(error, 'Failed to read file') }, 500);
  }
});

/**
 * PUT /workspaces/:id/files/* - Write a file
 */
app.put('/:id/files/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const rawPath = c.req.path.replace(`/workspaces/${workspaceId}/files/`, '');
  const repo = new WorkspacesRepository(userId);

  // Validate path to prevent directory traversal
  const filePath = sanitizeFilePath(rawPath);
  if (filePath === null) {
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Invalid file path' }, 400);
  }

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
    }

    const body = await c.req.json().catch(() => null);
    const { workspaceWriteFileSchema } = await import('../middleware/validation.js');
    const parsed = workspaceWriteFileSchema.safeParse(body);

    if (!parsed.success) {
      return zodValidationError(c, parsed.error.issues);
    }

    const { content } = parsed.data;

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
      return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: error.message }, 403);
    }
    return apiError(c, { code: ERROR_CODES.FILE_WRITE_ERROR, message: getErrorMessage(error, 'Failed to write file') }, 500);
  }
});

/**
 * DELETE /workspaces/:id/files/* - Delete a file
 */
app.delete('/:id/files/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const rawPath = c.req.path.replace(`/workspaces/${workspaceId}/files/`, '');
  const repo = new WorkspacesRepository(userId);

  // Validate path to prevent directory traversal
  const filePath = sanitizeFilePath(rawPath);
  if (filePath === null) {
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Invalid file path' }, 400);
  }

  try {
    // Verify workspace ownership
    const workspace = await repo.get(workspaceId);

    if (!workspace) {
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
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
      return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: error.message }, 403);
    }
    return apiError(c, { code: ERROR_CODES.FILE_DELETE_ERROR, message: getErrorMessage(error, 'Failed to delete file') }, 500);
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
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
    }

    const storage = getWorkspaceStorage();
    const files = await storage.listFiles(`${userId}/${workspaceId}`, '.', true);

    if (files.length === 0) {
      return apiError(c, { code: ERROR_CODES.WORKSPACE_EMPTY, message: 'Workspace has no files to download' }, 400);
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
    return apiError(c, { code: ERROR_CODES.DOWNLOAD_ERROR, message: getErrorMessage(error, 'Failed to download workspace') }, 500);
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
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: ERROR_CODES.STATS_ERROR, message: getErrorMessage(error, 'Failed to get workspace stats') }, 500);
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
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
    }

    // Check if Docker is available
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      return apiError(c, { code: ERROR_CODES.DOCKER_UNAVAILABLE, message: 'Docker is not available. Please ensure Docker is installed and running.' }, 503);
    }

    const rawBody = await c.req.json().catch(() => null);
    const { workspaceExecuteCodeSchema } = await import('../middleware/validation.js');
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
    await repo.logAudit('execute', 'execution', undefined, false, getErrorMessage(error));
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: getErrorMessage(error, 'Failed to execute code') }, 500);
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
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: ERROR_CODES.EXECUTIONS_LIST_ERROR, message: getErrorMessage(error, 'Failed to list executions') }, 500);
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
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: ERROR_CODES.CONTAINER_START_ERROR, message: getErrorMessage(error, 'Failed to start container') }, 500);
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
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: ERROR_CODES.CONTAINER_STOP_ERROR, message: getErrorMessage(error, 'Failed to stop container') }, 500);
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
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: ERROR_CODES.CONTAINER_STATUS_ERROR, message: getErrorMessage(error, 'Failed to get container status') }, 500);
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
      return apiError(c, { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' }, 404);
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
    return apiError(c, { code: ERROR_CODES.CONTAINER_LOGS_ERROR, message: getErrorMessage(error, 'Failed to get container logs') }, 500);
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
    return apiError(c, { code: ERROR_CODES.SYSTEM_STATUS_ERROR, message: getErrorMessage(error, 'Failed to get system status') }, 500);
  }
});

export const workspaceRoutes = app;
