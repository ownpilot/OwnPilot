/**
 * File Workspaces Routes
 *
 * API for managing session-based file workspaces.
 * These are lightweight, isolated directories for agent file operations.
 */

import { Hono } from 'hono';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ApiResponse } from '../types/index.js';
import { apiError } from './helpers.js';
import {
  listSessionWorkspaces,
  getSessionWorkspace,
  createSessionWorkspace,
  deleteSessionWorkspace,
  getSessionWorkspaceFiles,
  readSessionWorkspaceFile,
  writeSessionWorkspaceFile,
  deleteSessionWorkspaceFile,
  zipSessionWorkspace,
  cleanupSessionWorkspaces,
  getOrCreateSessionWorkspace,
} from '../workspace/file-workspace.js';

const app = new Hono();

/**
 * GET /file-workspaces - List all session workspaces
 */
app.get('/', async (c) => {
  try {
    const workspaces = listSessionWorkspaces();

    const response: ApiResponse = {
      success: true,
      data: {
        workspaces,
        count: workspaces.length,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return apiError(c, { code: 'WORKSPACE_LIST_ERROR', message: error instanceof Error ? error.message : 'Failed to list workspaces' }, 500);
  }
});

/**
 * POST /file-workspaces - Create a new session workspace
 */
app.post('/', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));

    const workspace = createSessionWorkspace({
      name: body.name,
      agentId: body.agentId,
      sessionId: body.sessionId,
      description: body.description,
      tags: body.tags,
    });

    const response: ApiResponse = {
      success: true,
      data: workspace,
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response, 201);
  } catch (error) {
    return apiError(c, { code: 'WORKSPACE_CREATE_ERROR', message: error instanceof Error ? error.message : 'Failed to create workspace' }, 500);
  }
});

/**
 * GET /file-workspaces/:id - Get workspace details
 */
app.get('/:id', async (c) => {
  const workspaceId = c.req.param('id');

  try {
    const workspace = getSessionWorkspace(workspaceId);

    if (!workspace) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    const response: ApiResponse = {
      success: true,
      data: workspace,
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return apiError(c, { code: 'WORKSPACE_FETCH_ERROR', message: error instanceof Error ? error.message : 'Failed to fetch workspace' }, 500);
  }
});

/**
 * DELETE /file-workspaces/:id - Delete a workspace
 */
app.delete('/:id', async (c) => {
  const workspaceId = c.req.param('id');

  try {
    const deleted = deleteSessionWorkspace(workspaceId);

    if (!deleted) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

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
    return apiError(c, { code: 'WORKSPACE_DELETE_ERROR', message: error instanceof Error ? error.message : 'Failed to delete workspace' }, 500);
  }
});

/**
 * GET /file-workspaces/:id/files - List files in workspace
 */
app.get('/:id/files', async (c) => {
  const workspaceId = c.req.param('id');
  const path = c.req.query('path') || '';

  try {
    const workspace = getSessionWorkspace(workspaceId);

    if (!workspace) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    const files = getSessionWorkspaceFiles(workspaceId, path);

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
    return apiError(c, { code: 'FILE_LIST_ERROR', message: error instanceof Error ? error.message : 'Failed to list files' }, 500);
  }
});

/**
 * GET /file-workspaces/:id/files/* - Read a file
 */
app.get('/:id/file/*', async (c) => {
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/file-workspaces/${workspaceId}/file/`, '');
  const download = c.req.query('download') === 'true';

  try {
    const workspace = getSessionWorkspace(workspaceId);

    if (!workspace) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    const content = readSessionWorkspaceFile(workspaceId, filePath);

    if (content === null) {
      return apiError(c, { code: 'FILE_NOT_FOUND', message: 'File not found' }, 404);
    }

    // If download requested, return as binary
    if (download) {
      const filename = basename(filePath);
      return new Response(content, {
        headers: {
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(content.length),
        },
      });
    }

    // Return as JSON with content
    const response: ApiResponse = {
      success: true,
      data: {
        path: filePath,
        content: content.toString('utf-8'),
        size: content.length,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    if (error instanceof Error && error.message.includes('traversal')) {
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
    return apiError(c, { code: 'FILE_READ_ERROR', message: error instanceof Error ? error.message : 'Failed to read file' }, 500);
  }
});

/**
 * PUT /file-workspaces/:id/file/* - Write a file
 */
app.put('/:id/file/*', async (c) => {
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/file-workspaces/${workspaceId}/file/`, '');

  try {
    const workspace = getSessionWorkspace(workspaceId);

    if (!workspace) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    const body = await c.req.json();
    const { content } = body;

    if (content === undefined) {
      return apiError(c, { code: 'INVALID_INPUT', message: 'Content is required' }, 400);
    }

    writeSessionWorkspaceFile(workspaceId, filePath, content);

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
    if (error instanceof Error && error.message.includes('traversal')) {
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
    return apiError(c, { code: 'FILE_WRITE_ERROR', message: error instanceof Error ? error.message : 'Failed to write file' }, 500);
  }
});

/**
 * DELETE /file-workspaces/:id/file/* - Delete a file
 */
app.delete('/:id/file/*', async (c) => {
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/file-workspaces/${workspaceId}/file/`, '');

  try {
    const workspace = getSessionWorkspace(workspaceId);

    if (!workspace) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    const deleted = deleteSessionWorkspaceFile(workspaceId, filePath);

    if (!deleted) {
      return apiError(c, { code: 'FILE_NOT_FOUND', message: 'File not found' }, 404);
    }

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
    if (error instanceof Error && error.message.includes('traversal')) {
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
    return apiError(c, { code: 'FILE_DELETE_ERROR', message: error instanceof Error ? error.message : 'Failed to delete file' }, 500);
  }
});

/**
 * GET /file-workspaces/:id/download - Download workspace as ZIP
 */
app.get('/:id/download', async (c) => {
  const workspaceId = c.req.param('id');

  try {
    const workspace = getSessionWorkspace(workspaceId);

    if (!workspace) {
      return apiError(c, { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' }, 404);
    }

    // Create zip file
    const zipPath = await zipSessionWorkspace(workspaceId);

    // Get file stats
    const stats = await stat(zipPath);

    // Set headers for download
    const filename = `${workspace.name || workspaceId}.zip`;
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    c.header('Content-Length', String(stats.size));

    // Stream the file
    const stream = createReadStream(zipPath);
    return new Response(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(stats.size),
      },
    });
  } catch (error) {
    return apiError(c, { code: 'DOWNLOAD_ERROR', message: error instanceof Error ? error.message : 'Failed to download workspace' }, 500);
  }
});

/**
 * POST /file-workspaces/cleanup - Clean up old workspaces
 */
app.post('/cleanup', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const maxAgeDays = body.maxAgeDays || 7;

    const result = cleanupSessionWorkspaces(maxAgeDays);

    const response: ApiResponse = {
      success: true,
      data: result,
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return apiError(c, { code: 'CLEANUP_ERROR', message: error instanceof Error ? error.message : 'Failed to cleanup workspaces' }, 500);
  }
});

/**
 * POST /file-workspaces/session/:sessionId - Get or create workspace for session
 */
app.post('/session/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');

  try {
    const body = await c.req.json().catch(() => ({}));

    const workspace = getOrCreateSessionWorkspace(sessionId, body.agentId);

    const response: ApiResponse = {
      success: true,
      data: workspace,
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return apiError(c, { code: 'WORKSPACE_ERROR', message: error instanceof Error ? error.message : 'Failed to get or create workspace' }, 500);
  }
});

export const fileWorkspaceRoutes = app;
