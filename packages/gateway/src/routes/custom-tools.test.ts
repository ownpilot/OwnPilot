/**
 * Custom Tools Routes Tests
 *
 * Integration tests for the custom tools API endpoints.
 * Mocks createCustomToolsRepo, createDynamicToolRegistry, and related deps.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const sampleTool = {
  id: 'ct_001',
  name: 'test_tool',
  description: 'A test tool',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  code: 'return { result: args.query };',
  category: 'utility',
  permissions: [] as string[],
  requiresApproval: false,
  createdBy: 'user' as const,
  status: 'active' as const,
  usageCount: 5,
  metadata: {},
  requiredApiKeys: undefined as unknown,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const pendingTool = {
  ...sampleTool,
  id: 'ct_002',
  name: 'pending_tool',
  status: 'pending_approval' as const,
  createdBy: 'llm' as const,
};

const mockRepo = {
  getStats: vi.fn(async () => ({ total: 2, active: 1, disabled: 0, pendingApproval: 1 })),
  list: vi.fn(async () => [sampleTool]),
  getPendingApproval: vi.fn(async () => [pendingTool]),
  get: vi.fn(async (id: string) => (id === 'ct_001' ? sampleTool : id === 'ct_002' ? pendingTool : null)),
  getByName: vi.fn(async () => null),
  create: vi.fn(async (input: Record<string, unknown>) => ({ ...sampleTool, ...input, id: 'ct_new' })),
  update: vi.fn(async (id: string, input: Record<string, unknown>) => (id === 'ct_001' ? { ...sampleTool, ...input } : null)),
  delete: vi.fn(async (id: string) => id === 'ct_001'),
  enable: vi.fn(async (id: string) => (id === 'ct_001' ? { ...sampleTool, status: 'active' } : null)),
  disable: vi.fn(async (id: string) => (id === 'ct_001' ? { ...sampleTool, status: 'disabled' } : null)),
  approve: vi.fn(async (id: string) => (id === 'ct_002' ? { ...pendingTool, status: 'active' } : null)),
  reject: vi.fn(async (id: string) => (id === 'ct_002' ? { ...pendingTool, status: 'rejected' } : null)),
  recordUsage: vi.fn(async () => undefined),
  getActiveTools: vi.fn(async () => [sampleTool]),
};

const mockDynamicRegistry = {
  register: vi.fn(),
  unregister: vi.fn(),
  execute: vi.fn(async () => ({ content: 'result data', isError: false, metadata: {} })),
};

vi.mock('../db/repositories/custom-tools.js', () => ({
  createCustomToolsRepo: vi.fn(() => mockRepo),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createDynamicToolRegistry: vi.fn(() => mockDynamicRegistry),
    ALL_TOOLS: [],
  };
});

vi.mock('./agents.js', () => ({
  invalidateAgentCache: vi.fn(),
}));

vi.mock('../services/api-service-registrar.js', () => ({
  registerToolConfigRequirements: vi.fn(async () => undefined),
  unregisterDependencies: vi.fn(async () => undefined),
}));

vi.mock('../middleware/validation.js', () => ({
  validateBody: vi.fn((_schema: unknown, body: unknown) => body),
  createCustomToolSchema: {},
}));

// Import after mocks
const { customToolsRoutes } = await import('./custom-tools.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/custom-tools', customToolsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Custom Tools Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default implementations
    mockRepo.get.mockImplementation(async (id: string) =>
      id === 'ct_001' ? sampleTool : id === 'ct_002' ? pendingTool : null
    );
    mockRepo.getByName.mockResolvedValue(null);
    mockRepo.list.mockResolvedValue([sampleTool]);
    mockRepo.update.mockImplementation(async (id: string, input: Record<string, unknown>) =>
      id === 'ct_001' ? { ...sampleTool, ...input } : null
    );
    mockRepo.delete.mockImplementation(async (id: string) => id === 'ct_001');
    mockRepo.enable.mockImplementation(async (id: string) =>
      id === 'ct_001' ? { ...sampleTool, status: 'active' } : null
    );
    mockRepo.disable.mockImplementation(async (id: string) =>
      id === 'ct_001' ? { ...sampleTool, status: 'disabled' } : null
    );
    mockRepo.approve.mockImplementation(async (id: string) =>
      id === 'ct_002' ? { ...pendingTool, status: 'active' } : null
    );
    mockRepo.reject.mockImplementation(async (id: string) =>
      id === 'ct_002' ? { ...pendingTool, status: 'rejected' } : null
    );
    mockDynamicRegistry.execute.mockResolvedValue({ content: 'result data', isError: false, metadata: {} });
    app = createApp();
  });

  // ========================================================================
  // GET /custom-tools/stats
  // ========================================================================

  describe('GET /custom-tools/stats', () => {
    it('returns tool statistics', async () => {
      const res = await app.request('/custom-tools/stats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(2);
      expect(json.data.active).toBe(1);
      expect(json.data.pendingApproval).toBe(1);
    });
  });

  // ========================================================================
  // GET /custom-tools
  // ========================================================================

  describe('GET /custom-tools', () => {
    it('returns list of custom tools', async () => {
      const res = await app.request('/custom-tools');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tools).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });

    it('passes filter params to repo', async () => {
      const res = await app.request('/custom-tools?status=active&category=utility&createdBy=user&limit=10&offset=5');

      expect(res.status).toBe(200);
      expect(mockRepo.list).toHaveBeenCalledWith({
        status: 'active',
        category: 'utility',
        createdBy: 'user',
        limit: 10,
        offset: 5,
      });
    });
  });

  // ========================================================================
  // GET /custom-tools/pending
  // ========================================================================

  describe('GET /custom-tools/pending', () => {
    it('returns pending approval tools', async () => {
      const res = await app.request('/custom-tools/pending');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.tools).toHaveLength(1);
      expect(json.data.tools[0].status).toBe('pending_approval');
    });
  });

  // ========================================================================
  // GET /custom-tools/:id
  // ========================================================================

  describe('GET /custom-tools/:id', () => {
    it('returns a specific tool', async () => {
      const res = await app.request('/custom-tools/ct_001');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('ct_001');
      expect(json.data.name).toBe('test_tool');
    });

    it('returns 404 for unknown tool', async () => {
      const res = await app.request('/custom-tools/ct_nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /custom-tools
  // ========================================================================

  describe('POST /custom-tools', () => {
    it('creates a new custom tool', async () => {
      const res = await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'new_tool',
          description: 'A new tool',
          parameters: { type: 'object', properties: {}, required: [] },
          code: 'return { hello: "world" };',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('ct_new');
    });

    it('returns 409 when tool name already exists', async () => {
      mockRepo.getByName.mockResolvedValueOnce(sampleTool);

      const res = await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test_tool',
          description: 'Duplicate',
          parameters: { type: 'object', properties: {} },
          code: 'return {};',
        }),
      });

      expect(res.status).toBe(409);
    });

    it('rejects dangerous code patterns', async () => {
      const res = await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'bad_tool',
          description: 'Evil tool',
          parameters: { type: 'object', properties: {} },
          code: 'process.exit(1);',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('forbidden pattern');
    });
  });

  // ========================================================================
  // PATCH /custom-tools/:id
  // ========================================================================

  describe('PATCH /custom-tools/:id', () => {
    it('updates an existing tool', async () => {
      const res = await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Updated description' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.description).toBe('Updated description');
    });

    it('rejects invalid tool name format', async () => {
      const res = await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Invalid-Name!' }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects dangerous code in updates', async () => {
      const res = await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'require("fs")' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown tool', async () => {
      const res = await app.request('/custom-tools/ct_nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'x' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /custom-tools/:id
  // ========================================================================

  describe('DELETE /custom-tools/:id', () => {
    it('deletes a custom tool', async () => {
      const res = await app.request('/custom-tools/ct_001', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
      expect(mockDynamicRegistry.unregister).toHaveBeenCalledWith('test_tool');
    });

    it('returns 404 for unknown tool', async () => {
      mockRepo.get.mockResolvedValueOnce(null);
      mockRepo.delete.mockResolvedValueOnce(false);

      const res = await app.request('/custom-tools/ct_nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /custom-tools/:id/enable & disable
  // ========================================================================

  describe('POST /custom-tools/:id/enable', () => {
    it('enables a tool', async () => {
      const res = await app.request('/custom-tools/ct_001/enable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('active');
    });

    it('returns 404 for unknown tool', async () => {
      const res = await app.request('/custom-tools/ct_nonexistent/enable', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /custom-tools/:id/disable', () => {
    it('disables a tool', async () => {
      const res = await app.request('/custom-tools/ct_001/disable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('disabled');
    });

    it('returns 404 for unknown tool', async () => {
      const res = await app.request('/custom-tools/ct_nonexistent/disable', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /custom-tools/:id/approve & reject
  // ========================================================================

  describe('POST /custom-tools/:id/approve', () => {
    it('approves a pending tool', async () => {
      const res = await app.request('/custom-tools/ct_002/approve', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('active');
    });

    it('returns 400 when tool is not pending', async () => {
      const res = await app.request('/custom-tools/ct_001/approve', { method: 'POST' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('not pending');
    });

    it('returns 404 for unknown tool', async () => {
      const res = await app.request('/custom-tools/ct_nonexistent/approve', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /custom-tools/:id/reject', () => {
    it('rejects a pending tool', async () => {
      const res = await app.request('/custom-tools/ct_002/reject', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe('rejected');
    });

    it('returns 400 when tool is not pending', async () => {
      const res = await app.request('/custom-tools/ct_001/reject', { method: 'POST' });

      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown tool', async () => {
      const res = await app.request('/custom-tools/ct_nonexistent/reject', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /custom-tools/:id/execute
  // ========================================================================

  describe('POST /custom-tools/:id/execute', () => {
    it('executes an active tool', async () => {
      const res = await app.request('/custom-tools/ct_001/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: { query: 'test' } }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.tool).toBe('test_tool');
      expect(json.data.result).toBe('result data');
      expect(json.data.isError).toBe(false);
      expect(json.data.duration).toBeDefined();
      expect(mockRepo.recordUsage).toHaveBeenCalledWith('ct_001');
    });

    it('returns 400 when tool is not active', async () => {
      const res = await app.request('/custom-tools/ct_002/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('not active');
    });

    it('returns 404 for unknown tool', async () => {
      const res = await app.request('/custom-tools/ct_nonexistent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /custom-tools/test
  // ========================================================================

  describe('POST /custom-tools/test', () => {
    it('tests a tool without saving', async () => {
      const res = await app.request('/custom-tools/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'temp_tool',
          description: 'Temp',
          parameters: { type: 'object', properties: {} },
          code: 'return { ok: true };',
          testArguments: { foo: 'bar' },
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.testMode).toBe(true);
      expect(json.data.tool).toBe('temp_tool');
    });

    it('returns 400 when required fields missing', async () => {
      const res = await app.request('/custom-tools/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'incomplete' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Missing required fields');
    });

    it('rejects dangerous code in test', async () => {
      const res = await app.request('/custom-tools/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'evil_test',
          description: 'Evil',
          parameters: { type: 'object', properties: {} },
          code: 'import("fs")',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('forbidden pattern');
    });
  });

  // ========================================================================
  // GET /custom-tools/active/definitions
  // ========================================================================

  describe('GET /custom-tools/active/definitions', () => {
    it('returns active tool definitions', async () => {
      const res = await app.request('/custom-tools/active/definitions');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.tools).toHaveLength(1);
      expect(json.data.tools[0].name).toBe('test_tool');
      expect(json.data.count).toBe(1);
    });
  });
});
