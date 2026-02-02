/**
 * Workspaces Routes Tests
 *
 * Comprehensive test suite for Docker-based workspace management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { workspaceRoutes } from './workspaces.js';

// Mock the core module
vi.mock('@ownpilot/core', () => ({
  getOrchestrator: vi.fn(),
  getWorkspaceStorage: vi.fn(),
  isDockerAvailable: vi.fn(),
  DEFAULT_CONTAINER_CONFIG: {
    image: 'node:18-alpine',
    timeoutMs: 30000,
    maxMemory: '512m',
    maxCpu: 1,
  },
  StorageSecurityError: class StorageSecurityError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'StorageSecurityError';
    }
  },
}));

// Mock the repository
vi.mock('../db/repositories/workspaces.js', () => ({
  WorkspacesRepository: vi.fn(),
}));

import {
  getOrchestrator,
  getWorkspaceStorage,
  isDockerAvailable,
  StorageSecurityError,
} from '@ownpilot/core';
import { WorkspacesRepository } from '../db/repositories/workspaces.js';

describe('Workspaces Routes', () => {
  let app: Hono;
  let mockRepo: any;
  let mockOrchestrator: any;
  let mockStorage: any;

  beforeEach(() => {
    app = new Hono();
    app.route('/workspaces', workspaceRoutes);

    // Create mock repository instance
    mockRepo = {
      list: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      logAudit: vi.fn(),
      updateContainerStatus: vi.fn(),
      createExecution: vi.fn(),
      updateExecution: vi.fn(),
      listExecutions: vi.fn(),
      countExecutions: vi.fn(),
    };

    // Mock WorkspacesRepository constructor
    vi.mocked(WorkspacesRepository).mockImplementation(() => mockRepo);

    // Create mock orchestrator
    mockOrchestrator = {
      createContainer: vi.fn(),
      executeInContainer: vi.fn(),
      stopContainer: vi.fn(),
      getContainerStatus: vi.fn(),
      getResourceUsage: vi.fn(),
      getContainerLogs: vi.fn(),
      getActiveContainers: vi.fn(),
    };
    vi.mocked(getOrchestrator).mockReturnValue(mockOrchestrator);

    // Create mock storage
    mockStorage = {
      createUserStorage: vi.fn(),
      listFiles: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      deleteFile: vi.fn(),
      getFileInfo: vi.fn(),
      getStorageUsage: vi.fn(),
    };
    vi.mocked(getWorkspaceStorage).mockReturnValue(mockStorage);

    // Mock Docker availability
    vi.mocked(isDockerAvailable).mockResolvedValue(true);

    vi.clearAllMocks();
  });

  describe('GET /workspaces - List workspaces', () => {
    it('should return list of workspaces', async () => {
      const mockWorkspaces = [
        {
          id: 'ws-1',
          userId: 'user-1',
          name: 'Workspace 1',
          description: 'Test workspace',
          status: 'active',
          storagePath: '/tmp/ws-1',
          containerConfig: {},
          containerId: 'container-1',
          containerStatus: 'running',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02'),
        },
      ];
      mockRepo.list.mockResolvedValue(mockWorkspaces);

      const res = await app.request('/workspaces');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.workspaces).toHaveLength(1);
      expect(data.data.workspaces[0].id).toBe('ws-1');
      expect(data.data.count).toBe(1);
    });

    it('should handle empty workspace list', async () => {
      mockRepo.list.mockResolvedValue([]);

      const res = await app.request('/workspaces');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.workspaces).toEqual([]);
      expect(data.data.count).toBe(0);
    });

    it('should handle list error', async () => {
      mockRepo.list.mockRejectedValue(new Error('Database error'));

      const res = await app.request('/workspaces');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('WORKSPACE_LIST_ERROR');
    });
  });

  describe('POST /workspaces - Create workspace', () => {
    it('should create workspace successfully', async () => {
      mockRepo.count.mockResolvedValue(2);
      mockStorage.createUserStorage.mockResolvedValue('/tmp/user-1/ws-123');
      mockRepo.create.mockResolvedValue({
        id: 'ws-123',
        userId: 'default-user',
        name: 'New Workspace',
        description: 'Test',
        status: 'active',
        storagePath: '/tmp/user-1/ws-123',
        containerConfig: {},
        containerStatus: 'stopped',
        createdAt: new Date('2024-01-01'),
      });

      const res = await app.request('/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Workspace',
          description: 'Test',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.name).toBe('New Workspace');
      expect(mockRepo.logAudit).toHaveBeenCalledWith('create', 'workspace', 'ws-123');
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('INVALID_INPUT');
      expect(data.error.message).toContain('name is required');
    });

    it('should return 400 when workspace limit exceeded', async () => {
      mockRepo.count.mockResolvedValue(5);

      const res = await app.request('/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_LIMIT_EXCEEDED');
    });

    it('should handle creation error', async () => {
      mockRepo.count.mockResolvedValue(1);
      mockStorage.createUserStorage.mockRejectedValue(new Error('Storage error'));

      const res = await app.request('/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_CREATE_ERROR');
    });
  });

  describe('GET /workspaces/:id - Get workspace', () => {
    it('should return workspace details with storage usage', async () => {
      const mockWorkspace = {
        id: 'ws-123',
        userId: 'user-1',
        name: 'Test Workspace',
        description: 'Test',
        status: 'active',
        storagePath: '/tmp/ws-123',
        containerConfig: {},
        containerId: 'container-1',
        containerStatus: 'running',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };
      mockRepo.get.mockResolvedValue(mockWorkspace);
      mockStorage.getStorageUsage.mockResolvedValue({ size: 1024, files: 5 });

      const res = await app.request('/workspaces/ws-123');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('ws-123');
      expect(data.data.storageUsage).toEqual({ size: 1024, files: 5 });
    });

    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workspaces/ws-nonexistent');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should handle fetch error', async () => {
      mockRepo.get.mockRejectedValue(new Error('Database error'));

      const res = await app.request('/workspaces/ws-123');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_FETCH_ERROR');
    });
  });

  describe('PATCH /workspaces/:id - Update workspace', () => {
    it('should update workspace name and description', async () => {
      mockRepo.get.mockResolvedValue({
        id: 'ws-123',
        containerConfig: { image: 'node:18' },
      });
      mockRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/workspaces/ws-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Name',
          description: 'Updated description',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.updated).toBe(true);
      expect(mockRepo.update).toHaveBeenCalledWith('ws-123', {
        name: 'Updated Name',
        description: 'Updated description',
      });
    });

    it('should update container config', async () => {
      mockRepo.get.mockResolvedValue({
        id: 'ws-123',
        containerConfig: { image: 'node:18', maxMemory: '512m' },
      });

      const res = await app.request('/workspaces/ws-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          containerConfig: { maxMemory: '1g' },
        }),
      });

      expect(res.status).toBe(200);
      expect(mockRepo.update).toHaveBeenCalledWith('ws-123', {
        containerConfig: { image: 'node:18', maxMemory: '1g' },
      });
    });

    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workspaces/ws-nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should handle update error', async () => {
      mockRepo.get.mockResolvedValue({ id: 'ws-123' });
      mockRepo.update.mockRejectedValue(new Error('Update failed'));

      const res = await app.request('/workspaces/ws-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_UPDATE_ERROR');
    });
  });

  describe('DELETE /workspaces/:id - Delete workspace', () => {
    it('should delete workspace and stop container', async () => {
      mockRepo.get.mockResolvedValue({
        id: 'ws-123',
        containerId: 'container-1',
      });
      mockOrchestrator.stopContainer.mockResolvedValue(undefined);
      mockRepo.delete.mockResolvedValue(undefined);

      const res = await app.request('/workspaces/ws-123', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.deleted).toBe(true);
      expect(mockOrchestrator.stopContainer).toHaveBeenCalledWith('container-1');
      expect(mockRepo.delete).toHaveBeenCalledWith('ws-123');
    });

    it('should delete workspace without container', async () => {
      mockRepo.get.mockResolvedValue({
        id: 'ws-123',
        containerId: null,
      });

      const res = await app.request('/workspaces/ws-123', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      expect(mockOrchestrator.stopContainer).not.toHaveBeenCalled();
      expect(mockRepo.delete).toHaveBeenCalledWith('ws-123');
    });

    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workspaces/ws-nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should handle deletion error', async () => {
      mockRepo.get.mockResolvedValue({ id: 'ws-123' });
      mockRepo.delete.mockRejectedValue(new Error('Delete failed'));

      const res = await app.request('/workspaces/ws-123', {
        method: 'DELETE',
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_DELETE_ERROR');
    });
  });

  describe('GET /workspaces/:id/files - List files', () => {
    it('should list files in workspace', async () => {
      mockRepo.get.mockResolvedValue({ id: 'ws-123' });
      mockStorage.listFiles.mockResolvedValue([
        { name: 'file1.txt', path: 'file1.txt', size: 100 },
        { name: 'file2.js', path: 'file2.js', size: 200 },
      ]);

      const res = await app.request('/workspaces/ws-123/files');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.files).toHaveLength(2);
      expect(data.data.count).toBe(2);
    });

    it('should list files with path and recursive params', async () => {
      mockRepo.get.mockResolvedValue({ id: 'ws-123' });
      mockStorage.listFiles.mockResolvedValue([]);

      const res = await app.request('/workspaces/ws-123/files?path=src&recursive=true');

      expect(res.status).toBe(200);
      expect(mockStorage.listFiles).toHaveBeenCalledWith('default-user/ws-123', 'src', true);
    });

    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workspaces/ws-123/files');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should return 403 for storage security error', async () => {
      mockRepo.get.mockResolvedValue({ id: 'ws-123' });
      mockStorage.listFiles.mockImplementation(() => {
        throw new StorageSecurityError('Path traversal attempt');
      });

      const res = await app.request('/workspaces/ws-123/files');

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe('ACCESS_DENIED');
    });
  });

  describe('POST /workspaces/:id/execute - Execute code', () => {
    it('should execute code successfully', async () => {
      mockRepo.get.mockResolvedValue({
        id: 'ws-123',
        storagePath: '/tmp/ws-123',
        containerConfig: {},
        containerId: 'container-1',
      });
      mockRepo.createExecution.mockResolvedValue({
        id: 'exec-1',
        codeHash: 'abc123',
      });
      mockOrchestrator.executeInContainer.mockResolvedValue({
        status: 'completed',
        stdout: 'Hello, World!',
        stderr: '',
        exitCode: 0,
        executionTimeMs: 150,
      });

      const res = await app.request('/workspaces/ws-123/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'console.log("Hello, World!")',
          language: 'javascript',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('completed');
      expect(data.data.stdout).toBe('Hello, World!');
      expect(data.data.exitCode).toBe(0);
    });

    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workspaces/ws-123/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'print("test")',
          language: 'python',
        }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('should return 503 when Docker unavailable', async () => {
      mockRepo.get.mockResolvedValue({ id: 'ws-123' });
      vi.mocked(isDockerAvailable).mockResolvedValue(false);

      const res = await app.request('/workspaces/ws-123/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'test',
          language: 'python',
        }),
      });

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error.code).toBe('DOCKER_UNAVAILABLE');
    });

    it('should return 400 for missing code or language', async () => {
      mockRepo.get.mockResolvedValue({ id: 'ws-123' });

      const res = await app.request('/workspaces/ws-123/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'test' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('INVALID_INPUT');
    });

    it('should return 400 for invalid language', async () => {
      mockRepo.get.mockResolvedValue({ id: 'ws-123' });

      const res = await app.request('/workspaces/ws-123/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'test',
          language: 'invalid',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('INVALID_LANGUAGE');
    });

    it('should create container if not exists', async () => {
      mockRepo.get.mockResolvedValue({
        id: 'ws-123',
        storagePath: '/tmp/ws-123',
        containerConfig: {},
        containerId: null,
      });
      mockOrchestrator.createContainer.mockResolvedValue('new-container-1');
      mockRepo.createExecution.mockResolvedValue({ id: 'exec-1', codeHash: 'abc' });
      mockOrchestrator.executeInContainer.mockResolvedValue({
        status: 'completed',
        stdout: '',
        stderr: '',
        exitCode: 0,
        executionTimeMs: 100,
      });

      const res = await app.request('/workspaces/ws-123/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'test',
          language: 'python',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockOrchestrator.createContainer).toHaveBeenCalled();
      expect(mockRepo.updateContainerStatus).toHaveBeenCalledWith('ws-123', 'new-container-1', 'running');
    });
  });

  describe('GET /workspaces/:id/executions - List executions', () => {
    it('should list executions with default limit', async () => {
      mockRepo.get.mockResolvedValue({ id: 'ws-123' });
      mockRepo.listExecutions.mockResolvedValue([
        {
          id: 'exec-1',
          workspaceId: 'ws-123',
          userId: 'user-1',
          language: 'python',
          codeHash: 'abc123',
          status: 'completed',
          stdout: 'output',
          stderr: '',
          exitCode: 0,
          executionTimeMs: 150,
          createdAt: new Date('2024-01-01'),
        },
      ]);

      const res = await app.request('/workspaces/ws-123/executions');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.executions).toHaveLength(1);
      expect(mockRepo.listExecutions).toHaveBeenCalledWith('ws-123', 50);
    });

    it('should list executions with custom limit', async () => {
      mockRepo.get.mockResolvedValue({ id: 'ws-123' });
      mockRepo.listExecutions.mockResolvedValue([]);

      const res = await app.request('/workspaces/ws-123/executions?limit=100');

      expect(res.status).toBe(200);
      expect(mockRepo.listExecutions).toHaveBeenCalledWith('ws-123', 100);
    });

    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workspaces/ws-123/executions');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });
  });

  describe('POST /workspaces/:id/container/start - Start container', () => {
    it('should start container successfully', async () => {
      mockRepo.get.mockResolvedValue({
        id: 'ws-123',
        storagePath: '/tmp/ws-123',
        containerConfig: {},
        containerStatus: 'stopped',
      });
      mockOrchestrator.createContainer.mockResolvedValue('container-1');

      const res = await app.request('/workspaces/ws-123/container/start', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.containerId).toBe('container-1');
      expect(data.data.status).toBe('running');
      expect(mockRepo.updateContainerStatus).toHaveBeenCalledWith('ws-123', 'container-1', 'running');
    });

    it('should return existing container if already running', async () => {
      mockRepo.get.mockResolvedValue({
        id: 'ws-123',
        containerId: 'existing-container',
        containerStatus: 'running',
      });

      const res = await app.request('/workspaces/ws-123/container/start', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.data.containerId).toBe('existing-container');
      expect(data.data.data.status).toBe('running');
      expect(mockOrchestrator.createContainer).not.toHaveBeenCalled();
    });

    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workspaces/ws-123/container/start', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });
  });

  describe('POST /workspaces/:id/container/stop - Stop container', () => {
    it('should stop container successfully', async () => {
      mockRepo.get.mockResolvedValue({
        id: 'ws-123',
        containerId: 'container-1',
      });
      mockOrchestrator.stopContainer.mockResolvedValue(undefined);

      const res = await app.request('/workspaces/ws-123/container/stop', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('stopped');
      expect(mockOrchestrator.stopContainer).toHaveBeenCalledWith('container-1');
      expect(mockRepo.updateContainerStatus).toHaveBeenCalledWith('ws-123', null, 'stopped');
    });

    it('should handle workspace without container', async () => {
      mockRepo.get.mockResolvedValue({
        id: 'ws-123',
        containerId: null,
      });

      const res = await app.request('/workspaces/ws-123/container/stop', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      expect(mockOrchestrator.stopContainer).not.toHaveBeenCalled();
    });

    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workspaces/ws-123/container/stop', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('WORKSPACE_NOT_FOUND');
    });
  });

  describe('GET /workspaces/system/status - System status', () => {
    it('should return system status', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(true);
      mockOrchestrator.getActiveContainers.mockReturnValue([
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          status: 'running',
          startedAt: new Date('2024-01-01'),
          lastActivityAt: new Date('2024-01-01'),
        },
      ]);

      const res = await app.request('/workspaces/system/status');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.dockerAvailable).toBe(true);
      expect(data.data.activeContainers).toBe(1);
      expect(data.data.containers).toHaveLength(1);
    });

    it('should handle system status error', async () => {
      vi.mocked(isDockerAvailable).mockRejectedValue(new Error('Docker check failed'));

      const res = await app.request('/workspaces/system/status');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe('SYSTEM_STATUS_ERROR');
    });
  });
});
