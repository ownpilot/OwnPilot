/**
 * File Workspaces Routes
 *
 * API for managing session-based file workspaces.
 * These are lightweight, isolated directories for agent file operations.
 * All endpoints are scoped to the authenticated user.
 */

import { Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { apiResponse, apiError, ERROR_CODES, getUserId, getErrorMessage, parseJsonBody } from './helpers.js';
import { MAX_DAYS_LOOKBACK } from '../config/defaults.js';

/** Sanitize a filename for use in Content-Disposition headers */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|\r\n]/g, '_') // Replace path separators, control chars, shell-dangerous chars
    .replace(/[^\x20-\x7E]/g, '_') // Replace non-printable / non-ASCII
    .slice(0, 255); // Limit length
}
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
  getOrCreateSessionWorkspace,
  smartCleanupSessionWorkspaces,
} from '../workspace/file-workspace.js';
import type { Context } from 'hono';
import type { SessionWorkspaceInfo } from '../workspace/file-workspace.js';

/** Get workspace and verify it belongs to the requesting user. Returns null with error response if not found/forbidden. */
function getOwnedWorkspace(
  c: Context,
  workspaceId: string,
  userId: string
): SessionWorkspaceInfo | Response {
  const workspace = getSessionWorkspace(workspaceId);

  if (!workspace) {
    return apiError(
      c,
      { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' },
      404
    );
  }

  // Deny access if workspace has a userId set and it doesn't match
  if (workspace.userId && workspace.userId !== userId) {
    return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: 'Workspace not found' }, 404);
  }

  return workspace;
}

const app = new Hono();

/**
 * GET /file-workspaces - List all session workspaces
 */
