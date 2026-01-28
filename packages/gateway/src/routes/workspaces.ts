/**
 * User Workspace Routes
 *
 * API for managing isolated user workspaces with Docker container execution.
 * Provides workspace CRUD, file operations, and code execution.
 */

import { Hono } from 'hono';
import { randomUUID, createHash } from 'node:crypto';
import type { ApiResponse } from '../types/index.js';
import { getDatabase } from '../db/connection.js';
import {
  getOrchestrator,
  getWorkspaceStorage,
  isDockerAvailable,
  type UserWorkspace,
  type CreateWorkspaceRequest,
  type UpdateWorkspaceRequest,
  type ExecuteCodeRequest,
  type ContainerConfig,
  type ExecutionLanguage,
  DEFAULT_CONTAINER_CONFIG,
  StorageSecurityError,
} from '@ownpilot/core';

const app = new Hono();

// Default user ID (single-user mode for now, can be extended with auth)
const DEFAULT_USER_ID = 'default-user';

/**
 * Helper to get user ID from context (for future auth integration)
 */
function getUserId(c: { get: (key: string) => unknown }): string {
  return (c.get('userId') as string) || DEFAULT_USER_ID;
}

/**
 * Helper to log audit entry
 */
async function logAudit(
  userId: string,
  action: string,
  resourceType: string,
  resource?: string,
  success: boolean = true,
  error?: string,
  ipAddress?: string
): Promise<void> {
  try {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO workspace_audit (id, user_id, workspace_id, action, resource, success, error, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      randomUUID(),
      userId,
      null,
      action,
      resource || resourceType,
      success ? 1 : 0,
      error || null,
      ipAddress || null
    );
  } catch {
    // Don't fail on audit logging errors
  }
}

// ============================================
// Workspace CRUD
// ============================================

/**
 * GET /workspaces - List user's workspaces
 */
app.get('/', async (c) => {
  const userId = getUserId(c);

  try {
    const db = getDatabase();
    const workspaces = db
      .prepare(
        `SELECT * FROM user_workspaces WHERE user_id = ? AND status != 'deleted' ORDER BY updated_at DESC`
      )
      .all(userId) as Array<{
      id: string;
      user_id: string;
      name: string;
      description: string | null;
      status: string;
      storage_path: string;
      container_config: string;
      container_id: string | null;
      container_status: string;
      created_at: string;
      updated_at: string;
    }>;

    const response: ApiResponse = {
      success: true,
      data: {
        workspaces: workspaces.map((w) => ({
          id: w.id,
          userId: w.user_id,
          name: w.name,
          description: w.description,
          status: w.status,
          storagePath: w.storage_path,
          containerConfig: JSON.parse(w.container_config || '{}'),
          containerId: w.container_id,
          containerStatus: w.container_status,
          createdAt: w.created_at,
          updatedAt: w.updated_at,
        })),
        count: workspaces.length,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKSPACE_LIST_ERROR',
          message: error instanceof Error ? error.message : 'Failed to list workspaces',
        },
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

  try {
    const body = (await c.req.json()) as CreateWorkspaceRequest;

    if (!body.name) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Workspace name is required',
          },
        },
        400
      );
    }

    const db = getDatabase();

    // Check workspace limit
    const existingCount = db
      .prepare(`SELECT COUNT(*) as count FROM user_workspaces WHERE user_id = ? AND status != 'deleted'`)
      .get(userId) as { count: number };

    const maxWorkspaces = 5; // Could be from settings
    if (existingCount.count >= maxWorkspaces) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_LIMIT_EXCEEDED',
            message: `Maximum ${maxWorkspaces} workspaces allowed`,
          },
        },
        400
      );
    }

    // Create workspace
    const workspaceId = randomUUID();
    const storage = getWorkspaceStorage();
    const storagePath = await storage.createUserStorage(`${userId}/${workspaceId}`);

    const containerConfig: ContainerConfig = {
      ...DEFAULT_CONTAINER_CONFIG,
      ...body.containerConfig,
    };

    db.prepare(
      `INSERT INTO user_workspaces (id, user_id, name, description, status, storage_path, container_config, container_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, 'stopped', datetime('now'), datetime('now'))`
    ).run(
      workspaceId,
      userId,
      body.name,
      body.description || null,
      storagePath,
      JSON.stringify(containerConfig)
    );

    await logAudit(userId, 'create', 'workspace', workspaceId);

    const response: ApiResponse = {
      success: true,
      data: {
        id: workspaceId,
        userId,
        name: body.name,
        description: body.description,
        status: 'active',
        storagePath,
        containerConfig,
        containerStatus: 'stopped',
        createdAt: new Date().toISOString(),
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response, 201);
  } catch (error) {
    await logAudit(userId, 'create', 'workspace', undefined, false, error instanceof Error ? error.message : 'Unknown error');
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKSPACE_CREATE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create workspace',
        },
      },
      500
    );
  }
});

