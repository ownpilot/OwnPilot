/**
 * CRUD Route Factory Tests
 *
 * Comprehensive tests for the createCrudRoutes factory function.
 * Verifies all generated CRUD endpoints, validation, broadcasting,
 * error handling, pagination, hooks, and configuration options.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockService = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  // Custom method names for testing serviceMethods override
  findAll: vi.fn(),
  findById: vi.fn(),
  add: vi.fn(),
  modify: vi.fn(),
  remove: vi.fn(),
};

const mockBroadcast = vi.fn();

vi.mock('../ws/server.js', () => ({
  wsGateway: {
    broadcast: (...args: unknown[]) => mockBroadcast(...args),
  },
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    getServiceRegistry: () => ({
      get: () => mockService,
    }),
  };
});

// Import after mocks
const { createCrudRoutes } = await import('./crud-factory.js');

// ---------------------------------------------------------------------------
// Schemas for testing
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fake ServiceToken for testing. */
const fakeToken = { name: 'test-entity', _type: undefined as unknown } as never;

/** Build a test app with the factory-generated routes. */
function createApp(config?: Parameters<typeof createCrudRoutes>[0]) {
  const app = new Hono();
  const routes = createCrudRoutes(
    config ?? {
      entity: 'task',
      serviceToken: fakeToken,
    }
  );
  app.route('/tasks', routes);
  app.onError(errorHandler);
  return app;
}

