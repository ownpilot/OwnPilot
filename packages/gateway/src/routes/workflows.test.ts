/**
 * Workflow Routes Tests
 *
 * Integration tests for the workflows API endpoints.
 * Mocks WorkflowsRepository and WorkflowService to test route logic,
 * DAG cycle detection, pagination, and response formatting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  updateLog: vi.fn().mockResolvedValue(undefined),
  countLogs: vi.fn().mockResolvedValue(0),
  getRecentLogs: vi.fn().mockResolvedValue([]),
  countLogsForWorkflow: vi.fn().mockResolvedValue(0),
  getLogsForWorkflow: vi.fn().mockResolvedValue([]),
  getActiveToolNames: vi.fn().mockResolvedValue([]),
  countVersions: vi.fn().mockResolvedValue(0),
  getVersions: vi.fn().mockResolvedValue([]),
  restoreVersion: vi.fn(),
  createVersion: vi.fn().mockResolvedValue(undefined),
};

const mockApprovalsRepo = {
  countPending: vi.fn().mockResolvedValue(0),
  getPending: vi.fn().mockResolvedValue([]),
  countAll: vi.fn().mockResolvedValue(0),
  getAll: vi.fn().mockResolvedValue([]),
  decide: vi.fn(),
};

const mockService = {
  executeWorkflow: vi.fn(),
  cancelExecution: vi.fn(),
  isRunning: vi.fn().mockReturnValue(false),
};

vi.mock('../db/repositories/workflows.js', () => ({
  createWorkflowsRepository: () => mockRepo,
}));

vi.mock('../db/repositories/workflow-approvals.js', () => ({
  createWorkflowApprovalsRepository: () => mockApprovalsRepo,
}));

vi.mock('../services/workflow-service.js', () => ({
  topologicalSort: vi.fn(), // default: no throw = valid DAG
}));

vi.mock('../services/workflow/dag-utils.js', () => ({
  detectCycle: vi.fn(), // default: no cycle detected
}));

vi.mock('@ownpilot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ownpilot/core')>()),
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
const { detectCycle: mockDetectCycle } = await import('../services/workflow/dag-utils.js');
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
    mockRepo.countVersions.mockResolvedValue(0);
    mockRepo.getVersions.mockResolvedValue([]);
    mockRepo.updateLog.mockResolvedValue(undefined);
    mockRepo.createVersion.mockResolvedValue(undefined);
    mockService.isRunning.mockReturnValue(false);
    mockDetectCycle.mockReturnValue(null); // default: no cycle
    vi.mocked(mockValidateBody).mockImplementation((_schema, body) => body); // restore pass-through
    // Restore approvals repo defaults
    mockApprovalsRepo.countPending.mockResolvedValue(0);
    mockApprovalsRepo.getPending.mockResolvedValue([]);
    mockApprovalsRepo.countAll.mockResolvedValue(0);
    mockApprovalsRepo.getAll.mockResolvedValue([]);
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
          nodes: [
            {
              id: 'n1',
              type: 'toolNode',
              position: { x: 0, y: 0 },
              data: { toolName: 't1', toolArgs: {}, label: 'T1' },
            },
            {
              id: 'n2',
              type: 'toolNode',
              position: { x: 0, y: 100 },
              data: { toolName: 't2', toolArgs: {}, label: 'T2' },
            },
          ],
          edges: [
            { id: 'e1', source: 'n1', target: 'n2' },
            { id: 'e2', source: 'n2', target: 'n1' },
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
          nodes: [
            {
              id: 'n1',
              type: 'toolNode',
              position: { x: 0, y: 0 },
              data: { toolName: 't1', toolArgs: {}, label: 'T1' },
            },
            {
              id: 'n2',
              type: 'toolNode',
              position: { x: 0, y: 100 },
              data: { toolName: 't2', toolArgs: {}, label: 'T2' },
            },
          ],
          edges: [
            { id: 'e1', source: 'n1', target: 'n2' },
            { id: 'e2', source: 'n2', target: 'n1' },
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
      // getActiveToolNames queries DB with WHERE status='active', so it returns
      // only tool names from active workflows directly
      mockRepo.getActiveToolNames.mockResolvedValue(['core.read_file', 'custom.my_tool']);

      const res = await app.request('/workflows/active-tool-names');

      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: string[] };
      expect(json.data).toContain('core.read_file');
      expect(json.data).toContain('custom.my_tool');
      expect(json.data).not.toContain('should_not_appear');
    });

    it('returns empty array when no active workflows', async () => {
      mockRepo.getActiveToolNames.mockResolvedValue([]);

      const res = await app.request('/workflows/active-tool-names');

      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: string[] };
      expect(json.data).toEqual([]);
    });

    it('deduplicates tool names across workflows', async () => {
      // DB uses DISTINCT so duplicates are already removed
      mockRepo.getActiveToolNames.mockResolvedValue(['shared_tool']);

      const res = await app.request('/workflows/active-tool-names');

      const json = (await res.json()) as { data: string[] };
      expect(json.data).toHaveLength(1);
      expect(json.data[0]).toBe('shared_tool');
    });

    it('skips non-tool nodes', async () => {
      // DB query uses type filter ($[*] ? (@.type == "tool")), so only tool nodes are returned
      mockRepo.getActiveToolNames.mockResolvedValue(['real_tool']);

      const res = await app.request('/workflows/active-tool-names');

      const json = (await res.json()) as { data: string[] };
      expect(json.data).toEqual(['real_tool']);
    });
  });

  // ========================================================================
  // POST /workflows/:id/clone
  // ========================================================================

  describe('POST /workflows/:id/clone', () => {
    it('clones a workflow with remapped node/edge IDs and returns 201', async () => {
      const original = {
        ...sampleWorkflow,
        nodes: [
          {
            id: 'n1',
            type: 'toolNode',
            position: { x: 0, y: 0 },
            data: { toolName: 't1', label: 'T1', triggerId: 'trig-1' },
          },
          {
            id: 'n2',
            type: 'toolNode',
            position: { x: 0, y: 100 },
            data: { toolName: 't2', label: 'T2' },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        variables: { foo: 'bar' },
        description: 'Original desc',
        inputSchema: [],
      };
      const cloned = { ...sampleWorkflow, id: 'wf-clone-1', name: 'Copy of Test Workflow' };
      mockRepo.get.mockResolvedValue(original);
      mockRepo.create.mockResolvedValue(cloned);

      const res = await app.request('/workflows/wf-1/clone', { method: 'POST' });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('wf-clone-1');
      expect(json.data.name).toBe('Copy of Test Workflow');
      // repo.create must have been called with remapped name and stripped triggerId
      expect(mockRepo.create).toHaveBeenCalledOnce();
      const createArg = mockRepo.create.mock.calls[0][0];
      expect(createArg.name).toBe('Copy of Test Workflow');
      // triggerId should be stripped from cloned nodes
      expect(createArg.nodes[0].data.triggerId).toBeUndefined();
      // node IDs should be remapped (not original n1/n2)
      expect(createArg.nodes[0].id).not.toBe('n1');
      expect(createArg.nodes[1].id).not.toBe('n2');
    });

    it('returns 404 when original workflow not found', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workflows/nonexistent/clone', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 when repo.create throws during clone', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockRepo.create.mockRejectedValue(new Error('DB constraint violation'));

      const res = await app.request('/workflows/wf-1/clone', { method: 'POST' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('CREATE_FAILED');
      expect(json.error.message).toContain('DB constraint violation');
    });

    it('clones a workflow with no nodes/edges correctly', async () => {
      const emptyWorkflow = {
        ...sampleWorkflow,
        nodes: [],
        edges: [],
        variables: {},
        description: null,
        inputSchema: [],
      };
      const cloned = { ...sampleWorkflow, id: 'wf-clone-2', name: 'Copy of Test Workflow' };
      mockRepo.get.mockResolvedValue(emptyWorkflow);
      mockRepo.create.mockResolvedValue(cloned);

      const res = await app.request('/workflows/wf-1/clone', { method: 'POST' });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      const createArg = mockRepo.create.mock.calls[0][0];
      expect(createArg.nodes).toHaveLength(0);
      expect(createArg.edges).toHaveLength(0);
    });
  });

  // ========================================================================
  // POST /workflows/:id/execute
  // ========================================================================

  describe('POST /workflows/:id/execute', () => {
    it('returns 404 when workflow not found', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workflows/nonexistent/execute', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 409 when workflow is already running', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockService.isRunning.mockReturnValue(true);

      const res = await app.request('/workflows/wf-1/execute', { method: 'POST' });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('WORKFLOW_ALREADY_RUNNING');
      expect(json.error.message).toContain('already running');
    });

    it('starts SSE stream and calls executeWorkflow when workflow is valid', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockService.isRunning.mockReturnValue(false);
      mockService.executeWorkflow.mockResolvedValue(undefined);

      const res = await app.request('/workflows/wf-1/execute', { method: 'POST' });

      // SSE stream: status 200 with text/event-stream content type
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(mockService.executeWorkflow).toHaveBeenCalledOnce();
      const [calledId, calledUserId] = mockService.executeWorkflow.mock.calls[0];
      expect(calledId).toBe('wf-1');
      expect(calledUserId).toBe('u1');
    });

    it('passes dryRun flag to executeWorkflow when query param is set', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockService.isRunning.mockReturnValue(false);
      mockService.executeWorkflow.mockResolvedValue(undefined);

      await app.request('/workflows/wf-1/execute?dryRun=true', { method: 'POST' });

      expect(mockService.executeWorkflow).toHaveBeenCalledOnce();
      const options = mockService.executeWorkflow.mock.calls[0][3];
      expect(options.dryRun).toBe(true);
    });

    it('passes inputs from request body to executeWorkflow', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockService.isRunning.mockReturnValue(false);
      mockService.executeWorkflow.mockResolvedValue(undefined);

      await app.request('/workflows/wf-1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: { key: 'value' } }),
      });

      expect(mockService.executeWorkflow).toHaveBeenCalledOnce();
      const options = mockService.executeWorkflow.mock.calls[0][3];
      expect(options.inputs).toEqual({ key: 'value' });
    });
  });

  // ========================================================================
  // POST /workflows/:id/cancel — workflow not found
  // ========================================================================

  describe('POST /workflows/:id/cancel — workflow not found', () => {
    it('returns 404 when workflow does not exist', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workflows/ghost/cancel', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // GET /workflows/:id/versions
  // ========================================================================

  describe('GET /workflows/:id/versions', () => {
    it('returns paginated versions for a workflow', async () => {
      const version = {
        id: 'v-1',
        workflowId: 'wf-1',
        version: 1,
        nodes: [],
        edges: [],
        createdAt: new Date('2024-06-01'),
      };
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockRepo.countVersions.mockResolvedValue(1);
      mockRepo.getVersions.mockResolvedValue([version]);

      const res = await app.request('/workflows/wf-1/versions');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.versions).toHaveLength(1);
      expect(json.data.total).toBe(1);
      expect(json.data.limit).toBe(20);
      expect(json.data.offset).toBe(0);
      expect(json.data.hasMore).toBe(false);
      expect(mockRepo.getVersions).toHaveBeenCalledWith('wf-1', 20, 0);
    });

    it('returns 404 when workflow not found', async () => {
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workflows/nonexistent/versions');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('respects limit and offset params for versions', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockRepo.countVersions.mockResolvedValue(10);
      mockRepo.getVersions.mockResolvedValue([]);

      await app.request('/workflows/wf-1/versions?limit=5&offset=3');

      expect(mockRepo.getVersions).toHaveBeenCalledWith('wf-1', 5, 3);
    });
  });

  // ========================================================================
  // POST /workflows/:id/versions/:version/restore
  // ========================================================================

  describe('POST /workflows/:id/versions/:version/restore', () => {
    it('restores a workflow version and returns updated workflow', async () => {
      const restored = { ...sampleWorkflow, name: 'Restored Workflow' };
      mockRepo.restoreVersion.mockResolvedValue(restored);

      const res = await app.request('/workflows/wf-1/versions/2/restore', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Restored Workflow');
      expect(mockRepo.restoreVersion).toHaveBeenCalledWith('wf-1', 2);
    });

    it('returns 404 when version not found', async () => {
      mockRepo.restoreVersion.mockResolvedValue(null);

      const res = await app.request('/workflows/wf-1/versions/99/restore', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('99');
    });

    it('returns 400 for non-numeric version param', async () => {
      const res = await app.request('/workflows/wf-1/versions/abc/restore', { method: 'POST' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('BAD_REQUEST');
    });

    it('returns 400 for version number less than 1', async () => {
      const res = await app.request('/workflows/wf-1/versions/0/restore', { method: 'POST' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('BAD_REQUEST');
    });
  });

  // ========================================================================
  // GET /workflows/approvals/pending
  // ========================================================================

  describe('GET /workflows/approvals/pending', () => {
    it('returns paginated pending approvals', async () => {
      const approval = {
        id: 'apr-1',
        workflowId: 'wf-1',
        workflowLogId: 'wflog-1',
        nodeId: 'n1',
        status: 'pending',
        createdAt: new Date('2024-06-01'),
      };
      mockApprovalsRepo.countPending.mockResolvedValue(1);
      mockApprovalsRepo.getPending.mockResolvedValue([approval]);

      const res = await app.request('/workflows/approvals/pending');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.approvals).toHaveLength(1);
      expect(json.data.total).toBe(1);
      expect(json.data.hasMore).toBe(false);
    });

    it('returns empty list when no pending approvals', async () => {
      mockApprovalsRepo.countPending.mockResolvedValue(0);
      mockApprovalsRepo.getPending.mockResolvedValue([]);

      const res = await app.request('/workflows/approvals/pending');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.approvals).toHaveLength(0);
      expect(json.data.total).toBe(0);
    });
  });

  // ========================================================================
  // GET /workflows/approvals/all
  // ========================================================================

  describe('GET /workflows/approvals/all', () => {
    it('returns all approvals with pagination metadata', async () => {
      const approval = {
        id: 'apr-2',
        workflowId: 'wf-1',
        workflowLogId: 'wflog-1',
        nodeId: 'n2',
        status: 'approved',
        createdAt: new Date('2024-06-01'),
      };
      mockApprovalsRepo.countAll.mockResolvedValue(3);
      mockApprovalsRepo.getAll.mockResolvedValue([approval]);

      const res = await app.request('/workflows/approvals/all?limit=1&offset=0');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.approvals).toHaveLength(1);
      expect(json.data.total).toBe(3);
      expect(json.data.hasMore).toBe(true);
    });
  });

  // ========================================================================
  // POST /workflows/approvals/:id/approve
  // ========================================================================

  describe('POST /workflows/approvals/:id/approve', () => {
    it('approves a pending approval and returns it', async () => {
      const approved = {
        id: 'apr-1',
        workflowId: 'wf-1',
        workflowLogId: 'wflog-1',
        nodeId: 'n1',
        status: 'approved',
      };
      mockApprovalsRepo.decide.mockResolvedValue(approved);

      const res = await app.request('/workflows/approvals/apr-1/approve', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('approved');
      expect(mockApprovalsRepo.decide).toHaveBeenCalledWith('apr-1', 'approved');
    });

    it('returns 404 when approval not found', async () => {
      mockApprovalsRepo.decide.mockResolvedValue(null);

      const res = await app.request('/workflows/approvals/bad-id/approve', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when approval status is not "approved" after decide', async () => {
      // decide returns an approval with wrong status (e.g. already decided)
      mockApprovalsRepo.decide.mockResolvedValue({ id: 'apr-1', status: 'rejected' });

      const res = await app.request('/workflows/approvals/apr-1/approve', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // POST /workflows/approvals/:id/reject
  // ========================================================================

  describe('POST /workflows/approvals/:id/reject', () => {
    it('rejects a pending approval and returns it', async () => {
      const rejected = {
        id: 'apr-1',
        workflowId: 'wf-1',
        workflowLogId: 'wflog-1',
        nodeId: 'n1',
        status: 'rejected',
      };
      mockApprovalsRepo.decide.mockResolvedValue(rejected);
      mockRepo.getLog.mockResolvedValue(null);

      const res = await app.request('/workflows/approvals/apr-1/reject', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('rejected');
      expect(mockApprovalsRepo.decide).toHaveBeenCalledWith('apr-1', 'rejected');
    });

    it('marks associated workflow log as failed when log is awaiting_approval', async () => {
      const rejected = {
        id: 'apr-1',
        workflowId: 'wf-1',
        workflowLogId: 'wflog-1',
        nodeId: 'n1',
        status: 'rejected',
      };
      mockApprovalsRepo.decide.mockResolvedValue(rejected);
      mockRepo.getLog.mockResolvedValue({ ...sampleLog, status: 'awaiting_approval' });

      await app.request('/workflows/approvals/apr-1/reject', { method: 'POST' });

      expect(mockRepo.updateLog).toHaveBeenCalledWith(
        'wflog-1',
        expect.objectContaining({ status: 'failed', error: 'Approval rejected' })
      );
    });

    it('does not update log when log status is not awaiting_approval', async () => {
      const rejected = {
        id: 'apr-1',
        workflowId: 'wf-1',
        workflowLogId: 'wflog-1',
        nodeId: 'n1',
        status: 'rejected',
      };
      mockApprovalsRepo.decide.mockResolvedValue(rejected);
      mockRepo.getLog.mockResolvedValue({ ...sampleLog, status: 'completed' });

      await app.request('/workflows/approvals/apr-1/reject', { method: 'POST' });

      expect(mockRepo.updateLog).not.toHaveBeenCalled();
    });

    it('returns 404 when approval not found for reject', async () => {
      mockApprovalsRepo.decide.mockResolvedValue(null);

      const res = await app.request('/workflows/approvals/bad-id/reject', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // POST /workflows/:id/run (Public API)
  // ========================================================================

  describe('POST /workflows/:id/run', () => {
    const origEnv = process.env.ADMIN_KEY;

    afterEach(() => {
      if (origEnv === undefined) {
        delete process.env.ADMIN_KEY;
      } else {
        process.env.ADMIN_KEY = origEnv;
      }
    });

    it('returns 403 when ADMIN_KEY is not set', async () => {
      delete process.env.ADMIN_KEY;

      const res = await app.request('/workflows/wf-1/run', { method: 'POST' });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when X-API-Key is missing', async () => {
      process.env.ADMIN_KEY = 'secret-key';

      const res = await app.request('/workflows/wf-1/run', { method: 'POST' });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when X-API-Key does not match', async () => {
      process.env.ADMIN_KEY = 'secret-key';

      const res = await app.request('/workflows/wf-1/run', {
        method: 'POST',
        headers: { 'X-API-Key': 'wrong-key' },
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 404 when workflow not found with valid API key', async () => {
      process.env.ADMIN_KEY = 'secret-key';
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workflows/nonexistent/run', {
        method: 'POST',
        headers: { 'X-API-Key': 'secret-key' },
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 409 when workflow is already running', async () => {
      process.env.ADMIN_KEY = 'secret-key';
      mockRepo.get.mockResolvedValue({ ...sampleWorkflow, inputSchema: [] });
      mockService.isRunning.mockReturnValue(true);

      const res = await app.request('/workflows/wf-1/run', {
        method: 'POST',
        headers: { 'X-API-Key': 'secret-key' },
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('WORKFLOW_ALREADY_RUNNING');
    });

    it('returns 400 when required inputs are missing', async () => {
      process.env.ADMIN_KEY = 'secret-key';
      mockRepo.get.mockResolvedValue({
        ...sampleWorkflow,
        inputSchema: [{ name: 'email', required: true }],
      });
      mockService.isRunning.mockReturnValue(false);

      const res = await app.request('/workflows/wf-1/run', {
        method: 'POST',
        headers: { 'X-API-Key': 'secret-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: {} }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('email');
    });

    it('accepts X-Admin-Key as an alternative to X-API-Key', async () => {
      process.env.ADMIN_KEY = 'secret-key';
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workflows/wf-1/run', {
        method: 'POST',
        headers: { 'X-Admin-Key': 'secret-key' },
      });

      // 404 means auth passed (workflow not found is the expected error here)
      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /workflows/:id/run/:logId (Public API — poll status)
  // ========================================================================

  describe('GET /workflows/:id/run/:logId', () => {
    const origEnv = process.env.ADMIN_KEY;

    afterEach(() => {
      if (origEnv === undefined) {
        delete process.env.ADMIN_KEY;
      } else {
        process.env.ADMIN_KEY = origEnv;
      }
    });

    it('returns 403 when ADMIN_KEY is not set', async () => {
      delete process.env.ADMIN_KEY;

      const res = await app.request('/workflows/wf-1/run/wflog-1');

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when API key is wrong', async () => {
      process.env.ADMIN_KEY = 'secret-key';

      const res = await app.request('/workflows/wf-1/run/wflog-1', {
        headers: { 'X-API-Key': 'bad-key' },
      });

      expect(res.status).toBe(403);
    });

    it('returns 404 when log not found', async () => {
      process.env.ADMIN_KEY = 'secret-key';
      mockRepo.getLog.mockResolvedValue(null);

      const res = await app.request('/workflows/wf-1/run/nonexistent', {
        headers: { 'X-API-Key': 'secret-key' },
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns log data when found with valid key', async () => {
      process.env.ADMIN_KEY = 'secret-key';
      mockRepo.getLog.mockResolvedValue(sampleLog);

      const res = await app.request('/workflows/wf-1/run/wflog-1', {
        headers: { 'X-API-Key': 'secret-key' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('wflog-1');
      expect(json.data.status).toBe('completed');
    });
  });

  // ========================================================================
  // POST /workflows/logs/:logId/replay
  // ========================================================================

  describe('POST /workflows/logs/:logId/replay', () => {
    it('returns 404 when log not found', async () => {
      mockRepo.getLog.mockResolvedValue(null);

      const res = await app.request('/workflows/logs/nonexistent/replay', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when log has no associated workflowId', async () => {
      mockRepo.getLog.mockResolvedValue({ ...sampleLog, workflowId: null });

      const res = await app.request('/workflows/logs/wflog-1/replay', { method: 'POST' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('deleted');
    });

    it('returns 404 when the associated workflow has been deleted', async () => {
      mockRepo.getLog.mockResolvedValueOnce({ ...sampleLog, workflowId: 'wf-deleted' });
      mockRepo.get.mockResolvedValue(null);

      const res = await app.request('/workflows/logs/wflog-1/replay', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 409 when the associated workflow is already running', async () => {
      mockRepo.getLog.mockResolvedValue({ ...sampleLog, workflowId: 'wf-1' });
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockService.isRunning.mockReturnValue(true);

      const res = await app.request('/workflows/logs/wflog-1/replay', { method: 'POST' });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('WORKFLOW_ALREADY_RUNNING');
    });

    it('starts SSE stream for valid replay request', async () => {
      mockRepo.getLog.mockResolvedValue({ ...sampleLog, workflowId: 'wf-1' });
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockService.isRunning.mockReturnValue(false);
      mockService.executeWorkflow.mockResolvedValue(undefined);

      const res = await app.request('/workflows/logs/wflog-1/replay', { method: 'POST' });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(mockService.executeWorkflow).toHaveBeenCalledWith('wf-1', 'u1', expect.any(Function));
    });
  });

  // ========================================================================
  // PATCH /workflows/:id — createVersion side-effect
  // ========================================================================

  describe('PATCH /workflows/:id — version snapshot', () => {
    it('calls createVersion before updating when nodes are included in patch', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockRepo.update.mockResolvedValue({ ...sampleWorkflow, name: 'Updated' });

      await app.request('/workflows/wf-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: [], edges: [] }),
      });

      expect(mockRepo.createVersion).toHaveBeenCalledWith('wf-1');
    });

    it('does not call createVersion when only name is updated', async () => {
      mockRepo.update.mockResolvedValue({ ...sampleWorkflow, name: 'New Name' });

      await app.request('/workflows/wf-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });

      expect(mockRepo.createVersion).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // retryCount / timeoutMs validation
  // ========================================================================

  describe('retryCount / timeoutMs validation', () => {
    beforeEach(async () => {
      // Use real validation for these tests
      const actual = await vi.importActual<typeof import('../middleware/validation.js')>(
        '../middleware/validation.js'
      );
      vi.mocked(mockValidateBody).mockImplementation((_schema, body) =>
        actual.validateBody(actual.createWorkflowSchema, body)
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
          nodes: [
            {
              id: 'n1',
              type: 'toolNode',
              position: { x: 0, y: 0 },
              data: { toolName: 'test', toolArgs: {}, label: 'T', retryCount: 3, timeoutMs: 60000 },
            },
          ],
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
          nodes: [
            {
              id: 'n1',
              type: 'toolNode',
              position: { x: 0, y: 0 },
              data: { toolName: 'test', toolArgs: {}, label: 'T', retryCount: 6 },
            },
          ],
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
          nodes: [
            {
              id: 'n1',
              type: 'toolNode',
              position: { x: 0, y: 0 },
              data: { toolName: 'test', toolArgs: {}, label: 'T', retryCount: -1 },
            },
          ],
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
          nodes: [
            {
              id: 'n1',
              type: 'toolNode',
              position: { x: 0, y: 0 },
              data: { toolName: 'test', toolArgs: {}, label: 'T', timeoutMs: 400000 },
            },
          ],
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
          nodes: [
            {
              id: 'n1',
              type: 'toolNode',
              position: { x: 0, y: 0 },
              data: { toolName: 'test', toolArgs: {}, label: 'T', timeoutMs: -1 },
            },
          ],
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
          nodes: [
            {
              id: 'n1',
              type: 'llmNode',
              position: { x: 0, y: 0 },
              data: {
                label: 'AI',
                provider: 'openai',
                model: 'gpt-4',
                userMessage: 'Hi',
                retryCount: 2,
                timeoutMs: 30000,
              },
            },
          ],
          edges: [],
        }),
      });

      expect(res.status).toBe(201);
    });
  });

  // ========================================================================
  // validateWorkflowSemantics — per-node type validation
  // ========================================================================

  describe('validateWorkflowSemantics — node type validation', () => {
    async function postWorkflow(nodes: unknown[], edges: unknown[]) {
      return app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Semantic Test', nodes, edges }),
      });
    }

    it('returns 400 when more than one trigger node is present', async () => {
      const res = await postWorkflow(
        [
          { id: 't1', type: 'triggerNode', data: {} },
          { id: 't2', type: 'triggerNode', data: {} },
        ],
        []
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('trigger');
    });

    it('returns 400 when more than one error handler node is present', async () => {
      const res = await postWorkflow(
        [
          { id: 'e1', type: 'errorHandlerNode', data: {} },
          { id: 'e2', type: 'errorHandlerNode', data: {} },
        ],
        []
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('error handler');
    });

    it('returns 400 for llmNode missing provider, model, and userMessage', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'llmNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('provider');
      expect(json.error.message).toContain('model');
      expect(json.error.message).toContain('userMessage');
    });

    it('returns 400 for conditionNode missing expression', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'conditionNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('expression');
    });

    it('returns 400 for codeNode missing language and code', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'codeNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('language');
      expect(json.error.message).toContain('code');
    });

    it('returns 400 for transformerNode missing expression', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'transformerNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('expression');
    });

    it('returns 400 for forEachNode missing arrayExpression', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'forEachNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('arrayExpression');
    });

    it('returns 400 for httpRequestNode missing method and url', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'httpRequestNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('method');
      expect(json.error.message).toContain('url');
    });

    it('returns 400 for delayNode missing duration and unit', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'delayNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('duration');
      expect(json.error.message).toContain('unit');
    });

    it('returns 400 for switchNode missing expression and cases', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'switchNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('expression');
    });

    it('returns 400 for toolNode missing toolName', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'toolNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('toolName');
    });

    it('returns 400 for subWorkflowNode missing subWorkflowId', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'subWorkflowNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Sub-workflow');
    });

    it('returns 400 for notificationNode missing message', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'notificationNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('message');
    });

    it('returns 400 for parallelNode with branchCount < 2', async () => {
      const res = await postWorkflow(
        [{ id: 'n1', type: 'parallelNode', data: { branchCount: 1 } }],
        []
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('branchCount');
    });

    it('returns 400 for parallelNode with non-numeric branchCount', async () => {
      const res = await postWorkflow([{ id: 'n1', type: 'parallelNode', data: {} }], []);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('branchCount');
    });
  });

  // ========================================================================
  // validateWorkflowSemantics — edge reference validation
  // ========================================================================

  describe('validateWorkflowSemantics — edge reference validation', () => {
    async function postWorkflow(nodes: unknown[], edges: unknown[]) {
      return app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Edge Test', nodes, edges }),
      });
    }

    it('returns 400 when edge source references a non-existent node', async () => {
      const res = await postWorkflow(
        [{ id: 'n1', type: 'toolNode', data: { toolName: 'tool1' } }],
        [{ id: 'e1', source: 'nonexistent', target: 'n1' }]
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('non-existent');
    });

    it('returns 400 when edge target references a non-existent node', async () => {
      const res = await postWorkflow(
        [{ id: 'n1', type: 'toolNode', data: { toolName: 'tool1' } }],
        [{ id: 'e1', source: 'n1', target: 'nonexistent' }]
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('non-existent');
    });
  });

  // ========================================================================
  // validateWorkflowSemantics — branching sourceHandle validation
  // ========================================================================

  describe('validateWorkflowSemantics — branching sourceHandle validation', () => {
    async function postWorkflow(nodes: unknown[], edges: unknown[]) {
      return app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Branch Test', nodes, edges }),
      });
    }

    it('returns 400 when conditionNode edge has no sourceHandle', async () => {
      const res = await postWorkflow(
        [
          { id: 'cond1', type: 'conditionNode', data: { expression: '$x > 0' } },
          { id: 'n2', type: 'toolNode', data: { toolName: 'tool' } },
        ],
        [{ id: 'e1', source: 'cond1', target: 'n2' }]
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('sourceHandle');
    });

    it('returns 400 when conditionNode edge has invalid sourceHandle (not true/false)', async () => {
      const res = await postWorkflow(
        [
          { id: 'cond1', type: 'conditionNode', data: { expression: '$x > 0' } },
          { id: 'n2', type: 'toolNode', data: { toolName: 'tool' } },
        ],
        [{ id: 'e1', source: 'cond1', target: 'n2', sourceHandle: 'invalid' }]
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('"true"');
    });

    it('returns 400 when forEachNode edge has no sourceHandle', async () => {
      const res = await postWorkflow(
        [
          { id: 'fe1', type: 'forEachNode', data: { arrayExpression: '$.items' } },
          { id: 'n2', type: 'toolNode', data: { toolName: 'tool' } },
        ],
        [{ id: 'e1', source: 'fe1', target: 'n2' }]
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('sourceHandle');
    });

    it('returns 400 when forEachNode edge has invalid sourceHandle', async () => {
      const res = await postWorkflow(
        [
          { id: 'fe1', type: 'forEachNode', data: { arrayExpression: '$.items' } },
          { id: 'n2', type: 'toolNode', data: { toolName: 'tool' } },
        ],
        [{ id: 'e1', source: 'fe1', target: 'n2', sourceHandle: 'badHandle' }]
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('"each"');
    });

    it('returns 400 when switchNode edge has invalid sourceHandle (not a case label)', async () => {
      const res = await postWorkflow(
        [
          {
            id: 'sw1',
            type: 'switchNode',
            data: { expression: '$.type', cases: [{ label: 'A' }, { label: 'B' }] },
          },
          { id: 'n2', type: 'toolNode', data: { toolName: 'tool' } },
        ],
        [{ id: 'e1', source: 'sw1', target: 'n2', sourceHandle: 'C' }]
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('case label');
    });

    it('returns 400 when switchNode edge has no sourceHandle', async () => {
      const res = await postWorkflow(
        [
          {
            id: 'sw1',
            type: 'switchNode',
            data: { expression: '$.type', cases: [{ label: 'A' }] },
          },
          { id: 'n2', type: 'toolNode', data: { toolName: 'tool' } },
        ],
        [{ id: 'e1', source: 'sw1', target: 'n2' }]
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('sourceHandle');
    });

    it('returns 400 when parallelNode edge has invalid sourceHandle', async () => {
      const res = await postWorkflow(
        [
          { id: 'par1', type: 'parallelNode', data: { branchCount: 2 } },
          { id: 'n2', type: 'toolNode', data: { toolName: 'tool' } },
        ],
        [{ id: 'e1', source: 'par1', target: 'n2', sourceHandle: 'branch-5' }]
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('branch-0');
    });

    it('returns 400 when parallelNode edge has no sourceHandle', async () => {
      const res = await postWorkflow(
        [
          { id: 'par1', type: 'parallelNode', data: { branchCount: 2 } },
          { id: 'n2', type: 'toolNode', data: { toolName: 'tool' } },
        ],
        [{ id: 'e1', source: 'par1', target: 'n2' }]
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('sourceHandle');
    });
  });

  // ========================================================================
  // validateWorkflowSemantics — output alias validation
  // ========================================================================

  describe('validateWorkflowSemantics — output alias validation', () => {
    async function postWorkflow(nodes: unknown[], edges: unknown[]) {
      return app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alias Test', nodes, edges }),
      });
    }

    it('returns 400 when output alias is a reserved word', async () => {
      const res = await postWorkflow(
        [{ id: 'n1', type: 'toolNode', data: { toolName: 'tool', outputAlias: 'variables' } }],
        []
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('reserved');
    });

    it('returns 400 when output alias is not a valid identifier', async () => {
      const res = await postWorkflow(
        [{ id: 'n1', type: 'toolNode', data: { toolName: 'tool', outputAlias: '123bad' } }],
        []
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('valid identifier');
    });

    it('returns 400 when two nodes share the same output alias', async () => {
      const res = await postWorkflow(
        [
          { id: 'n1', type: 'toolNode', data: { toolName: 'tool1', outputAlias: 'myOutput' } },
          { id: 'n2', type: 'toolNode', data: { toolName: 'tool2', outputAlias: 'myOutput' } },
        ],
        []
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Duplicate');
    });

    it('accepts nodes with valid unique output aliases', async () => {
      mockRepo.create.mockResolvedValue(sampleWorkflow);
      const res = await postWorkflow(
        [
          { id: 'n1', type: 'toolNode', data: { toolName: 'tool1', outputAlias: 'resultA' } },
          { id: 'n2', type: 'toolNode', data: { toolName: 'tool2', outputAlias: 'resultB' } },
        ],
        []
      );
      expect(res.status).toBe(201);
    });
  });

  // ========================================================================
  // validateWorkflowSemantics — cycle detection via detectCycle
  // ========================================================================

  describe('validateWorkflowSemantics — detectCycle integration', () => {
    it('returns 400 VALIDATION_ERROR when detectCycle reports a cycle', async () => {
      vi.mocked(mockDetectCycle).mockReturnValue('Cycle detected: n1 -> n2 -> n1');

      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Cycle Test',
          nodes: [
            { id: 'n1', type: 'toolNode', data: { toolName: 'tool1' } },
            { id: 'n2', type: 'toolNode', data: { toolName: 'tool2' } },
          ],
          edges: [
            { id: 'e1', source: 'n1', target: 'n2' },
            { id: 'e2', source: 'n2', target: 'n1' },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('Cycle detected');
    });
  });

  // ========================================================================
  // POST /workflows — validateBody throws (line 257)
  // ========================================================================

  describe('POST /workflows — validateBody throws', () => {
    it('returns 400 VALIDATION_ERROR when validateBody throws', async () => {
      vi.mocked(mockValidateBody).mockImplementationOnce(() => {
        throw new Error('Required field "name" is missing');
      });

      const res = await app.request('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: [], edges: [] }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('name');
    });
  });

  // ========================================================================
  // PATCH /workflows/:id — validateBody throws (line 446) and semantic errors (line 468)
  // ========================================================================

  describe('PATCH /workflows/:id — additional validation coverage', () => {
    it('returns 400 when validateBody throws during PATCH (line 446)', async () => {
      vi.mocked(mockValidateBody).mockImplementationOnce(() => {
        throw new Error('Invalid field type for update');
      });

      const res = await app.request('/workflows/wf-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('Invalid field type');
    });

    it('returns 400 when PATCH nodes contain semantic errors (line 468)', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);

      const res = await app.request('/workflows/wf-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: [{ id: 'n1', type: 'llmNode', data: {} }], // missing provider/model/userMessage
          edges: [],
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('provider');
    });
  });

  // ========================================================================
  // POST /workflows/:id/execute — SSE callback lines 561 & 569
  // ========================================================================

  describe('POST /workflows/:id/execute — SSE event callbacks', () => {
    it('SSE stream writes node events when executeWorkflow calls onEvent (line 561)', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockService.isRunning.mockReturnValue(false);
      mockService.executeWorkflow.mockImplementation(
        async (
          _id: string,
          _userId: string,
          onEvent: (event: Record<string, unknown>) => Promise<void>
        ) => {
          await onEvent({ type: 'nodeStarted', nodeId: 'n1', label: 'Step 1' });
          await onEvent({ type: 'completed', durationMs: 100 });
        }
      );

      const res = await app.request('/workflows/wf-1/execute', { method: 'POST' });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const body = await res.text();
      expect(body).toContain('nodeStarted');
      expect(body).toContain('completed');
    });

    it('SSE stream writes error event when executeWorkflow throws (line 569)', async () => {
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockService.isRunning.mockReturnValue(false);
      mockService.executeWorkflow.mockRejectedValue(new Error('Execution crashed'));

      const res = await app.request('/workflows/wf-1/execute', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('error');
      expect(body).toContain('Execution crashed');
    });
  });

  // ========================================================================
  // POST /workflows/:id/run — background execution success & timeout (lines 837–872)
  // ========================================================================

  describe('POST /workflows/:id/run — background execution paths', () => {
    const origEnv = process.env.ADMIN_KEY;

    afterEach(() => {
      if (origEnv === undefined) {
        delete process.env.ADMIN_KEY;
      } else {
        process.env.ADMIN_KEY = origEnv;
      }
      vi.useRealTimers();
    });

    it('returns 200 with logId when executeWorkflow fires started event (lines 837–872)', async () => {
      process.env.ADMIN_KEY = 'secret-key';
      mockRepo.get.mockResolvedValue({ ...sampleWorkflow, inputSchema: [] });
      mockService.isRunning.mockReturnValue(false);
      mockService.executeWorkflow.mockImplementation(
        async (
          _id: string,
          _userId: string,
          onEvent: (event: Record<string, unknown>) => Promise<void>
        ) => {
          await onEvent({ type: 'started', logId: 'run-log-abc' });
        }
      );

      const res = await app.request('/workflows/wf-1/run', {
        method: 'POST',
        headers: { 'X-API-Key': 'secret-key' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.logId).toBe('run-log-abc');
      expect(json.data.workflowId).toBe('wf-1');
      expect(json.data.status).toBe('running');
      expect(json.data.pollUrl).toContain('run-log-abc');
    });

    it('returns 500 when started event is not fired within 5s timeout (line 864)', async () => {
      process.env.ADMIN_KEY = 'secret-key';
      mockRepo.get.mockResolvedValue({ ...sampleWorkflow, inputSchema: [] });
      mockService.isRunning.mockReturnValue(false);

      // executeWorkflow never fires the 'started' event
      let resolveExecution!: () => void;
      mockService.executeWorkflow.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveExecution = resolve;
        })
      );

      vi.useFakeTimers();

      const reqPromise = app.request('/workflows/wf-1/run', {
        method: 'POST',
        headers: { 'X-API-Key': 'secret-key' },
      });

      await vi.advanceTimersByTimeAsync(5001);
      vi.useRealTimers();
      resolveExecution(); // clean up hanging promise

      const res = await reqPromise;

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('INTERNAL_ERROR');
      expect(json.error.message).toContain('timeout');
    });
  });

  // ========================================================================
  // POST /workflows/logs/:logId/replay — SSE callback lines 950 & 953
  // ========================================================================

  describe('POST /workflows/logs/:logId/replay — SSE event callbacks', () => {
    it('SSE stream writes events when executeWorkflow calls onEvent during replay (line 950)', async () => {
      mockRepo.getLog.mockResolvedValue({ ...sampleLog, workflowId: 'wf-1' });
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockService.isRunning.mockReturnValue(false);
      mockService.executeWorkflow.mockImplementation(
        async (
          _id: string,
          _userId: string,
          onEvent: (event: Record<string, unknown>) => Promise<void>
        ) => {
          await onEvent({ type: 'nodeStarted', nodeId: 'n1' });
          await onEvent({ type: 'completed' });
        }
      );

      const res = await app.request('/workflows/logs/wflog-1/replay', { method: 'POST' });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const body = await res.text();
      expect(body).toContain('nodeStarted');
      expect(body).toContain('completed');
    });

    it('SSE stream writes error event when executeWorkflow throws during replay (line 953)', async () => {
      mockRepo.getLog.mockResolvedValue({ ...sampleLog, workflowId: 'wf-1' });
      mockRepo.get.mockResolvedValue(sampleWorkflow);
      mockService.isRunning.mockReturnValue(false);
      mockService.executeWorkflow.mockRejectedValue(new Error('Replay crashed'));

      const res = await app.request('/workflows/logs/wflog-1/replay', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('error');
      expect(body).toContain('Replay crashed');
    });
  });
});
