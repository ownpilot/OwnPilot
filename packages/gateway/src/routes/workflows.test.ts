/**
 * Workflow Routes Tests
 *
 * Integration tests for the workflows API endpoints.
 * Mocks WorkflowsRepository and WorkflowService to test route logic,
 * DAG cycle detection, pagination, and response formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRepo = {
  count: vi.fn().mockResolvedValue(0),
  getPage: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getLog: vi.fn(),
  countLogs: vi.fn().mockResolvedValue(0),
  getRecentLogs: vi.fn().mockResolvedValue([]),
  countLogsForWorkflow: vi.fn().mockResolvedValue(0),
  getLogsForWorkflow: vi.fn().mockResolvedValue([]),
};

const mockService = {
  executeWorkflow: vi.fn(),
  cancelExecution: vi.fn(),
  isRunning: vi.fn().mockReturnValue(false),
};

vi.mock('../db/repositories/workflows.js', () => ({
  createWorkflowsRepository: () => mockRepo,
}));

vi.mock('../services/workflow-service.js', () => ({
  topologicalSort: vi.fn(), // default: no throw = valid DAG
}));

vi.mock('@ownpilot/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@ownpilot/core')>(),
  getServiceRegistry: () => ({
    get: (token: { name: string }) => {
      if (token.name === 'workflow') return mockService;
      throw new Error(`Unexpected token: ${token.name}`);
    },
  }),
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

vi.mock('../middleware/validation.js', () => ({
  validateBody: vi.fn((_schema: unknown, body: unknown) => body),
  createWorkflowSchema: {},
  updateWorkflowSchema: {},
}));

vi.mock('../config/defaults.js', () => ({
  MAX_PAGINATION_OFFSET: 10000,
}));

vi.mock('./workflow-copilot.js', () => ({
  workflowCopilotRoute: new Hono(),
}));

// Import after mocks
const { workflowRoutes } = await import('./workflows.js');
const { topologicalSort: mockTopologicalSort } = await import('../services/workflow-service.js');
const { validateBody: mockValidateBody } = await import('../middleware/validation.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  // Simulate authenticated user
  app.use('*', async (c, next) => {
    c.set('userId', 'u1');
    await next();
  });
  app.route('/workflows', workflowRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleWorkflow = {
  id: 'wf-1',
  userId: 'default',
  name: 'Test Workflow',
  description: 'A test',
  nodes: [],
  edges: [],
  status: 'inactive',
  variables: {},
  lastRun: null,
  runCount: 0,
  createdAt: new Date('2024-06-01'),
  updatedAt: new Date('2024-06-01'),
};

const sampleLog = {
  id: 'wflog-1',
  workflowId: 'wf-1',
  workflowName: 'Test Workflow',
  status: 'completed',
  nodeResults: {},
  error: null,
  durationMs: 1500,
  startedAt: new Date('2024-06-01T12:00:00Z'),
  completedAt: new Date('2024-06-01T12:00:01Z'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Workflow Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults that clearAllMocks resets
    mockRepo.count.mockResolvedValue(0);
    mockRepo.getPage.mockResolvedValue([]);
    mockRepo.countLogs.mockResolvedValue(0);
    mockRepo.getRecentLogs.mockResolvedValue([]);
    mockRepo.countLogsForWorkflow.mockResolvedValue(0);
    mockRepo.getLogsForWorkflow.mockResolvedValue([]);
    mockService.isRunning.mockReturnValue(false);
    app = createApp();
  });

  // ========================================================================
  // GET /workflows
  // ========================================================================

  describe('GET /workflows', () => {
    it('returns paginated list with total', async () => {
      mockRepo.count.mockResolvedValue(2);
      mockRepo.getPage.mockResolvedValue([sampleWorkflow, { ...sampleWorkflow, id: 'wf-2' }]);

      const res = await app.request('/workflows');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.workflows).toHaveLength(2);
      expect(json.data.total).toBe(2);
      expect(json.data.limit).toBe(20);
      expect(json.data.offset).toBe(0);
      expect(json.data.hasMore).toBe(false);
    });

    it('respects custom limit and offset query params', async () => {
      mockRepo.count.mockResolvedValue(50);
      mockRepo.getPage.mockResolvedValue([sampleWorkflow]);

      const res = await app.request('/workflows?limit=10&offset=5');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.limit).toBe(10);
      expect(json.data.offset).toBe(5);
      expect(mockRepo.getPage).toHaveBeenCalledWith(10, 5);
    });

    it('returns empty list when no workflows exist', async () => {
      mockRepo.count.mockResolvedValue(0);
      mockRepo.getPage.mockResolvedValue([]);

      const res = await app.request('/workflows');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.workflows).toHaveLength(0);
      expect(json.data.total).toBe(0);
      expect(json.data.hasMore).toBe(false);
    });

    it('sets hasMore true when more items exist beyond current page', async () => {
      mockRepo.count.mockResolvedValue(30);
      mockRepo.getPage.mockResolvedValue(Array(10).fill(sampleWorkflow));

      const res = await app.request('/workflows?limit=10&offset=0');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.hasMore).toBe(true);
    });
  });

  // ========================================================================
  // POST /workflows
  // ========================================================================

  describe('POST /workflows', () => {
    it('creates a workflow and returns 201', async () => {
      mockRepo.create.mockResolvedValue(sampleWorkflow);

      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Workflow',
          description: 'A test',
          nodes: [],
          edges: [],
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('wf-1');
      expect(json.data.name).toBe('Test Workflow');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-valid-json{{{',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('BAD_REQUEST');
    });

    it('returns 400 when DAG has a cycle', async () => {
      vi.mocked(mockTopologicalSort).mockImplementation(() => {
        throw new Error('Cycle detected in workflow graph');
      });

      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Cyclic Workflow',
          nodes: [{ id: 'n1' }, { id: 'n2' }],
          edges: [
            { source: 'n1', target: 'n2' },
            { source: 'n2', target: 'n1' },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('WORKFLOW_CYCLE_DETECTED');
      expect(json.error.message).toContain('cycle');
    });

    it('returns 500 when repo.create throws', async () => {
      vi.mocked(mockTopologicalSort).mockImplementation(() => {}); // valid DAG
      mockRepo.create.mockRejectedValue(new Error('DB write failed'));

      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Failing Workflow',
          nodes: [],
          edges: [],
        }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('CREATE_FAILED');
      expect(json.error.message).toContain('DB write failed');
    });
  });

  // ========================================================================
  // GET /workflows/logs/recent
  // ========================================================================

  describe('GET /workflows/logs/recent', () => {
    it('returns recent execution logs with pagination metadata', async () => {
      mockRepo.countLogs.mockResolvedValue(1);
      mockRepo.getRecentLogs.mockResolvedValue([sampleLog]);

      const res = await app.request('/workflows/logs/recent');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.logs).toHaveLength(1);
      expect(json.data.total).toBe(1);
      expect(json.data.limit).toBe(20);
      expect(json.data.offset).toBe(0);
      expect(json.data.hasMore).toBe(false);
    });

    it('passes limit and offset to repo', async () => {
      mockRepo.countLogs.mockResolvedValue(50);
      mockRepo.getRecentLogs.mockResolvedValue([sampleLog]);

      await app.request('/workflows/logs/recent?limit=5&offset=10');

      expect(mockRepo.getRecentLogs).toHaveBeenCalledWith(5, 10);
    });
  });

  // ========================================================================
  // GET /workflows/logs/:logId
  // ========================================================================

  describe('GET /workflows/logs/:logId', () => {
    it('returns log detail by id', async () => {
      mockRepo.getLog.mockResolvedValue(sampleLog);

      const res = await app.request('/workflows/logs/wflog-1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('wflog-1');
      expect(json.data.workflowId).toBe('wf-1');
      expect(json.data.status).toBe('completed');
    });

    it('returns 404 when log not found', async () => {
      mockRepo.getLog.mockResolvedValue(null);

      const res = await app.request('/workflows/logs/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // GET /workflows/:id
  // ========================================================================

  describe('GET /workflows/:id', () => {
    it('returns a workflow by id', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);

      const res = await app.request('/workflows/wf-1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('wf-1');
      expect(json.data.name).toBe('Test Workflow');
    });

    it('returns 404 when workflow not found', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workflows/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // PATCH /workflows/:id
  // ========================================================================

  describe('PATCH /workflows/:id', () => {
    it('updates a workflow and returns updated data', async () => {
      const updated = { ...sampleWorkflow, name: 'Updated Name' };
      mockRepo.update.mockResolvedValue(updated);

      const res = await app.request('/workflows/wf-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Updated Name');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/workflows/wf-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad-json{',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('BAD_REQUEST');
    });

    it('returns 404 when workflow not found during update', async () => {
      mockRepo.update.mockResolvedValue(null);

      const res = await app.request('/workflows/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ghost Workflow' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when existing workflow not found during DAG re-validation', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workflows/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: [{ id: 'n1' }],
          edges: [{ source: 'n1', target: 'n2' }],
        }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when updated graph introduces a cycle', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      vi.mocked(mockTopologicalSort).mockImplementation(() => {
        throw new Error('Cycle detected');
      });

      const res = await app.request('/workflows/wf-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: [{ id: 'n1' }, { id: 'n2' }],
          edges: [
            { source: 'n1', target: 'n2' },
            { source: 'n2', target: 'n1' },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('WORKFLOW_CYCLE_DETECTED');
    });
  });

  // ========================================================================
  // DELETE /workflows/:id
  // ========================================================================

  describe('DELETE /workflows/:id', () => {
    it('deletes a workflow and returns success message', async () => {
      mockRepo.delete.mockResolvedValue(true);

      const res = await app.request('/workflows/wf-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toContain('deleted');
    });

    it('returns 404 when workflow not found for delete', async () => {
      mockRepo.delete.mockResolvedValue(false);

      const res = await app.request('/workflows/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // POST /workflows/:id/cancel
  // ========================================================================

  describe('POST /workflows/:id/cancel', () => {
    it('cancels a running execution and returns success', async () => {
      mockService.cancelExecution.mockReturnValue(true);

      const res = await app.request('/workflows/wf-1/cancel', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toContain('cancelled');
      expect(mockService.cancelExecution).toHaveBeenCalledWith('wf-1');
    });

    it('returns 404 when no active execution exists for cancel', async () => {
      mockService.cancelExecution.mockReturnValue(false);

      const res = await app.request('/workflows/wf-1/cancel', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('No active execution');
    });
  });

  // ========================================================================
  // GET /workflows/:id/logs
  // ========================================================================

  describe('GET /workflows/:id/logs', () => {
    it('returns execution logs for a specific workflow', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockRepo.countLogsForWorkflow.mockResolvedValue(1);
      mockRepo.getLogsForWorkflow.mockResolvedValue([sampleLog]);

      const res = await app.request('/workflows/wf-1/logs');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.logs).toHaveLength(1);
      expect(json.data.total).toBe(1);
      expect(json.data.limit).toBe(20);
      expect(json.data.offset).toBe(0);
      expect(json.data.hasMore).toBe(false);
      expect(mockRepo.getLogsForWorkflow).toHaveBeenCalledWith('wf-1', 20, 0);
    });

    it('returns 404 when workflow not found for logs', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workflows/nonexistent/logs');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // GET /workflows/active-tool-names
  // ========================================================================

  describe('GET /workflows/active-tool-names', () => {
    it('returns tool names from active workflows only', async () => {
      mockRepo.getPage.mockResolvedValue([
        {
          ...sampleWorkflow,
          id: 'wf-active',
          status: 'active',
          nodes: [
            { id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: { toolName: 'core.read_file', toolArgs: {}, label: 'Read' } },
            { id: 'n2', type: 'tool', position: { x: 0, y: 0 }, data: { toolName: 'custom.my_tool', toolArgs: {}, label: 'My Tool' } },
          ],
        },
        {
          ...sampleWorkflow,
          id: 'wf-inactive',
          status: 'inactive',
          nodes: [
            { id: 'n3', type: 'tool', position: { x: 0, y: 0 }, data: { toolName: 'should_not_appear', toolArgs: {}, label: 'Skip' } },
          ],
        },
      ]);

      const res = await app.request('/workflows/active-tool-names');

      expect(res.status).toBe(200);
      const json = await res.json() as { data: string[] };
      expect(json.data).toContain('core.read_file');
      expect(json.data).toContain('custom.my_tool');
      expect(json.data).not.toContain('should_not_appear');
    });

    it('returns empty array when no active workflows', async () => {
      mockRepo.getPage.mockResolvedValue([]);

      const res = await app.request('/workflows/active-tool-names');

      expect(res.status).toBe(200);
      const json = await res.json() as { data: string[] };
      expect(json.data).toEqual([]);
    });

    it('deduplicates tool names across workflows', async () => {
      mockRepo.getPage.mockResolvedValue([
        {
          ...sampleWorkflow,
          id: 'wf-a',
          status: 'active',
          nodes: [
            { id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: { toolName: 'shared_tool', toolArgs: {}, label: 'T' } },
          ],
        },
        {
          ...sampleWorkflow,
          id: 'wf-b',
          status: 'active',
          nodes: [
            { id: 'n2', type: 'tool', position: { x: 0, y: 0 }, data: { toolName: 'shared_tool', toolArgs: {}, label: 'T' } },
          ],
        },
      ]);

      const res = await app.request('/workflows/active-tool-names');

      const json = await res.json() as { data: string[] };
      expect(json.data).toHaveLength(1);
      expect(json.data[0]).toBe('shared_tool');
    });

    it('skips non-tool nodes', async () => {
      mockRepo.getPage.mockResolvedValue([
        {
          ...sampleWorkflow,
          id: 'wf-mix',
          status: 'active',
          nodes: [
            { id: 'n1', type: 'trigger', position: { x: 0, y: 0 }, data: { triggerType: 'manual', label: 'Start' } },
            { id: 'n2', type: 'tool', position: { x: 0, y: 0 }, data: { toolName: 'real_tool', toolArgs: {}, label: 'Tool' } },
            { id: 'n3', type: 'condition', position: { x: 0, y: 0 }, data: { expression: 'true', label: 'Check' } },
          ],
        },
      ]);

      const res = await app.request('/workflows/active-tool-names');

      const json = await res.json() as { data: string[] };
      expect(json.data).toEqual(['real_tool']);
    });
  });

  // ========================================================================
  // retryCount / timeoutMs validation
  // ========================================================================

  describe('retryCount / timeoutMs validation', () => {
    beforeEach(async () => {
      // Use real validation for these tests
      const actual = await vi.importActual<typeof import('../middleware/validation.js')>('../middleware/validation.js');
      vi.mocked(mockValidateBody).mockImplementation(
        (_schema, body) => actual.validateBody(actual.createWorkflowSchema, body),
      );
    });

    it('accepts valid retryCount and timeoutMs on tool nodes', async () => {
      mockRepo.create.mockResolvedValue(sampleWorkflow);
      vi.mocked(mockTopologicalSort).mockReturnValue([['n1']]);

      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Retry Test',
          nodes: [{
            id: 'n1', type: 'toolNode',
            position: { x: 0, y: 0 },
            data: { toolName: 'test', toolArgs: {}, label: 'T', retryCount: 3, timeoutMs: 60000 },
          }],
          edges: [],
        }),
      });

      expect(res.status).toBe(201);
    });

    it('rejects retryCount > 5', async () => {
      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad Retry',
          nodes: [{
            id: 'n1', type: 'toolNode',
            position: { x: 0, y: 0 },
            data: { toolName: 'test', toolArgs: {}, label: 'T', retryCount: 6 },
          }],
          edges: [],
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects retryCount < 0', async () => {
      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Negative Retry',
          nodes: [{
            id: 'n1', type: 'toolNode',
            position: { x: 0, y: 0 },
            data: { toolName: 'test', toolArgs: {}, label: 'T', retryCount: -1 },
          }],
          edges: [],
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects timeoutMs > 300000', async () => {
      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad Timeout',
          nodes: [{
            id: 'n1', type: 'toolNode',
            position: { x: 0, y: 0 },
            data: { toolName: 'test', toolArgs: {}, label: 'T', timeoutMs: 400000 },
          }],
          edges: [],
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects timeoutMs < 0', async () => {
      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Negative Timeout',
          nodes: [{
            id: 'n1', type: 'toolNode',
            position: { x: 0, y: 0 },
            data: { toolName: 'test', toolArgs: {}, label: 'T', timeoutMs: -1 },
          }],
          edges: [],
        }),
      });

      expect(res.status).toBe(400);
    });

    it('accepts retryCount and timeoutMs on LLM nodes', async () => {
      mockRepo.create.mockResolvedValue(sampleWorkflow);
      vi.mocked(mockTopologicalSort).mockReturnValue([['n1']]);

      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'LLM Retry',
          nodes: [{
            id: 'n1', type: 'llmNode',
            position: { x: 0, y: 0 },
            data: { label: 'AI', provider: 'openai', model: 'gpt-4', userMessage: 'Hi', retryCount: 2, timeoutMs: 30000 },
          }],
          edges: [],
        }),
      });

      expect(res.status).toBe(201);
    });
  });
});
