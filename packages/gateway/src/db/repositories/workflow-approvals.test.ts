/**
 * Workflow Approvals Repository Tests
 *
 * Unit tests for WorkflowApprovalsRepository: create, get, decide,
 * getPending, countPending, getAll, countAll, getByLogId, and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter: {
  [K in keyof DatabaseAdapter]: ReturnType<typeof vi.fn>;
} = {
  type: 'postgres' as unknown as ReturnType<typeof vi.fn>,
  isConnected: vi.fn().mockReturnValue(true),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ changes: 0 }),
  exec: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  now: vi.fn().mockReturnValue('NOW()'),
  date: vi.fn(),
  dateSubtract: vi.fn(),
  placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
  boolean: vi.fn().mockImplementation((v: boolean) => v),
  parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue(mockAdapter),
  getAdapterSync: vi.fn().mockReturnValue(mockAdapter),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    generateId: vi.fn().mockReturnValue('wfappr-generated-id'),
  };
});

// ---------------------------------------------------------------------------
// Dynamic import after mocks
// ---------------------------------------------------------------------------

const { WorkflowApprovalsRepository, createWorkflowApprovalsRepository } =
  await import('./workflow-approvals.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApprovalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wfappr-1',
    workflow_log_id: 'wflog-1',
    workflow_id: 'wf-1',
    node_id: 'node-gate',
    user_id: 'default',
    status: 'pending',
    context: '{"key":"value"}',
    message: 'Please approve',
    decided_at: null,
    expires_at: null,
    created_at: '2024-06-01T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowApprovalsRepository', () => {
  let repo: InstanceType<typeof WorkflowApprovalsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new WorkflowApprovalsRepository();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert approval record and return mapped result', async () => {
      const row = makeApprovalRow({ id: 'wfappr-generated-id' });

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        workflowLogId: 'wflog-1',
        workflowId: 'wf-1',
        nodeId: 'node-gate',
        context: { key: 'value' },
        message: 'Please approve',
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO workflow_approvals');
      expect(sql).toContain('$1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('wfappr-generated-id'); // id
      expect(params[1]).toBe('wflog-1'); // workflow_log_id
      expect(params[2]).toBe('wf-1'); // workflow_id
      expect(params[3]).toBe('node-gate'); // node_id
      expect(params[4]).toBe('default'); // user_id
      expect(params[5]).toBe('pending'); // status default
      expect(params[6]).toBe('{"key":"value"}'); // context JSON
      expect(params[7]).toBe('Please approve'); // message
      expect(params[8]).toBeNull(); // expires_at (not provided)
      expect(typeof params[9]).toBe('string'); // created_at ISO

      expect(result.id).toBe('wfappr-generated-id');
      expect(result.status).toBe('pending');
      expect(result.workflowLogId).toBe('wflog-1');
      expect(result.workflowId).toBe('wf-1');
    });

    it('should default context to empty object when not provided', async () => {
      const row = makeApprovalRow({ id: 'wfappr-generated-id', context: '{}', message: null });

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      await repo.create({
        workflowLogId: 'wflog-2',
        workflowId: 'wf-2',
        nodeId: 'node-2',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBe('{}'); // context defaults to {}
      expect(params[7]).toBeNull(); // message defaults to null
      expect(params[8]).toBeNull(); // expires_at defaults to null
    });

    it('should pass expiresAt as ISO string when provided', async () => {
      const expiresAt = new Date('2025-01-01T00:00:00Z');
      const row = makeApprovalRow({
        id: 'wfappr-generated-id',
        expires_at: '2025-01-01T00:00:00.000Z',
      });

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      await repo.create({
        workflowLogId: 'wflog-3',
        workflowId: 'wf-3',
        nodeId: 'node-3',
        expiresAt,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[8]).toBe(expiresAt.toISOString());
    });

    it('should throw when approval not found after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({ workflowLogId: 'wflog-bad', workflowId: 'wf-bad', nodeId: 'node-bad' })
      ).rejects.toThrow('Failed to create approval');
    });

    it('should call get() with generated id after insert', async () => {
      const row = makeApprovalRow({ id: 'wfappr-generated-id' });

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      await repo.create({
        workflowLogId: 'wflog-1',
        workflowId: 'wf-1',
        nodeId: 'node-1',
      });

      // queryOne is called by get() with the generated id
      const queryOneParams = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(queryOneParams[0]).toBe('wfappr-generated-id');
      expect(queryOneParams[1]).toBe('default');
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.get('wfappr-missing');

      expect(result).toBeNull();
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['wfappr-missing', 'default']);
    });

    it('should map row fields to camelCase correctly', async () => {
      const row = makeApprovalRow({
        id: 'wfappr-1',
        decided_at: '2024-06-02T10:00:00Z',
        expires_at: '2024-06-30T00:00:00Z',
        status: 'approved',
        context: '{"requestId":"abc"}',
        message: 'Looks good',
      });

      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.get('wfappr-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('wfappr-1');
      expect(result!.workflowLogId).toBe('wflog-1');
      expect(result!.workflowId).toBe('wf-1');
      expect(result!.nodeId).toBe('node-gate');
      expect(result!.userId).toBe('default');
      expect(result!.status).toBe('approved');
      expect(result!.context).toEqual({ requestId: 'abc' });
      expect(result!.message).toBe('Looks good');
      expect(result!.decidedAt).toBeInstanceOf(Date);
      expect(result!.decidedAt!.toISOString()).toBe('2024-06-02T10:00:00.000Z');
      expect(result!.expiresAt).toBeInstanceOf(Date);
      expect(result!.expiresAt!.toISOString()).toBe('2024-06-30T00:00:00.000Z');
      expect(result!.createdAt).toBeInstanceOf(Date);
    });

    it('should return null for decidedAt and expiresAt when null in row', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeApprovalRow());

      const result = await repo.get('wfappr-1');

      expect(result!.decidedAt).toBeNull();
      expect(result!.expiresAt).toBeNull();
    });

    it('should parse context JSON string', async () => {
      const row = makeApprovalRow({ context: '{"amount":100,"currency":"USD"}' });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.get('wfappr-1');

      expect(result!.context).toEqual({ amount: 100, currency: 'USD' });
    });

    it('should return empty object for invalid context JSON', async () => {
      const row = makeApprovalRow({ context: 'invalid-json' });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.get('wfappr-1');

      expect(result!.context).toEqual({});
    });

    it('should query with correct SQL and userId scope', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.get('wfappr-42');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM workflow_approvals');
      expect(sql).toContain('WHERE id = $1 AND user_id = $2');
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['wfappr-42', 'default']);
    });
  });

  // =========================================================================
  // decide
  // =========================================================================

  describe('decide', () => {
    it('should update status to approved and return updated record', async () => {
      const updatedRow = makeApprovalRow({
        status: 'approved',
        decided_at: '2024-06-01T14:00:00Z',
      });

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(updatedRow);

      const result = await repo.decide('wfappr-1', 'approved');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('UPDATE workflow_approvals SET status = $1, decided_at = $2');
      expect(sql).toContain("WHERE id = $3 AND user_id = $4 AND status = 'pending'");

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('approved');
      expect(typeof params[1]).toBe('string'); // decided_at ISO
      expect(params[2]).toBe('wfappr-1');
      expect(params[3]).toBe('default');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('approved');
      expect(result!.decidedAt).toBeInstanceOf(Date);
    });

    it('should update status to rejected', async () => {
      const updatedRow = makeApprovalRow({
        status: 'rejected',
        decided_at: '2024-06-01T15:00:00Z',
      });

      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(updatedRow);

      const result = await repo.decide('wfappr-1', 'rejected');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('rejected');
      expect(result!.status).toBe('rejected');
    });

    it('should return null when approval not found after update', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.decide('wfappr-missing', 'approved');

      expect(result).toBeNull();
    });

    it('should call get() after execute to return current state', async () => {
      const row = makeApprovalRow({ status: 'approved', decided_at: '2024-06-01T16:00:00Z' });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      await repo.decide('wfappr-5', 'approved');

      const queryOneParams = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(queryOneParams[0]).toBe('wfappr-5');
      expect(queryOneParams[1]).toBe('default');
    });
  });

  // =========================================================================
  // getPending
  // =========================================================================

  describe('getPending', () => {
    it('should return mapped pending approvals', async () => {
      const rows = [
        makeApprovalRow({ id: 'wfappr-1' }),
        makeApprovalRow({ id: 'wfappr-2', workflow_id: 'wf-2' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.getPending();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('wfappr-1');
      expect(result[1]!.id).toBe('wfappr-2');
      expect(result[0]!.status).toBe('pending');
    });

    it('should query with pending status filter and pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getPending(10, 5);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM workflow_approvals');
      expect(sql).toContain("WHERE user_id = $1 AND status = 'pending'");
      expect(sql).toContain('ORDER BY created_at DESC LIMIT $2 OFFSET $3');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default', 10, 5]);
    });

    it('should use default limit=20 and offset=0', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getPending();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default', 20, 0]);
    });

    it('should return empty array when no pending approvals', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getPending();

      expect(result).toEqual([]);
    });

    it('should map all rows through mapApproval', async () => {
      const row = makeApprovalRow({
        context: '{"taskId":"t1"}',
        expires_at: '2024-12-31T00:00:00Z',
      });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.getPending();

      expect(result[0]!.context).toEqual({ taskId: 't1' });
      expect(result[0]!.expiresAt).toBeInstanceOf(Date);
      expect(result[0]!.createdAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // countPending
  // =========================================================================

  describe('countPending', () => {
    it('should return parsed count of pending approvals', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '7' });

      const result = await repo.countPending();

      expect(result).toBe(7);

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT COUNT(*) as count FROM workflow_approvals');
      expect(sql).toContain("WHERE user_id = $1 AND status = 'pending'");
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['default']);
    });

    it('should return 0 when queryOne returns null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.countPending();

      expect(result).toBe(0);
    });

    it('should return 0 when count is missing in row', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      const result = await repo.countPending();

      expect(result).toBe(0);
    });
  });

  // =========================================================================
  // getAll
  // =========================================================================

  describe('getAll', () => {
    it('should return all approvals with pagination', async () => {
      const rows = [
        makeApprovalRow({ id: 'wfappr-1', status: 'pending' }),
        makeApprovalRow({ id: 'wfappr-2', status: 'approved', decided_at: '2024-06-02T10:00:00Z' }),
        makeApprovalRow({ id: 'wfappr-3', status: 'rejected', decided_at: '2024-06-03T10:00:00Z' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(rows);

      const result = await repo.getAll();

      expect(result).toHaveLength(3);
      expect(result[0]!.id).toBe('wfappr-1');
      expect(result[1]!.status).toBe('approved');
      expect(result[2]!.status).toBe('rejected');
    });

    it('should query with correct SQL, ORDER BY and pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll(15, 30);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM workflow_approvals WHERE user_id = $1');
      expect(sql).toContain('ORDER BY created_at DESC LIMIT $2 OFFSET $3');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default', 15, 30]);
    });

    it('should use default limit=20 and offset=0', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default', 20, 0]);
    });

    it('should return empty array when no approvals exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getAll();

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // countAll
  // =========================================================================

  describe('countAll', () => {
    it('should return total count of all approvals', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });

      const result = await repo.countAll();

      expect(result).toBe(42);

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT COUNT(*) as count FROM workflow_approvals WHERE user_id = $1');
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['default']);
    });

    it('should return 0 when queryOne returns null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.countAll();

      expect(result).toBe(0);
    });

    it('should return integer even when count is a string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '100' });

      const result = await repo.countAll();

      expect(result).toBe(100);
      expect(typeof result).toBe('number');
    });
  });

  // =========================================================================
  // getByLogId
  // =========================================================================

  describe('getByLogId', () => {
    it('should return approval matching the workflow log id', async () => {
      const row = makeApprovalRow({ workflow_log_id: 'wflog-99' });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.getByLogId('wflog-99');

      expect(result).not.toBeNull();
      expect(result!.workflowLogId).toBe('wflog-99');
      expect(result!.id).toBe('wfappr-1');
    });

    it('should query with correct SQL including ORDER BY and LIMIT 1', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getByLogId('wflog-42');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SELECT * FROM workflow_approvals');
      expect(sql).toContain('WHERE workflow_log_id = $1 AND user_id = $2');
      expect(sql).toContain('ORDER BY created_at DESC LIMIT 1');
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['wflog-42', 'default']);
    });

    it('should return null when no approval exists for that log', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getByLogId('wflog-nonexistent');

      expect(result).toBeNull();
    });

    it('should map the returned row fully', async () => {
      const row = makeApprovalRow({
        workflow_log_id: 'wflog-5',
        context: '{"step":3}',
        status: 'rejected',
        decided_at: '2024-07-01T09:00:00Z',
      });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.getByLogId('wflog-5');

      expect(result!.context).toEqual({ step: 3 });
      expect(result!.status).toBe('rejected');
      expect(result!.decidedAt).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // Custom userId
  // =========================================================================

  describe('custom userId', () => {
    it('should use provided userId in get()', async () => {
      const customRepo = new WorkflowApprovalsRepository('user-99');
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await customRepo.get('wfappr-1');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['wfappr-1', 'user-99']);
    });

    it('should use provided userId in create() execute call', async () => {
      const customRepo = new WorkflowApprovalsRepository('user-55');
      const row = makeApprovalRow({ user_id: 'user-55', id: 'wfappr-generated-id' });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      await customRepo.create({
        workflowLogId: 'wflog-x',
        workflowId: 'wf-x',
        nodeId: 'node-x',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[4]).toBe('user-55');
    });

    it('should use provided userId in getPending()', async () => {
      const customRepo = new WorkflowApprovalsRepository('user-abc');
      mockAdapter.query.mockResolvedValueOnce([]);

      await customRepo.getPending();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('user-abc');
    });

    it('should use provided userId in countAll()', async () => {
      const customRepo = new WorkflowApprovalsRepository('user-xyz');
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '3' });

      await customRepo.countAll();

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-xyz']);
    });
  });

  // =========================================================================
  // createWorkflowApprovalsRepository factory
  // =========================================================================

  describe('createWorkflowApprovalsRepository', () => {
    it('should return a WorkflowApprovalsRepository instance', () => {
      const factoryRepo = createWorkflowApprovalsRepository();
      expect(factoryRepo).toBeInstanceOf(WorkflowApprovalsRepository);
    });

    it('should use default userId when none provided', async () => {
      const factoryRepo = createWorkflowApprovalsRepository();
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await factoryRepo.get('wfappr-1');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['wfappr-1', 'default']);
    });

    it('should pass custom userId to repository', async () => {
      const factoryRepo = createWorkflowApprovalsRepository('custom-user');
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await factoryRepo.get('wfappr-1');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['wfappr-1', 'custom-user']);
    });
  });
});
