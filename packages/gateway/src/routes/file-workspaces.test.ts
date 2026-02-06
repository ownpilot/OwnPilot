/**
 * File Workspaces Routes Tests
 *
 * Comprehensive test suite for session-based file workspace management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { fileWorkspaceRoutes } from './file-workspaces.js';

// Mock the file-workspace module
vi.mock('../workspace/file-workspace.js', () => ({
  listSessionWorkspaces: vi.fn(),
  getSessionWorkspace: vi.fn(),
  createSessionWorkspace: vi.fn(),
  deleteSessionWorkspace: vi.fn(),
  getSessionWorkspaceFiles: vi.fn(),
  readSessionWorkspaceFile: vi.fn(),
  writeSessionWorkspaceFile: vi.fn(),
  deleteSessionWorkspaceFile: vi.fn(),
  zipSessionWorkspace: vi.fn(),
  cleanupSessionWorkspaces: vi.fn(),
  smartCleanupSessionWorkspaces: vi.fn(),
  getOrCreateSessionWorkspace: vi.fn(),
}));

// Mock fs functions
vi.mock('node:fs', () => ({
  createReadStream: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
}));

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
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';

describe('File Workspaces Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/file-workspaces', fileWorkspaceRoutes);
    vi.clearAllMocks();
  });

  describe('GET /file-workspaces - List workspaces', () => {
    it('should return list of workspaces', async () => {
      const mockWorkspaces = [
        { id: 'ws-1', name: 'Workspace 1', path: '/tmp/ws-1' },
        { id: 'ws-2', name: 'Workspace 2', path: '/tmp/ws-2' },
      ];
      vi.mocked(listSessionWorkspaces).mockReturnValue(mockWorkspaces);

      const res = await app.request('/file-workspaces');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.workspaces).toEqual(mockWorkspaces);
      expect(data.data.count).toBe(2);
      expect(listSessionWorkspaces).toHaveBeenCalledWith('default');
    });

    it('should handle empty workspace list', async () => {
      vi.mocked(listSessionWorkspaces).mockReturnValue([]);

      const res = await app.request('/file-workspaces');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.workspaces).toEqual([]);
      expect(data.data.count).toBe(0);
    });

    it('should handle list error', async () => {
      vi.mocked(listSessionWorkspaces).mockImplementation(() => {
        throw new Error('Failed to list');
      });

      const res = await app.request('/file-workspaces');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('WORKSPACE_LIST_ERROR');
    });
  });

  describe('POST /file-workspaces - Create workspace', () => {
    it('should create workspace with all fields', async () => {
      const mockWorkspace = {
        id: 'ws-123',
        name: 'Test Workspace',
        agentId: 'agent-1',
        sessionId: 'session-1',
        description: 'Test description',
        tags: ['test', 'demo'],
        path: '/tmp/ws-123',
      };
      vi.mocked(createSessionWorkspace).mockReturnValue(mockWorkspace);

      const res = await app.request('/file-workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Workspace',
          agentId: 'agent-1',
          sessionId: 'session-1',
          description: 'Test description',
          tags: ['test', 'demo'],
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockWorkspace);
      expect(createSessionWorkspace).toHaveBeenCalledWith({
        name: 'Test Workspace',
        userId: 'default',
        agentId: 'agent-1',
        sessionId: 'session-1',
        description: 'Test description',
        tags: ['test', 'demo'],
      });
    });

    it('should handle empty request body', async () => {
      const mockWorkspace = { id: 'ws-456', path: '/tmp/ws-456' };
      vi.mocked(createSessionWorkspace).mockReturnValue(mockWorkspace);

      const res = await app.request('/file-workspaces', {
        method: 'POST',
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(createSessionWorkspace).toHaveBeenCalledWith({
        name: undefined,
        userId: 'default',
        agentId: undefined,
        sessionId: undefined,
        description: undefined,
        tags: undefined,
      });
    });

    it('should handle creation error', async () => {
      vi.mocked(createSessionWorkspace).mockImplementation(() => {
        throw new Error('Creation failed');
      });

      const res = await app.request('/file-workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('WORKSPACE_CREATE_ERROR');
    });
  });

  describe('GET /file-workspaces/:id - Get workspace', () => {
    it('should return workspace details', async () => {
      const mockWorkspace = {
        id: 'ws-123',
        name: 'Test Workspace',
        path: '/tmp/ws-123',
        createdAt: new Date('2024-01-01'),
      };
      vi.mocked(getSessionWorkspace).mockReturnValue(mockWorkspace);

      const res = await app.request('/file-workspaces/ws-123');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        id: 'ws-123',
        name: 'Test Workspace',
        path: '/tmp/ws-123',
      });
      expect(getSessionWorkspace).toHaveBeenCalledWith('ws-123');
    });

    it('should return 404 for non-existent workspace', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue(null);

      const res = await app.request('/file-workspaces/ws-nonexistent');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should return 404 for workspace owned by different user', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({
        id: 'ws-123',
        name: 'Other User Workspace',
        path: '/tmp/ws-123',
        userId: 'other-user',
        createdAt: new Date('2024-01-01').toISOString(),
        updatedAt: new Date('2024-01-01').toISOString(),
        size: 0,
        fileCount: 0,
      });

      const res = await app.request('/file-workspaces/ws-123');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('ACCESS_DENIED');
    });

    it('should handle fetch error', async () => {
      vi.mocked(getSessionWorkspace).mockImplementation(() => {
        throw new Error('Fetch failed');
      });

      const res = await app.request('/file-workspaces/ws-123');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('WORKSPACE_FETCH_ERROR');
    });
  });

  describe('DELETE /file-workspaces/:id - Delete workspace', () => {
    it('should delete workspace successfully', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123', path: '/tmp/ws-123' });
      vi.mocked(deleteSessionWorkspace).mockReturnValue(true);

      const res = await app.request('/file-workspaces/ws-123', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.deleted).toBe(true);
      expect(deleteSessionWorkspace).toHaveBeenCalledWith('ws-123');
    });

    it('should return 404 when workspace not found', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue(null);

      const res = await app.request('/file-workspaces/ws-nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should handle deletion error', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123', path: '/tmp/ws-123' });
      vi.mocked(deleteSessionWorkspace).mockImplementation(() => {
        throw new Error('Deletion failed');
      });

      const res = await app.request('/file-workspaces/ws-123', {
        method: 'DELETE',
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('WORKSPACE_DELETE_ERROR');
    });
  });

  describe('GET /file-workspaces/:id/files - List files', () => {
    it('should list files in workspace root', async () => {
      const mockWorkspace = { id: 'ws-123', path: '/tmp/ws-123' };
      const mockFiles = [
        { name: 'file1.txt', path: 'file1.txt', size: 100, isDirectory: false },
        { name: 'dir1', path: 'dir1', size: 0, isDirectory: true },
      ];
      vi.mocked(getSessionWorkspace).mockReturnValue(mockWorkspace);
      vi.mocked(getSessionWorkspaceFiles).mockReturnValue(mockFiles);

      const res = await app.request('/file-workspaces/ws-123/files');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.path).toBe('');
      expect(data.data.files).toEqual(mockFiles);
      expect(data.data.count).toBe(2);
    });

    it('should list files in subdirectory', async () => {
      const mockWorkspace = { id: 'ws-123', path: '/tmp/ws-123' };
      const mockFiles = [{ name: 'file2.txt', path: 'subdir/file2.txt', size: 50, isDirectory: false }];
      vi.mocked(getSessionWorkspace).mockReturnValue(mockWorkspace);
      vi.mocked(getSessionWorkspaceFiles).mockReturnValue(mockFiles);

      const res = await app.request('/file-workspaces/ws-123/files?path=subdir');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.path).toBe('subdir');
      expect(getSessionWorkspaceFiles).toHaveBeenCalledWith('ws-123', 'subdir');
    });

    it('should return 404 for non-existent workspace', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue(null);

      const res = await app.request('/file-workspaces/ws-nonexistent/files');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should handle list error', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123' });
      vi.mocked(getSessionWorkspaceFiles).mockImplementation(() => {
        throw new Error('List failed');
      });

      const res = await app.request('/file-workspaces/ws-123/files');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('FILE_LIST_ERROR');
    });
  });

  describe('GET /file-workspaces/:id/file/* - Read file', () => {
    it('should read file as JSON', async () => {
      const mockWorkspace = { id: 'ws-123', path: '/tmp/ws-123' };
      const mockContent = Buffer.from('Hello, World!');
      vi.mocked(getSessionWorkspace).mockReturnValue(mockWorkspace);
      vi.mocked(readSessionWorkspaceFile).mockReturnValue(mockContent);

      const res = await app.request('/file-workspaces/ws-123/file/test.txt');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.path).toBe('test.txt');
      expect(data.data.content).toBe('Hello, World!');
      expect(data.data.size).toBe(mockContent.length);
    });

    it('should return file as download', async () => {
      const mockWorkspace = { id: 'ws-123', path: '/tmp/ws-123' };
      const mockContent = Buffer.from('Binary content');
      vi.mocked(getSessionWorkspace).mockReturnValue(mockWorkspace);
      vi.mocked(readSessionWorkspaceFile).mockReturnValue(mockContent);

      const res = await app.request('/file-workspaces/ws-123/file/test.bin?download=true');

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Disposition')).toContain('attachment');
      expect(res.headers.get('Content-Disposition')).toContain('test.bin');
      expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    });

    it('should return 404 for non-existent workspace', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue(null);

      const res = await app.request('/file-workspaces/ws-nonexistent/file/test.txt');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should return 404 for non-existent file', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123' });
      vi.mocked(readSessionWorkspaceFile).mockReturnValue(null);

      const res = await app.request('/file-workspaces/ws-123/file/nonexistent.txt');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('FILE_NOT_FOUND');
    });

    it('should return 403 for path traversal attempt', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123' });
      vi.mocked(readSessionWorkspaceFile).mockImplementation(() => {
        throw new Error('Path traversal attempt detected');
      });

      const res = await app.request('/file-workspaces/ws-123/file/..%2F..%2F..%2Fetc%2Fpasswd');

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe('ACCESS_DENIED');
      expect(data.error.message).toContain('traversal');
    });

    it('should handle read error', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123' });
      vi.mocked(readSessionWorkspaceFile).mockImplementation(() => {
        throw new Error('Read failed');
      });

      const res = await app.request('/file-workspaces/ws-123/file/test.txt');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('FILE_READ_ERROR');
    });
  });

  describe('PUT /file-workspaces/:id/file/* - Write file', () => {
    it('should write file successfully', async () => {
      const mockWorkspace = { id: 'ws-123', path: '/tmp/ws-123' };
      vi.mocked(getSessionWorkspace).mockReturnValue(mockWorkspace);

      const res = await app.request('/file-workspaces/ws-123/file/newfile.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'File content' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.path).toBe('newfile.txt');
      expect(data.data.written).toBe(true);
      expect(writeSessionWorkspaceFile).toHaveBeenCalledWith('ws-123', 'newfile.txt', 'File content');
    });

    it('should return 404 for non-existent workspace', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue(null);

      const res = await app.request('/file-workspaces/ws-nonexistent/file/test.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'content' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should return 400 when content is missing', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123' });

      const res = await app.request('/file-workspaces/ws-123/file/test.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('INVALID_INPUT');
      expect(data.error.message).toContain('Content is required');
    });

    it('should return 403 for path traversal attempt', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123' });
      vi.mocked(writeSessionWorkspaceFile).mockImplementation(() => {
        throw new Error('Path traversal attempt detected');
      });

      const res = await app.request('/file-workspaces/ws-123/file/..%2F..%2Fmalicious.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'malicious content' }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe('ACCESS_DENIED');
      expect(data.error.message).toContain('traversal');
    });

    it('should handle write error', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123' });
      vi.mocked(writeSessionWorkspaceFile).mockImplementation(() => {
        throw new Error('Write failed');
      });

      const res = await app.request('/file-workspaces/ws-123/file/test.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'content' }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('FILE_WRITE_ERROR');
    });
  });

  describe('DELETE /file-workspaces/:id/file/* - Delete file', () => {
    it('should delete file successfully', async () => {
      const mockWorkspace = { id: 'ws-123', path: '/tmp/ws-123' };
      vi.mocked(getSessionWorkspace).mockReturnValue(mockWorkspace);
      vi.mocked(deleteSessionWorkspaceFile).mockReturnValue(true);

      const res = await app.request('/file-workspaces/ws-123/file/test.txt', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.path).toBe('test.txt');
      expect(data.data.deleted).toBe(true);
      expect(deleteSessionWorkspaceFile).toHaveBeenCalledWith('ws-123', 'test.txt');
    });

    it('should return 404 for non-existent workspace', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue(null);

      const res = await app.request('/file-workspaces/ws-nonexistent/file/test.txt', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should return 404 for non-existent file', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123' });
      vi.mocked(deleteSessionWorkspaceFile).mockReturnValue(false);

      const res = await app.request('/file-workspaces/ws-123/file/nonexistent.txt', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('FILE_NOT_FOUND');
    });

    it('should return 403 for path traversal attempt', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123' });
      vi.mocked(deleteSessionWorkspaceFile).mockImplementation(() => {
        throw new Error('Path traversal attempt detected');
      });

      const res = await app.request('/file-workspaces/ws-123/file/..%2F..%2Fmalicious.txt', {
        method: 'DELETE',
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe('ACCESS_DENIED');
      expect(data.error.message).toContain('traversal');
    });

    it('should handle deletion error', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123' });
      vi.mocked(deleteSessionWorkspaceFile).mockImplementation(() => {
        throw new Error('Deletion failed');
      });

      const res = await app.request('/file-workspaces/ws-123/file/test.txt', {
        method: 'DELETE',
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('FILE_DELETE_ERROR');
    });
  });

  describe('GET /file-workspaces/:id/download - Download workspace', () => {
    it('should download workspace as ZIP', async () => {
      const mockWorkspace = { id: 'ws-123', name: 'Test Workspace', path: '/tmp/ws-123' };
      const mockZipPath = '/tmp/ws-123.zip';
      const mockStream = {};
      vi.mocked(getSessionWorkspace).mockReturnValue(mockWorkspace);
      vi.mocked(zipSessionWorkspace).mockResolvedValue(mockZipPath);
      vi.mocked(stat).mockResolvedValue({ size: 1024 } as unknown as Awaited<ReturnType<typeof stat>>);
      vi.mocked(createReadStream).mockReturnValue(mockStream as unknown as ReturnType<typeof createReadStream>);

      const res = await app.request('/file-workspaces/ws-123/download');

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/zip');
      expect(res.headers.get('Content-Disposition')).toContain('Test Workspace.zip');
      expect(res.headers.get('Content-Length')).toBe('1024');
      expect(zipSessionWorkspace).toHaveBeenCalledWith('ws-123');
    });

    it('should return 404 for non-existent workspace', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue(null);

      const res = await app.request('/file-workspaces/ws-nonexistent/download');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should handle download error', async () => {
      vi.mocked(getSessionWorkspace).mockReturnValue({ id: 'ws-123' });
      vi.mocked(zipSessionWorkspace).mockRejectedValue(new Error('Zip failed'));

      const res = await app.request('/file-workspaces/ws-123/download');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('DOWNLOAD_ERROR');
    });
  });

  describe('POST /file-workspaces/cleanup - Cleanup workspaces', () => {
    it('should cleanup with default mode (old) and default maxAgeDays (7)', async () => {
      vi.mocked(smartCleanupSessionWorkspaces).mockReturnValue({
        deleted: 2, kept: 3, deletedEmpty: 0, deletedOld: 2,
      });

      const res = await app.request('/file-workspaces/cleanup', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.deleted).toBe(2);
      expect(data.data.kept).toBe(3);
      expect(data.data.mode).toBe('old');
      expect(data.data.stats).toEqual({ deletedEmpty: 0, deletedOld: 2 });
      expect(smartCleanupSessionWorkspaces).toHaveBeenCalledWith('old', 7, 'default');
    });

    it('should cleanup with empty mode', async () => {
      vi.mocked(smartCleanupSessionWorkspaces).mockReturnValue({
        deleted: 1, kept: 4, deletedEmpty: 1, deletedOld: 0,
      });

      const res = await app.request('/file-workspaces/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'empty' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.mode).toBe('empty');
      expect(data.data.stats.deletedEmpty).toBe(1);
      expect(smartCleanupSessionWorkspaces).toHaveBeenCalledWith('empty', 7, 'default');
    });

    it('should cleanup with both mode and custom maxAgeDays', async () => {
      vi.mocked(smartCleanupSessionWorkspaces).mockReturnValue({
        deleted: 5, kept: 0, deletedEmpty: 2, deletedOld: 4,
      });

      const res = await app.request('/file-workspaces/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'both', maxAgeDays: 30 }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.mode).toBe('both');
      expect(data.data.deleted).toBe(5);
      expect(smartCleanupSessionWorkspaces).toHaveBeenCalledWith('both', 30, 'default');
    });

    it('should clamp maxAgeDays to valid range', async () => {
      vi.mocked(smartCleanupSessionWorkspaces).mockReturnValue({
        deleted: 0, kept: 0, deletedEmpty: 0, deletedOld: 0,
      });

      // Test minimum clamp
      const res = await app.request('/file-workspaces/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxAgeDays: -5 }),
      });

      expect(res.status).toBe(200);
      expect(smartCleanupSessionWorkspaces).toHaveBeenCalledWith('old', 1, 'default');
    });

    it('should handle cleanup error', async () => {
      vi.mocked(smartCleanupSessionWorkspaces).mockImplementation(() => {
        throw new Error('Cleanup failed');
      });

      const res = await app.request('/file-workspaces/cleanup', {
        method: 'POST',
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('CLEANUP_ERROR');
    });
  });

  describe('POST /file-workspaces/session/:sessionId - Get or create session workspace', () => {
    it('should get or create workspace for session', async () => {
      const mockWorkspace = {
        id: 'ws-session-123',
        sessionId: 'session-123',
        agentId: 'agent-1',
        path: '/tmp/ws-session-123',
      };
      vi.mocked(getOrCreateSessionWorkspace).mockReturnValue(mockWorkspace);

      const res = await app.request('/file-workspaces/session/session-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'agent-1' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockWorkspace);
      expect(getOrCreateSessionWorkspace).toHaveBeenCalledWith('session-123', 'agent-1', 'default');
    });

    it('should handle empty body', async () => {
      const mockWorkspace = { id: 'ws-session-456', sessionId: 'session-456' };
      vi.mocked(getOrCreateSessionWorkspace).mockReturnValue(mockWorkspace);

      const res = await app.request('/file-workspaces/session/session-456', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(getOrCreateSessionWorkspace).toHaveBeenCalledWith('session-456', undefined, 'default');
    });

    it('should handle session workspace error', async () => {
      vi.mocked(getOrCreateSessionWorkspace).mockImplementation(() => {
        throw new Error('Session workspace failed');
      });

      const res = await app.request('/file-workspaces/session/session-123', {
        method: 'POST',
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_ERROR');
    });
  });
});
