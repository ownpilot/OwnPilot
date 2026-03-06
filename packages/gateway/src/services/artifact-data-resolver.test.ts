/**
 * ArtifactDataResolver Tests
 *
 * Tests for resolveBinding and resolveAllBindings:
 * - All DataBindingSource types (query, aggregate, goal, memory, custom, unknown)
 * - Aggregate operations (count, sum, avg) with and without filters
 * - Error handling (returns null, never throws)
 * - resolveAllBindings stamps lastValue and lastRefreshed on every binding
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveBinding, resolveAllBindings } from './artifact-data-resolver.js';
import type { DataBinding } from '@ownpilot/core';

// ============================================================================
// Mocks
// ============================================================================

const { mockTasksRepo, mockGoalsRepo, mockMemoriesRepo, mockCustomDataRepo } = vi.hoisted(() => ({
  mockTasksRepo: { list: vi.fn(), query: vi.fn() },
  mockGoalsRepo: { list: vi.fn(), getById: vi.fn() },
  mockMemoriesRepo: { list: vi.fn(), search: vi.fn() },
  mockCustomDataRepo: { listRecords: vi.fn() },
}));

vi.mock('../db/repositories/index.js', () => ({
  TasksRepository: vi.fn(function () {
    return mockTasksRepo;
  }),
  GoalsRepository: vi.fn(function () {
    return mockGoalsRepo;
  }),
  MemoriesRepository: vi.fn(function () {
    return mockMemoriesRepo;
  }),
  CustomDataRepository: vi.fn(function () {
    return mockCustomDataRepo;
  }),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    getLog: () => ({ debug: vi.fn() }),
  };
});

// ============================================================================
// Helpers
// ============================================================================

const USER_ID = 'user-123';

function makeBinding(
  source: DataBinding['source'],
  overrides: Partial<DataBinding> = {}
): DataBinding {
  return {
    id: 'binding-1',
    variableName: 'testVar',
    source,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('resolveBinding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // query type — tasks
  // --------------------------------------------------------------------------

  it('resolves query/tasks and returns list result', async () => {
    const tasks = [{ id: 't1', title: 'Task 1' }];
    mockTasksRepo.list.mockResolvedValueOnce(tasks);

    const binding = makeBinding({ type: 'query', entity: 'tasks', filter: {} });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toEqual(tasks);
    expect(mockTasksRepo.list).toHaveBeenCalledWith({ limit: 100 });
  });

  it('resolves query/tasks with custom filter and limit', async () => {
    const tasks = [{ id: 't2', status: 'done' }];
    mockTasksRepo.list.mockResolvedValueOnce(tasks);

    const binding = makeBinding({
      type: 'query',
      entity: 'tasks',
      filter: { status: 'done', limit: 10 },
    });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toEqual(tasks);
    expect(mockTasksRepo.list).toHaveBeenCalledWith({ status: 'done', limit: 10 });
  });

  // --------------------------------------------------------------------------
  // query type — goals
  // --------------------------------------------------------------------------

  it('resolves query/goals and returns list result', async () => {
    const goals = [{ id: 'g1', title: 'Goal A' }];
    mockGoalsRepo.list.mockResolvedValueOnce(goals);

    const binding = makeBinding({ type: 'query', entity: 'goals', filter: {} });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toEqual(goals);
    expect(mockGoalsRepo.list).toHaveBeenCalledWith({ limit: 100 });
  });

  // --------------------------------------------------------------------------
  // query type — memories
  // --------------------------------------------------------------------------

  it('resolves query/memories and returns list result', async () => {
    const memories = [{ id: 'm1', content: 'Remember X' }];
    mockMemoriesRepo.list.mockResolvedValueOnce(memories);

    const binding = makeBinding({ type: 'query', entity: 'memories', filter: {} });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toEqual(memories);
    expect(mockMemoriesRepo.list).toHaveBeenCalledWith({ limit: 100 });
  });

  // --------------------------------------------------------------------------
  // query type — custom entity (falls through to CustomDataRepository)
  // --------------------------------------------------------------------------

  it('resolves query for unknown entity via CustomDataRepository.listRecords', async () => {
    const records = [{ id: 'r1', data: 'foo' }];
    mockCustomDataRepo.listRecords.mockResolvedValueOnce(records);

    const binding = makeBinding({ type: 'query', entity: 'products', filter: {} });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toEqual(records);
    expect(mockCustomDataRepo.listRecords).toHaveBeenCalledWith('products', { limit: 100 });
  });

  it('resolves query for unknown entity with custom limit', async () => {
    const records: unknown[] = [];
    mockCustomDataRepo.listRecords.mockResolvedValueOnce(records);

    const binding = makeBinding({ type: 'query', entity: 'invoices', filter: { limit: 25 } });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toEqual(records);
    expect(mockCustomDataRepo.listRecords).toHaveBeenCalledWith('invoices', { limit: 25 });
  });

  // --------------------------------------------------------------------------
  // aggregate type — count
  // --------------------------------------------------------------------------

  it('resolves aggregate/count for tasks', async () => {
    mockTasksRepo.query.mockResolvedValueOnce([{ result: '42' }]);

    const binding = makeBinding({ type: 'aggregate', entity: 'tasks', operation: 'count' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBe(42);
    const [sql, params] = mockTasksRepo.query.mock.calls[0];
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain('tasks');
    expect(params).toEqual([USER_ID]);
  });

  it('resolves aggregate/count for goals', async () => {
    mockTasksRepo.query.mockResolvedValueOnce([{ result: '7' }]);

    const binding = makeBinding({ type: 'aggregate', entity: 'goals', operation: 'count' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBe(7);
    const [sql] = mockTasksRepo.query.mock.calls[0];
    expect(sql).toContain('goals');
  });

  // --------------------------------------------------------------------------
  // aggregate type — sum
  // --------------------------------------------------------------------------

  it('resolves aggregate/sum with field', async () => {
    mockTasksRepo.query.mockResolvedValueOnce([{ result: '99.5' }]);

    const binding = makeBinding({
      type: 'aggregate',
      entity: 'tasks',
      operation: 'sum',
      field: 'priority',
    });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBe(99.5);
    const [sql] = mockTasksRepo.query.mock.calls[0];
    expect(sql).toContain('SUM');
    expect(sql).toContain('priority');
  });

  it('returns null for aggregate/sum without field', async () => {
    const binding = makeBinding({ type: 'aggregate', entity: 'tasks', operation: 'sum' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
    expect(mockTasksRepo.query).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // aggregate type — avg
  // --------------------------------------------------------------------------

  it('resolves aggregate/avg with field', async () => {
    mockTasksRepo.query.mockResolvedValueOnce([{ result: '3.14' }]);

    const binding = makeBinding({
      type: 'aggregate',
      entity: 'memories',
      operation: 'avg',
      field: 'score',
    });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeCloseTo(3.14);
    const [sql] = mockTasksRepo.query.mock.calls[0];
    expect(sql).toContain('AVG');
    expect(sql).toContain('score');
    expect(sql).toContain('memories');
  });

  it('returns null for aggregate/avg without field', async () => {
    const binding = makeBinding({ type: 'aggregate', entity: 'tasks', operation: 'avg' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
    expect(mockTasksRepo.query).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // aggregate type — unknown operation
  // --------------------------------------------------------------------------

  it('returns null for unknown aggregate operation', async () => {
    const binding = makeBinding({
      type: 'aggregate',
      entity: 'tasks',
      // @ts-expect-error intentionally invalid operation
      operation: 'median',
    });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
    expect(mockTasksRepo.query).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // aggregate type — unknown entity
  // --------------------------------------------------------------------------

  it('returns null for aggregate on unknown entity', async () => {
    const binding = makeBinding({
      type: 'aggregate',
      entity: 'nonexistent_table',
      operation: 'count',
    });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
    expect(mockTasksRepo.query).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // aggregate type — with filter conditions
  // --------------------------------------------------------------------------

  it('resolves aggregate/count with filter conditions appended to SQL', async () => {
    mockTasksRepo.query.mockResolvedValueOnce([{ result: '5' }]);

    const binding = makeBinding({
      type: 'aggregate',
      entity: 'tasks',
      operation: 'count',
      filter: { status: 'open', priority: 'high' },
    });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBe(5);
    const [sql, params] = mockTasksRepo.query.mock.calls[0];
    expect(sql).toContain('AND status = $2');
    expect(sql).toContain('AND priority = $3');
    expect(params).toContain('open');
    expect(params).toContain('high');
  });

  it('ignores filter keys with unsafe characters in aggregate', async () => {
    mockTasksRepo.query.mockResolvedValueOnce([{ result: '10' }]);

    const binding = makeBinding({
      type: 'aggregate',
      entity: 'tasks',
      operation: 'count',
      // 'status; DROP TABLE tasks--' is an unsafe key and must be ignored
      filter: { status: 'active', 'bad key!': 'evil' },
    });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBe(10);
    const [sql, params] = mockTasksRepo.query.mock.calls[0];
    expect(sql).toContain('AND status = $2');
    expect(sql).not.toContain('bad key!');
    expect(params).not.toContain('evil');
  });

  it('returns null when aggregate query result has no result field', async () => {
    mockTasksRepo.query.mockResolvedValueOnce([{}]);

    const binding = makeBinding({ type: 'aggregate', entity: 'tasks', operation: 'count' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
  });

  // --------------------------------------------------------------------------
  // goal type — found in first page
  // --------------------------------------------------------------------------

  it('resolves goal found in first page via list()', async () => {
    const goal = { id: 'goal-99', title: 'My Goal' };
    mockGoalsRepo.list.mockResolvedValueOnce([goal]);

    const binding = makeBinding({ type: 'goal', goalId: 'goal-99' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toEqual(goal);
    expect(mockGoalsRepo.list).toHaveBeenCalledWith({ limit: 1 });
    expect(mockGoalsRepo.getById).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // goal type — not found in first page → getById fallback
  // --------------------------------------------------------------------------

  it('falls back to getById when goal not found in first page', async () => {
    const goal = { id: 'goal-77', title: 'Fallback Goal' };
    mockGoalsRepo.list.mockResolvedValueOnce([{ id: 'goal-other', title: 'Other' }]);
    mockGoalsRepo.getById.mockResolvedValueOnce(goal);

    const binding = makeBinding({ type: 'goal', goalId: 'goal-77' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toEqual(goal);
    expect(mockGoalsRepo.getById).toHaveBeenCalledWith('goal-77');
  });

  it('returns null via getById when goal truly does not exist', async () => {
    mockGoalsRepo.list.mockResolvedValueOnce([]);
    mockGoalsRepo.getById.mockResolvedValueOnce(null);

    const binding = makeBinding({ type: 'goal', goalId: 'nonexistent' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
  });

  // --------------------------------------------------------------------------
  // memory type
  // --------------------------------------------------------------------------

  it('resolves memory source by calling search with query and default limit', async () => {
    const memories = [{ id: 'm1', content: 'Buy milk' }];
    mockMemoriesRepo.search.mockResolvedValueOnce(memories);

    const binding = makeBinding({ type: 'memory', query: 'grocery' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toEqual(memories);
    expect(mockMemoriesRepo.search).toHaveBeenCalledWith('grocery', { limit: 10 });
  });

  it('resolves memory source with explicit limit', async () => {
    const memories = [{ id: 'm2', content: 'Call dentist' }];
    mockMemoriesRepo.search.mockResolvedValueOnce(memories);

    const binding = makeBinding({ type: 'memory', query: 'dentist', limit: 5 });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toEqual(memories);
    expect(mockMemoriesRepo.search).toHaveBeenCalledWith('dentist', { limit: 5 });
  });

  // --------------------------------------------------------------------------
  // custom type — returns null (deferred to v2)
  // --------------------------------------------------------------------------

  it('returns null for custom source type', async () => {
    const binding = makeBinding({
      type: 'custom',
      toolName: 'my_tool',
      params: { key: 'val' },
    });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
  });

  // --------------------------------------------------------------------------
  // unknown source type
  // --------------------------------------------------------------------------

  it('returns null for unknown source type', async () => {
    const binding = makeBinding({
      // @ts-expect-error intentionally invalid type
      type: 'unsupported_type',
    } as DataBinding['source']);
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
  });

  // --------------------------------------------------------------------------
  // error handling — always returns null, never throws
  // --------------------------------------------------------------------------

  it('catches repository errors and returns null without throwing', async () => {
    mockTasksRepo.list.mockRejectedValueOnce(new Error('DB connection failed'));

    const binding = makeBinding({ type: 'query', entity: 'tasks', filter: {} });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
  });

  it('catches aggregate query errors and returns null', async () => {
    mockTasksRepo.query.mockRejectedValueOnce(new Error('SQL error'));

    const binding = makeBinding({ type: 'aggregate', entity: 'tasks', operation: 'count' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
  });

  it('catches goal getById errors and returns null', async () => {
    mockGoalsRepo.list.mockResolvedValueOnce([]);
    mockGoalsRepo.getById.mockRejectedValueOnce(new Error('Not found'));

    const binding = makeBinding({ type: 'goal', goalId: 'gone' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
  });

  it('catches memory search errors and returns null', async () => {
    mockMemoriesRepo.search.mockRejectedValueOnce(new Error('Search failed'));

    const binding = makeBinding({ type: 'memory', query: 'breakfast' });
    const result = await resolveBinding(USER_ID, binding);

    expect(result).toBeNull();
  });
});

// ============================================================================
// resolveAllBindings
// ============================================================================

describe('resolveAllBindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns array of same length as input', async () => {
    mockTasksRepo.list.mockResolvedValue([]);
    mockGoalsRepo.list.mockResolvedValue([]);

    const bindings: DataBinding[] = [
      makeBinding({ type: 'query', entity: 'tasks', filter: {} }, { id: 'b1', variableName: 'a' }),
      makeBinding({ type: 'query', entity: 'goals', filter: {} }, { id: 'b2', variableName: 'b' }),
    ];

    const result = await resolveAllBindings(USER_ID, bindings);

    expect(result).toHaveLength(2);
  });

  it('populates lastValue on each resolved binding', async () => {
    const tasks = [{ id: 't1' }];
    const goals = [{ id: 'g1' }];
    mockTasksRepo.list.mockResolvedValueOnce(tasks);
    mockGoalsRepo.list.mockResolvedValueOnce(goals);

    const bindings: DataBinding[] = [
      makeBinding({ type: 'query', entity: 'tasks', filter: {} }, { id: 'b1', variableName: 'a' }),
      makeBinding({ type: 'query', entity: 'goals', filter: {} }, { id: 'b2', variableName: 'b' }),
    ];

    const result = await resolveAllBindings(USER_ID, bindings);

    expect(result[0].lastValue).toEqual(tasks);
    expect(result[1].lastValue).toEqual(goals);
  });

  it('populates lastRefreshed as a Date on each binding', async () => {
    mockTasksRepo.list.mockResolvedValue([]);
    mockGoalsRepo.list.mockResolvedValue([]);

    const bindings: DataBinding[] = [
      makeBinding({ type: 'query', entity: 'tasks', filter: {} }, { id: 'b1', variableName: 'a' }),
      makeBinding({ type: 'query', entity: 'goals', filter: {} }, { id: 'b2', variableName: 'b' }),
    ];

    const before = new Date();
    const result = await resolveAllBindings(USER_ID, bindings);
    const after = new Date();

    for (const b of result) {
      expect(b.lastRefreshed).toBeInstanceOf(Date);
      expect((b.lastRefreshed as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect((b.lastRefreshed as Date).getTime()).toBeLessThanOrEqual(after.getTime());
    }
  });

  it('all bindings receive the same lastRefreshed timestamp (single now snapshot)', async () => {
    mockTasksRepo.list.mockResolvedValue([]);
    mockGoalsRepo.list.mockResolvedValue([]);

    const bindings: DataBinding[] = [
      makeBinding({ type: 'query', entity: 'tasks', filter: {} }, { id: 'b1', variableName: 'a' }),
      makeBinding({ type: 'query', entity: 'goals', filter: {} }, { id: 'b2', variableName: 'b' }),
    ];

    const result = await resolveAllBindings(USER_ID, bindings);

    expect(result[0].lastRefreshed).toEqual(result[1].lastRefreshed);
  });

  it('preserves original binding fields and merges lastValue/lastRefreshed', async () => {
    const tasks = [{ id: 't1' }];
    mockTasksRepo.list.mockResolvedValueOnce(tasks);

    const original = makeBinding(
      { type: 'query', entity: 'tasks', filter: {} },
      { id: 'b1', variableName: 'myVar', refreshInterval: 300 }
    );

    const [result] = await resolveAllBindings(USER_ID, [original]);

    expect(result.id).toBe('b1');
    expect(result.variableName).toBe('myVar');
    expect(result.refreshInterval).toBe(300);
    expect(result.lastValue).toEqual(tasks);
    expect(result.lastRefreshed).toBeInstanceOf(Date);
  });

  it('sets lastValue to null when a binding errors out', async () => {
    mockTasksRepo.list.mockRejectedValueOnce(new Error('DB down'));

    const bindings: DataBinding[] = [
      makeBinding({ type: 'query', entity: 'tasks', filter: {} }, { id: 'b1', variableName: 'v' }),
    ];

    const result = await resolveAllBindings(USER_ID, bindings);

    expect(result).toHaveLength(1);
    expect(result[0].lastValue).toBeNull();
    expect(result[0].lastRefreshed).toBeInstanceOf(Date);
  });

  it('handles empty bindings array and returns empty array', async () => {
    const result = await resolveAllBindings(USER_ID, []);

    expect(result).toEqual([]);
  });

  it('resolves mixed binding types in parallel', async () => {
    const tasks = [{ id: 't1' }];
    const memories = [{ id: 'm1', content: 'test' }];
    mockTasksRepo.list.mockResolvedValueOnce(tasks);
    mockMemoriesRepo.search.mockResolvedValueOnce(memories);
    mockTasksRepo.query.mockResolvedValueOnce([{ result: '3' }]);

    const bindings: DataBinding[] = [
      makeBinding({ type: 'query', entity: 'tasks', filter: {} }, { id: 'b1', variableName: 'a' }),
      makeBinding({ type: 'memory', query: 'test' }, { id: 'b2', variableName: 'b' }),
      makeBinding(
        { type: 'aggregate', entity: 'tasks', operation: 'count' },
        { id: 'b3', variableName: 'c' }
      ),
    ];

    const result = await resolveAllBindings(USER_ID, bindings);

    expect(result).toHaveLength(3);
    expect(result[0].lastValue).toEqual(tasks);
    expect(result[1].lastValue).toEqual(memories);
    expect(result[2].lastValue).toBe(3);
  });
});