app.get('/', async (c) => {
  const userId = getUserId(c);
  try {
    const workspaces = listSessionWorkspaces(userId);

    return apiResponse(c, {
      workspaces,
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
 * POST /file-workspaces - Create a new session workspace
 */
app.post('/', async (c) => {
  const userId = getUserId(c);
  try {
    const body = await parseJsonBody<{
      name?: string;
      agentId?: string;
      sessionId?: string;
      description?: string;
      tags?: string[];
      mode?: string;
      maxAgeDays?: number;
    }>(c) ?? {};

    const workspace = createSessionWorkspace({
      name: body.name,
      userId,
      agentId: body.agentId,
      sessionId: body.sessionId,
      description: body.description,
      tags: body.tags,
    });

    return apiResponse(c, workspace, 201);
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.WORKSPACE_CREATE_ERROR,
        message: getErrorMessage(error, 'Failed to create workspace'),
      },
      500
    );
  }
});

/**
 * GET /file-workspaces/:id - Get workspace details
 */
app.get('/:id', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');

  try {
    const result = getOwnedWorkspace(c, workspaceId, userId);
    if (result instanceof Response) return result;

    return apiResponse(c, result);
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
 * DELETE /file-workspaces/:id - Delete a workspace
 */
app.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');

  try {
    const result = getOwnedWorkspace(c, workspaceId, userId);
    if (result instanceof Response) return result;

    deleteSessionWorkspace(workspaceId);

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

/**
 * GET /file-workspaces/:id/files - List files in workspace
 */
app.get('/:id/files', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const path = c.req.query('path') || '';

  try {
    const result = getOwnedWorkspace(c, workspaceId, userId);
    if (result instanceof Response) return result;

    const files = getSessionWorkspaceFiles(workspaceId, path);

    return apiResponse(c, {
      path,
      files,
      count: files.length,
    });
  } catch (error) {
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
 * GET /file-workspaces/:id/files/* - Read a file
 */
app.get('/:id/file/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/file-workspaces/${workspaceId}/file/`, '');
  const download = c.req.query('download') === 'true';
  const raw = c.req.query('raw') === 'true';

  try {
    const result = getOwnedWorkspace(c, workspaceId, userId);
    if (result instanceof Response) return result;

    const content = readSessionWorkspaceFile(workspaceId, filePath);

    if (content === null) {
      return apiError(c, { code: ERROR_CODES.FILE_NOT_FOUND, message: 'File not found' }, 404);
    }

    // If download requested, return as binary
    if (download) {
      const filename = sanitizeFilename(basename(filePath));
      return new Response(content, {
        headers: {
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(content.length),
        },
      });
    }

    // If raw requested, return with proper MIME type (for images, PDFs, etc.)
    if (raw) {
      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      const mimeTypes: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
        ico: 'image/x-icon',
        mp4: 'video/mp4',
        webm: 'video/webm',
        pdf: 'application/pdf',
        txt: 'text/plain',
        html: 'text/html',
        css: 'text/css',
        js: 'text/javascript',
        json: 'application/json',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      return new Response(content, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(content.length),
          'Cache-Control': 'private, max-age=300',
        },
      });
    }

    // Return as JSON with content
    return apiResponse(c, {
      path: filePath,
      content: content.toString('utf-8'),
      size: content.length,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('traversal')) {
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
 * PUT /file-workspaces/:id/file/* - Write a file
 */
app.put('/:id/file/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/file-workspaces/${workspaceId}/file/`, '');

  try {
    const result = getOwnedWorkspace(c, workspaceId, userId);
    if (result instanceof Response) return result;

    const body = await parseJsonBody<{ content: string }>(c);

    if (!body || body.content === undefined) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Content is required' }, 400);
    }

    const { content } = body;

    writeSessionWorkspaceFile(workspaceId, filePath, content);

    return apiResponse(c, {
      path: filePath,
      written: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('traversal')) {
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
 * DELETE /file-workspaces/:id/file/* - Delete a file
 */
app.delete('/:id/file/*', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');
  const filePath = c.req.path.replace(`/file-workspaces/${workspaceId}/file/`, '');

  try {
    const result = getOwnedWorkspace(c, workspaceId, userId);
    if (result instanceof Response) return result;

    const deleted = deleteSessionWorkspaceFile(workspaceId, filePath);

    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.FILE_NOT_FOUND, message: 'File not found' }, 404);
    }

    return apiResponse(c, {
      path: filePath,
      deleted: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('traversal')) {
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

/**
 * GET /file-workspaces/:id/download - Download workspace as ZIP
 */
app.get('/:id/download', async (c) => {
  const userId = getUserId(c);
  const workspaceId = c.req.param('id');

  try {
    const result = getOwnedWorkspace(c, workspaceId, userId);
    if (result instanceof Response) return result;

    // Create zip file
    const zipPath = await zipSessionWorkspace(workspaceId);

    // Get file stats
    const stats = await stat(zipPath);

    // Set headers for download
    const filename = sanitizeFilename(`${result.name || workspaceId}.zip`);
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    c.header('Content-Length', String(stats.size));

    // Stream the file, then clean up temp ZIP
    const stream = createReadStream(zipPath);
    stream.on('end', () => {
      unlink(zipPath).catch(() => {});
    });
    stream.on('error', () => {
      unlink(zipPath).catch(() => {});
    });
    return new Response(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(stats.size),
      },
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

/**
 * POST /file-workspaces/cleanup - Clean up old workspaces
 */
app.post('/cleanup', async (c) => {
  const userId = getUserId(c);
  try {
    const body = await parseJsonBody<{
      name?: string;
      agentId?: string;
      sessionId?: string;
      description?: string;
      tags?: string[];
      mode?: string;
      maxAgeDays?: number;
    }>(c) ?? {};
    const mode: 'empty' | 'old' | 'both' = body.mode && ['empty', 'old', 'both'].includes(body.mode)
      ? body.mode as 'empty' | 'old' | 'both'
      : 'old';
    const raw = Number(body.maxAgeDays) || 7;
    const maxAgeDays = Math.max(1, Math.min(MAX_DAYS_LOOKBACK, raw));

    const result = smartCleanupSessionWorkspaces(mode, maxAgeDays, userId);

    return apiResponse(c, {
      deleted: result.deleted,
      kept: result.kept,
      mode,
      stats: { deletedEmpty: result.deletedEmpty, deletedOld: result.deletedOld },
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CLEANUP_ERROR,
        message: getErrorMessage(error, 'Failed to cleanup workspaces'),
      },
      500
    );
  }
});

/**
 * POST /file-workspaces/session/:sessionId - Get or create workspace for session
 */
app.post('/session/:sessionId', async (c) => {
  const userId = getUserId(c);
  const sessionId = c.req.param('sessionId');

  try {
    const body = await parseJsonBody<{
      name?: string;
      agentId?: string;
      sessionId?: string;
      description?: string;
      tags?: string[];
      mode?: string;
      maxAgeDays?: number;
    }>(c) ?? {};

    const workspace = getOrCreateSessionWorkspace(sessionId, body.agentId, userId);

    return apiResponse(c, workspace);
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.WORKSPACE_ERROR,
        message: getErrorMessage(error, 'Failed to get or create workspace'),
      },
      500
    );
  }
});

export const fileWorkspaceRoutes = app;