/**
 * GET /workspaces/:id - Get workspace details
 */
app.get('/:id', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');

  try {
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId) as {
      id: string;
      user_id: string;
      name: string;
      description: string | null;
      status: string;
      storage_path: string;
      container_config: string;
      container_id: string | null;
      container_status: string;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    // Get storage usage
    const storage = getWorkspaceStorage();
    const storageUsage = await storage.getStorageUsage(`${userId}/${workspaceId}`);

    const response: ApiResponse = {
      success: true,
      data: {
        id: workspace.id,
        userId: workspace.user_id,
        name: workspace.name,
        description: workspace.description,
        status: workspace.status,
        storagePath: workspace.storage_path,
        containerConfig: JSON.parse(workspace.container_config || '{}'),
        containerId: workspace.container_id,
        containerStatus: workspace.container_status,
        createdAt: workspace.created_at,
        updatedAt: workspace.updated_at,
        storageUsage,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKSPACE_FETCH_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch workspace',
        },
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

  try {
    const body = (await c.req.json()) as UpdateWorkspaceRequest;
    const db = getDatabase();

    // Check workspace exists and belongs to user
    const existing = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId);

    if (!existing) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    // Build update query
    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.name) {
      updates.push('name = ?');
      values.push(body.name);
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      values.push(body.description);
    }
    if (body.containerConfig) {
      const existingConfig = JSON.parse((existing as { container_config: string }).container_config || '{}');
      const newConfig = { ...existingConfig, ...body.containerConfig };
      updates.push('container_config = ?');
      values.push(JSON.stringify(newConfig));
    }

    if (updates.length > 0) {
      updates.push('updated_at = datetime(\'now\')');
      values.push(workspaceId, userId);

      db.prepare(
        `UPDATE user_workspaces SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...values);
    }

    await logAudit(userId, 'write', 'workspace', workspaceId);

    const response: ApiResponse = {
      success: true,
      data: { updated: true },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKSPACE_UPDATE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update workspace',
        },
      },
      500
    );
  }
});

/**
 * DELETE /workspaces/:id - Delete workspace
 */
app.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');

  try {
    const db = getDatabase();

    // Check workspace exists and belongs to user
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId) as { container_id: string | null } | undefined;

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    // Stop container if running
    if (workspace.container_id) {
      const orchestrator = getOrchestrator();
      await orchestrator.stopContainer(workspace.container_id);
    }

    // Soft delete (set status to deleted)
    db.prepare(
      `UPDATE user_workspaces SET status = 'deleted', updated_at = datetime('now') WHERE id = ? AND user_id = ?`
    ).run(workspaceId, userId);

    // Optionally delete storage
    // const storage = getWorkspaceStorage();
    // await storage.deleteUserStorage(`${userId}/${workspaceId}`);

    await logAudit(userId, 'delete', 'workspace', workspaceId);

    const response: ApiResponse = {
      success: true,
      data: { deleted: true },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKSPACE_DELETE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to delete workspace',
        },
      },
      500
    );
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

  try {
    // Verify workspace ownership
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId);

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    const storage = getWorkspaceStorage();
    const files = await storage.listFiles(`${userId}/${workspaceId}`, path, recursive);

    const response: ApiResponse = {
      success: true,
      data: {
        path,
        files,
        count: files.length,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    if (error instanceof StorageSecurityError) {
      return c.json(
        {
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: error.message,
          },
        },
        403
      );
    }
    return c.json(
      {
        success: false,
        error: {
          code: 'FILE_LIST_ERROR',
          message: error instanceof Error ? error.message : 'Failed to list files',
        },
      },
      500
    );
  }
});

/**
 * GET /workspaces/:id/files/* - Read a file
 */
app.get('/:id/files/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/workspaces/${workspaceId}/files/`, '');

  try {
    // Verify workspace ownership
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId);

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    const storage = getWorkspaceStorage();
    const content = await storage.readFile(`${userId}/${workspaceId}`, filePath);
    const fileInfo = await storage.getFileInfo(`${userId}/${workspaceId}`, filePath);

    await logAudit(userId, 'read', 'file', filePath);

    const response: ApiResponse = {
      success: true,
      data: {
        path: filePath,
        content,
        size: fileInfo.size,
        modifiedAt: fileInfo.modifiedAt,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    if (error instanceof StorageSecurityError) {
      return c.json(
        {
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: error.message,
          },
        },
        403
      );
    }
    return c.json(
      {
        success: false,
        error: {
          code: 'FILE_READ_ERROR',
          message: error instanceof Error ? error.message : 'Failed to read file',
        },
      },
      500
    );
  }
});

/**
 * PUT /workspaces/:id/files/* - Write a file
 */
app.put('/:id/files/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/workspaces/${workspaceId}/files/`, '');

  try {
    // Verify workspace ownership
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId);

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    const body = await c.req.json();
    const { content } = body;

    if (content === undefined) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Content is required',
          },
        },
        400
      );
    }

    const storage = getWorkspaceStorage();
    await storage.writeFile(`${userId}/${workspaceId}`, filePath, content);

    await logAudit(userId, 'write', 'file', filePath);

    const response: ApiResponse = {
      success: true,
      data: {
        path: filePath,
        written: true,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    if (error instanceof StorageSecurityError) {
      await logAudit(userId, 'write', 'file', filePath, false, error.message);
      return c.json(
        {
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: error.message,
          },
        },
        403
      );
    }
    return c.json(
      {
        success: false,
        error: {
          code: 'FILE_WRITE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to write file',
        },
      },
      500
    );
  }
});

