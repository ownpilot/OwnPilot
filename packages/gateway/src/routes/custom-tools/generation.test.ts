/**
 * Custom Tools Generation Routes Tests
 *
 * Integration tests for the custom tool execution, testing, audit trail,
 * and meta-tool executor endpoints/functions.
 * Covers: POST /:id/execute, GET /:id/executions, POST /test,
 * executeCustomToolTool, executeActiveCustomTool, getActiveCustomToolDefinitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleTool = {
  id: 'ct_001',
  name: 'test_tool',
  description: 'A test tool',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  code: 'return { content: { result: args.query } };',
  category: 'utility',
  permissions: [] as string[],
  requiresApproval: false,
  createdBy: 'user' as const,
  status: 'active' as const,
  usageCount: 5,
  version: 1,
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

const disabledTool = {
  ...sampleTool,
  id: 'ct_003',
  name: 'disabled_tool',
  status: 'disabled' as const,
};

const llmTool = {
  ...sampleTool,
  id: 'ct_004',
  name: 'llm_tool',
  createdBy: 'llm' as const,
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRepo = {
  get: vi.fn(async (id: string) => {
    if (id === 'ct_001') return sampleTool;
    if (id === 'ct_002') return pendingTool;
    if (id === 'ct_003') return disabledTool;
    return null;
  }),
  getByName: vi.fn(async (name: string) => {
    if (name === 'test_tool') return sampleTool;
    if (name === 'pending_tool') return pendingTool;
    if (name === 'disabled_tool') return disabledTool;
    if (name === 'llm_tool') return llmTool;
    return null;
  }),
  create: vi.fn(async (input: Record<string, unknown>) => ({
    ...sampleTool,
    ...input,
    id: 'ct_new',
    status: 'active',
    version: 1,
  })),
  update: vi.fn(async (_id: string, input: Record<string, unknown>) => ({
    ...sampleTool,
    ...input,
    version: 2,
  })),
  delete: vi.fn(async () => true),
  enable: vi.fn(async () => ({ ...sampleTool, status: 'active' })),
  disable: vi.fn(async () => ({ ...sampleTool, status: 'disabled' })),
  list: vi.fn(async () => [sampleTool]),
  getStats: vi.fn(async () => ({ total: 2, active: 1, disabled: 0, pendingApproval: 1 })),
  recordUsage: vi.fn(async () => undefined),
  getActiveTools: vi.fn(async () => [
    sampleTool,
    { ...sampleTool, id: 'ct_005', name: 'another_tool', category: null, metadata: { workflowUsable: true } },
  ]),
};

vi.mock('../../db/repositories/custom-tools.js', () => ({
  createCustomToolsRepo: vi.fn(() => mockRepo),
}));

const mockDynamicRegistry = {
  register: vi.fn(),
  execute: vi.fn(async () => ({ content: 'test result', isError: false, metadata: {} })),
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createDynamicToolRegistry: vi.fn(() => mockDynamicRegistry),
    ALL_TOOLS: [],
    validateToolCode: (code: string) => {
      if (code.includes('process.exit')) return { valid: false, errors: ['forbidden pattern: process access'] };
      if (code.includes('require(')) return { valid: false, errors: ['forbidden pattern: require()'] };
      if (code.length > 50_000) return { valid: false, errors: ['Code exceeds maximum size'] };
      return { valid: true, errors: [] };
    },
  };
});

const mockSyncToolToRegistry = vi.fn();
const mockExecuteCustomToolUnified = vi.fn(async () => ({
  content: 'unified result',
  isError: false,
  metadata: {},
}));
const mockUnregisterToolFromRegistries = vi.fn();

vi.mock('../../services/custom-tool-registry.js', () => ({
  syncToolToRegistry: (...args: unknown[]) => mockSyncToolToRegistry(...args),
  executeCustomToolUnified: (...args: unknown[]) => mockExecuteCustomToolUnified(...args),
  unregisterToolFromRegistries: (...args: unknown[]) => mockUnregisterToolFromRegistries(...args),
}));

vi.mock('../agents.js', () => ({
  invalidateAgentCache: vi.fn(),
}));

vi.mock('../../services/api-service-registrar.js', () => ({
  registerToolConfigRequirements: vi.fn(async () => undefined),
  unregisterDependencies: vi.fn(async () => undefined),
}));

// Import after mocks
const {
  generationRoutes,
  executeCustomToolTool,
  executeActiveCustomTool,
  getActiveCustomToolDefinitions,
} = await import('./generation.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/ct', generationRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Custom Tools Generation Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.get.mockImplementation(async (id: string) => {
      if (id === 'ct_001') return sampleTool;
      if (id === 'ct_002') return pendingTool;
      if (id === 'ct_003') return disabledTool;
      return null;
    });
    mockRepo.getByName.mockImplementation(async (name: string) => {
      if (name === 'test_tool') return sampleTool;
      if (name === 'pending_tool') return pendingTool;
      if (name === 'disabled_tool') return disabledTool;
      if (name === 'llm_tool') return llmTool;
      return null;
    });
    mockExecuteCustomToolUnified.mockResolvedValue({
      content: 'unified result',
      isError: false,
      metadata: {},
    });
    mockDynamicRegistry.execute.mockResolvedValue({
      content: 'test result',
      isError: false,
      metadata: {},
    });
    app = createApp();
  });

  // ========================================================================
  // POST /:id/execute
  // ========================================================================

  describe('POST /ct/:id/execute', () => {
    it('executes an active tool', async () => {
      const res = await app.request('/ct/ct_001/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: { query: 'test' } }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.tool).toBe('test_tool');
      expect(json.data.result).toBe('unified result');
      expect(json.data.isError).toBe(false);
      expect(json.data.duration).toBeDefined();
      expect(mockSyncToolToRegistry).toHaveBeenCalled();
      expect(mockRepo.recordUsage).toHaveBeenCalledWith('ct_001');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/ct/ct_001/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown tool', async () => {
      const res = await app.request('/ct/ct_nonexistent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 for non-active tool', async () => {
      const res = await app.request('/ct/ct_002/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('not active');
    });

    it('returns 400 when arguments payload is too large', async () => {
      const largeArgs = { data: 'x'.repeat(101_000) };

      const res = await app.request('/ct/ct_001/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: largeArgs }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('too large');
    });

    it('handles execution errors gracefully', async () => {
      mockExecuteCustomToolUnified.mockRejectedValueOnce(new Error('Runtime error'));

      const res = await app.request('/ct/ct_001/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: { query: 'test' } }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.isError).toBe(true);
      expect(json.data.result).toContain('Runtime error');
    });

    it('uses empty arguments when none provided', async () => {
      const res = await app.request('/ct/ct_001/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(mockExecuteCustomToolUnified).toHaveBeenCalledWith(
        'test_tool',
        {},
        expect.objectContaining({ conversationId: 'direct-execution' })
      );
    });
  });

  // ========================================================================
  // GET /:id/executions
  // ========================================================================

  describe('GET /ct/:id/executions', () => {
    it('returns execution audit trail for a tool', async () => {
      // First execute the tool to populate the audit trail
      await app.request('/ct/ct_001/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: { query: 'test' } }),
      });

      const res = await app.request('/ct/ct_001/executions');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.tool).toBe('test_tool');
      expect(json.data.toolId).toBe('ct_001');
      expect(json.data.executions).toBeDefined();
    });

    it('returns 404 for unknown tool', async () => {
      const res = await app.request('/ct/ct_nonexistent/executions');

      expect(res.status).toBe(404);
    });

    it('returns empty executions when no audit trail exists', async () => {
      // Use a tool that has no prior executions
      const res = await app.request('/ct/ct_002/executions');

      // ct_002 exists (pendingTool) but has no executions
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.executions).toEqual([]);
      expect(json.data.totalRecorded).toBe(0);
    });

    it('respects limit parameter', async () => {
      const res = await app.request('/ct/ct_001/executions?limit=5');

      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // POST /test
  // ========================================================================

  describe('POST /ct/test', () => {
    it('tests a tool without saving it', async () => {
      const res = await app.request('/ct/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test_tool',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          code: 'return { content: "hello" };',
          testArguments: { input: 'test' },
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.testMode).toBe(true);
      expect(json.data.tool).toBe('test_tool');
      expect(json.data.result).toBe('test result');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/ct/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await app.request('/ct/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', description: 'x' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Missing required fields');
    });

    it('returns 400 for dangerous code patterns', async () => {
      const res = await app.request('/ct/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'evil',
          description: 'Evil tool',
          parameters: { type: 'object', properties: {} },
          code: 'process.exit(1);',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('validation failed');
    });

    it('handles execution errors in test mode', async () => {
      mockDynamicRegistry.execute.mockRejectedValueOnce(new Error('VM timeout'));

      const res = await app.request('/ct/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'timeout_tool',
          description: 'Times out',
          parameters: { type: 'object', properties: {} },
          code: 'return { content: "hello" };',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.isError).toBe(true);
      expect(json.data.testMode).toBe(true);
      expect(json.data.result).toContain('VM timeout');
    });

    it('uses empty testArguments when not provided', async () => {
      const res = await app.request('/ct/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'tool',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          code: 'return { content: {} };',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockDynamicRegistry.execute).toHaveBeenCalledWith(
        'tool',
        {},
        expect.objectContaining({ conversationId: 'test-execution' })
      );
    });

    it('passes permissions to test tool definition', async () => {
      const res = await app.request('/ct/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'net_tool',
          description: 'Networking tool',
          parameters: { type: 'object', properties: {} },
          code: 'return { content: {} };',
          permissions: ['network'],
        }),
      });

      expect(res.status).toBe(200);
      expect(mockDynamicRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ permissions: ['network'] })
      );
    });
  });

  // ========================================================================
  // executeCustomToolTool (meta-tool executor)
  // ========================================================================

  describe('executeCustomToolTool', () => {
    // --- create_tool ---
    describe('create_tool', () => {
      it('creates a tool successfully', async () => {
        mockRepo.getByName.mockResolvedValueOnce(null);

        const result = await executeCustomToolTool('create_tool', {
          name: 'new_tool',
          description: 'A new tool',
          parameters: { type: 'object', properties: {}, required: [] },
          code: 'return { content: {} };',
        });

        expect(result.success).toBe(true);
        expect(result.result).toBeDefined();
        expect(mockRepo.create).toHaveBeenCalled();
      });

      it('returns error when required fields are missing', async () => {
        const result = await executeCustomToolTool('create_tool', {
          name: 'x',
          description: '',
          parameters: '',
          code: '',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Missing required fields');
      });

      it('returns error for invalid tool name format', async () => {
        const result = await executeCustomToolTool('create_tool', {
          name: 'Invalid-Name',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          code: 'return {};',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('lowercase');
      });

      it('returns error when tool name already exists', async () => {
        const result = await executeCustomToolTool('create_tool', {
          name: 'test_tool',
          description: 'Duplicate',
          parameters: { type: 'object', properties: {} },
          code: 'return {};',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('already exists');
      });

      it('returns error for too long name', async () => {
        const result = await executeCustomToolTool('create_tool', {
          name: 'a'.repeat(101),
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          code: 'return {};',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('max 100');
      });

      it('returns error for too long description', async () => {
        const result = await executeCustomToolTool('create_tool', {
          name: 'my_tool',
          description: 'x'.repeat(2001),
          parameters: { type: 'object', properties: {} },
          code: 'return {};',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('max 2000');
      });

      it('returns error for too long code', async () => {
        const result = await executeCustomToolTool('create_tool', {
          name: 'my_tool',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          code: 'x'.repeat(50001),
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('max 50000');
      });

      it('returns error for invalid category length', async () => {
        const result = await executeCustomToolTool('create_tool', {
          name: 'my_tool',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          code: 'return {};',
          category: 'x'.repeat(51),
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('max 50');
      });

      it('returns error for invalid permissions', async () => {
        const result = await executeCustomToolTool('create_tool', {
          name: 'my_tool',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          code: 'return {};',
          permissions: ['invalid_perm'],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid permissions');
      });

      it('returns error for too many permissions', async () => {
        const result = await executeCustomToolTool('create_tool', {
          name: 'my_tool',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          code: 'return {};',
          permissions: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('max 7');
      });

      it('parses string parameters as JSON', async () => {
        mockRepo.getByName.mockResolvedValueOnce(null);

        const result = await executeCustomToolTool('create_tool', {
          name: 'json_param_tool',
          description: 'Test',
          parameters: JSON.stringify({ type: 'object', properties: { x: { type: 'string' } } }),
          code: 'return { content: {} };',
        });

        expect(result.success).toBe(true);
      });

      it('returns error for invalid JSON string parameters', async () => {
        const result = await executeCustomToolTool('create_tool', {
          name: 'bad_params',
          description: 'Test',
          parameters: 'not valid json',
          code: 'return {};',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid JSON');
      });

      it('returns error for parameters without type: object', async () => {
        const result = await executeCustomToolTool('create_tool', {
          name: 'bad_type',
          description: 'Test',
          parameters: { type: 'array', items: {} },
          code: 'return {};',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('type: "object"');
      });

      it('returns error for code with forbidden patterns', async () => {
        mockRepo.getByName.mockResolvedValueOnce(null);

        const result = await executeCustomToolTool('create_tool', {
          name: 'evil_tool',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          code: 'process.exit(1);',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('validation failed');
      });

      it('reports pending approval status for tool with dangerous permissions', async () => {
        mockRepo.getByName.mockResolvedValueOnce(null);
        mockRepo.create.mockResolvedValueOnce({
          ...sampleTool,
          id: 'ct_pending',
          name: 'shell_tool',
          status: 'pending_approval',
        });

        const result = await executeCustomToolTool('create_tool', {
          name: 'shell_tool',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          code: 'return { content: {} };',
          permissions: ['shell'],
        });

        expect(result.success).toBe(true);
        expect(result.requiresApproval).toBe(true);
        expect(result.pendingToolId).toBe('ct_pending');
      });

      it('registers config requirements when required_api_keys provided', async () => {
        mockRepo.getByName.mockResolvedValueOnce(null);
        const { registerToolConfigRequirements } = await import('../../services/api-service-registrar.js');

        await executeCustomToolTool('create_tool', {
          name: 'api_tool',
          description: 'Needs API key',
          parameters: { type: 'object', properties: {} },
          code: 'return { content: {} };',
          required_api_keys: [{ name: 'my_service', displayName: 'My Service' }],
        });

        expect(registerToolConfigRequirements).toHaveBeenCalled();
      });
    });

    // --- list_custom_tools ---
    describe('list_custom_tools', () => {
      it('lists tools', async () => {
        const result = await executeCustomToolTool('list_custom_tools', {});

        expect(result.success).toBe(true);
        expect(result.result.tools).toBeDefined();
        expect(result.result.stats).toBeDefined();
      });

      it('passes category and status filters', async () => {
        await executeCustomToolTool('list_custom_tools', {
          category: 'utility',
          status: 'active',
        });

        expect(mockRepo.list).toHaveBeenCalledWith({ category: 'utility', status: 'active' });
      });

      it('returns error for invalid status', async () => {
        const result = await executeCustomToolTool('list_custom_tools', {
          status: 'invalid',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid status');
      });

      it('returns error for invalid category', async () => {
        const result = await executeCustomToolTool('list_custom_tools', {
          category: 'x'.repeat(51),
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('max 50');
      });
    });

    // --- delete_custom_tool ---
    describe('delete_custom_tool', () => {
      it('deletes an llm-created tool with confirmation', async () => {
        const result = await executeCustomToolTool('delete_custom_tool', {
          name: 'llm_tool',
          confirm: true,
        });

        expect(result.success).toBe(true);
        expect(mockUnregisterToolFromRegistries).toHaveBeenCalledWith('llm_tool');
      });

      it('requires confirmation before deleting', async () => {
        const result = await executeCustomToolTool('delete_custom_tool', {
          name: 'llm_tool',
        });

        expect(result.success).toBe(false);
        expect(result.requiresConfirmation).toBe(true);
      });

      it('cannot delete user-created tools', async () => {
        const result = await executeCustomToolTool('delete_custom_tool', {
          name: 'test_tool',
          confirm: true,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('protected');
      });

      it('returns error for unknown tool', async () => {
        const result = await executeCustomToolTool('delete_custom_tool', {
          name: 'nonexistent',
          confirm: true,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });

      it('returns error for empty name', async () => {
        const result = await executeCustomToolTool('delete_custom_tool', {
          name: '',
        });

        expect(result.success).toBe(false);
      });

      it('returns error for too long name', async () => {
        const result = await executeCustomToolTool('delete_custom_tool', {
          name: 'x'.repeat(101),
        });

        expect(result.success).toBe(false);
      });

      it('returns error for non-boolean confirm', async () => {
        const result = await executeCustomToolTool('delete_custom_tool', {
          name: 'llm_tool',
          confirm: 'yes',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('boolean');
      });
    });

    // --- toggle_custom_tool ---
    describe('toggle_custom_tool', () => {
      it('enables a tool', async () => {
        const result = await executeCustomToolTool('toggle_custom_tool', {
          name: 'test_tool',
          enabled: true,
        });

        expect(result.success).toBe(true);
        expect(result.result.message).toContain('enabled');
      });

      it('disables a tool', async () => {
        const result = await executeCustomToolTool('toggle_custom_tool', {
          name: 'test_tool',
          enabled: false,
        });

        expect(result.success).toBe(true);
        expect(result.result.message).toContain('disabled');
      });

      it('returns error for unknown tool', async () => {
        const result = await executeCustomToolTool('toggle_custom_tool', {
          name: 'nonexistent',
          enabled: true,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });

      it('returns error for non-boolean enabled', async () => {
        const result = await executeCustomToolTool('toggle_custom_tool', {
          name: 'test_tool',
          enabled: 'yes',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('boolean');
      });

      it('returns error for empty name', async () => {
        const result = await executeCustomToolTool('toggle_custom_tool', {
          name: '',
          enabled: true,
        });

        expect(result.success).toBe(false);
      });
    });

    // --- update_custom_tool ---
    describe('update_custom_tool', () => {
      it('updates description', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'test_tool',
          description: 'Updated description',
        });

        expect(result.success).toBe(true);
        expect(result.result.updatedFields).toContain('description');
      });

      it('updates code with validation', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'test_tool',
          code: 'return { content: "updated" };',
        });

        expect(result.success).toBe(true);
        expect(result.result.updatedFields).toContain('code');
      });

      it('returns error for forbidden code patterns in update', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'test_tool',
          code: 'require("fs")',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('validation failed');
      });

      it('updates parameters from string', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'test_tool',
          parameters: JSON.stringify({ type: 'object', properties: { x: { type: 'number' } } }),
        });

        expect(result.success).toBe(true);
        expect(result.result.updatedFields).toContain('parameters');
      });

      it('updates parameters from object', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'test_tool',
          parameters: { type: 'object', properties: { y: { type: 'boolean' } } },
        });

        expect(result.success).toBe(true);
      });

      it('returns error for invalid parameters JSON string', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'test_tool',
          parameters: 'not json',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('parse parameters');
      });

      it('returns error for parameters without type: object', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'test_tool',
          parameters: { type: 'string' },
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('type "object"');
      });

      it('returns error when no fields to update', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'test_tool',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('No fields provided');
      });

      it('returns error for unknown tool', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'nonexistent',
          description: 'x',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });

      it('returns error for empty name', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: '',
          description: 'x',
        });

        expect(result.success).toBe(false);
      });

      it('returns error when repo.update returns null', async () => {
        mockRepo.update.mockResolvedValueOnce(null);

        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'test_tool',
          description: 'Updated',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to update');
      });

      it('updates category', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'test_tool',
          category: 'data',
        });

        expect(result.success).toBe(true);
        expect(result.result.updatedFields).toContain('category');
      });

      it('updates permissions', async () => {
        const result = await executeCustomToolTool('update_custom_tool', {
          name: 'test_tool',
          permissions: ['network'],
        });

        expect(result.success).toBe(true);
        expect(result.result.updatedFields).toContain('permissions');
      });
    });

    // --- default/unknown ---
    describe('unknown operation', () => {
      it('returns error for unknown toolId', async () => {
        const result = await executeCustomToolTool('unknown_operation', {});

        expect(result.success).toBe(false);
        expect(result.error).toContain('Unknown custom tool operation');
      });
    });

    // --- error handling ---
    describe('error handling', () => {
      it('catches and returns errors thrown by repo', async () => {
        mockRepo.list.mockRejectedValueOnce(new Error('DB connection lost'));

        const result = await executeCustomToolTool('list_custom_tools', {});

        expect(result.success).toBe(false);
        expect(result.error).toContain('DB connection lost');
      });
    });
  });

  // ========================================================================
  // executeActiveCustomTool
  // ========================================================================

  describe('executeActiveCustomTool', () => {
    it('executes an active tool', async () => {
      const result = await executeActiveCustomTool('test_tool', { query: 'hello' });

      expect(result.success).toBe(true);
      expect(mockSyncToolToRegistry).toHaveBeenCalled();
      expect(mockRepo.recordUsage).toHaveBeenCalled();
    });

    it('returns error for unknown tool', async () => {
      const result = await executeActiveCustomTool('nonexistent', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns pending approval error for pending tools', async () => {
      const result = await executeActiveCustomTool('pending_tool', {});

      expect(result.success).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.error).toContain('pending approval');
    });

    it('returns error for disabled tools', async () => {
      const result = await executeActiveCustomTool('disabled_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('catches execution errors', async () => {
      mockExecuteCustomToolUnified.mockRejectedValueOnce(new Error('Sandbox crash'));

      const result = await executeActiveCustomTool('test_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sandbox crash');
    });

    it('passes context parameters', async () => {
      await executeActiveCustomTool('test_tool', {}, 'user-1', {
        callId: 'call-123',
        conversationId: 'conv-456',
      });

      expect(mockExecuteCustomToolUnified).toHaveBeenCalledWith(
        'test_tool',
        {},
        expect.objectContaining({
          callId: 'call-123',
          conversationId: 'conv-456',
          userId: 'user-1',
        })
      );
    });
  });

  // ========================================================================
  // getActiveCustomToolDefinitions
  // ========================================================================

  describe('getActiveCustomToolDefinitions', () => {
    it('returns active tool definitions', async () => {
      const defs = await getActiveCustomToolDefinitions();

      expect(defs).toHaveLength(2);
      expect(defs[0].name).toBe('test_tool');
      expect(defs[0].category).toBe('utility');
    });

    it('uses Custom as default category', async () => {
      const defs = await getActiveCustomToolDefinitions();
      // another_tool has category: null
      const anotherTool = defs.find((d) => d.name === 'another_tool');
      expect(anotherTool?.category).toBe('Custom');
    });

    it('includes workflowUsable from metadata', async () => {
      const defs = await getActiveCustomToolDefinitions();
      const anotherTool = defs.find((d) => d.name === 'another_tool');
      expect(anotherTool?.workflowUsable).toBe(true);
    });

    it('passes userId to repo', async () => {
      await getActiveCustomToolDefinitions('user-123');

      const { createCustomToolsRepo } = await import('../../db/repositories/custom-tools.js');
      expect(createCustomToolsRepo).toHaveBeenCalledWith('user-123');
    });
  });
});