/** Build a test app with validation schemas. */
function createAppWithSchemas() {
  return createApp({
    entity: 'task',
    serviceToken: fakeToken,
    schemas: { create: createSchema, update: updateSchema },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCrudRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.list.mockResolvedValue([
      { id: 'w1', name: 'Widget A' },
      { id: 'w2', name: 'Widget B' },
    ]);
    mockService.get.mockImplementation(async (_userId: string, id: string) =>
      id === 'w1' ? { id: 'w1', name: 'Widget A' } : null
    );
    mockService.create.mockResolvedValue({ id: 'w3', name: 'Widget C' });
    mockService.update.mockImplementation(
      async (_userId: string, id: string, body: Record<string, unknown>) =>
        id === 'w1' ? { id: 'w1', ...body } : null
    );
    mockService.delete.mockImplementation(async (_userId: string, id: string) => id === 'w1');
    // Custom methods
    mockService.findAll.mockResolvedValue([{ id: 'c1' }]);
    mockService.findById.mockImplementation(async (_u: string, id: string) =>
      id === 'c1' ? { id: 'c1' } : null
    );
    mockService.add.mockResolvedValue({ id: 'c2' });
    mockService.modify.mockImplementation(
      async (_u: string, id: string, body: Record<string, unknown>) =>
        id === 'c1' ? { id: 'c1', ...body } : null
    );
    mockService.remove.mockImplementation(async (_u: string, id: string) => id === 'c1');
  });

  // ========================================================================
  // GET / - List
  // ========================================================================

  describe('GET / (list)', () => {
    it('returns items with default pagination', async () => {
      const app = createApp();
      const res = await app.request('/tasks');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tasks).toHaveLength(2);
      expect(json.data.total).toBe(2);
      expect(json.data.limit).toBe(20);
      expect(json.data.offset).toBe(0);
    });

    it('passes limit and offset to service', async () => {
      const app = createApp();
      await app.request('/tasks?limit=5&offset=10');

      expect(mockService.list).toHaveBeenCalledWith('default', { limit: 5, offset: 10 });
    });

    it('clamps limit to maxLimit', async () => {
      const app = createApp();
      await app.request('/tasks?limit=500');

      expect(mockService.list).toHaveBeenCalledWith('default', { limit: 100, offset: 0 });
    });

    it('clamps limit to minimum of 1', async () => {
      const app = createApp();
      await app.request('/tasks?limit=0');

      expect(mockService.list).toHaveBeenCalledWith('default', { limit: 1, offset: 0 });
    });

    it('uses custom pagination defaults', async () => {
      const app = createApp({
        entity: 'task',
        serviceToken: fakeToken,
        pagination: { defaultLimit: 50, maxLimit: 200 },
      });
      await app.request('/tasks');

      expect(mockService.list).toHaveBeenCalledWith('default', { limit: 50, offset: 0 });
    });

    it('clamps to custom maxLimit', async () => {
      const app = createApp({
        entity: 'task',
        serviceToken: fakeToken,
        pagination: { defaultLimit: 50, maxLimit: 200 },
      });
      await app.request('/tasks?limit=300');

      expect(mockService.list).toHaveBeenCalledWith('default', { limit: 200, offset: 0 });
    });

    it('returns 500 when service throws', async () => {
      mockService.list.mockRejectedValue(new Error('DB down'));
      const app = createApp();
      const res = await app.request('/tasks');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('LIST_FAILED');
    });

    it('returns empty array when no items', async () => {
      mockService.list.mockResolvedValue([]);
      const app = createApp();
      const res = await app.request('/tasks');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.tasks).toHaveLength(0);
      expect(json.data.total).toBe(0);
    });
  });

  // ========================================================================
  // GET /:id - Get by ID
  // ========================================================================

  describe('GET /:id (get)', () => {
    it('returns item by ID', async () => {
      const app = createApp();
      const res = await app.request('/tasks/w1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.task.id).toBe('w1');
      expect(json.data.task.name).toBe('Widget A');
    });

    it('returns 404 for unknown ID', async () => {
      const app = createApp();
      const res = await app.request('/tasks/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('Task');
      expect(json.error.message).toContain('not found');
    });

    it('calls service with correct userId and id', async () => {
      const app = createApp();
      await app.request('/tasks/w1');

      expect(mockService.get).toHaveBeenCalledWith('default', 'w1');
    });

    it('returns 500 when service throws', async () => {
      mockService.get.mockRejectedValue(new Error('DB error'));
      const app = createApp();
      const res = await app.request('/tasks/w1');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('FETCH_FAILED');
    });
  });

  // ========================================================================
  // POST / - Create
  // ========================================================================

  describe('POST / (create)', () => {
    it('creates an item', async () => {
      const app = createApp();
      const res = await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Widget C' }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.task.id).toBe('w3');
      expect(json.data.message).toContain('created');
    });

    it('broadcasts change on create', async () => {
      const app = createApp();
      await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Widget C' }),
      });

      expect(mockBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'task',
        action: 'created',
        id: 'w3',
      });
    });

    it('does not broadcast when broadcast=false', async () => {
      const app = createApp({
        entity: 'task',
        serviceToken: fakeToken,
        broadcast: false,
      });
      await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Widget C' }),
      });

      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid JSON', async () => {
      const app = createApp();
      const res = await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('Invalid JSON');
    });

    it('validates body against create schema', async () => {
      const app = createAppWithSchemas();
      const res = await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }), // min length 1
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
      expect(json.error.message).toContain('Validation failed');
    });

    it('passes validated body to service when schema is set', async () => {
      const app = createAppWithSchemas();
      await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Valid Widget', extraField: 'stripped' }),
      });

      // Zod strips unknown fields
      expect(mockService.create).toHaveBeenCalledWith('default', { name: 'Valid Widget' });
    });

    it('returns 500 when service throws', async () => {
      mockService.create.mockRejectedValue(new Error('DB error'));
      const app = createApp();
      const res = await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Widget' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('CREATE_FAILED');
    });
  });

  // ========================================================================
  // PATCH /:id - Update
  // ========================================================================

  describe('PATCH /:id (update)', () => {
    it('updates an item', async () => {
      const app = createApp();
      const res = await app.request('/tasks/w1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Widget' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.task.name).toBe('Updated Widget');
      expect(json.data.message).toContain('updated');
    });

    it('broadcasts change on update', async () => {
      const app = createApp();
      await app.request('/tasks/w1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(mockBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'task',
        action: 'updated',
        id: 'w1',
      });
    });

    it('returns 400 for invalid JSON', async () => {
      const app = createApp();
      const res = await app.request('/tasks/w1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('validates body against update schema', async () => {
      const app = createAppWithSchemas();
      const res = await app.request('/tasks/w1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }), // min length 1
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 404 for unknown item', async () => {
      const app = createApp();
      const res = await app.request('/tasks/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('does not broadcast when item not found', async () => {
      const app = createApp();
      await app.request('/tasks/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('returns 500 when service throws', async () => {
      mockService.update.mockRejectedValue(new Error('DB error'));
      const app = createApp();
      const res = await app.request('/tasks/w1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('UPDATE_FAILED');
    });
  });

  // ========================================================================
  // DELETE /:id - Delete
  // ========================================================================

  describe('DELETE /:id (delete)', () => {
    it('deletes an item', async () => {
      const app = createApp();
      const res = await app.request('/tasks/w1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toContain('deleted');
    });

    it('broadcasts change on delete', async () => {
      const app = createApp();
      await app.request('/tasks/w1', { method: 'DELETE' });

      expect(mockBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'task',
        action: 'deleted',
        id: 'w1',
      });
    });

    it('returns 404 for unknown item', async () => {
      const app = createApp();
      const res = await app.request('/tasks/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('does not broadcast when item not found', async () => {
      const app = createApp();
      await app.request('/tasks/nonexistent', { method: 'DELETE' });

      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('returns 500 when service throws', async () => {
      mockService.delete.mockRejectedValue(new Error('DB error'));
      const app = createApp();
      const res = await app.request('/tasks/w1', { method: 'DELETE' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('DELETE_FAILED');
    });
  });

  // ========================================================================
  // methods filter
  // ========================================================================

  describe('methods filter', () => {
    it('only generates list and get when methods=[list, get]', async () => {
      const app = new Hono();
      const routes = createCrudRoutes({
        entity: 'task',
        serviceToken: fakeToken,
        methods: ['list', 'get'],
      });
      app.route('/tasks', routes);
      app.onError(errorHandler);

      // list should work
      const listRes = await app.request('/tasks');
      expect(listRes.status).toBe(200);

      // get should work
      const getRes = await app.request('/tasks/w1');
      expect(getRes.status).toBe(200);

      // POST should 404 (route not registered)
      const postRes = await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });
      expect(postRes.status).toBe(404);

      // PATCH should 404
      const patchRes = await app.request('/tasks/w1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });
      expect(patchRes.status).toBe(404);

      // DELETE should 404
      const delRes = await app.request('/tasks/w1', { method: 'DELETE' });
      expect(delRes.status).toBe(404);
    });

    it('generates only create and delete when specified', async () => {
      const app = new Hono();
      const routes = createCrudRoutes({
        entity: 'task',
        serviceToken: fakeToken,
        methods: ['create', 'delete'],
      });
      app.route('/tasks', routes);
      app.onError(errorHandler);

      // POST should work
      const postRes = await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });
      expect(postRes.status).toBe(201);

      // DELETE should work
      const delRes = await app.request('/tasks/w1', { method: 'DELETE' });
      expect(delRes.status).toBe(200);

      // list should 404
      const listRes = await app.request('/tasks');
      expect(listRes.status).toBe(404);
    });
  });

  // ========================================================================
  // serviceMethods override
  // ========================================================================

  describe('serviceMethods override', () => {
    it('uses custom method names', async () => {
      const app = createApp({
        entity: 'task',
        serviceToken: fakeToken,
        serviceMethods: {
          list: 'findAll',
          get: 'findById',
          create: 'add',
          update: 'modify',
          delete: 'remove',
        },
      });

      // List
      await app.request('/tasks');
      expect(mockService.findAll).toHaveBeenCalled();

      // Get
      await app.request('/tasks/c1');
      expect(mockService.findById).toHaveBeenCalledWith('default', 'c1');

      // Create
      await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });
      expect(mockService.add).toHaveBeenCalled();

      // Update
      await app.request('/tasks/c1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });
      expect(mockService.modify).toHaveBeenCalled();

      // Delete
      await app.request('/tasks/c1', { method: 'DELETE' });
      expect(mockService.remove).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // hooks
  // ========================================================================

  describe('hooks', () => {
    it('afterList transforms the list response', async () => {
      const app = createApp({
        entity: 'task',
        serviceToken: fakeToken,
        hooks: {
          afterList: (items) => ({
            results: items,
            count: (items as unknown[]).length,
            extra: 'data',
          }),
        },
      });

      const res = await app.request('/tasks');
      const json = await res.json();

      expect(json.data.results).toHaveLength(2);
      expect(json.data.count).toBe(2);
      expect(json.data.extra).toBe('data');
      // Should NOT have the default keys
      expect(json.data.tasks).toBeUndefined();
    });

    it('afterGet transforms the get response', async () => {
      const app = createApp({
        entity: 'task',
        serviceToken: fakeToken,
        hooks: {
          afterGet: (item) => ({
            detail: item,
            fetchedAt: '2026-01-01',
          }),
        },
      });

      const res = await app.request('/tasks/w1');
      const json = await res.json();

      expect(json.data.detail).toBeDefined();
      expect(json.data.detail.id).toBe('w1');
      expect(json.data.fetchedAt).toBe('2026-01-01');
    });

    it('beforeCreate transforms the body before service call', async () => {
      const app = createApp({
        entity: 'task',
        serviceToken: fakeToken,
        hooks: {
          beforeCreate: (body) => ({
            ...(body as Record<string, unknown>),
            source: 'factory',
          }),
        },
      });

      await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Widget' }),
      });

      expect(mockService.create).toHaveBeenCalledWith('default', {
        name: 'Widget',
        source: 'factory',
      });
    });

    it('beforeUpdate transforms the body before service call', async () => {
      const app = createApp({
        entity: 'task',
        serviceToken: fakeToken,
        hooks: {
          beforeUpdate: (body) => ({
            ...(body as Record<string, unknown>),
            updatedBy: 'factory',
          }),
        },
      });

      await app.request('/tasks/w1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(mockService.update).toHaveBeenCalledWith('default', 'w1', {
        name: 'Updated',
        updatedBy: 'factory',
      });
    });
  });

  // ========================================================================
  // Response structure
  // ========================================================================

  describe('response structure', () => {
    it('includes meta in success responses', async () => {
      const app = createApp();
      const res = await app.request('/tasks');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });

    it('includes meta in error responses', async () => {
      const app = createApp();
      const res = await app.request('/tasks/nonexistent');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });

    it('uses entity name as response key', async () => {
      const app = new Hono();
      const routes = createCrudRoutes({
        entity: 'note',
        serviceToken: fakeToken,
      });
      app.route('/notes', routes);

      const listRes = await app.request('/notes');
      const listJson = await listRes.json();
      expect(listJson.data.notes).toBeDefined();

      const getRes = await app.request('/notes/w1');
      const getJson = await getRes.json();
      expect(getJson.data.note).toBeDefined();
    });
  });

  // ========================================================================
  // broadcast=false
  // ========================================================================

  describe('broadcast=false', () => {
    it('does not broadcast on create, update, or delete', async () => {
      const app = createApp({
        entity: 'task',
        serviceToken: fakeToken,
        broadcast: false,
      });

      // Create
      await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Widget' }),
      });
      expect(mockBroadcast).not.toHaveBeenCalled();

      // Update
      await app.request('/tasks/w1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });
      expect(mockBroadcast).not.toHaveBeenCalled();

      // Delete
      await app.request('/tasks/w1', { method: 'DELETE' });
      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Entity name capitalization in messages
  // ========================================================================

  describe('entity name in messages', () => {
    it('capitalizes entity in success messages', async () => {
      const app = createApp();

      const createRes = await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });
      const createJson = await createRes.json();
      expect(createJson.data.message).toBe('Task created successfully.');

      const updateRes = await app.request('/tasks/w1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });
      const updateJson = await updateRes.json();
      expect(updateJson.data.message).toBe('Task updated successfully.');

      const deleteRes = await app.request('/tasks/w1', { method: 'DELETE' });
      const deleteJson = await deleteRes.json();
      expect(deleteJson.data.message).toBe('Task deleted successfully.');
    });

    it('capitalizes entity in not-found errors', async () => {
      const app = createApp();

      const res = await app.request('/tasks/nonexistent');
      const json = await res.json();
      expect(json.error.message).toContain('Task');
    });
  });
});