/**
 * DELETE /workspaces/:id/files/* - Delete a file
 */
app.delete('/:id/files/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/workspaces/${workspaceId}/files/`, '');

  try {
    // Verify workspace ownership
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId);

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    const storage = getWorkspaceStorage();
    await storage.deleteFile(`${userId}/${workspaceId}`, filePath);

    await logAudit(userId, 'delete', 'file', filePath);

    const response: ApiResponse = {
      success: true,
      data: {
        path: filePath,
        deleted: true,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    if (error instanceof StorageSecurityError) {
      return c.json(
        {
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: error.message,
          },
        },
        403
      );
    }
    return c.json(
      {
        success: false,
        error: {
          code: 'FILE_DELETE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to delete file',
        },
      },
      500
    );
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

  try {
    // Verify workspace ownership
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId) as {
      name: string;
      storage_path: string;
    } | undefined;

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    const storage = getWorkspaceStorage();
    const files = await storage.listFiles(`${userId}/${workspaceId}`, '.', true);

    if (files.length === 0) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_EMPTY',
            message: 'Workspace has no files to download',
          },
        },
        400
      );
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

    await logAudit(userId, 'download', 'workspace', workspaceId);

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
    return c.json(
      {
        success: false,
        error: {
          code: 'DOWNLOAD_ERROR',
          message: error instanceof Error ? error.message : 'Failed to download workspace',
        },
      },
      500
    );
  }
});

