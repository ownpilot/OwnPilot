/**
 * Workspace Container Routes Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@ownpilot/core', () => ({
  getOrchestrator: vi.fn(),
  isDockerAvailable: vi.fn(),
}));

vi.mock('../../db/repositories/workspaces.js', () => ({
  WorkspacesRepository: vi.fn(),
}));

import { getOrchestrator, isDockerAvailable } from '@ownpilot/core';
import { WorkspacesRepository } from '../../db/repositories/workspaces.js';
import { workspaceContainerRoutes } from './container.js';

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-1', userId: 'user-1', name: 'Test', status: 'active',
    storagePath: '/tmp/ws-1',
    containerConfig: { memoryMB: 512, cpuCores: 1, timeoutMs: 30000 },
    containerId: null as string | null,
    containerStatus: 'stopped',
    createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-02'),
    ...overrides,
  };
}

describe('Workspace Container Routes', () => {
  let app: Hono;
  let mockRepo: Record<string, ReturnType<typeof vi.fn>>;
  let mockOrchestrator: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.use('*', async (c, next) => { c.set('userId', 'user-1'); await next(); });
    app.route('/', workspaceContainerRoutes);
    mockRepo = { get: vi.fn(), logAudit: vi.fn(), updateContainerStatus: vi.fn() };
    vi.mocked(WorkspacesRepository).mockImplementation(() => mockRepo as never);
    mockOrchestrator = {
      createContainer: vi.fn(), stopContainer: vi.fn(),
      getContainerStatus: vi.fn(), getResourceUsage: vi.fn(),
      getContainerLogs: vi.fn(), getActiveContainers: vi.fn(),
    };
    vi.mocked(getOrchestrator).mockReturnValue(mockOrchestrator as never);
    vi.mocked(isDockerAvailable).mockResolvedValue(true);
  });

  describe('POST /:id/container/start', () => {
    it('should start container for a stopped workspace', async () => {
      const ws = makeWorkspace({ containerStatus: 'stopped', containerId: null });
      mockRepo.get.mockResolvedValue(ws);
      mockOrchestrator.createContainer.mockResolvedValue('ctr-new');
      const res = await app.request('/ws-1/container/start', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.containerId).toBe('ctr-new');
      expect(json.data.status).toBe('running');
      expect(mockOrchestrator.createContainer).toHaveBeenCalledWith('user-1', 'ws-1', '/tmp/ws-1', ws.containerConfig);
      expect(mockRepo.updateContainerStatus).toHaveBeenCalledWith('ws-1', 'ctr-new', 'running');
      expect(mockRepo.logAudit).toHaveBeenCalledWith('start', 'container', 'ws-1');
    });
    it('should return existing container if already running', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerStatus: 'running', containerId: 'ctr-existing' }));
      const res = await app.request('/ws-1/container/start', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.containerId).toBe('ctr-existing');
      expect(json.data.message).toBe('Container already running');
      expect(mockOrchestrator.createContainer).not.toHaveBeenCalled();
    });
    it('should return 404 when workspace not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/ws-1/container/start', { method: 'POST' });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('WORKSPACE_NOT_FOUND');
    });
    it('should return 500 when orchestrator throws Error', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockOrchestrator.createContainer.mockRejectedValue(new Error('Docker daemon error'));
      const res = await app.request('/ws-1/container/start', { method: 'POST' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('CONTAINER_START_ERROR');
      expect(json.error.message).toBe('Docker daemon error');
    });
    it('should return 500 with fallback for non-Error throws', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace());
      mockOrchestrator.createContainer.mockRejectedValue('random');
      const res = await app.request('/ws-1/container/start', { method: 'POST' });
      expect(res.status).toBe(500);
      expect((await res.json()).error.message).toBe('Failed to start container');
    });
  });

  describe('POST /:id/container/stop', () => {
    it('should stop a running container', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1' }));
      mockOrchestrator.stopContainer.mockResolvedValue(undefined);
      const res = await app.request('/ws-1/container/stop', { method: 'POST' });
      expect(res.status).toBe(200);
      expect((await res.json()).data.status).toBe('stopped');
      expect(mockOrchestrator.stopContainer).toHaveBeenCalledWith('ctr-1');
      expect(mockRepo.updateContainerStatus).toHaveBeenCalledWith('ws-1', null, 'stopped');
      expect(mockRepo.logAudit).toHaveBeenCalledWith('stop', 'container', 'ws-1');
    });
    it('should succeed when workspace has no container', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: null }));
      const res = await app.request('/ws-1/container/stop', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(mockOrchestrator.stopContainer).not.toHaveBeenCalled();
    });
    it('should return 404 when workspace not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/ws-1/container/stop', { method: 'POST' });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('WORKSPACE_NOT_FOUND');
    });
    it('should return 500 when stop fails', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1' }));
      mockOrchestrator.stopContainer.mockRejectedValue(new Error('Container hung'));
      const res = await app.request('/ws-1/container/stop', { method: 'POST' });
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('CONTAINER_STOP_ERROR');
    });
    it('should return fallback for non-Error stop failure', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1' }));
      mockOrchestrator.stopContainer.mockRejectedValue(42);
      const res = await app.request('/ws-1/container/stop', { method: 'POST' });
      expect(res.status).toBe(500);
      expect((await res.json()).error.message).toBe('Failed to stop container');
    });
  });

  describe('GET /:id/container/status', () => {
    it('should return status for workspace without container', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: null, containerStatus: 'stopped' }));
      const res = await app.request('/ws-1/container/status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('stopped');
      expect(json.data.resourceUsage).toBeNull();
      expect(mockOrchestrator.getContainerStatus).not.toHaveBeenCalled();
    });
    it('should query orchestrator when container exists and status unchanged', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1', containerStatus: 'running' }));
      mockOrchestrator.getContainerStatus.mockResolvedValue('running');
      mockOrchestrator.getResourceUsage.mockResolvedValue({ cpuPercent: 25, memoryMB: 128 });
      const res = await app.request('/ws-1/container/status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('running');
      expect(json.data.resourceUsage).toEqual({ cpuPercent: 25, memoryMB: 128 });
      expect(mockRepo.updateContainerStatus).not.toHaveBeenCalled();
    });
    it('should update DB when container status has changed', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1', containerStatus: 'running' }));
      mockOrchestrator.getContainerStatus.mockResolvedValue('stopped');
      mockOrchestrator.getResourceUsage.mockResolvedValue(null);
      const res = await app.request('/ws-1/container/status');
      expect(res.status).toBe(200);
      expect(mockRepo.updateContainerStatus).toHaveBeenCalledWith('ws-1', 'ctr-1', 'stopped');
    });
    it('should return 404 when workspace not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/ws-1/container/status');
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('WORKSPACE_NOT_FOUND');
    });
    it('should return 500 when orchestrator throws', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1' }));
      mockOrchestrator.getContainerStatus.mockRejectedValue(new Error('timeout'));
      const res = await app.request('/ws-1/container/status');
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('CONTAINER_STATUS_ERROR');
    });
    it('should return 500 with fallback for non-Error failure', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1' }));
      mockOrchestrator.getContainerStatus.mockRejectedValue(undefined);
      const res = await app.request('/ws-1/container/status');
      expect(res.status).toBe(500);
      expect((await res.json()).error.message).toBe('Failed to get container status');
    });
  });

  describe('GET /:id/container/logs', () => {
    it('should return logs with default tail', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1' }));
      mockOrchestrator.getContainerLogs.mockResolvedValue('log output');
      const res = await app.request('/ws-1/container/logs');
      expect(res.status).toBe(200);
      expect((await res.json()).data.logs).toContain('log');
      expect(mockOrchestrator.getContainerLogs).toHaveBeenCalledWith('ctr-1', 100);
    });
    it('should respect custom tail parameter', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1' }));
      mockOrchestrator.getContainerLogs.mockResolvedValue('');
      await app.request('/ws-1/container/logs?tail=50');
      expect(mockOrchestrator.getContainerLogs).toHaveBeenCalledWith('ctr-1', 50);
    });
    it('should clamp tail to max=1000', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1' }));
      mockOrchestrator.getContainerLogs.mockResolvedValue('');
      await app.request('/ws-1/container/logs?tail=5000');
      expect(mockOrchestrator.getContainerLogs).toHaveBeenCalledWith('ctr-1', 1000);
    });
    it('should clamp tail to min=1', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1' }));
      mockOrchestrator.getContainerLogs.mockResolvedValue('');
      await app.request('/ws-1/container/logs?tail=0');
      expect(mockOrchestrator.getContainerLogs).toHaveBeenCalledWith('ctr-1', 1);
    });
    it('should return empty logs when no container', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: null }));
      const res = await app.request('/ws-1/container/logs');
      expect(res.status).toBe(200);
      expect((await res.json()).data.logs).toBe('');
      expect(mockOrchestrator.getContainerLogs).not.toHaveBeenCalled();
    });
    it('should return 404 when workspace not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/ws-1/container/logs');
      expect(res.status).toBe(404);
    });
    it('should return 500 when fetching logs fails', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1' }));
      mockOrchestrator.getContainerLogs.mockRejectedValue(new Error('err'));
      const res = await app.request('/ws-1/container/logs');
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('CONTAINER_LOGS_ERROR');
    });
    it('should return 500 with fallback for non-Error failure', async () => {
      mockRepo.get.mockResolvedValue(makeWorkspace({ containerId: 'ctr-1' }));
      mockOrchestrator.getContainerLogs.mockRejectedValue(null);
      const res = await app.request('/ws-1/container/logs');
      expect(res.status).toBe(500);
      expect((await res.json()).error.message).toBe('Failed to get container logs');
    });
  });

  describe('GET /system/status', () => {
    it('should return Docker available with active containers', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(true);
      mockOrchestrator.getActiveContainers.mockReturnValue([
        { userId: 'u-1', workspaceId: 'ws-1', status: 'running', startedAt: new Date(), lastActivityAt: new Date() },
      ]);
      const res = await app.request('/system/status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.dockerAvailable).toBe(true);
      expect(json.data.activeContainers).toBe(1);
      expect(json.data.containers).toHaveLength(1);
    });
    it('should return empty when none active', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(false);
      mockOrchestrator.getActiveContainers.mockReturnValue([]);
      const res = await app.request('/system/status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.dockerAvailable).toBe(false);
      expect(json.data.activeContainers).toBe(0);
    });
    it('should return 500 when isDockerAvailable throws', async () => {
      vi.mocked(isDockerAvailable).mockRejectedValue(new Error('fail'));
      const res = await app.request('/system/status');
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('SYSTEM_STATUS_ERROR');
    });
    it('should return 500 when getActiveContainers throws', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(true);
      mockOrchestrator.getActiveContainers.mockImplementation(() => { throw new Error('err'); });
      const res = await app.request('/system/status');
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('SYSTEM_STATUS_ERROR');
    });
    it('should return 500 with fallback for non-Error failure', async () => {
      vi.mocked(isDockerAvailable).mockRejectedValue('unknown');
      const res = await app.request('/system/status');
      expect(res.status).toBe(500);
      expect((await res.json()).error.message).toBe('Failed to get system status');
    });
  });
});
