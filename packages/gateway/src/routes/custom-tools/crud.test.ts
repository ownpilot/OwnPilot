/**
 * Custom Tools CRUD Routes Tests
 *
 * Integration tests for all CRUD endpoints:
 *   GET /stats, GET /, GET /pending, GET /templates, GET /templates (filtered),
 *   GET /active/definitions, GET /:id,
 *   POST / (create), PATCH /:id (update), DELETE /:id,
 *   PATCH /:id/workflow-usable, POST /:id/enable, POST /:id/disable,
 *   POST /templates/:templateId/create
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// vi.hoisted() — must be defined before vi.mock() calls
// ---------------------------------------------------------------------------

const {
  mockRepo,
  mockCreateCustomToolsRepo,
  mockValidateToolCode,
  mockInvalidateAgentCache,
  mockRegisterToolConfigRequirements,
  mockUnregisterDependencies,
  mockSyncToolToRegistry,
  mockUnregisterToolFromRegistries,
  mockValidateBody,
  mockWsBroadcast,
} = vi.hoisted(() => {
  const mockRepo = {
    get: vi.fn(),
    getByName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    list: vi.fn(),
    getStats: vi.fn(),
    getPendingApproval: vi.fn(),
    getActiveTools: vi.fn(),
  };

  const mockCreateCustomToolsRepo = vi.fn(() => mockRepo);
  const mockValidateToolCode = vi.fn(() => ({ valid: true, errors: [] as string[] }));
  const mockInvalidateAgentCache = vi.fn();
  const mockRegisterToolConfigRequirements = vi.fn(async () => undefined);
  const mockUnregisterDependencies = vi.fn(async () => undefined);
  const mockSyncToolToRegistry = vi.fn();
  const mockUnregisterToolFromRegistries = vi.fn();
  const mockValidateBody = vi.fn((_schema: unknown, data: unknown) => data);
  const mockWsBroadcast = vi.fn();

  return {
    mockRepo,
    mockCreateCustomToolsRepo,
    mockValidateToolCode,
    mockInvalidateAgentCache,
    mockRegisterToolConfigRequirements,
    mockUnregisterDependencies,
    mockSyncToolToRegistry,
    mockUnregisterToolFromRegistries,
    mockValidateBody,
    mockWsBroadcast,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../db/repositories/custom-tools.js', () => ({
  createCustomToolsRepo: mockCreateCustomToolsRepo,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    validateToolCode: (...args: unknown[]) => mockValidateToolCode(...args),
  };
});

vi.mock('../agents.js', () => ({
  invalidateAgentCache: mockInvalidateAgentCache,
}));

vi.mock('../../services/api-service-registrar.js', () => ({
  registerToolConfigRequirements: mockRegisterToolConfigRequirements,
  unregisterDependencies: mockUnregisterDependencies,
}));

vi.mock('../../services/custom-tool-registry.js', () => ({
  syncToolToRegistry: mockSyncToolToRegistry,
  unregisterToolFromRegistries: mockUnregisterToolFromRegistries,
}));

vi.mock('../../middleware/validation.js', () => ({
  validateBody: (...args: unknown[]) => mockValidateBody(...args),
  createCustomToolSchema: {},
  updateCustomToolSchema: {},
}));

vi.mock('../../ws/server.js', () => ({
  wsGateway: { broadcast: mockWsBroadcast },
}));

// ---------------------------------------------------------------------------
// Import routes AFTER all vi.mock() calls
// ---------------------------------------------------------------------------

const { crudRoutes } = await import('./crud.js');

// ---------------------------------------------------------------------------
// Sample data factories
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';

function makeTool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ct_001',
    name: 'my_tool',
    description: 'Does something',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    code: 'return { result: args.query };',
    category: 'utility',
    permissions: [] as string[],
    requiresApproval: false,
    createdBy: 'user' as const,
    status: 'active' as const,
    usageCount: 0,
    version: 1,
    metadata: {} as Record<string, unknown>,
    requiredApiKeys: undefined as unknown,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', USER_ID);
    await next();
  });
  app.route('/custom-tools', crudRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Custom Tools CRUD Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock returns
    mockValidateToolCode.mockReturnValue({ valid: true, errors: [] });
    mockRepo.getStats.mockResolvedValue({
      total: 5,
      active: 3,
      disabled: 1,
      pendingApproval: 1,
    });
    mockRepo.list.mockResolvedValue([makeTool()]);
    mockRepo.getPendingApproval.mockResolvedValue([makeTool({ status: 'pending_approval' })]);
    mockRepo.get.mockResolvedValue(makeTool());
    mockRepo.getByName.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue(makeTool({ id: 'ct_new' }));
    mockRepo.update.mockResolvedValue(makeTool({ version: 2 }));
    mockRepo.delete.mockResolvedValue(true);
    mockRepo.enable.mockResolvedValue(makeTool({ status: 'active' }));
    mockRepo.disable.mockResolvedValue(makeTool({ status: 'disabled' }));
    mockRepo.getActiveTools.mockResolvedValue([
      makeTool(),
      makeTool({
        id: 'ct_002',
        name: 'another_tool',
        category: null,
        metadata: { workflowUsable: true },
      }),
    ]);

    app = createApp();
  });

  // =========================================================================
  // GET /stats
  // =========================================================================

  describe('GET /custom-tools/stats', () => {
    it('returns tool statistics', async () => {
      const res = await app.request('/custom-tools/stats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(5);
      expect(json.data.active).toBe(3);
      expect(json.data.disabled).toBe(1);
      expect(json.data.pendingApproval).toBe(1);
      expect(mockCreateCustomToolsRepo).toHaveBeenCalledWith(USER_ID);
      expect(mockRepo.getStats).toHaveBeenCalled();
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.getStats.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/custom-tools/stats');

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // GET /
  // =========================================================================

  describe('GET /custom-tools', () => {
    it('returns list of tools with count', async () => {
      const res = await app.request('/custom-tools');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tools).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });

    it('passes status filter to repo', async () => {
      await app.request('/custom-tools?status=active');

      expect(mockRepo.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    });

    it('passes category filter to repo', async () => {
      await app.request('/custom-tools?category=utility');

      expect(mockRepo.list).toHaveBeenCalledWith(expect.objectContaining({ category: 'utility' }));
    });

    it('passes createdBy filter to repo', async () => {
      await app.request('/custom-tools?createdBy=llm');

      expect(mockRepo.list).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'llm' }));
    });

    it('passes limit and offset to repo', async () => {
      await app.request('/custom-tools?limit=10&offset=20');

      expect(mockRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 20 })
      );
    });

    it('ignores invalid status enum value', async () => {
      const res = await app.request('/custom-tools?status=invalid_status');

      expect(res.status).toBe(200);
      expect(mockRepo.list).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
    });

    it('returns empty tools array when repo returns empty list', async () => {
      mockRepo.list.mockResolvedValue([]);

      const res = await app.request('/custom-tools');
      const json = await res.json();
      expect(json.data.tools).toEqual([]);
      expect(json.data.count).toBe(0);
    });
  });

  // =========================================================================
  // GET /pending
  // =========================================================================

  describe('GET /custom-tools/pending', () => {
    it('returns pending approval tools', async () => {
      const res = await app.request('/custom-tools/pending');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tools).toHaveLength(1);
      expect(json.data.count).toBe(1);
      expect(mockRepo.getPendingApproval).toHaveBeenCalled();
    });

    it('returns empty list when no pending tools', async () => {
      mockRepo.getPendingApproval.mockResolvedValue([]);

      const res = await app.request('/custom-tools/pending');
      const json = await res.json();
      expect(json.data.tools).toEqual([]);
      expect(json.data.count).toBe(0);
    });
  });

  // =========================================================================
  // GET /templates
  // =========================================================================

  describe('GET /custom-tools/templates', () => {
    it('returns all templates with categories', async () => {
      const res = await app.request('/custom-tools/templates');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data.templates)).toBe(true);
      expect(json.data.templates.length).toBeGreaterThan(0);
      expect(json.data.count).toBeGreaterThan(0);
      expect(Array.isArray(json.data.categories)).toBe(true);
    });

    it('returns template fields including id, name, displayName, description, category', async () => {
      const res = await app.request('/custom-tools/templates');
      const json = await res.json();
      const template = json.data.templates[0];
      expect(template).toHaveProperty('id');
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('displayName');
      expect(template).toHaveProperty('description');
      expect(template).toHaveProperty('category');
      expect(template).toHaveProperty('permissions');
      expect(template).toHaveProperty('parameters');
      expect(template).toHaveProperty('code');
    });

    it('filters templates by category (case-insensitive)', async () => {
      const res = await app.request('/custom-tools/templates?category=network');
      const json = await res.json();
      expect(
        json.data.templates.every(
          (t: { category: string }) => t.category.toLowerCase() === 'network'
        )
      ).toBe(true);
    });

    it('returns empty templates array for unknown category', async () => {
      const res = await app.request('/custom-tools/templates?category=nonexistent_category');
      const json = await res.json();
      expect(json.data.templates).toHaveLength(0);
      expect(json.data.count).toBe(0);
    });

    it('returns categories as unique list from all templates regardless of filter', async () => {
      const res = await app.request('/custom-tools/templates?category=data');
      const json = await res.json();
      // categories should reflect all templates, not just filtered ones
      expect(json.data.categories.length).toBeGreaterThan(1);
    });
  });

  // =========================================================================
  // GET /active/definitions
  // =========================================================================

  describe('GET /custom-tools/active/definitions', () => {
    it('returns tool definitions for LLM context', async () => {
      const res = await app.request('/custom-tools/active/definitions');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tools).toHaveLength(2);
      expect(json.data.count).toBe(2);
      expect(mockRepo.getActiveTools).toHaveBeenCalled();
    });

    it('maps tool fields to definition format', async () => {
      const res = await app.request('/custom-tools/active/definitions');
      const json = await res.json();
      const def = json.data.tools[0];
      expect(def).toHaveProperty('name');
      expect(def).toHaveProperty('description');
      expect(def).toHaveProperty('parameters');
      expect(def).toHaveProperty('category');
      expect(def).toHaveProperty('requiresConfirmation');
    });

    it('uses "Custom" as default category when category is null', async () => {
      const res = await app.request('/custom-tools/active/definitions');
      const json = await res.json();
      const anotherTool = json.data.tools.find((t: { name: string }) => t.name === 'another_tool');
      expect(anotherTool?.category).toBe('Custom');
    });

    it('extracts workflowUsable from metadata', async () => {
      const res = await app.request('/custom-tools/active/definitions');
      const json = await res.json();
      const anotherTool = json.data.tools.find((t: { name: string }) => t.name === 'another_tool');
      expect(anotherTool?.workflowUsable).toBe(true);
    });

    it('returns undefined workflowUsable when not set in metadata', async () => {
      const res = await app.request('/custom-tools/active/definitions');
      const json = await res.json();
      const myTool = json.data.tools.find((t: { name: string }) => t.name === 'my_tool');
      expect(myTool?.workflowUsable).toBeUndefined();
    });
  });

  // =========================================================================
  // GET /:id
  // =========================================================================

  describe('GET /custom-tools/:id', () => {
    it('returns the custom tool when found', async () => {
      const res = await app.request('/custom-tools/ct_001');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('ct_001');
      expect(json.data.name).toBe('my_tool');
      expect(mockRepo.get).toHaveBeenCalledWith('ct_001');
    });

    it('returns 404 when tool is not found', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/custom-tools/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.get.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/custom-tools/ct_001');

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // POST / — create
  // =========================================================================

  describe('POST /custom-tools', () => {
    const validBody = {
      name: 'new_tool',
      description: 'A new tool',
      parameters: { type: 'object', properties: { x: { type: 'string' } } },
      code: 'return { result: args.x };',
      category: 'utility',
    };

    it('creates a new tool and returns 201', async () => {
      const res = await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('ct_new');
      expect(mockRepo.create).toHaveBeenCalled();
    });

    it('calls invalidateAgentCache after creation', async () => {
      await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(mockInvalidateAgentCache).toHaveBeenCalled();
    });

    it('calls syncToolToRegistry after creation', async () => {
      await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(mockSyncToolToRegistry).toHaveBeenCalled();
    });

    it('broadcasts data:changed event after creation', async () => {
      await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(mockWsBroadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ entity: 'custom_tool', action: 'created' })
      );
    });

    it('registers config requirements when requiredApiKeys are provided', async () => {
      const bodyWithKeys = {
        ...validBody,
        requiredApiKeys: [{ name: 'my_service', displayName: 'My Service' }],
      };
      mockRepo.create.mockResolvedValue(
        makeTool({
          id: 'ct_new',
          name: 'new_tool',
          requiredApiKeys: [{ name: 'my_service' }],
        })
      );

      await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyWithKeys),
      });

      expect(mockRegisterToolConfigRequirements).toHaveBeenCalled();
    });

    it('returns 400 when validateToolCode returns invalid', async () => {
      mockValidateToolCode.mockReturnValue({
        valid: false,
        errors: ['process access is forbidden'],
      });

      const res = await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
      expect(json.error.message).toContain('Tool code validation failed');
      expect(json.error.message).toContain('process access is forbidden');
    });

    it('returns 409 when tool name already exists', async () => {
      mockRepo.getByName.mockResolvedValue(makeTool({ name: 'new_tool' }));

      const res = await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('ALREADY_EXISTS');
    });

    it('returns 500 when repo.create throws', async () => {
      mockRepo.create.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(500);
    });

    it('defaults createdBy to user when not specified', async () => {
      await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'user' }));
    });
  });

  // =========================================================================
  // PATCH /:id — update
  // =========================================================================

  describe('PATCH /custom-tools/:id', () => {
    const updateBody = { description: 'Updated description' };

    it('updates a tool and returns 200', async () => {
      const res = await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockRepo.update).toHaveBeenCalledWith('ct_001', expect.any(Object));
    });

    it('calls invalidateAgentCache after update', async () => {
      await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      });

      expect(mockInvalidateAgentCache).toHaveBeenCalled();
    });

    it('calls syncToolToRegistry after update', async () => {
      await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      });

      expect(mockSyncToolToRegistry).toHaveBeenCalled();
    });

    it('broadcasts data:changed event after update', async () => {
      await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      });

      expect(mockWsBroadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ entity: 'custom_tool', action: 'updated', id: 'ct_001' })
      );
    });

    it('returns 404 when tool is not found', async () => {
      mockRepo.update.mockResolvedValue(null);

      const res = await app.request('/custom-tools/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when code fails validation on update', async () => {
      mockValidateToolCode.mockReturnValue({
        valid: false,
        errors: ['require() is forbidden'],
      });

      const res = await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'require("fs");' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
      expect(json.error.message).toContain('Tool code validation failed');
    });

    it('unregisters then re-registers config deps when requiredApiKeys updated', async () => {
      const body = { requiredApiKeys: [{ name: 'new_service' }] };
      mockValidateBody.mockReturnValue(body);

      await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(mockUnregisterDependencies).toHaveBeenCalledWith('ct_001');
      expect(mockRegisterToolConfigRequirements).toHaveBeenCalled();
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.update.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      });

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // DELETE /:id
  // =========================================================================

  describe('DELETE /custom-tools/:id', () => {
    it('deletes a tool and returns 200 with deleted: true', async () => {
      const res = await app.request('/custom-tools/ct_001', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(true);
      expect(mockRepo.delete).toHaveBeenCalledWith('ct_001');
    });

    it('unregisters tool from registries when tool exists', async () => {
      await app.request('/custom-tools/ct_001', { method: 'DELETE' });

      expect(mockUnregisterToolFromRegistries).toHaveBeenCalledWith('my_tool');
    });

    it('unregisters API dependencies', async () => {
      await app.request('/custom-tools/ct_001', { method: 'DELETE' });

      expect(mockUnregisterDependencies).toHaveBeenCalledWith('ct_001');
    });

    it('calls invalidateAgentCache after deletion', async () => {
      await app.request('/custom-tools/ct_001', { method: 'DELETE' });

      expect(mockInvalidateAgentCache).toHaveBeenCalled();
    });

    it('broadcasts data:changed event after deletion', async () => {
      await app.request('/custom-tools/ct_001', { method: 'DELETE' });

      expect(mockWsBroadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ entity: 'custom_tool', action: 'deleted', id: 'ct_001' })
      );
    });

    it('returns 404 when tool is not found in repo.delete', async () => {
      mockRepo.delete.mockResolvedValue(false);

      const res = await app.request('/custom-tools/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.get.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/custom-tools/ct_001', { method: 'DELETE' });

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // PATCH /:id/workflow-usable
  // =========================================================================

  describe('PATCH /custom-tools/:id/workflow-usable', () => {
    it('sets workflowUsable to true and returns 200', async () => {
      const res = await app.request('/custom-tools/ct_001/workflow-usable', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.workflowUsable).toBe(true);
    });

    it('sets workflowUsable to false', async () => {
      const res = await app.request('/custom-tools/ct_001/workflow-usable', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.workflowUsable).toBe(false);
    });

    it('calls syncToolToRegistry and invalidateAgentCache after toggling', async () => {
      await app.request('/custom-tools/ct_001/workflow-usable', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(mockSyncToolToRegistry).toHaveBeenCalled();
      expect(mockInvalidateAgentCache).toHaveBeenCalled();
    });

    it('returns 400 when enabled field is missing', async () => {
      const res = await app.request('/custom-tools/ct_001/workflow-usable', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 when enabled is not a boolean', async () => {
      const res = await app.request('/custom-tools/ct_001/workflow-usable', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 'yes' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when tool is not found', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/custom-tools/nonexistent/workflow-usable', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.get.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/custom-tools/ct_001/workflow-usable', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // POST /:id/enable
  // =========================================================================

  describe('POST /custom-tools/:id/enable', () => {
    it('enables the tool and returns 200', async () => {
      const res = await app.request('/custom-tools/ct_001/enable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('active');
      expect(mockRepo.enable).toHaveBeenCalledWith('ct_001');
    });

    it('calls syncToolToRegistry and invalidateAgentCache after enabling', async () => {
      await app.request('/custom-tools/ct_001/enable', { method: 'POST' });

      expect(mockSyncToolToRegistry).toHaveBeenCalled();
      expect(mockInvalidateAgentCache).toHaveBeenCalled();
    });

    it('broadcasts data:changed event after enabling', async () => {
      await app.request('/custom-tools/ct_001/enable', { method: 'POST' });

      expect(mockWsBroadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ entity: 'custom_tool', action: 'updated', id: 'ct_001' })
      );
    });

    it('returns 404 when tool is not found', async () => {
      mockRepo.enable.mockResolvedValue(null);

      const res = await app.request('/custom-tools/nonexistent/enable', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.enable.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/custom-tools/ct_001/enable', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // POST /:id/disable
  // =========================================================================

  describe('POST /custom-tools/:id/disable', () => {
    it('disables the tool and returns 200', async () => {
      const res = await app.request('/custom-tools/ct_001/disable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('disabled');
      expect(mockRepo.disable).toHaveBeenCalledWith('ct_001');
    });

    it('calls syncToolToRegistry and invalidateAgentCache after disabling', async () => {
      await app.request('/custom-tools/ct_001/disable', { method: 'POST' });

      expect(mockSyncToolToRegistry).toHaveBeenCalled();
      expect(mockInvalidateAgentCache).toHaveBeenCalled();
    });

    it('broadcasts data:changed event after disabling', async () => {
      await app.request('/custom-tools/ct_001/disable', { method: 'POST' });

      expect(mockWsBroadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ entity: 'custom_tool', action: 'updated', id: 'ct_001' })
      );
    });

    it('returns 404 when tool is not found', async () => {
      mockRepo.disable.mockResolvedValue(null);

      const res = await app.request('/custom-tools/nonexistent/disable', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.disable.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/custom-tools/ct_001/disable', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // POST /templates/:templateId/create
  // =========================================================================

  describe('POST /custom-tools/templates/:templateId/create', () => {
    it('creates a tool from a known template (api_fetcher)', async () => {
      const res = await app.request('/custom-tools/templates/api_fetcher/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockRepo.create).toHaveBeenCalled();
    });

    it('returns 404 for an unknown template id', async () => {
      const res = await app.request('/custom-tools/templates/nonexistent_template/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('allows overriding template name', async () => {
      await app.request('/custom-tools/templates/api_fetcher/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'my_custom_fetcher' }),
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'my_custom_fetcher' })
      );
    });

    it('uses template name when no override provided', async () => {
      await app.request('/custom-tools/templates/api_fetcher/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'fetch_api_data' })
      );
    });

    it('returns 409 when template tool name already exists', async () => {
      mockRepo.getByName.mockResolvedValue(makeTool({ name: 'fetch_api_data' }));

      const res = await app.request('/custom-tools/templates/api_fetcher/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('ALREADY_EXISTS');
    });

    it('returns 400 when validateToolCode fails on template code', async () => {
      mockValidateToolCode.mockReturnValue({
        valid: false,
        errors: ['code validation failed'],
      });

      const res = await app.request('/custom-tools/templates/api_fetcher/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('registers config requirements when template has requiredApiKeys', async () => {
      mockRepo.create.mockResolvedValue(
        makeTool({
          id: 'ct_new',
          name: 'fetch_with_api_key',
          requiredApiKeys: [{ name: 'custom_api' }],
        })
      );

      await app.request('/custom-tools/templates/api_with_key/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(mockRegisterToolConfigRequirements).toHaveBeenCalled();
    });

    it('calls syncToolToRegistry and invalidateAgentCache after creation from template', async () => {
      await app.request('/custom-tools/templates/calculator/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(mockSyncToolToRegistry).toHaveBeenCalled();
      expect(mockInvalidateAgentCache).toHaveBeenCalled();
    });

    it('broadcasts data:changed event after creation from template', async () => {
      await app.request('/custom-tools/templates/calculator/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(mockWsBroadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ entity: 'custom_tool', action: 'created' })
      );
    });

    it('allows overriding template description', async () => {
      await app.request('/custom-tools/templates/api_fetcher/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Custom description' }),
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Custom description' })
      );
    });

    it('creates tool with createdBy: user and requiresApproval: false', async () => {
      await app.request('/custom-tools/templates/api_fetcher/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 'user', requiresApproval: false })
      );
    });

    it('works with null body (no overrides)', async () => {
      const res = await app.request('/custom-tools/templates/text_formatter/create', {
        method: 'POST',
      });

      expect(res.status).toBe(201);
    });
  });
});
