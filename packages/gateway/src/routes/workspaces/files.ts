/**
 * Workspace File Routes
 *
 * GET /:id/files       - List files in workspace
 * GET /:id/files/*     - Read a file
 * PUT /:id/files/*     - Write a file
 * DELETE /:id/files/*  - Delete a file
 * GET /:id/download    - Download workspace as ZIP
 */

import { Hono } from 'hono';
import { WorkspacesRepository } from '../../db/repositories/workspaces.js';
import { getWorkspaceStorage, StorageSecurityError } from '@ownpilot/core';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getUserId,
  zodValidationError,
  getErrorMessage,
  parseJsonBody,
} from '../helpers.js';
import { sanitizeFilePath } from './shared.js';

const app = new Hono();

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
      return apiError(
        c,
        { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' },
        404
      );
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
    return apiError(
      c,
      {
        code: ERROR_CODES.FILE_LIST_ERROR,
        message: getErrorMessage(error, 'Failed to list files'),
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
      return apiError(
        c,
        { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' },
        404
      );
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
    return apiError(
      c,
      { code: ERROR_CODES.FILE_READ_ERROR, message: getErrorMessage(error, 'Failed to read file') },
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
      return apiError(
        c,
        { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' },
        404
      );
    }

    const body = await parseJsonBody(c);
    const { workspaceWriteFileSchema } = await import('../../middleware/validation.js');
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
    return apiError(
      c,
      {
        code: ERROR_CODES.FILE_WRITE_ERROR,
        message: getErrorMessage(error, 'Failed to write file'),
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
      return apiError(
        c,
        { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' },
        404
      );
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
    return apiError(
      c,
      {
        code: ERROR_CODES.FILE_DELETE_ERROR,
        message: getErrorMessage(error, 'Failed to delete file'),
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

    if (files.length === 0) {
      return apiError(
        c,
        { code: ERROR_CODES.WORKSPACE_EMPTY, message: 'Workspace has no files to download' },
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
    return apiError(
      c,
      {
        code: ERROR_CODES.DOWNLOAD_ERROR,
        message: getErrorMessage(error, 'Failed to download workspace'),
      },
      500
    );
  }
});

export const workspaceFileRoutes = app;
