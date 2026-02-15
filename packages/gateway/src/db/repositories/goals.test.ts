/**
 * GoalsRepository Tests
 *
 * Unit tests for goal CRUD, step management, progress tracking,
 * status transitions, filtering, and statistics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockAdapter = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  exec: vi.fn(),
  transaction: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
  isConnected: vi.fn(() => true),
  close: vi.fn(),
  now: vi.fn(() => 'NOW()'),
  date: vi.fn((col: string) => `DATE(${col})`),
  dateSubtract: vi.fn(),
  placeholder: vi.fn((i: number) => `$${i}`),
  boolean: vi.fn((v: boolean) => v),
  parseBoolean: vi.fn((v: unknown) => Boolean(v)),
  type: 'postgres' as const,
}));

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn(async () => mockAdapter),
  getAdapterSync: vi.fn(() => mockAdapter),
}));

const mockEmit = vi.hoisted(() => vi.fn());

vi.mock('@ownpilot/core', () => ({
  getEventBus: () => ({ emit: mockEmit }),
  createEvent: vi.fn(
    (type: string, category: string, source: string, data: unknown) => ({
      type,
      category,
      source,
      data,
      timestamp: new Date().toISOString(),
    }),
  ),
  EventTypes: {
    RESOURCE_CREATED: 'resource.created',
    RESOURCE_UPDATED: 'resource.updated',
    RESOURCE_DELETED: 'resource.deleted',
  },
  generateId: (prefix: string) => `${prefix}_test_${Date.now()}`,
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { GoalsRepository } from './goals.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_ISO = '2025-01-15T12:00:00.000Z';

function goalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'goal_1',
    user_id: 'user-1',
    title: 'Learn TypeScript',
    description: 'Master TS fundamentals',
    status: 'active',
    priority: 5,
    parent_id: null,
    due_date: '2025-12-31',
    progress: 0,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    completed_at: null,
    metadata: '{}',
    ...overrides,
  };
}

function stepRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step_1',
    goal_id: 'goal_1',
    title: 'Read docs',
    description: null,
    status: 'pending',
    order_num: 0,
    dependencies: '[]',
    result: null,
    created_at: NOW_ISO,
    completed_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoalsRepository', () => {
  let repo: GoalsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset persistent mockResolvedValue defaults so they don't leak between tests
    mockAdapter.query.mockReset();
    mockAdapter.queryOne.mockReset();
    mockAdapter.execute.mockReset();
    mockEmit.mockReset();
    repo = new GoalsRepository('user-1');
  });

  // ==========================================================================
  // Goal CRUD
  // ==========================================================================

  describe('create', () => {
    it('inserts a goal and returns it', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(goalRow());

      const goal = await repo.create({ title: 'Learn TypeScript' });

      expect(goal.id).toBe('goal_1');
      expect(goal.title).toBe('Learn TypeScript');
      expect(goal.status).toBe('active');
      expect(goal.createdAt).toBeInstanceOf(Date);
      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
    });

    it('applies default values', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(goalRow());

      await repo.create({ title: 'Test' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // status defaults to 'active'
      expect(params[4]).toBe('active');
      // priority defaults to 5
      expect(params[5]).toBe(5);
      // progress starts at 0
      expect(params[8]).toBe(0);
    });

    it('emits RESOURCE_CREATED event', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(goalRow());

      await repo.create({ title: 'Test' });

      expect(mockEmit).toHaveBeenCalledTimes(1);
    });

    it('throws when goal not found after insert', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValue(null);

      await expect(repo.create({ title: 'Test' })).rejects.toThrow('Failed to create goal');
    });
  });

  describe('get', () => {
    it('returns mapped goal when found', async () => {
      mockAdapter.queryOne.mockResolvedValue(goalRow());

      const goal = await repo.get('goal_1');

      expect(goal).not.toBeNull();
      expect(goal!.userId).toBe('user-1');
      expect(goal!.priority).toBe(5);
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const goal = await repo.get('nonexistent');
      expect(goal).toBeNull();
    });

    it('parses JSON metadata from string', async () => {
      mockAdapter.queryOne.mockResolvedValue(goalRow({ metadata: '{"key":"val"}' }));

      const goal = await repo.get('goal_1');
      expect(goal!.metadata).toEqual({ key: 'val' });
    });
  });

  describe('getById', () => {
    it('delegates to get()', async () => {
      mockAdapter.queryOne.mockResolvedValue(goalRow());

      const goal = await repo.getById('goal_1');
      expect(goal).not.toBeNull();
      expect(goal!.id).toBe('goal_1');
    });
  });

  describe('update', () => {
    it('returns null when goal not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const result = await repo.update('no-goal', { title: 'New' });
      expect(result).toBeNull();
    });

    it('updates title and returns refreshed goal', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow()) // existing
        .mockResolvedValueOnce(goalRow({ title: 'Updated' })); // refreshed
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const result = await repo.update('goal_1', { title: 'Updated' });

      expect(result!.title).toBe('Updated');
    });

    it('sets completed_at when status changes to completed', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow())
        .mockResolvedValueOnce(goalRow({ status: 'completed', completed_at: NOW_ISO }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('goal_1', { status: 'completed' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('completed_at');
    });

    it('clamps priority between 1 and 10', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow())
        .mockResolvedValueOnce(goalRow({ priority: 10 }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('goal_1', { priority: 15 });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // priority should be clamped to 10
      expect(params).toContain(10);
    });

    it('clamps priority minimum to 1', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow())
        .mockResolvedValueOnce(goalRow({ priority: 1 }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('goal_1', { priority: -5 });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain(1);
    });

    it('clamps progress between 0 and 100', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow())
        .mockResolvedValueOnce(goalRow({ progress: 100 }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('goal_1', { progress: 150 });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain(100);
    });

    it('emits RESOURCE_UPDATED event', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow())
        .mockResolvedValueOnce(goalRow({ title: 'New' }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.update('goal_1', { title: 'New' });

      expect(mockEmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('returns true when deleted', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const result = await repo.delete('goal_1');
      expect(result).toBe(true);
    });

    it('returns false when not found', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      const result = await repo.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('emits RESOURCE_DELETED event when deleted', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.delete('goal_1');

      expect(mockEmit).toHaveBeenCalledTimes(1);
    });

    it('does not emit event when not found', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 0 });

      await repo.delete('nonexistent');

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // List & Filtering
  // ==========================================================================

  describe('list', () => {
    it('returns all goals for user', async () => {
      mockAdapter.query.mockResolvedValue([goalRow(), goalRow({ id: 'goal_2' })]);

      const goals = await repo.list();
      expect(goals).toHaveLength(2);
    });

    it('filters by single status', async () => {
      mockAdapter.query.mockResolvedValue([goalRow({ status: 'active' })]);

      await repo.list({ status: 'active' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('status IN');
    });

    it('filters by multiple statuses', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ status: ['active', 'paused'] });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('status IN');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('active');
      expect(params).toContain('paused');
    });

    it('filters by parentId', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ parentId: 'goal_parent' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('parent_id');
    });

    it('filters for root goals (parentId null)', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ parentId: null });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('parent_id IS NULL');
    });

    it('filters by minimum priority', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ minPriority: 7 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('priority >=');
    });

    it('applies search filter', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ search: 'typescript' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ILIKE');
    });

    it('orders by priority', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ orderBy: 'priority' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY priority DESC');
    });

    it('orders by due_date', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ orderBy: 'due_date' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY due_date ASC');
    });

    it('orders by progress', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ orderBy: 'progress' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY progress DESC');
    });

    it('defaults to ordering by created_at', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('applies limit and offset', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.list({ limit: 5, offset: 10 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });
  });

  describe('getActive', () => {
    it('returns active goals ordered by priority', async () => {
      mockAdapter.query.mockResolvedValue([goalRow()]);

      const goals = await repo.getActive();

      expect(goals).toHaveLength(1);
    });

    it('passes limit parameter', async () => {
      mockAdapter.query.mockResolvedValue([]);

      await repo.getActive(5);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(5);
    });
  });

  describe('getUpcoming', () => {
    it('returns goals with upcoming due dates', async () => {
      mockAdapter.query.mockResolvedValue([
        goalRow({ due_date: '2025-01-20' }),
      ]);

      const goals = await repo.getUpcoming(7);

      expect(goals).toHaveLength(1);
      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('due_date');
      expect(sql).toContain("status = 'active'");
    });
  });

  // ==========================================================================
  // Goal Steps
  // ==========================================================================

  describe('addStep', () => {
    it('adds a step and returns it', async () => {
      // get goal
      mockAdapter.queryOne.mockResolvedValueOnce(goalRow());
      // max order_num
      mockAdapter.queryOne.mockResolvedValueOnce({ max_order: 2 });
      // insert
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      // getStep
      mockAdapter.queryOne.mockResolvedValueOnce(stepRow({ order_num: 3 }));

      const step = await repo.addStep('goal_1', { title: 'Build project' });

      expect(step).not.toBeNull();
      expect(step!.title).toBe('Read docs');
      expect(step!.orderNum).toBe(3);
    });

    it('returns null when goal not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const step = await repo.addStep('nonexistent', { title: 'X' });
      expect(step).toBeNull();
    });

    it('uses provided orderNum', async () => {
      // get goal
      mockAdapter.queryOne.mockResolvedValueOnce(goalRow());
      // insert (no max_order query needed)
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      // getStep
      mockAdapter.queryOne.mockResolvedValueOnce(stepRow({ order_num: 5 }));

      const step = await repo.addStep('goal_1', { title: 'X', orderNum: 5 });

      expect(step).not.toBeNull();
      // Should NOT query for max order when orderNum is provided
      // First queryOne = get goal, second = getStep (no max_order call)
      expect(mockAdapter.queryOne).toHaveBeenCalledTimes(2);
    });

    it('auto-assigns orderNum when not provided', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow()) // get goal
        .mockResolvedValueOnce({ max_order: null }) // max order (no existing steps)
        .mockResolvedValueOnce(stepRow({ order_num: 0 })); // getStep
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.addStep('goal_1', { title: 'First step' });

      const insertParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // order_num should be 0 (null + 1 = 0 per the source logic)
      expect(insertParams[5]).toBe(0);
    });

    it('serializes dependencies as JSON', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow())
        .mockResolvedValueOnce({ max_order: 0 })
        .mockResolvedValueOnce(stepRow());
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.addStep('goal_1', {
        title: 'Step 2',
        dependencies: ['step_1'],
      });

      const insertParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(insertParams[6]).toBe('["step_1"]');
    });
  });

  describe('getStep', () => {
    it('returns mapped step', async () => {
      mockAdapter.queryOne.mockResolvedValue(stepRow());

      const step = await repo.getStep('step_1');

      expect(step).not.toBeNull();
      expect(step!.goalId).toBe('goal_1');
      expect(step!.dependencies).toEqual([]);
    });

    it('returns null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const step = await repo.getStep('nonexistent');
      expect(step).toBeNull();
    });
  });

  describe('updateStep', () => {
    it('returns null when step not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const result = await repo.updateStep('no-step', { status: 'completed' });
      expect(result).toBeNull();
    });

    it('returns existing step when no fields to update', async () => {
      mockAdapter.queryOne.mockResolvedValue(stepRow());

      const result = await repo.updateStep('step_1', {});

      expect(result).not.toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('sets completed_at when status changes to completed', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(stepRow()) // existing
        .mockResolvedValueOnce(stepRow({ status: 'completed', completed_at: NOW_ISO })); // refreshed
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      // recalculateProgress calls getSteps and then update
      mockAdapter.query.mockResolvedValue([
        stepRow({ status: 'completed' }),
        stepRow({ id: 'step_2', status: 'pending' }),
      ]);
      // update goal progress (get goal, execute, get goal)
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow())
        .mockResolvedValueOnce(goalRow({ progress: 50 }))
        .mockResolvedValueOnce(stepRow({ status: 'completed', completed_at: NOW_ISO })); // final getStep

      await repo.updateStep('step_1', { status: 'completed' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('completed_at');
    });

    it('recalculates goal progress after step update', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(stepRow()) // existing step
        .mockResolvedValueOnce(stepRow({ status: 'completed' })); // updated step
      mockAdapter.execute.mockResolvedValue({ changes: 1 });
      // recalculateProgress
      mockAdapter.query.mockResolvedValue([
        stepRow({ status: 'completed' }),
        stepRow({ id: 'step_2', status: 'pending' }),
      ]);
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow()) // goal for update
        .mockResolvedValueOnce(goalRow({ progress: 50 })) // refreshed goal
        .mockResolvedValueOnce(stepRow({ status: 'completed' })); // final getStep

      await repo.updateStep('step_1', { title: 'Updated title' });

      // Should have called execute for step update + goal progress update
      expect(mockAdapter.execute).toHaveBeenCalled();
    });
  });

  describe('deleteStep', () => {
    it('returns false when step not found', async () => {
      mockAdapter.queryOne.mockResolvedValue(null);

      const result = await repo.deleteStep('nonexistent');
      expect(result).toBe(false);
    });

    it('deletes step and recalculates progress', async () => {
      // getStep
      mockAdapter.queryOne.mockResolvedValueOnce(stepRow());
      // delete
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // recalculateProgress: getSteps
      mockAdapter.query.mockResolvedValue([stepRow({ status: 'completed' })]);
      // recalculateProgress: update goal
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow())
        .mockResolvedValueOnce(goalRow({ progress: 100 }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.deleteStep('step_1');
      expect(result).toBe(true);
    });
  });

  describe('getSteps', () => {
    it('returns ordered steps', async () => {
      mockAdapter.query.mockResolvedValue([
        stepRow({ order_num: 0 }),
        stepRow({ id: 'step_2', order_num: 1 }),
      ]);

      const steps = await repo.getSteps('goal_1');

      expect(steps).toHaveLength(2);
      expect(steps[0]!.orderNum).toBe(0);
    });
  });

  // ==========================================================================
  // Progress Calculation
  // ==========================================================================

  describe('recalculateProgress', () => {
    it('returns 0 when no steps', async () => {
      mockAdapter.query.mockResolvedValue([]);

      const progress = await repo.recalculateProgress('goal_1');
      expect(progress).toBe(0);
    });

    it('calculates correct progress percentage', async () => {
      mockAdapter.query.mockResolvedValue([
        stepRow({ status: 'completed' }),
        stepRow({ id: 'step_2', status: 'completed' }),
        stepRow({ id: 'step_3', status: 'pending' }),
      ]);
      mockAdapter.queryOne
        .mockResolvedValueOnce(goalRow())
        .mockResolvedValueOnce(goalRow({ progress: 67 }));
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      const progress = await repo.recalculateProgress('goal_1');

      expect(progress).toBe(67); // Math.round(2/3 * 100)
    });
  });

  // ==========================================================================
  // Statistics
  // ==========================================================================

  describe('getStats', () => {
    it('returns default values when empty', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ count: '0' }) // total
        .mockResolvedValueOnce({ count: '0' }) // completedThisWeek
        .mockResolvedValueOnce({ avg: null }) // avgProgress
        .mockResolvedValueOnce({ count: '0' }); // overdue
      mockAdapter.query.mockResolvedValue([]); // byStatus

      const stats = await repo.getStats();

      expect(stats.total).toBe(0);
      expect(stats.byStatus.active).toBe(0);
      expect(stats.byStatus.completed).toBe(0);
      expect(stats.completedThisWeek).toBe(0);
      expect(stats.averageProgress).toBe(0);
      expect(stats.overdueCount).toBe(0);
    });

    it('computes stats from data', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ count: '5' }) // total
        .mockResolvedValueOnce({ count: '2' }) // completedThisWeek
        .mockResolvedValueOnce({ avg: '45.5' }) // avgProgress
        .mockResolvedValueOnce({ count: '1' }); // overdue
      mockAdapter.query.mockResolvedValue([
        { status: 'active', count: '3' },
        { status: 'completed', count: '2' },
      ]);

      const stats = await repo.getStats();

      expect(stats.total).toBe(5);
      expect(stats.byStatus.active).toBe(3);
      expect(stats.byStatus.completed).toBe(2);
      expect(stats.byStatus.paused).toBe(0);
      expect(stats.completedThisWeek).toBe(2);
      expect(stats.averageProgress).toBe(46); // Math.round(45.5)
      expect(stats.overdueCount).toBe(1);
    });
  });
});
