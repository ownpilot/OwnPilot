/**
 * Workspace File Routes Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@ownpilot/core', () => ({
  getWorkspaceStorage: vi.fn(),
  StorageSecurityError: class StorageSecurityError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'StorageSecurityError';
    }
  },
}));

vi.mock('../../db/repositories/workspaces.js', () => ({
  WorkspacesRepository: vi.fn(),
}));

import { getWorkspaceStorage, StorageSecurityError } from '@ownpilot/core';
import { WorkspacesRepository } from '../../db/repositories/workspaces.js';
import { workspaceFileRoutes } from './files.js';

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-1',
    userId: 'user-1',
    name: 'Test Workspace',
    status: 'active',
    storagePath: '/tmp/ws-1',
    containerConfig: {},
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...overrides,
  };
}

describe('Workspace File Routes', () => {
  let app: Hono;
  let mockRepo: Record<string, ReturnType<typeof vi.fn>>;
  let mockStorage: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userId', 'user-1');
      await next();
    });
    app.route('/workspaces', workspaceFileRoutes);
    mockRepo = { get: vi.fn(), logAudit: vi.fn() };
    vi.mocked(WorkspacesRepository).mockImplementation(() => mockRepo as never);
    mockStorage = {
      listFiles: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      deleteFile: vi.fn(),
      getFileInfo: vi.fn(),
      getStorageUsage: vi.fn(),
    };
    vi.mocked(getWorkspaceStorage).mockReturnValue(mockStorage as never);
  });

  // =========================================================================
  // GET /:id/files - List files
  // =========================================================================
  describe('GET /:id/files', () => {
    it('should list files in workspace root', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.listFiles.mockResolvedValue([
        { name: 'file1.txt', path: 'file1.txt', size: 100, isDirectory: false },
        { name: 'src', path: 'src', size: 0, isDirectory: true },
      ]);
      const res = await app.request('/workspaces/ws-1/files');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.files).toHaveLength(2);
      expect(json.data.count).toBe(2);
      expect(json.data.path).toBe('.');
      expect(mockStorage.listFiles).toHaveBeenCalledWith('user-1/ws-1', '.', false);
    });
    it('should list files with path and recursive params', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.listFiles.mockResolvedValue([]);
      const res = await app.request('/workspaces/ws-1/files?path=src&recursive=true');
      expect(res.status).toBe(200);
      expect(mockStorage.listFiles).toHaveBeenCalledWith('user-1/ws-1', 'src', true);
    });
    it('should return 400 for directory traversal path', async () => {
      const res = await app.request('/workspaces/ws-1/files?path=../../etc/passwd');
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('BAD_REQUEST');
    });
    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/workspaces/ws-1/files');
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('WORKSPACE_NOT_FOUND');
    });
    it('should return 403 for StorageSecurityError', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.listFiles.mockRejectedValue(new StorageSecurityError('Path traversal attempt'));
      const res = await app.request('/workspaces/ws-1/files');
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('ACCESS_DENIED');
    });
    it('should return 500 for generic errors', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.listFiles.mockRejectedValue(new Error('disk error'));
      const res = await app.request('/workspaces/ws-1/files');
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('FILE_LIST_ERROR');
    });
  });

  // =========================================================================
  // GET /:id/files/* - Read file
  // =========================================================================
  describe('GET /:id/files/* - Read file', () => {
    it('should read a file successfully', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.readFile.mockResolvedValue('file content here');
      mockStorage.getFileInfo.mockResolvedValue({ size: 17, modifiedAt: '2024-01-15T10:00:00Z' });
      const res = await app.request('/workspaces/ws-1/files/src/main.ts');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.path).toBe('src/main.ts');
      expect(json.data.content).toBe('file content here');
      expect(json.data.size).toBe(17);
      expect(mockRepo.logAudit).toHaveBeenCalledWith('read', 'file', 'src/main.ts');
    });
    it('should handle URL-normalized traversal paths', async () => {
      // URL normalization resolves ../../ before reaching handler
      const res = await app.request('/workspaces/ws-1/files/../../../etc/passwd');
      // URL normalization prevents the path from reaching the handler
      expect(res.status).toBe(404);
    });
    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/workspaces/ws-1/files/readme.md');
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('WORKSPACE_NOT_FOUND');
    });
    it('should return 403 for StorageSecurityError', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.readFile.mockRejectedValue(new StorageSecurityError('blocked'));
      const res = await app.request('/workspaces/ws-1/files/secret.key');
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('ACCESS_DENIED');
    });
    it('should return 500 for generic read errors', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.readFile.mockRejectedValue(new Error('read failed'));
      const res = await app.request('/workspaces/ws-1/files/broken.txt');
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('FILE_READ_ERROR');
    });
  });

  // =========================================================================
  // PUT /:id/files/* - Write file
  // =========================================================================
  describe('PUT /:id/files/* - Write file', () => {
    it('should write a file successfully', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.writeFile.mockResolvedValue(undefined);
      const res = await app.request('/workspaces/ws-1/files/new-file.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'hello world' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.path).toBe('new-file.txt');
      expect(json.data.written).toBe(true);
      expect(mockStorage.writeFile).toHaveBeenCalledWith(
        'user-1/ws-1',
        'new-file.txt',
        'hello world'
      );
      expect(mockRepo.logAudit).toHaveBeenCalledWith('write', 'file', 'new-file.txt');
    });
    it('should handle URL-normalized traversal paths', async () => {
      // URL normalization resolves ../../ before reaching handler
      const res = await app.request('/workspaces/ws-1/files/../../../etc/passwd', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      });
      // URL normalization prevents the path from reaching the handler
      expect(res.status).toBe(404);
    });
    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/workspaces/ws-1/files/file.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'data' }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('WORKSPACE_NOT_FOUND');
    });
    it('should return 400 for invalid body', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      const res = await app.request('/workspaces/ws-1/files/file.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('INVALID_INPUT');
    });
    it('should return 400 for missing body', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      const res = await app.request('/workspaces/ws-1/files/file.txt', {
        method: 'PUT',
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('INVALID_INPUT');
    });
    it('should return 403 for StorageSecurityError on write', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.writeFile.mockRejectedValue(new StorageSecurityError('blocked'));
      const res = await app.request('/workspaces/ws-1/files/file.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'data' }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('ACCESS_DENIED');
    });
    it('should return 500 for generic write errors', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.writeFile.mockRejectedValue(new Error('disk full'));
      const res = await app.request('/workspaces/ws-1/files/file.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'data' }),
      });
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('FILE_WRITE_ERROR');
    });
  });

  // =========================================================================
  // DELETE /:id/files/* - Delete file
  // =========================================================================
  describe('DELETE /:id/files/* - Delete file', () => {
    it('should delete a file successfully', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.deleteFile.mockResolvedValue(undefined);
      const res = await app.request('/workspaces/ws-1/files/old-file.txt', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.path).toBe('old-file.txt');
      expect(json.data.deleted).toBe(true);
      expect(mockStorage.deleteFile).toHaveBeenCalledWith('user-1/ws-1', 'old-file.txt');
      expect(mockRepo.logAudit).toHaveBeenCalledWith('delete', 'file', 'old-file.txt');
    });
    it('should handle URL-normalized traversal paths', async () => {
      // URL normalization resolves ../../ before reaching handler
      const res = await app.request('/workspaces/ws-1/files/../../../etc/passwd', {
        method: 'DELETE',
      });
      // URL normalization prevents the path from reaching the handler
      expect(res.status).toBe(404);
    });
    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/workspaces/ws-1/files/file.txt', { method: 'DELETE' });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('WORKSPACE_NOT_FOUND');
    });
    it('should return 403 for StorageSecurityError', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.deleteFile.mockRejectedValue(new StorageSecurityError('blocked'));
      const res = await app.request('/workspaces/ws-1/files/file.txt', { method: 'DELETE' });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('ACCESS_DENIED');
    });
    it('should return 500 for generic delete errors', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.deleteFile.mockRejectedValue(new Error('disk error'));
      const res = await app.request('/workspaces/ws-1/files/file.txt', { method: 'DELETE' });
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('FILE_DELETE_ERROR');
    });
  });

  // =========================================================================
  // GET /:id/download - Download workspace
  // =========================================================================
  describe('GET /:id/download', () => {
    it('should download workspace as JSON archive', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ name: 'My Project' }));
      mockStorage.listFiles.mockResolvedValue([
        { name: 'file1.txt', path: 'file1.txt', size: 5, isDirectory: false },
        { name: 'src', path: 'src', size: 0, isDirectory: true },
        { name: 'main.ts', path: 'src/main.ts', size: 10, isDirectory: false },
      ]);
      mockStorage.readFile.mockResolvedValueOnce('hello').mockResolvedValueOnce('const x = 1;');
      const res = await app.request('/workspaces/ws-1/download');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.name).toBe('My Project');
      expect(json.id).toBe('ws-1');
      expect(json.files).toHaveLength(2);
      expect(json.totalFiles).toBe(2);
      expect(json.files[0].path).toBe('file1.txt');
      expect(json.files[0].content).toBe('hello');
      expect(mockRepo.logAudit).toHaveBeenCalledWith('download', 'workspace', 'ws-1');
    });
    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/workspaces/ws-1/download');
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('WORKSPACE_NOT_FOUND');
    });
    it('should return 400 when workspace has no files', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.listFiles.mockResolvedValue([]);
      const res = await app.request('/workspaces/ws-1/download');
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('WORKSPACE_EMPTY');
    });
    it('should skip unreadable files during download', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.listFiles.mockResolvedValue([
        { name: 'good.txt', path: 'good.txt', size: 4, isDirectory: false },
        { name: 'bad.bin', path: 'bad.bin', size: 100, isDirectory: false },
      ]);
      mockStorage.readFile
        .mockResolvedValueOnce('good')
        .mockRejectedValueOnce(new Error('unreadable'));
      const res = await app.request('/workspaces/ws-1/download');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.files).toHaveLength(1);
      expect(json.files[0].path).toBe('good.txt');
    });
    it('should return 500 for generic download errors', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.listFiles.mockRejectedValue(new Error('storage error'));
      const res = await app.request('/workspaces/ws-1/download');
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('DOWNLOAD_ERROR');
    });
  });
});
