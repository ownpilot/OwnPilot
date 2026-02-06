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
    validateToolCode: (code: string) => {
      // Check for forbidden patterns used in tests
      const forbidden = [
        { pattern: /\bprocess\b/, msg: 'forbidden pattern: process access' },
        { pattern: /\brequire\s*\(/, msg: 'forbidden pattern: require()' },
        { pattern: /\bimport\s*\(/, msg: 'forbidden pattern: dynamic import()' },
        { pattern: /\beval\s*\(/i, msg: 'forbidden pattern: eval()' },
        { pattern: /\bFunction\s*\(/i, msg: 'forbidden pattern: Function()' },
        { pattern: /\bglobalThis\b/, msg: 'forbidden pattern: globalThis' },
        { pattern: /__proto__/, msg: 'forbidden pattern: __proto__' },
        { pattern: /\.constructor\b/, msg: 'forbidden pattern: .constructor' },
        { pattern: /\bgetPrototypeOf\b/, msg: 'forbidden pattern: getPrototypeOf' },
        { pattern: /\bsetPrototypeOf\b/, msg: 'forbidden pattern: setPrototypeOf' },
        { pattern: /\bReflect\.construct\b/, msg: 'forbidden pattern: Reflect.construct' },
        { pattern: /\bwith\s*\(/, msg: 'forbidden pattern: with()' },
        { pattern: /\bchild_process\b/, msg: 'forbidden pattern: child_process' },
        { pattern: /\bexec\s*\(/, msg: 'forbidden pattern: exec()' },
        { pattern: /\bspawn\s*\(/, msg: 'forbidden pattern: spawn()' },
        { pattern: /\bdebugger\b/, msg: 'forbidden pattern: debugger' },
        { pattern: /\bvm\b\s*\.\s*createContext/, msg: 'forbidden pattern: vm.createContext' },
        { pattern: /\barguments\.callee\b/, msg: 'forbidden pattern: arguments.callee' },
        { pattern: /\bmodule\.exports\b/, msg: 'forbidden pattern: module.exports' },
      ];
      if (code.length > 50_000) {
        return { valid: false, errors: ['Code exceeds maximum size of 50000 characters'] };
      }
      for (const { pattern, msg } of forbidden) {
        if (pattern.test(code)) {
          return { valid: false, errors: [msg] };
        }
      }
      return { valid: true, errors: [] };
    },
    analyzeToolCode: (code: string) => {
      const forbidden = [
        { pattern: /\bprocess\b/, msg: 'forbidden pattern: process access' },
        { pattern: /\beval\s*\(/i, msg: 'forbidden pattern: eval()' },
        { pattern: /\brequire\s*\(/, msg: 'forbidden pattern: require()' },
        { pattern: /\bimport\s*\(/, msg: 'forbidden pattern: dynamic import()' },
      ];
      const errors: string[] = [];
      for (const { pattern, msg } of forbidden) {
        if (pattern.test(code)) {
          errors.push(msg);
        }
      }
      const lines = code.split('\n');
      return {
        valid: errors.length === 0,
        errors,
        warnings: [] as string[],
        securityScore: { score: errors.length === 0 ? 90 : 30, category: errors.length === 0 ? 'safe' : 'dangerous', factors: {} },
        dataFlowRisks: [] as string[],
        bestPractices: { followed: [] as string[], violated: [] as string[] },
        suggestedPermissions: [] as string[],
        stats: {
          lineCount: lines.length,
          hasAsyncCode: /\bawait\b/.test(code),
          usesFetch: /\bfetch\s*\(/.test(code),
          usesCallTool: /utils\s*\.\s*callTool\b/.test(code),
          usesUtils: /\butils\s*\./.test(code),
          returnsValue: /\breturn\b/.test(code),
        },
      };
    },
    calculateSecurityScore: (_code: string, _perms?: string[]) => ({
      score: 90,
      category: 'safe',
      factors: {},
    }),
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
  validateBody: vi.fn((_schema: unknown, body: unknown) => {
    // Minimal validation matching the real Zod schema's name regex
    const b = body as Record<string, unknown>;
    if (b.name !== undefined && (typeof b.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(b.name))) {
      throw new Error('Validation failed: name: Tool name must be lowercase with underscores');
    }
    return body;
  }),
  createCustomToolSchema: {},
  updateCustomToolSchema: {},
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

  // ========================================================================
  // POST /custom-tools/validate
  // ========================================================================

  describe('POST /custom-tools/validate', () => {
    it('returns 400 when code field is missing', async () => {
      const res = await app.request('/custom-tools/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('code is required');
    });

    it('returns 400 when code is not a string', async () => {
      const res = await app.request('/custom-tools/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 123 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('code is required');
    });

    it('returns valid:true with stats for safe code', async () => {
      const res = await app.request('/custom-tools/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return { result: args.query };' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.valid).toBe(true);
      expect(json.data.errors).toEqual([]);
      expect(json.data.stats).toBeDefined();
      expect(json.data.stats.lineCount).toBeGreaterThan(0);
      expect(json.data.stats.returnsValue).toBe(true);
      expect(json.data.warnings).toBeDefined();
      expect(json.data.recommendations).toBeDefined();
    });

    it('returns valid:false with errors for dangerous code', async () => {
      const res = await app.request('/custom-tools/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'eval("malicious")' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.valid).toBe(false);
      expect(json.data.errors.length).toBeGreaterThan(0);
    });

    it('returns stats with correct analysis fields', async () => {
      const res = await app.request('/custom-tools/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'const data = await fetch("https://example.com");\nreturn data;' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.stats.hasAsyncCode).toBe(true);
      expect(json.data.stats.usesFetch).toBe(true);
      expect(json.data.stats.returnsValue).toBe(true);
    });

    it('returns warnings and recommendations arrays', async () => {
      const res = await app.request('/custom-tools/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return { ok: true };' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.data.warnings)).toBe(true);
      expect(Array.isArray(json.data.recommendations)).toBe(true);
    });
  });

  // ========================================================================
  // GET /custom-tools/templates
  // ========================================================================

  describe('GET /custom-tools/templates', () => {
    it('returns list of tool templates', async () => {
      const res = await app.request('/custom-tools/templates');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data.templates)).toBe(true);
      expect(json.data.templates.length).toBe(16);
      expect(json.data.count).toBe(16);
    });

    it('returns templates with required fields', async () => {
      const res = await app.request('/custom-tools/templates');

      expect(res.status).toBe(200);
      const json = await res.json();
      const template = json.data.templates[0];
      expect(template.id).toBeDefined();
      expect(template.name).toBeDefined();
      expect(template.description).toBeDefined();
      expect(template.category).toBeDefined();
      expect(template.code).toBeDefined();
      expect(template.parameters).toBeDefined();
      expect(template.permissions).toBeDefined();
    });

    it('returns categories list', async () => {
      const res = await app.request('/custom-tools/templates');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.data.categories)).toBe(true);
      expect(json.data.categories.length).toBeGreaterThan(0);
    });

    it('filters templates by category', async () => {
      const res = await app.request('/custom-tools/templates?category=Network');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.templates.length).toBeGreaterThan(0);
      for (const tpl of json.data.templates) {
        expect(tpl.category.toLowerCase()).toBe('network');
      }
    });
  });

  // ========================================================================
  // POST /custom-tools/templates/:templateId/create
  // ========================================================================

  describe('POST /custom-tools/templates/:templateId/create', () => {
    it('returns 404 for invalid template ID', async () => {
      const res = await app.request('/custom-tools/templates/nonexistent/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'my_tool' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.message).toContain('Template not found');
    });

    it('creates a tool from a template with default name', async () => {
      const res = await app.request('/custom-tools/templates/api_fetcher/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('ct_new');
    });

    it('creates a tool from a template with custom name', async () => {
      const res = await app.request('/custom-tools/templates/calculator/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'my_calculator' }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my_calculator',
          category: 'Math',
          createdBy: 'user',
          requiresApproval: false,
        })
      );
    });

    it('calls mockRepo.create with template data', async () => {
      const res = await app.request('/custom-tools/templates/data_transformer/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'my_transformer' }),
      });

      expect(res.status).toBe(201);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my_transformer',
          description: expect.any(String),
          parameters: expect.objectContaining({ type: 'object' }),
          code: expect.any(String),
          category: 'Data',
          permissions: expect.any(Array),
          requiresApproval: false,
          createdBy: 'user',
        })
      );
    });

    it('returns 409 when tool name already exists', async () => {
      mockRepo.getByName.mockResolvedValueOnce(sampleTool);

      const res = await app.request('/custom-tools/templates/calculator/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test_tool' }),
      });

      expect(res.status).toBe(409);
    });
  });

  // ========================================================================
  // Additional security pattern tests for POST /custom-tools
  // ========================================================================

  describe('POST /custom-tools - security patterns', () => {
    const dangerousPatterns: Array<{ label: string; code: string }> = [
      { label: 'eval()', code: 'eval("malicious code")' },
      { label: 'Function()', code: 'Function("return this")()' },
      { label: 'globalThis', code: 'globalThis.secret = true' },
      { label: '__proto__', code: 'obj.__proto__.polluted = true' },
      { label: '.constructor', code: 'obj.constructor("return this")()' },
      { label: 'getPrototypeOf', code: 'Object.getPrototypeOf(obj)' },
      { label: 'setPrototypeOf', code: 'Object.setPrototypeOf(obj, null)' },
      { label: 'Reflect.construct', code: 'Reflect.construct(Array, [], Object)' },
      { label: 'with()', code: 'with(obj) { x = 1; }' },
      { label: 'child_process', code: 'const cp = child_process' },
      { label: 'exec()', code: 'exec("ls -la")' },
      { label: 'spawn()', code: 'spawn("node", ["-e", "code"])' },
      { label: 'debugger', code: 'debugger; return {};' },
      { label: 'vm.createContext', code: 'vm.createContext({})' },
      { label: 'arguments.callee', code: 'arguments.callee()' },
      { label: 'module.exports', code: 'module.exports = {}' },
    ];

    for (const { label, code } of dangerousPatterns) {
      it(`rejects code containing ${label}`, async () => {
        const res = await app.request('/custom-tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'bad_tool',
            description: 'Tool with dangerous pattern',
            parameters: { type: 'object', properties: {} },
            code,
          }),
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error.message).toContain('forbidden pattern');
      });
    }
  });

  // ========================================================================
  // Edge case tests
  // ========================================================================

  describe('Edge cases', () => {
    it('PATCH with empty body does not error', async () => {
      const res = await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      // Should succeed since update with empty body is valid (no fields changed)
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('POST with code exactly at size limit succeeds', async () => {
      // 50,000 characters is the max - build safe code at exactly that size
      const suffix = 'return {};';
      const padding = 'x'.repeat(50_000 - suffix.length);
      const code = padding + suffix;

      // Verify our code is exactly at the limit
      expect(code.length).toBe(50_000);

      const res = await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'large_tool',
          description: 'Tool with code at size limit',
          parameters: { type: 'object', properties: {} },
          code,
        }),
      });

      // Code at exactly 50k should be accepted (no forbidden patterns)
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('POST with code exceeding size limit is rejected', async () => {
      const code = 'a'.repeat(50_001);

      const res = await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'too_large_tool',
          description: 'Tool with code over size limit',
          parameters: { type: 'object', properties: {} },
          code,
        }),
      });

      expect(res.status).toBe(400);
    });

    it('POST with permissions triggers pending_approval status when createdBy is llm', async () => {
      mockRepo.create.mockResolvedValueOnce({
        ...sampleTool,
        id: 'ct_pending',
        name: 'dangerous_tool',
        status: 'pending_approval',
        permissions: ['network', 'filesystem'],
        createdBy: 'llm',
      });

      const res = await app.request('/custom-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'dangerous_tool',
          description: 'A tool with dangerous permissions',
          parameters: { type: 'object', properties: {} },
          code: 'return { ok: true };',
          permissions: ['network', 'filesystem'],
          createdBy: 'llm',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('pending_approval');
      expect(json.data.permissions).toContain('network');
      expect(json.data.permissions).toContain('filesystem');
    });

    it('PATCH with valid name format is accepted', async () => {
      const res = await app.request('/custom-tools/ct_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'valid_name_123' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.name).toBe('valid_name_123');
    });

    it('DELETE unregisters tool from dynamic registry', async () => {
      const res = await app.request('/custom-tools/ct_001', { method: 'DELETE' });

      expect(res.status).toBe(200);
      expect(mockDynamicRegistry.unregister).toHaveBeenCalledWith('test_tool');
    });

    it('POST execute records usage after execution', async () => {
      const res = await app.request('/custom-tools/ct_001/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      });

      expect(res.status).toBe(200);
      expect(mockRepo.recordUsage).toHaveBeenCalledWith('ct_001');
    });
  });
});
