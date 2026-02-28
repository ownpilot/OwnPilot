/**
 * Workspace Execution Routes Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@ownpilot/core', () => ({
  getOrchestrator: vi.fn(),
  getWorkspaceStorage: vi.fn(),
  isDockerAvailable: vi.fn(),
}));

vi.mock('../../db/repositories/workspaces.js', () => ({
  WorkspacesRepository: vi.fn(function () {}),
}));

import { getOrchestrator, getWorkspaceStorage, isDockerAvailable } from '@ownpilot/core';
import { WorkspacesRepository } from '../../db/repositories/workspaces.js';
import { workspaceExecutionRoutes } from './execution.js';

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-1',
    userId: 'user-1',
    name: 'Test',
    status: 'active',
    storagePath: '/tmp/ws-1',
    containerConfig: { memoryMB: 512, cpuCores: 1, timeoutMs: 30000 },
    containerId: null as string | null,
    containerStatus: 'stopped',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...overrides,
  };
}

describe('Workspace Execution Routes', () => {
  let app: Hono;
  let mockRepo: Record<string, ReturnType<typeof vi.fn>>;
  let mockOrchestrator: Record<string, ReturnType<typeof vi.fn>>;
  let mockStorage: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userId', 'user-1');
      await next();
    });
    app.route('/', workspaceExecutionRoutes);
    mockRepo = {
      get: vi.fn(),
      logAudit: vi.fn(),
      updateContainerStatus: vi.fn(),
      createExecution: vi.fn(),
      updateExecution: vi.fn(),
      listExecutions: vi.fn(),
      countExecutions: vi.fn(),
    };
    vi.mocked(WorkspacesRepository).mockImplementation(function () {
      return mockRepo as never;
    });
    mockOrchestrator = {
      createContainer: vi.fn(),
      executeInContainer: vi.fn(),
    };
    vi.mocked(getOrchestrator).mockReturnValue(mockOrchestrator as never);
    mockStorage = {
      listFiles: vi.fn(),
      getStorageUsage: vi.fn(),
      writeFile: vi.fn(),
    };
    vi.mocked(getWorkspaceStorage).mockReturnValue(mockStorage as never);
    vi.mocked(isDockerAvailable).mockResolvedValue(true);
  });

  // =========================================================================
  // GET /:id/stats
  // =========================================================================
  describe('GET /:id/stats', () => {
    it('should return workspace statistics', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.listFiles.mockResolvedValue([
        { name: 'main.ts', path: 'main.ts', size: 100, isDirectory: false },
        { name: 'util.js', path: 'util.js', size: 50, isDirectory: false },
        { name: 'src', path: 'src', size: 0, isDirectory: true },
        { name: 'readme.md', path: 'readme.md', size: 200, isDirectory: false },
      ]);
      mockStorage.getStorageUsage.mockResolvedValue({ totalBytes: 350, fileCount: 3 });
      mockRepo.countExecutions.mockResolvedValue(10);
      const res = await app.request('/ws-1/stats');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.fileCount).toBe(3);
      expect(json.data.directoryCount).toBe(1);
      expect(json.data.storageUsage).toEqual({ totalBytes: 350, fileCount: 3 });
      expect(json.data.fileTypes).toEqual({ ts: 1, js: 1, md: 1 });
      expect(json.data.executionCount).toBe(10);
    });
    it('should handle files without extensions', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.listFiles.mockResolvedValue([
        { name: 'Makefile', path: 'Makefile', size: 100, isDirectory: false },
      ]);
      mockStorage.getStorageUsage.mockResolvedValue({ totalBytes: 100 });
      mockRepo.countExecutions.mockResolvedValue(0);
      const res = await app.request('/ws-1/stats');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.fileTypes).toEqual({ makefile: 1 });
    });
    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/ws-1/stats');
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('WORKSPACE_NOT_FOUND');
    });
    it('should return 500 for generic stats errors', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockStorage.listFiles.mockRejectedValue(new Error('storage error'));
      const res = await app.request('/ws-1/stats');
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('STATS_ERROR');
    });
  });

  // =========================================================================
  // POST /:id/execute
  // =========================================================================
  describe('POST /:id/execute', () => {
    it('should execute code successfully with existing container', async () => {
      mockRepo.get.mockResolvedValue(
        makeWorkspace({ containerId: 'ctr-1', containerConfig: { timeoutMs: 30000 } })
      );
      mockRepo.createExecution.mockResolvedValue({ id: 'exec-1', codeHash: 'abc12345' });
      mockOrchestrator.executeInContainer.mockResolvedValue({
        status: 'completed',
        stdout: 'Hello',
        stderr: '',
        exitCode: 0,
        executionTimeMs: 150,
      });
      const res = await app.request('/ws-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'console.log("Hello")', language: 'javascript' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.executionId).toBe('exec-1');
      expect(json.data.status).toBe('completed');
      expect(json.data.stdout).toBe('Hello');
      expect(json.data.exitCode).toBe(0);
      expect(mockRepo.updateExecution).toHaveBeenCalledWith(
        'exec-1',
        'completed',
        'Hello',
        '',
        0,
        150
      );
      expect(mockRepo.logAudit).toHaveBeenCalled();
    });
    it('should create container if not exists', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: null, containerConfig: {} }));
      mockOrchestrator.createContainer.mockResolvedValue('new-ctr');
      mockRepo.createExecution.mockResolvedValue({ id: 'exec-1', codeHash: 'abc' });
      mockOrchestrator.executeInContainer.mockResolvedValue({
        status: 'completed',
        stdout: '',
        stderr: '',
        exitCode: 0,
        executionTimeMs: 100,
      });
      const res = await app.request('/ws-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'print("hi")', language: 'python' }),
      });
      expect(res.status).toBe(200);
      expect(mockOrchestrator.createContainer).toHaveBeenCalled();
      expect(mockRepo.updateContainerStatus).toHaveBeenCalledWith('ws-1', 'new-ctr', 'running');
    });
    it('should write files if provided', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1', containerConfig: {} }));
      mockRepo.createExecution.mockResolvedValue({ id: 'exec-1', codeHash: 'abc' });
      mockOrchestrator.executeInContainer.mockResolvedValue({
        status: 'completed',
        stdout: '',
        stderr: '',
        exitCode: 0,
        executionTimeMs: 50,
      });
      const res = await app.request('/ws-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'import helper',
          language: 'python',
          files: [{ path: 'helper.py', content: 'def foo(): pass' }],
        }),
      });
      expect(res.status).toBe(200);
      expect(mockStorage.writeFile).toHaveBeenCalledWith(
        'user-1/ws-1',
        'helper.py',
        'def foo(): pass'
      );
    });
    it('should use custom timeout from body', async () => {
      mockRepo.get.mockResolvedValue(
        makeWorkspace({ containerId: 'ctr-1', containerConfig: { timeoutMs: 30000 } })
      );
      mockRepo.createExecution.mockResolvedValue({ id: 'exec-1', codeHash: 'abc' });
      mockOrchestrator.executeInContainer.mockResolvedValue({
        status: 'completed',
        stdout: '',
        stderr: '',
        exitCode: 0,
        executionTimeMs: 50,
      });
      const res = await app.request('/ws-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'echo hi', language: 'shell', timeout: 5000 }),
      });
      expect(res.status).toBe(200);
      expect(mockOrchestrator.executeInContainer).toHaveBeenCalledWith(
        'ctr-1',
        'echo hi',
        'shell',
        5000
      );
    });
    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/ws-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'test', language: 'python' }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('WORKSPACE_NOT_FOUND');
    });
    it('should return 503 when Docker unavailable', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      vi.mocked(isDockerAvailable).mockResolvedValue(false);
      const res = await app.request('/ws-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'test', language: 'python' }),
      });
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe('DOCKER_UNAVAILABLE');
    });
    it('should return 400 for invalid language', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      const res = await app.request('/ws-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'test', language: 'invalid' }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('INVALID_INPUT');
    });
    it('should return 400 for missing code', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      const res = await app.request('/ws-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'python' }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('INVALID_INPUT');
    });
    it('should return 400 for missing body', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      const res = await app.request('/ws-1/execute', { method: 'POST' });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('INVALID_INPUT');
    });
    it('should return 500 for execution errors and log audit', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1', containerConfig: {} }));
      mockRepo.createExecution.mockRejectedValue(new Error('DB error'));
      const res = await app.request('/ws-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'test', language: 'python' }),
      });
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('EXECUTION_ERROR');
      expect(mockRepo.logAudit).toHaveBeenCalledWith(
        'execute',
        'execution',
        undefined,
        false,
        'DB error'
      );
    });
  });

  // =========================================================================
  // GET /:id/executions
  // =========================================================================
  describe('GET /:id/executions', () => {
    it('should list executions with default limit', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockRepo.listExecutions.mockResolvedValue([
        {
          id: 'exec-1',
          workspaceId: 'ws-1',
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
      const res = await app.request('/ws-1/executions');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.executions).toHaveLength(1);
      expect(json.data.count).toBe(1);
      expect(json.data.executions[0].id).toBe('exec-1');
      expect(json.data.executions[0].createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(mockRepo.listExecutions).toHaveBeenCalledWith('ws-1', 50);
    });
    it('should list executions with custom limit', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockRepo.listExecutions.mockResolvedValue([]);
      const res = await app.request('/ws-1/executions?limit=100');
      expect(res.status).toBe(200);
      expect(mockRepo.listExecutions).toHaveBeenCalledWith('ws-1', 100);
    });
    it('should clamp limit to max=200', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockRepo.listExecutions.mockResolvedValue([]);
      await app.request('/ws-1/executions?limit=500');
      expect(mockRepo.listExecutions).toHaveBeenCalledWith('ws-1', 200);
    });
    it('should clamp limit to min=1', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockRepo.listExecutions.mockResolvedValue([]);
      await app.request('/ws-1/executions?limit=0');
      expect(mockRepo.listExecutions).toHaveBeenCalledWith('ws-1', 1);
    });
    it('should return 404 for non-existent workspace', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/ws-1/executions');
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('WORKSPACE_NOT_FOUND');
    });
    it('should return 500 for generic errors', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockRepo.listExecutions.mockRejectedValue(new Error('DB error'));
      const res = await app.request('/ws-1/executions');
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('EXECUTIONS_LIST_ERROR');
    });
  });
});
