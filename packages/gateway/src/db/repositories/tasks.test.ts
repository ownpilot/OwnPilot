/**
 * Tasks Repository Tests
 *
 * Unit tests for TasksRepository CRUD, status transitions, priority/due-date
 * filtering, search, and pagination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the database adapter and event bus
// ---------------------------------------------------------------------------

const mockAdapter = {
  type: 'postgres' as const,
  isConnected: () => true,
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ changes: 1 })),
  transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  exec: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  now: () => 'NOW()',
  date: (col: string) => `DATE(${col})`,
  dateSubtract: (col: string, n: number, u: string) => `${col} - INTERVAL '${n} ${u}'`,
  placeholder: (i: number) => `$${i}`,
  boolean: (v: boolean) => v,
  parseBoolean: (v: unknown) => Boolean(v),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockEmit = vi.fn();

vi.mock('@ownpilot/core', () => ({
  getEventBus: () => ({ emit: mockEmit }),
  createEvent: vi.fn((_type: string, _cat: string, _src: string, data: unknown) => ({
    type: _type,
    data,
  })),
  EventTypes: {
    RESOURCE_CREATED: 'resource.created',
    RESOURCE_UPDATED: 'resource.updated',
    RESOURCE_DELETED: 'resource.deleted',
  },
}));

import { TasksRepository } from './tasks.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    user_id: 'user-1',
    title: 'My Task',
    description: null,
    status: 'pending',
    priority: 'normal',
    due_date: null,
    due_time: null,
    reminder_at: null,
    category: null,
    tags: '[]',
    parent_id: null,
    project_id: null,
    recurrence: null,
    completed_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TasksRepository', () => {
  let repo: TasksRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new TasksRepository('user-1');
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a task and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow());

      const result = await repo.create({ title: 'My Task' });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.title).toBe('My Task');
      expect(result.status).toBe('pending');
      expect(result.priority).toBe('normal');
      expect(result.tags).toEqual([]);
    });

    it('should emit RESOURCE_CREATED event', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow());

      await repo.create({ title: 'My Task' });

      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('should default priority to normal', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow());

      await repo.create({ title: 'Test' });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[4]).toBe('normal');
    });

    it('should accept all optional fields', async () => {
      const row = makeTaskRow({
        description: 'desc',
        priority: 'high',
        due_date: '2025-02-01',
        due_time: '14:00',
        category: 'work',
        tags: '["urgent"]',
        parent_id: 'parent-1',
        project_id: 'proj-1',
        recurrence: 'daily',
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        title: 'Test',
        description: 'desc',
        priority: 'high',
        dueDate: '2025-02-01',
        dueTime: '14:00',
        category: 'work',
        tags: ['urgent'],
        parentId: 'parent-1',
        projectId: 'proj-1',
        recurrence: 'daily',
      });

      expect(result.priority).toBe('high');
      expect(result.dueDate).toBe('2025-02-01');
      expect(result.tags).toEqual(['urgent']);
      expect(result.parentId).toBe('parent-1');
      expect(result.projectId).toBe('proj-1');
      expect(result.recurrence).toBe('daily');
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.create({ title: 'Test' }))
        .rejects.toThrow('Failed to create task');
    });
  });

  // =========================================================================
  // get / getById
  // =========================================================================

  describe('get', () => {
    it('should return a task when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow());

      const result = await repo.get('task-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('task-1');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.get('missing')).toBeNull();
    });

    it('should parse dates', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow());

      const result = await repo.get('task-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow());

      const result = await repo.get('task-1');

      expect(result!.description).toBeUndefined();
      expect(result!.dueDate).toBeUndefined();
      expect(result!.completedAt).toBeUndefined();
    });
  });

  describe('getById', () => {
    it('should alias get()', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow());

      const result = await repo.getById('task-1');

      expect(result!.id).toBe('task-1');
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update fields and return the updated task', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow({ title: 'Updated' }));

      const result = await repo.update('task-1', { title: 'Updated' });

      expect(result!.title).toBe('Updated');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should emit RESOURCE_UPDATED event', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow({ title: 'Updated' }));

      await repo.update('task-1', { title: 'Updated' });

      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('should return null if task does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.update('missing', { title: 'x' })).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return existing task when no changes provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow());

      const result = await repo.update('task-1', {});

      expect(result!.id).toBe('task-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should set completed_at when status changes to completed', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow({ status: 'pending' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeTaskRow({ status: 'completed', completed_at: NOW }),
      );

      await repo.update('task-1', { status: 'completed' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('completed_at = NOW()');
    });

    it('should clear completed_at when status changes away from completed', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeTaskRow({ status: 'completed', completed_at: NOW }),
      );
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeTaskRow({ status: 'pending', completed_at: null }),
      );

      await repo.update('task-1', { status: 'pending' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('completed_at = NULL');
    });

    it('should not reset completed_at when already completed and staying completed', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeTaskRow({ status: 'completed', completed_at: NOW }),
      );
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeTaskRow({ status: 'completed', completed_at: NOW }),
      );

      await repo.update('task-1', { status: 'completed' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      // Should not contain completed_at = NOW() because it's already completed
      expect(sql).not.toContain('completed_at = NOW()');
      // Should not contain completed_at = NULL either
      expect(sql).not.toContain('completed_at = NULL');
    });

    it('should serialize tags on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow({ tags: '["a"]' }));

      await repo.update('task-1', { tags: ['a'] });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('["a"]');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('task-1')).toBe(true);
    });

    it('should emit RESOURCE_DELETED event', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('task-1');

      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('should return false when task not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('missing')).toBe(false);
    });

    it('should not emit event when nothing deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      await repo.delete('missing');

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // complete
  // =========================================================================

  describe('complete', () => {
    it('should set status to completed', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow({ status: 'pending' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeTaskRow({ status: 'completed', completed_at: NOW }),
      );

      const result = await repo.complete('task-1');

      expect(result!.status).toBe('completed');
    });
  });

  // =========================================================================
  // Status transitions
  // =========================================================================

  describe('status transitions', () => {
    it.each([
      ['pending', 'in_progress'],
      ['pending', 'completed'],
      ['pending', 'cancelled'],
      ['in_progress', 'completed'],
      ['in_progress', 'cancelled'],
      ['completed', 'pending'],
    ])('should transition from %s to %s', async (from, to) => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow({ status: from }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeTaskRow({ status: to }));

      const result = await repo.update('task-1', { status: to as 'pending' | 'in_progress' | 'completed' | 'cancelled' });

      expect(result!.status).toBe(to);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no tasks', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.list()).toEqual([]);
    });

    it('should filter by single status', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ status: 'pending' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('status IN');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('pending');
    });

    it('should filter by multiple statuses', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ status: ['pending', 'in_progress'] });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('status IN');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('pending');
      expect(params).toContain('in_progress');
    });

    it('should filter by single priority', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ priority: 'high' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('priority IN');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('high');
    });

    it('should filter by multiple priorities', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ priority: ['high', 'urgent'] });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('high');
      expect(params).toContain('urgent');
    });

    it('should filter by category', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ category: 'work' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('category = $');
    });

    it('should filter by projectId', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ projectId: 'proj-1' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('project_id = $');
    });

    it('should filter parentId IS NULL', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ parentId: null });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('parent_id IS NULL');
    });

    it('should filter by parentId value', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ parentId: 'parent-1' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('parent_id = $');
    });

    it('should filter by dueBefore', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ dueBefore: '2025-02-01' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('due_date <= $');
    });

    it('should filter by dueAfter', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ dueAfter: '2025-01-01' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('due_date >= $');
    });

    it('should search by title and description', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: 'fix bug' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('title ILIKE');
      expect(sql).toContain('description ILIKE');
    });

    it('should order by priority then due_date', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain("WHEN 'urgent' THEN 1");
      expect(sql).toContain('due_date ASC NULLS LAST');
    });

    it('should apply pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 10, offset: 30 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });

    it('should escape LIKE wildcards in search', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: '100%' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('%100\\%%');
    });
  });

  // =========================================================================
  // Convenience methods
  // =========================================================================

  describe('getSubtasks', () => {
    it('should delegate to list with parentId', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getSubtasks('parent-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('parent_id = $');
    });
  });

  describe('getByProject', () => {
    it('should delegate to list with projectId', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByProject('proj-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('project_id = $');
    });
  });

  describe('getDueToday', () => {
    it('should filter by today date and active statuses', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getDueToday();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('due_date >= $');
      expect(sql).toContain('due_date <= $');
      expect(sql).toContain('status IN');
    });
  });

  describe('getOverdue', () => {
    it('should filter by past due_date and active statuses', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getOverdue();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('due_date <= $');
      expect(sql).toContain('status IN');
    });
  });

  describe('getUpcoming', () => {
    it('should filter by date range and active statuses', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getUpcoming(7);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('due_date >= $');
      expect(sql).toContain('due_date <= $');
      expect(sql).toContain('status IN');
    });
  });

  describe('count', () => {
    it('should return count of all tasks for user', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '25' });

      expect(await repo.count()).toBe(25);
    });

    it('should filter count by status', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '3' });

      await repo.count({ status: 'completed' });

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('status IN');
    });

    it('should filter count by projectId', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '5' });

      await repo.count({ projectId: 'proj-1' });

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('project_id = $');
    });

    it('should return 0 when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });
  });

  describe('getCategories', () => {
    it('should return distinct categories', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { category: 'personal' },
        { category: 'work' },
      ]);

      expect(await repo.getCategories()).toEqual(['personal', 'work']);
    });
  });

  describe('search', () => {
    it('should delegate to list with search and limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.search('keyword', 15);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ILIKE');
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createTasksRepository', () => {
    it('should be importable', async () => {
      const { createTasksRepository } = await import('./tasks.js');
      const r = createTasksRepository('u1');
      expect(r).toBeInstanceOf(TasksRepository);
    });
  });
});