/**
 * GET /workspaces/:id/stats - Get workspace statistics
 */
app.get('/:id/stats', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');

  try {
    // Verify workspace ownership
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId);

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
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
    const executionCount = db
      .prepare(`SELECT COUNT(*) as count FROM code_executions WHERE workspace_id = ?`)
      .get(workspaceId) as { count: number };

    const response: ApiResponse = {
      success: true,
      data: {
        fileCount: totalFiles,
        directoryCount: totalDirectories,
        storageUsage,
        fileTypes,
        executionCount: executionCount.count,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'STATS_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get workspace stats',
        },
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

  try {
    // Verify workspace ownership
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId) as {
      storage_path: string;
      container_config: string;
      container_id: string | null;
    } | undefined;

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    // Check if Docker is available
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DOCKER_UNAVAILABLE',
            message: 'Docker is not available. Please ensure Docker is installed and running.',
          },
        },
        503
      );
    }

    const body = (await c.req.json()) as ExecuteCodeRequest;

    if (!body.code || !body.language) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Code and language are required',
          },
        },
        400
      );
    }

    const validLanguages: ExecutionLanguage[] = ['python', 'javascript', 'shell'];
    if (!validLanguages.includes(body.language)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_LANGUAGE',
            message: `Unsupported language. Supported: ${validLanguages.join(', ')}`,
          },
        },
        400
      );
    }

    const orchestrator = getOrchestrator();
    const containerConfig: ContainerConfig = JSON.parse(workspace.container_config || '{}');

    // Create files if provided
    if (body.files && body.files.length > 0) {
      const storage = getWorkspaceStorage();
      for (const file of body.files) {
        await storage.writeFile(`${userId}/${workspaceId}`, file.path, file.content);
      }
    }

    // Get or create container
    let containerId = workspace.container_id;
    if (!containerId) {
      containerId = await orchestrator.createContainer(
        userId,
        workspaceId,
        workspace.storage_path,
        containerConfig,
        body.language
      );

      // Update workspace with container ID
      db.prepare(
        `UPDATE user_workspaces SET container_id = ?, container_status = 'running', updated_at = datetime('now') WHERE id = ?`
      ).run(containerId, workspaceId);
    }

    // Record execution
    const executionId = randomUUID();
    const codeHash = createHash('sha256').update(body.code).digest('hex');

    db.prepare(
      `INSERT INTO code_executions (id, workspace_id, user_id, language, code_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'running', datetime('now'))`
    ).run(executionId, workspaceId, userId, body.language, codeHash);

    // Execute code
    const timeout = body.timeout || containerConfig.timeoutMs || 30000;
    const result = await orchestrator.executeInContainer(
      containerId,
      body.code,
      body.language,
      timeout
    );

    // Update execution record
    db.prepare(
      `UPDATE code_executions SET status = ?, stdout = ?, stderr = ?, exit_code = ?, execution_time_ms = ?
       WHERE id = ?`
    ).run(
      result.status,
      result.stdout || null,
      result.stderr || null,
      result.exitCode || null,
      result.executionTimeMs || null,
      executionId
    );

    await logAudit(userId, 'execute', 'execution', `${body.language}:${codeHash.substring(0, 8)}`);

    const response: ApiResponse = {
      success: true,
      data: {
        executionId,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTimeMs: result.executionTimeMs,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    await logAudit(userId, 'execute', 'execution', undefined, false, error instanceof Error ? error.message : 'Unknown error');
    return c.json(
      {
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Failed to execute code',
        },
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
  const limit = parseInt(c.req.query('limit') || '50');

  try {
    const db = getDatabase();

    // Verify workspace ownership
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId);

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    const executions = db
      .prepare(
        `SELECT * FROM code_executions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(workspaceId, limit);

    const response: ApiResponse = {
      success: true,
      data: {
        executions,
        count: executions.length,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'EXECUTIONS_LIST_ERROR',
          message: error instanceof Error ? error.message : 'Failed to list executions',
        },
      },
      500
    );
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

  try {
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId) as {
      storage_path: string;
      container_config: string;
      container_id: string | null;
      container_status: string;
    } | undefined;

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    // Check if already running
    if (workspace.container_status === 'running' && workspace.container_id) {
      return c.json({
        success: true,
        data: {
          containerId: workspace.container_id,
          status: 'running',
          message: 'Container already running',
        },
        meta: {
          requestId: c.get('requestId') ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }

    const orchestrator = getOrchestrator();
    const containerConfig: ContainerConfig = JSON.parse(workspace.container_config || '{}');

    const containerId = await orchestrator.createContainer(
      userId,
      workspaceId,
      workspace.storage_path,
      containerConfig
    );

    // Update workspace
    db.prepare(
      `UPDATE user_workspaces SET container_id = ?, container_status = 'running', updated_at = datetime('now') WHERE id = ?`
    ).run(containerId, workspaceId);

    await logAudit(userId, 'start', 'container', workspaceId);

    const response: ApiResponse = {
      success: true,
      data: {
        containerId,
        status: 'running',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CONTAINER_START_ERROR',
          message: error instanceof Error ? error.message : 'Failed to start container',
        },
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

  try {
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId) as {
      container_id: string | null;
    } | undefined;

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    if (workspace.container_id) {
      const orchestrator = getOrchestrator();
      await orchestrator.stopContainer(workspace.container_id);
    }

    // Update workspace
    db.prepare(
      `UPDATE user_workspaces SET container_id = NULL, container_status = 'stopped', updated_at = datetime('now') WHERE id = ?`
    ).run(workspaceId);

    await logAudit(userId, 'stop', 'container', workspaceId);

    const response: ApiResponse = {
      success: true,
      data: {
        status: 'stopped',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CONTAINER_STOP_ERROR',
          message: error instanceof Error ? error.message : 'Failed to stop container',
        },
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

  try {
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId) as {
      container_id: string | null;
      container_status: string;
    } | undefined;

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    let status = workspace.container_status;
    let resourceUsage = null;

    if (workspace.container_id) {
      const orchestrator = getOrchestrator();
      status = await orchestrator.getContainerStatus(workspace.container_id);
      resourceUsage = await orchestrator.getResourceUsage(workspace.container_id);

      // Update status in DB if changed
      if (status !== workspace.container_status) {
        db.prepare(
          `UPDATE user_workspaces SET container_status = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(status, workspaceId);
      }
    }

    const response: ApiResponse = {
      success: true,
      data: {
        containerId: workspace.container_id,
        status,
        resourceUsage,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CONTAINER_STATUS_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get container status',
        },
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
  const tail = parseInt(c.req.query('tail') || '100');

  try {
    const db = getDatabase();
    const workspace = db
      .prepare(`SELECT * FROM user_workspaces WHERE id = ? AND user_id = ?`)
      .get(workspaceId, userId) as {
      container_id: string | null;
    } | undefined;

    if (!workspace) {
      return c.json(
        {
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
          },
        },
        404
      );
    }

    let logs = '';
    if (workspace.container_id) {
      const orchestrator = getOrchestrator();
      logs = await orchestrator.getContainerLogs(workspace.container_id, tail);
    }

    const response: ApiResponse = {
      success: true,
      data: {
        logs,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CONTAINER_LOGS_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get container logs',
        },
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

    const response: ApiResponse = {
      success: true,
      data: {
        dockerAvailable,
        activeContainers: activeContainers.length,
        containers: activeContainers.map((c) => ({
          userId: c.userId,
          workspaceId: c.workspaceId,
          status: c.status,
          startedAt: c.startedAt,
          lastActivityAt: c.lastActivityAt,
        })),
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SYSTEM_STATUS_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get system status',
        },
      },
      500
    );
  }
});

export const workspaceRoutes = app;
