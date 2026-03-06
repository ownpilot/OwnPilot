/**
 * Workspace CRUD Routes Tests
 *
 * Integration tests for:
 *   GET /         — list user's workspaces
 *   POST /        — create a new workspace
 *   GET /:id      — get workspace details with storage usage
 *   PATCH /:id    — update workspace
 *   DELETE /:id   — delete workspace (with/without container)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const { mockRepo, mockOrchestrator, mockStorage, MockWorkspacesRepository } = vi.hoisted(() => {
  const mockRepo = {
    list: vi.fn(),
    count: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    logAudit: vi.fn(),
  };

  const mockOrchestrator = {
    stopContainer: vi.fn(async () => {}),
  };

  const mockStorage = {
    createUserStorage: vi.fn(async () => '/tmp/storage'),
    getStorageUsage: vi.fn(async () => ({ used: 100, limit: 1000 })),
  };

  const MockWorkspacesRepository = vi.fn(function () {
    return mockRepo;
  });

  return { mockRepo, mockOrchestrator, mockStorage, MockWorkspacesRepository };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../db/repositories/workspaces.js', () => ({
  WorkspacesRepository: MockWorkspacesRepository,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getOrchestrator: vi.fn(() => mockOrchestrator),
    getWorkspaceStorage: vi.fn(() => mockStorage),
    DEFAULT_CONTAINER_CONFIG: {},
  };
});

vi.mock('./shared.js', () => ({
  sanitizeContainerConfig: vi.fn((base: object, override?: object) => ({
    ...base,
    ...(override ?? {}),
  })),
}));

vi.mock('../../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

vi.mock('../../middleware/validation.js', () => ({
  validateBody: vi.fn((_schema: unknown, data: unknown) => data),
  createWorkspaceSchema: {},
  updateWorkspaceSchema: {},
}));

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are in place)
// ---------------------------------------------------------------------------

const { workspaceCrudRoutes } = await import('./crud.js');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const sampleWorkspace = {
  id: 'ws-1',
  userId: 'user-1',
  name: 'My Workspace',
  description: 'Test workspace',
  status: 'active',
  storagePath: '/tmp/storage',
  containerConfig: {},
  containerId: null as string | null,
  containerStatus: null as string | null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', workspaceCrudRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Helper to make JSON requests
// ---------------------------------------------------------------------------

function jsonRequest(method: string, body: unknown) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Workspace CRUD Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();

    // Default happy-path behaviours
    mockRepo.list.mockResolvedValue([sampleWorkspace]);
    mockRepo.count.mockResolvedValue(0);
    mockRepo.get.mockResolvedValue(sampleWorkspace);
    mockRepo.create.mockResolvedValue(sampleWorkspace);
    mockRepo.update.mockResolvedValue(sampleWorkspace);
    mockRepo.delete.mockResolvedValue(true);
    mockRepo.logAudit.mockResolvedValue(undefined);
    mockStorage.createUserStorage.mockResolvedValue('/tmp/storage');
    mockStorage.getStorageUsage.mockResolvedValue({ used: 100, limit: 1000 });
    mockOrchestrator.stopContainer.mockResolvedValue(undefined);
  });

  // =========================================================================
  // GET /
  // =========================================================================

  describe('GET /', () => {
    it('returns 200 with a list of workspaces', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.workspaces).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });

    it('returns workspace fields as ISO strings for dates', async () => {
      const res = await app.request('/');
      const json = await res.json();
      const ws = json.data.workspaces[0];
      expect(ws.id).toBe('ws-1');
      expect(ws.name).toBe('My Workspace');
      expect(ws.createdAt).toBe(new Date('2026-01-01').toISOString());
      expect(ws.updatedAt).toBe(new Date('2026-01-01').toISOString());
    });

    it('returns empty list when user has no workspaces', async () => {
      mockRepo.list.mockResolvedValue([]);
      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.workspaces).toHaveLength(0);
      expect(json.data.count).toBe(0);
    });

    it('returns 500 with WORKSPACE_LIST_ERROR when repo throws', async () => {
      mockRepo.list.mockRejectedValue(new Error('DB failure'));
      const res = await app.request('/');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('WORKSPACE_LIST_ERROR');
      expect(json.error.message).toBe('DB failure');
    });

    it('returns 500 with fallback message for non-Error throws on list', async () => {
      mockRepo.list.mockRejectedValue('unknown');
      const res = await app.request('/');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toBe('Failed to list workspaces');
    });
  });

  // =========================================================================
  // POST /
  // =========================================================================

  describe('POST /', () => {
    it('returns 201 with created workspace on valid input', async () => {
      const res = await app.request('/', jsonRequest('POST', { name: 'New WS' }));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('ws-1');
      expect(json.data.name).toBe('My Workspace');
      expect(json.data.createdAt).toBe(new Date('2026-01-01').toISOString());
    });

    it('calls repo.create with sanitized containerConfig and storagePath', async () => {
      await app.request('/', jsonRequest('POST', { name: 'New WS' }));
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New WS',
          storagePath: '/tmp/storage',
          containerConfig: expect.any(Object),
        })
      );
    });

    it('logs audit and broadcasts websocket event on create', async () => {
      const { wsGateway } = await import('../../ws/server.js');
      await app.request('/', jsonRequest('POST', { name: 'New WS' }));
      expect(mockRepo.logAudit).toHaveBeenCalledWith('create', 'workspace', 'ws-1');
      expect(wsGateway.broadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ entity: 'workspace', action: 'created', id: 'ws-1' })
      );
    });

    it('returns 400 when body is missing (no Content-Type)', async () => {
      const res = await app.request('/', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when workspace limit is reached (count >= 5)', async () => {
      mockRepo.count.mockResolvedValue(5);
      const res = await app.request('/', jsonRequest('POST', { name: 'New WS' }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('WORKSPACE_LIMIT_EXCEEDED');
      expect(json.error.message).toContain('5');
    });

    it('returns 400 when count equals exactly 5', async () => {
      mockRepo.count.mockResolvedValue(5);
      const res = await app.request('/', jsonRequest('POST', { name: 'Sixth WS' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for validation error from validateBody', async () => {
      const { validateBody } = await import('../../middleware/validation.js');
      vi.mocked(validateBody).mockImplementationOnce(() => {
        throw new Error('Validation failed: name is required');
      });
      const res = await app.request('/', jsonRequest('POST', {}));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 500 with WORKSPACE_CREATE_ERROR on repo.create failure', async () => {
      mockRepo.create.mockRejectedValue(new Error('Insert failed'));
      const res = await app.request('/', jsonRequest('POST', { name: 'New WS' }));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('WORKSPACE_CREATE_ERROR');
      expect(json.error.message).toBe('Insert failed');
    });

    it('logs failed audit when create throws', async () => {
      mockRepo.create.mockRejectedValue(new Error('Insert failed'));
      await app.request('/', jsonRequest('POST', { name: 'New WS' }));
      expect(mockRepo.logAudit).toHaveBeenCalledWith(
        'create',
        'workspace',
        undefined,
        false,
        'Insert failed'
      );
    });
  });

  // =========================================================================
  // GET /:id
  // =========================================================================

  describe('GET /:id', () => {
    it('returns 200 with workspace details including storageUsage', async () => {
      const res = await app.request('/ws-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('ws-1');
      expect(json.data.storageUsage).toEqual({ used: 100, limit: 1000 });
    });

    it('includes all expected workspace fields', async () => {
      const res = await app.request('/ws-1');
      const json = await res.json();
      const ws = json.data;
      expect(ws).toHaveProperty('id');
      expect(ws).toHaveProperty('userId');
      expect(ws).toHaveProperty('name');
      expect(ws).toHaveProperty('description');
      expect(ws).toHaveProperty('status');
      expect(ws).toHaveProperty('storagePath');
      expect(ws).toHaveProperty('containerConfig');
      expect(ws).toHaveProperty('createdAt');
      expect(ws).toHaveProperty('updatedAt');
      expect(ws).toHaveProperty('storageUsage');
    });

    it('returns 404 with WORKSPACE_NOT_FOUND when workspace does not exist', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/ws-missing');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('returns 500 with WORKSPACE_FETCH_ERROR on repo.get failure', async () => {
      mockRepo.get.mockRejectedValue(new Error('DB error'));
      const res = await app.request('/ws-1');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('WORKSPACE_FETCH_ERROR');
      expect(json.error.message).toBe('DB error');
    });

    it('returns 500 with fallback message for non-Error get failure', async () => {
      mockRepo.get.mockRejectedValue(null);
      const res = await app.request('/ws-1');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toBe('Failed to fetch workspace');
    });

    it('calls getStorageUsage with userId/workspaceId path', async () => {
      await app.request('/ws-1');
      expect(mockStorage.getStorageUsage).toHaveBeenCalledWith('user-1/ws-1');
    });
  });

  // =========================================================================
  // PATCH /:id
  // =========================================================================

  describe('PATCH /:id', () => {
    it('returns 200 with updated:true on successful update', async () => {
      const res = await app.request('/ws-1', jsonRequest('PATCH', { name: 'Updated Name' }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.updated).toBe(true);
    });

    it('calls repo.update with provided name field', async () => {
      await app.request('/ws-1', jsonRequest('PATCH', { name: 'New Name' }));
      expect(mockRepo.update).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ name: 'New Name' })
      );
    });

    it('calls repo.update with provided description field', async () => {
      await app.request('/ws-1', jsonRequest('PATCH', { description: 'New description' }));
      expect(mockRepo.update).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ description: 'New description' })
      );
    });

    it('does not call repo.update when no updatable fields present', async () => {
      await app.request('/ws-1', jsonRequest('PATCH', {}));
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('logs audit and broadcasts websocket event on update', async () => {
      const { wsGateway } = await import('../../ws/server.js');
      await app.request('/ws-1', jsonRequest('PATCH', { name: 'Updated' }));
      expect(mockRepo.logAudit).toHaveBeenCalledWith('write', 'workspace', 'ws-1');
      expect(wsGateway.broadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ entity: 'workspace', action: 'updated', id: 'ws-1' })
      );
    });

    it('returns 400 when body is missing (no Content-Type)', async () => {
      const res = await app.request('/ws-1', { method: 'PATCH' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for validation error thrown by validateBody', async () => {
      const { validateBody } = await import('../../middleware/validation.js');
      vi.mocked(validateBody).mockImplementationOnce(() => {
        throw new Error('Validation failed: invalid field');
      });
      const res = await app.request('/ws-1', jsonRequest('PATCH', { bad: true }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 404 when workspace is not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/ws-missing', jsonRequest('PATCH', { name: 'X' }));
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('returns 500 with WORKSPACE_UPDATE_ERROR on repo.update failure', async () => {
      mockRepo.update.mockRejectedValue(new Error('Update failed'));
      const res = await app.request('/ws-1', jsonRequest('PATCH', { name: 'X' }));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('WORKSPACE_UPDATE_ERROR');
    });

    it('returns 500 with fallback message for non-Error update failure', async () => {
      mockRepo.update.mockRejectedValue('oops');
      const res = await app.request('/ws-1', jsonRequest('PATCH', { name: 'X' }));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toBe('Failed to update workspace');
    });
  });

  // =========================================================================
  // DELETE /:id
  // =========================================================================

  describe('DELETE /:id', () => {
    it('returns 200 with deleted:true when workspace has no container', async () => {
      mockRepo.get.mockResolvedValue({ ...sampleWorkspace, containerId: null });
      const res = await app.request('/ws-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });

    it('does not call stopContainer when workspace has no containerId', async () => {
      mockRepo.get.mockResolvedValue({ ...sampleWorkspace, containerId: null });
      await app.request('/ws-1', { method: 'DELETE' });
      expect(mockOrchestrator.stopContainer).not.toHaveBeenCalled();
    });

    it('calls stopContainer with containerId when workspace has a running container', async () => {
      mockRepo.get.mockResolvedValue({ ...sampleWorkspace, containerId: 'ctr-abc' });
      await app.request('/ws-1', { method: 'DELETE' });
      expect(mockOrchestrator.stopContainer).toHaveBeenCalledWith('ctr-abc');
    });

    it('calls repo.delete after stopping container', async () => {
      mockRepo.get.mockResolvedValue({ ...sampleWorkspace, containerId: 'ctr-abc' });
      await app.request('/ws-1', { method: 'DELETE' });
      expect(mockRepo.delete).toHaveBeenCalledWith('ws-1');
    });

    it('logs audit and broadcasts websocket event on delete', async () => {
      const { wsGateway } = await import('../../ws/server.js');
      mockRepo.get.mockResolvedValue({ ...sampleWorkspace, containerId: null });
      await app.request('/ws-1', { method: 'DELETE' });
      expect(mockRepo.logAudit).toHaveBeenCalledWith('delete', 'workspace', 'ws-1');
      expect(wsGateway.broadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ entity: 'workspace', action: 'deleted', id: 'ws-1' })
      );
    });

    it('returns 404 with WORKSPACE_NOT_FOUND when workspace does not exist', async () => {
      mockRepo.get.mockResolvedValue(null);
      const res = await app.request('/ws-missing', { method: 'DELETE' });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('returns 500 with WORKSPACE_DELETE_ERROR when repo.delete fails', async () => {
      mockRepo.get.mockResolvedValue({ ...sampleWorkspace, containerId: null });
      mockRepo.delete.mockRejectedValue(new Error('Delete failed'));
      const res = await app.request('/ws-1', { method: 'DELETE' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('WORKSPACE_DELETE_ERROR');
      expect(json.error.message).toBe('Delete failed');
    });

    it('returns 500 with fallback message for non-Error delete failure', async () => {
      mockRepo.get.mockResolvedValue({ ...sampleWorkspace, containerId: null });
      mockRepo.delete.mockRejectedValue(42);
      const res = await app.request('/ws-1', { method: 'DELETE' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toBe('Failed to delete workspace');
    });

    it('returns 500 when stopContainer throws', async () => {
      mockRepo.get.mockResolvedValue({ ...sampleWorkspace, containerId: 'ctr-abc' });
      mockOrchestrator.stopContainer.mockRejectedValue(new Error('Container hung'));
      const res = await app.request('/ws-1', { method: 'DELETE' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('WORKSPACE_DELETE_ERROR');
    });
  });
});
