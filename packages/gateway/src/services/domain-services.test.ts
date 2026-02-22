/**
 * Domain Services Comprehensive Test Suite
 *
 * Consolidated tests for MemoryService, PlanService, GoalService, and TriggerService.
 * Covers CRUD, validation, event emission, edge cases, error codes,
 * and every public method including those not tested by the per-service files.
 *
 * All repository and core dependencies are mocked; tests are fully isolated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// @ownpilot/core mock -- shared by all four services
// ---------------------------------------------------------------------------

const mockEmit = vi.fn();

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
  getLog: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Repository mocks
// ---------------------------------------------------------------------------

const memoryRepo = {
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  search: vi.fn(),
  searchByEmbedding: vi.fn(),
  updateEmbedding: vi.fn(),
  findSimilar: vi.fn(),
  boost: vi.fn(),
  getImportant: vi.fn(),
  getRecent: vi.fn(),
  getFrequentlyAccessed: vi.fn(),
  getBySource: vi.fn(),
  getStats: vi.fn(),
  count: vi.fn(),
  decay: vi.fn(),
  cleanup: vi.fn(),
};

vi.mock('../db/repositories/memories.js', () => ({
  MemoriesRepository: vi.fn(),
  createMemoriesRepository: () => memoryRepo,
}));

const planRepo = {
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getActive: vi.fn(),
  getPending: vi.fn(),
  addStep: vi.fn(),
  getSteps: vi.fn(),
  getStep: vi.fn(),
  updateStep: vi.fn(),
  getNextStep: vi.fn(),
  getStepsByStatus: vi.fn(),
  areDependenciesMet: vi.fn(),
  logEvent: vi.fn(),
  getHistory: vi.fn(),
  recalculateProgress: vi.fn(),
  getStats: vi.fn(),
};

vi.mock('../db/repositories/plans.js', () => ({
  PlansRepository: vi.fn(),
  createPlansRepository: () => planRepo,
}));

const goalRepo = {
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getActive: vi.fn(),
  getUpcoming: vi.fn(),
  getNextActions: vi.fn(),
  getStats: vi.fn(),
  addStep: vi.fn(),
  getStep: vi.fn(),
  getSteps: vi.fn(),
  updateStep: vi.fn(),
  deleteStep: vi.fn(),
  recalculateProgress: vi.fn(),
  transaction: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
};

vi.mock('../db/repositories/goals.js', () => ({
  GoalsRepository: vi.fn(),
  createGoalsRepository: () => goalRepo,
}));

const triggerRepo = {
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getDueTriggers: vi.fn(),
  getByEventType: vi.fn(),
  getConditionTriggers: vi.fn(),
  markFired: vi.fn(),
  logExecution: vi.fn(),
  getRecentHistory: vi.fn(),
  getHistoryForTrigger: vi.fn(),
  cleanupHistory: vi.fn(),
  getStats: vi.fn(),
};

vi.mock('../db/repositories/triggers.js', () => ({
  TriggersRepository: vi.fn(),
  createTriggersRepository: () => triggerRepo,
}));

// ---------------------------------------------------------------------------
// Service imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { createEvent } from '@ownpilot/core';
import { MemoryService, MemoryServiceError } from './memory-service.js';
import { PlanService, PlanServiceError } from './plan-service.js';
import { GoalService, GoalServiceError } from './goal-service.js';
import { TriggerService, TriggerServiceError } from './trigger-service.js';
import type { Memory } from '../db/repositories/memories.js';
import type { Plan, PlanStep, PlanHistory } from '../db/repositories/plans.js';
import type { Goal, GoalStep } from '../db/repositories/goals.js';
import type { Trigger, TriggerHistory } from '../db/repositories/triggers.js';

// Alias for assertions -- createEvent is the mocked vi.fn() from vi.mock above
const mockCreateEvent = vi.mocked(createEvent);

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function fakeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    userId: 'user-1',
    type: 'fact',
    content: 'User likes TypeScript',
    importance: 0.5,
    tags: ['dev'],
    source: 'conversation',
    sourceId: 'conv-1',
    accessCount: 1,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    lastAccessedAt: new Date('2025-01-02'),
    metadata: {},
    ...overrides,
  } as Memory;
}

function fakePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    userId: 'user-1',
    name: 'Ship MVP',
    description: 'Launch first version',
    goal: 'Ship the first version',
    status: 'pending',
    currentStep: 0,
    totalSteps: 3,
    progress: 0,
    priority: 5,
    source: null,
    sourceId: null,
    triggerId: null,
    goalId: null,
    autonomyLevel: 1,
    maxRetries: 3,
    retryCount: 0,
    timeoutMs: null,
    checkpoint: null,
    error: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    startedAt: null,
    completedAt: null,
    metadata: {},
    ...overrides,
  } as Plan;
}

function fakePlanStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: 'step-1',
    planId: 'plan-1',
    orderNum: 1,
    type: 'tool_call',
    name: 'Build project',
    description: null,
    config: { toolName: 'build' },
    status: 'pending',
    dependencies: [],
    result: null,
    error: null,
    retryCount: 0,
    maxRetries: 3,
    timeoutMs: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    onSuccess: null,
    onFailure: null,
    metadata: {},
    ...overrides,
  } as PlanStep;
}

function fakePlanHistory(overrides: Partial<PlanHistory> = {}): PlanHistory {
  return {
    id: 'evt-1',
    planId: 'plan-1',
    stepId: null,
    eventType: 'started',
    details: {},
    createdAt: new Date('2025-01-01'),
    ...overrides,
  } as PlanHistory;
}

function fakeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    userId: 'user-1',
    title: 'Learn Rust',
    description: 'Systems programming',
    status: 'active',
    priority: 7,
    parentId: null,
    dueDate: '2025-06-01',
    progress: 25,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    completedAt: null,
    metadata: {},
    ...overrides,
  } as Goal;
}

function fakeGoalStep(overrides: Partial<GoalStep> = {}): GoalStep {
  return {
    id: 'gstep-1',
    goalId: 'goal-1',
    title: 'Read The Book',
    description: null,
    status: 'pending',
    orderNum: 0,
    dependencies: [],
    result: null,
    createdAt: new Date('2025-01-01'),
    completedAt: null,
    ...overrides,
  } as GoalStep;
}

function fakeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 'trg-1',
    userId: 'user-1',
    name: 'Morning check',
    description: 'Daily morning trigger',
    type: 'schedule',
    config: { cron: '0 8 * * *' },
    action: { type: 'notification', payload: { message: 'Good morning' } },
    enabled: true,
    priority: 5,
    lastFired: null,
    nextFire: null,
    fireCount: 0,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as Trigger;
}

function fakeTriggerHistory(overrides: Partial<TriggerHistory> = {}): TriggerHistory {
  return {
    id: 'thist-1',
    triggerId: 'trg-1',
    triggerName: 'Test Trigger',
    firedAt: new Date('2025-01-15'),
    status: 'success',
    result: { ok: true },
    error: null,
    durationMs: 42,
    ...overrides,
  } as TriggerHistory;
}

// ###########################################################################
// MEMORY SERVICE
// ###########################################################################

describe('MemoryService', () => {
  let service: MemoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MemoryService();
  });

  // ========================================================================
  // createMemory
  // ========================================================================

  describe('createMemory', () => {
    it('should create a memory and return it', async () => {
      const mem = fakeMemory();
      memoryRepo.create.mockResolvedValue(mem);
      const result = await service.createMemory('user-1', { type: 'fact', content: 'Hello' });
      expect(result).toBe(mem);
      expect(memoryRepo.create).toHaveBeenCalledOnce();
    });

    it('should emit RESOURCE_CREATED with correct payload', async () => {
      const mem = fakeMemory({ id: 'mem-99' });
      memoryRepo.create.mockResolvedValue(mem);
      await service.createMemory('user-1', { type: 'fact', content: 'Test' });
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'resource.created',
        'resource',
        'memory-service',
        { resourceType: 'memory', id: 'mem-99' },
      );
      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('should throw MemoryServiceError with VALIDATION_ERROR code for empty content', async () => {
      const err = await service.createMemory('user-1', { type: 'fact', content: '' }).catch((e) => e);
      expect(err).toBeInstanceOf(MemoryServiceError);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.name).toBe('MemoryServiceError');
    });

    it('should throw VALIDATION_ERROR when content is null-ish', async () => {
      await expect(
        service.createMemory('user-1', { type: 'fact', content: null as unknown as string }),
      ).rejects.toThrow(MemoryServiceError);
    });

    it('should throw VALIDATION_ERROR when type is falsy', async () => {
      await expect(
        service.createMemory('user-1', { type: '' as unknown as string, content: 'valid' }),
      ).rejects.toThrow(/Type is required/);
    });

    it('should not call repo.create when validation fails', async () => {
      await service.createMemory('user-1', { type: 'fact', content: '' }).catch(() => {});
      expect(memoryRepo.create).not.toHaveBeenCalled();
    });

    it('should pass full input including optional fields to repo', async () => {
      const mem = fakeMemory();
      memoryRepo.create.mockResolvedValue(mem);
      const input = {
        type: 'preference' as const,
        content: 'Dark mode',
        importance: 0.9,
        tags: ['ui'],
        source: 'settings',
        sourceId: 'set-1',
        metadata: { key: 'val' },
      };
      await service.createMemory('user-1', input);
      expect(memoryRepo.create).toHaveBeenCalledWith(input);
    });
  });

  // ========================================================================
  // rememberMemory (deduplication)
  // ========================================================================

  describe('rememberMemory', () => {
    it('should create new memory when no similar exists', async () => {
      const mem = fakeMemory();
      memoryRepo.findSimilar.mockResolvedValue(null);
      memoryRepo.create.mockResolvedValue(mem);

      const result = await service.rememberMemory('user-1', { type: 'fact', content: 'New info' });
      expect(result.deduplicated).toBe(false);
      expect(result.memory).toBe(mem);
    });

    it('should boost and return existing memory when duplicate found', async () => {
      const existing = fakeMemory({ id: 'mem-dup', importance: 0.5 });
      const boosted = fakeMemory({ id: 'mem-dup', importance: 0.6 });
      memoryRepo.findSimilar.mockResolvedValue(existing);
      memoryRepo.boost.mockResolvedValue(undefined);
      memoryRepo.get.mockResolvedValue(boosted);

      const result = await service.rememberMemory('user-1', { type: 'fact', content: 'Dup' });
      expect(result.deduplicated).toBe(true);
      expect(result.memory).toBe(boosted);
      expect(memoryRepo.boost).toHaveBeenCalledWith('mem-dup', 0.1);
    });

    it('should return existing memory when boosted get returns null', async () => {
      const existing = fakeMemory({ id: 'mem-dup' });
      memoryRepo.findSimilar.mockResolvedValue(existing);
      memoryRepo.boost.mockResolvedValue(undefined);
      memoryRepo.get.mockResolvedValue(null);

      const result = await service.rememberMemory('user-1', { type: 'fact', content: 'Dup' });
      expect(result.memory).toBe(existing);
      expect(result.deduplicated).toBe(true);
    });

    it('should pass embedding to findSimilar', async () => {
      memoryRepo.findSimilar.mockResolvedValue(null);
      memoryRepo.create.mockResolvedValue(fakeMemory());
      const embedding = [0.1, 0.2, 0.3];
      await service.rememberMemory('user-1', { type: 'fact', content: 'Emb', embedding });
      expect(memoryRepo.findSimilar).toHaveBeenCalledWith('Emb', 'fact', embedding);
    });

    it('should throw VALIDATION_ERROR for missing type', async () => {
      await expect(
        service.rememberMemory('user-1', { type: undefined as unknown as string, content: 'x' }),
      ).rejects.toThrow(/Type is required/);
      expect(memoryRepo.findSimilar).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // batchRemember
  // ========================================================================

  describe('batchRemember', () => {
    it('should tally created vs deduplicated correctly', async () => {
      memoryRepo.findSimilar
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(fakeMemory({ id: 'existing' }))
        .mockResolvedValueOnce(null);
      memoryRepo.create
        .mockResolvedValueOnce(fakeMemory({ id: 'new-1' }))
        .mockResolvedValueOnce(fakeMemory({ id: 'new-2' }));
      memoryRepo.boost.mockResolvedValue(undefined);
      memoryRepo.get.mockResolvedValue(fakeMemory({ id: 'existing' }));

      const result = await service.batchRemember('user-1', [
        { type: 'fact', content: 'A' },
        { type: 'fact', content: 'B' },
        { type: 'fact', content: 'C' },
      ]);

      expect(result.created).toBe(2);
      expect(result.deduplicated).toBe(1);
      expect(result.memories).toHaveLength(3);
    });

    it('should skip entries that have empty content or no type', async () => {
      const result = await service.batchRemember('user-1', [
        { type: 'fact', content: '' },
        { type: '' as unknown as string, content: 'No type' },
        { type: 'fact', content: '   ' },
      ]);

      expect(result.created).toBe(0);
      expect(result.deduplicated).toBe(0);
      expect(result.memories).toHaveLength(0);
    });

    it('should handle empty input array', async () => {
      const result = await service.batchRemember('user-1', []);
      expect(result.created).toBe(0);
      expect(result.deduplicated).toBe(0);
      expect(result.memories).toHaveLength(0);
    });
  });

  // ========================================================================
  // getMemory / updateMemory / deleteMemory
  // ========================================================================

  describe('getMemory', () => {
    it('should pass trackAccess to repo.get', async () => {
      memoryRepo.get.mockResolvedValue(fakeMemory());
      await service.getMemory('user-1', 'mem-1', false);
      expect(memoryRepo.get).toHaveBeenCalledWith('mem-1', false);
    });

    it('should default trackAccess to true', async () => {
      memoryRepo.get.mockResolvedValue(fakeMemory());
      await service.getMemory('user-1', 'mem-1');
      expect(memoryRepo.get).toHaveBeenCalledWith('mem-1', true);
    });

    it('should return null when memory is not found', async () => {
      memoryRepo.get.mockResolvedValue(null);
      const result = await service.getMemory('user-1', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('updateMemory', () => {
    it('should emit event only when update succeeds', async () => {
      memoryRepo.update.mockResolvedValue(fakeMemory({ content: 'New' }));
      await service.updateMemory('user-1', 'mem-1', { content: 'New' });
      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('should not emit event when memory not found', async () => {
      memoryRepo.update.mockResolvedValue(null);
      await service.updateMemory('user-1', 'gone', { content: 'x' });
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should include changes in the emitted event data', async () => {
      memoryRepo.update.mockResolvedValue(fakeMemory());
      const changes = { importance: 0.9, tags: ['new'] };
      await service.updateMemory('user-1', 'mem-1', changes);
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'resource.updated',
        'resource',
        'memory-service',
        { resourceType: 'memory', id: 'mem-1', changes },
      );
    });
  });

  describe('deleteMemory', () => {
    it('should return true and emit when deleted', async () => {
      memoryRepo.delete.mockResolvedValue(true);
      const result = await service.deleteMemory('user-1', 'mem-1');
      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('should return false and not emit when not found', async () => {
      memoryRepo.delete.mockResolvedValue(false);
      const result = await service.deleteMemory('user-1', 'nope');
      expect(result).toBe(false);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Search and query methods
  // ========================================================================

  describe('searchMemories', () => {
    it('should delegate to repo.search with options', async () => {
      memoryRepo.search.mockResolvedValue([fakeMemory()]);
      const result = await service.searchMemories('user-1', 'rust', { type: 'skill', limit: 3 });
      expect(result).toHaveLength(1);
      expect(memoryRepo.search).toHaveBeenCalledWith('rust', { type: 'skill', limit: 3 });
    });

    it('should pass empty options when none provided', async () => {
      memoryRepo.search.mockResolvedValue([]);
      await service.searchMemories('user-1', 'query');
      expect(memoryRepo.search).toHaveBeenCalledWith('query', {});
    });
  });

  describe('searchByEmbedding', () => {
    it('should delegate to repo.searchByEmbedding with all options', async () => {
      const embResults = [{ ...fakeMemory(), similarity: 0.95 }];
      memoryRepo.searchByEmbedding.mockResolvedValue(embResults);

      const opts = { type: 'fact' as const, limit: 5, threshold: 0.8, minImportance: 0.5 };
      const result = await service.searchByEmbedding('user-1', [0.1, 0.2], opts);
      expect(result).toEqual(embResults);
      expect(memoryRepo.searchByEmbedding).toHaveBeenCalledWith([0.1, 0.2], opts);
    });

    it('should pass empty options by default', async () => {
      memoryRepo.searchByEmbedding.mockResolvedValue([]);
      await service.searchByEmbedding('user-1', [0.5]);
      expect(memoryRepo.searchByEmbedding).toHaveBeenCalledWith([0.5], {});
    });
  });

  describe('updateEmbedding', () => {
    it('should delegate to repo.updateEmbedding', async () => {
      memoryRepo.updateEmbedding.mockResolvedValue(true);
      const result = await service.updateEmbedding('user-1', 'mem-1', [0.1, 0.2, 0.3]);
      expect(result).toBe(true);
      expect(memoryRepo.updateEmbedding).toHaveBeenCalledWith('mem-1', [0.1, 0.2, 0.3]);
    });

    it('should return false when memory not found', async () => {
      memoryRepo.updateEmbedding.mockResolvedValue(false);
      const result = await service.updateEmbedding('user-1', 'gone', []);
      expect(result).toBe(false);
    });
  });

  describe('listMemories', () => {
    it('should pass query to repo.list', async () => {
      memoryRepo.list.mockResolvedValue([fakeMemory()]);
      const query = { type: 'preference' as const, limit: 10 };
      await service.listMemories('user-1', query);
      expect(memoryRepo.list).toHaveBeenCalledWith(query);
    });

    it('should default to empty query', async () => {
      memoryRepo.list.mockResolvedValue([]);
      await service.listMemories('user-1');
      expect(memoryRepo.list).toHaveBeenCalledWith({});
    });
  });

  describe('getBySource', () => {
    it('should delegate with source and sourceId', async () => {
      memoryRepo.getBySource.mockResolvedValue([fakeMemory()]);
      await service.getBySource('user-1', 'conversation', 'conv-99');
      expect(memoryRepo.getBySource).toHaveBeenCalledWith('conversation', 'conv-99');
    });

    it('should delegate with only source', async () => {
      memoryRepo.getBySource.mockResolvedValue([]);
      await service.getBySource('user-1', 'tool');
      expect(memoryRepo.getBySource).toHaveBeenCalledWith('tool', undefined);
    });
  });

  describe('getFrequentlyAccessedMemories', () => {
    it('should delegate with custom limit', async () => {
      memoryRepo.getFrequentlyAccessed.mockResolvedValue([]);
      await service.getFrequentlyAccessedMemories('user-1', 50);
      expect(memoryRepo.getFrequentlyAccessed).toHaveBeenCalledWith(50);
    });

    it('should use default limit of 20', async () => {
      memoryRepo.getFrequentlyAccessed.mockResolvedValue([]);
      await service.getFrequentlyAccessedMemories('user-1');
      expect(memoryRepo.getFrequentlyAccessed).toHaveBeenCalledWith(20);
    });
  });

  // ========================================================================
  // Stats and maintenance
  // ========================================================================

  describe('getStats', () => {
    it('should return stats from repo', async () => {
      const stats = { total: 100, byType: { fact: 50 }, avgImportance: 0.6, recentCount: 10 };
      memoryRepo.getStats.mockResolvedValue(stats);
      const result = await service.getStats('user-1');
      expect(result).toEqual(stats);
    });
  });

  describe('boostMemory', () => {
    it('should use custom boost amount', async () => {
      memoryRepo.boost.mockResolvedValue(fakeMemory({ importance: 0.8 }));
      await service.boostMemory('user-1', 'mem-1', 0.3);
      expect(memoryRepo.boost).toHaveBeenCalledWith('mem-1', 0.3);
    });

    it('should default boost amount to 0.1', async () => {
      memoryRepo.boost.mockResolvedValue(fakeMemory());
      await service.boostMemory('user-1', 'mem-1');
      expect(memoryRepo.boost).toHaveBeenCalledWith('mem-1', 0.1);
    });
  });

  describe('decayMemories', () => {
    it('should pass custom options to repo', async () => {
      memoryRepo.decay.mockResolvedValue(12);
      const result = await service.decayMemories('user-1', { daysThreshold: 14, decayFactor: 0.8 });
      expect(result).toBe(12);
      expect(memoryRepo.decay).toHaveBeenCalledWith({ daysThreshold: 14, decayFactor: 0.8 });
    });

    it('should pass empty options by default', async () => {
      memoryRepo.decay.mockResolvedValue(0);
      await service.decayMemories('user-1');
      expect(memoryRepo.decay).toHaveBeenCalledWith({});
    });
  });

  describe('cleanupMemories', () => {
    it('should pass custom options to repo', async () => {
      memoryRepo.cleanup.mockResolvedValue(7);
      const result = await service.cleanupMemories('user-1', { maxAge: 60, minImportance: 0.2 });
      expect(result).toBe(7);
      expect(memoryRepo.cleanup).toHaveBeenCalledWith({ maxAge: 60, minImportance: 0.2 });
    });

    it('should pass empty options by default', async () => {
      memoryRepo.cleanup.mockResolvedValue(0);
      await service.cleanupMemories('user-1');
      expect(memoryRepo.cleanup).toHaveBeenCalledWith({});
    });
  });

  describe('countMemories', () => {
    it('should return count with type filter', async () => {
      memoryRepo.count.mockResolvedValue(15);
      const result = await service.countMemories('user-1', 'preference');
      expect(result).toBe(15);
      expect(memoryRepo.count).toHaveBeenCalledWith('preference');
    });

    it('should return count without type filter', async () => {
      memoryRepo.count.mockResolvedValue(100);
      const result = await service.countMemories('user-1');
      expect(result).toBe(100);
      expect(memoryRepo.count).toHaveBeenCalledWith(undefined);
    });
  });
});

// ###########################################################################
// PLAN SERVICE
// ###########################################################################

describe('PlanService', () => {
  let service: PlanService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PlanService();
  });

  // ========================================================================
  // createPlan
  // ========================================================================

  describe('createPlan', () => {
    it('should create a plan and emit resource.created', async () => {
      const plan = fakePlan();
      planRepo.create.mockResolvedValue(plan);

      const result = await service.createPlan('user-1', { name: 'Ship MVP', goal: 'Launch' });
      expect(result).toBe(plan);
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'resource.created',
        'resource',
        'plan-service',
        { resourceType: 'plan', id: 'plan-1' },
      );
    });

    it('should throw PlanServiceError with VALIDATION_ERROR for empty name', async () => {
      const err = await service.createPlan('user-1', { name: '', goal: 'x' }).catch((e) => e);
      expect(err).toBeInstanceOf(PlanServiceError);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.name).toBe('PlanServiceError');
    });

    it('should throw VALIDATION_ERROR for whitespace-only name', async () => {
      await expect(
        service.createPlan('user-1', { name: '  \t  ', goal: 'x' }),
      ).rejects.toThrow(/Name is required/);
    });

    it('should throw VALIDATION_ERROR for empty goal', async () => {
      const err = await service.createPlan('user-1', { name: 'OK', goal: '' }).catch((e) => e);
      expect(err).toBeInstanceOf(PlanServiceError);
      expect(err.code).toBe('VALIDATION_ERROR');
    });

    it('should throw VALIDATION_ERROR for null goal', async () => {
      await expect(
        service.createPlan('user-1', { name: 'OK', goal: null as unknown as string }),
      ).rejects.toThrow(/Goal is required/);
    });

    it('should not call repo when validation fails', async () => {
      await service.createPlan('user-1', { name: '', goal: '' }).catch(() => {});
      expect(planRepo.create).not.toHaveBeenCalled();
    });

    it('should forward all optional fields to repo.create', async () => {
      planRepo.create.mockResolvedValue(fakePlan());
      const input = {
        name: 'Plan',
        goal: 'Goal',
        description: 'Desc',
        priority: 9,
        source: 'auto',
        goalId: 'g-1',
        autonomyLevel: 3,
        maxRetries: 5,
        timeoutMs: 60000,
        metadata: { key: 1 },
      };
      await service.createPlan('user-1', input);
      expect(planRepo.create).toHaveBeenCalledWith(input);
    });
  });

  // ========================================================================
  // getPlan / getPlanWithDetails
  // ========================================================================

  describe('getPlan', () => {
    it('should return plan from repo', async () => {
      planRepo.get.mockResolvedValue(fakePlan());
      const result = await service.getPlan('user-1', 'plan-1');
      expect(result).toBeTruthy();
      expect(planRepo.get).toHaveBeenCalledWith('plan-1');
    });

    it('should return null for non-existent plan', async () => {
      planRepo.get.mockResolvedValue(null);
      expect(await service.getPlan('user-1', 'nope')).toBeNull();
    });
  });

  describe('getPlanWithDetails', () => {
    it('should compose plan with steps and history', async () => {
      const plan = fakePlan();
      const steps = [fakePlanStep(), fakePlanStep({ id: 'step-2', orderNum: 2 })];
      const history = [fakePlanHistory(), fakePlanHistory({ id: 'evt-2', eventType: 'completed' })];

      planRepo.get.mockResolvedValue(plan);
      planRepo.getSteps.mockResolvedValue(steps);
      planRepo.getHistory.mockResolvedValue(history);

      const result = await service.getPlanWithDetails('user-1', 'plan-1');
      expect(result).not.toBeNull();
      expect(result!.steps).toHaveLength(2);
      expect(result!.history).toHaveLength(2);
      expect(result!.name).toBe('Ship MVP');
    });

    it('should return null and skip fetching steps/history when plan not found', async () => {
      planRepo.get.mockResolvedValue(null);
      const result = await service.getPlanWithDetails('user-1', 'missing');
      expect(result).toBeNull();
      expect(planRepo.getSteps).not.toHaveBeenCalled();
      expect(planRepo.getHistory).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // updatePlan / deletePlan
  // ========================================================================

  describe('updatePlan', () => {
    it('should emit event with changes on success', async () => {
      const updated = fakePlan({ name: 'Renamed' });
      planRepo.update.mockResolvedValue(updated);
      await service.updatePlan('user-1', 'plan-1', { name: 'Renamed' });
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'resource.updated',
        'resource',
        'plan-service',
        { resourceType: 'plan', id: 'plan-1', changes: { name: 'Renamed' } },
      );
    });

    it('should return null and skip emit for missing plan', async () => {
      planRepo.update.mockResolvedValue(null);
      const result = await service.updatePlan('user-1', 'gone', { name: 'x' });
      expect(result).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('deletePlan', () => {
    it('should emit resource.deleted on success', async () => {
      planRepo.delete.mockResolvedValue(true);
      expect(await service.deletePlan('user-1', 'plan-1')).toBe(true);
      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('should not emit when plan not found', async () => {
      planRepo.delete.mockResolvedValue(false);
      expect(await service.deletePlan('user-1', 'nope')).toBe(false);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Query helpers
  // ========================================================================

  describe('listPlans', () => {
    it('should delegate with status and goalId filters', async () => {
      planRepo.list.mockResolvedValue([fakePlan()]);
      await service.listPlans('user-1', { status: 'running', goalId: 'g-1', limit: 5 });
      expect(planRepo.list).toHaveBeenCalledWith({ status: 'running', goalId: 'g-1', limit: 5 });
    });
  });

  describe('getActive / getPending', () => {
    it('should delegate getActive to repo', async () => {
      planRepo.getActive.mockResolvedValue([fakePlan({ status: 'running' })]);
      const result = await service.getActive('user-1');
      expect(result).toHaveLength(1);
    });

    it('should delegate getPending to repo', async () => {
      planRepo.getPending.mockResolvedValue([]);
      const result = await service.getPending('user-1');
      expect(result).toHaveLength(0);
    });
  });

  // ========================================================================
  // Step operations
  // ========================================================================

  describe('addStep', () => {
    it('should verify plan exists before adding', async () => {
      planRepo.get.mockResolvedValue(fakePlan());
      planRepo.addStep.mockResolvedValue(fakePlanStep());
      await service.addStep('user-1', 'plan-1', {
        orderNum: 1,
        type: 'tool_call',
        name: 'Step',
        config: {},
      });
      expect(planRepo.get).toHaveBeenCalledWith('plan-1');
      expect(planRepo.addStep).toHaveBeenCalledWith('plan-1', expect.any(Object));
    });

    it('should throw PlanServiceError NOT_FOUND when plan missing', async () => {
      planRepo.get.mockResolvedValue(null);
      const err = await service
        .addStep('user-1', 'gone', { orderNum: 1, type: 'tool_call', name: 'S', config: {} })
        .catch((e) => e);
      expect(err).toBeInstanceOf(PlanServiceError);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toContain('gone');
    });
  });

  describe('getStep / getSteps / getNextStep', () => {
    it('should return a single step', async () => {
      planRepo.getStep.mockResolvedValue(fakePlanStep());
      const result = await service.getStep('user-1', 'step-1');
      expect(result).toBeTruthy();
    });

    it('should return null for missing step', async () => {
      planRepo.getStep.mockResolvedValue(null);
      expect(await service.getStep('user-1', 'nope')).toBeNull();
    });

    it('should return all steps for a plan', async () => {
      planRepo.getSteps.mockResolvedValue([fakePlanStep(), fakePlanStep({ id: 'step-2' })]);
      const steps = await service.getSteps('user-1', 'plan-1');
      expect(steps).toHaveLength(2);
    });

    it('should return next pending step', async () => {
      planRepo.getNextStep.mockResolvedValue(fakePlanStep({ status: 'pending' }));
      const next = await service.getNextStep('user-1', 'plan-1');
      expect(next).toBeTruthy();
    });

    it('should return null when no next step exists', async () => {
      planRepo.getNextStep.mockResolvedValue(null);
      expect(await service.getNextStep('user-1', 'plan-1')).toBeNull();
    });
  });

  describe('updateStep', () => {
    it('should delegate update to repo', async () => {
      planRepo.updateStep.mockResolvedValue(fakePlanStep({ status: 'completed' }));
      const result = await service.updateStep('user-1', 'step-1', { status: 'completed' });
      expect(result!.status).toBe('completed');
    });

    it('should return null for missing step', async () => {
      planRepo.updateStep.mockResolvedValue(null);
      expect(await service.updateStep('user-1', 'gone', { status: 'failed' })).toBeNull();
    });
  });

  describe('getStepsByStatus', () => {
    it('should filter steps by status', async () => {
      planRepo.getStepsByStatus.mockResolvedValue([
        fakePlanStep({ status: 'completed' }),
        fakePlanStep({ id: 'step-2', status: 'completed' }),
      ]);
      const result = await service.getStepsByStatus('user-1', 'plan-1', 'completed');
      expect(result).toHaveLength(2);
      expect(planRepo.getStepsByStatus).toHaveBeenCalledWith('plan-1', 'completed');
    });
  });

  describe('areDependenciesMet', () => {
    it('should return boolean from repo', async () => {
      planRepo.areDependenciesMet.mockResolvedValue(true);
      expect(await service.areDependenciesMet('user-1', 'step-1')).toBe(true);

      planRepo.areDependenciesMet.mockResolvedValue(false);
      expect(await service.areDependenciesMet('user-1', 'step-2')).toBe(false);
    });
  });

  // ========================================================================
  // History and progress
  // ========================================================================

  describe('logEvent', () => {
    it('should forward all parameters to repo', async () => {
      planRepo.logEvent.mockResolvedValue(undefined);
      await service.logEvent('user-1', 'plan-1', 'step_completed', 'step-1', { ms: 100 });
      expect(planRepo.logEvent).toHaveBeenCalledWith('plan-1', 'step_completed', 'step-1', { ms: 100 });
    });

    it('should handle missing optional params', async () => {
      planRepo.logEvent.mockResolvedValue(undefined);
      await service.logEvent('user-1', 'plan-1', 'started');
      expect(planRepo.logEvent).toHaveBeenCalledWith('plan-1', 'started', undefined, undefined);
    });
  });

  describe('getHistory', () => {
    it('should use default limit of 50', async () => {
      planRepo.getHistory.mockResolvedValue([fakePlanHistory()]);
      await service.getHistory('user-1', 'plan-1');
      expect(planRepo.getHistory).toHaveBeenCalledWith('plan-1', 50);
    });

    it('should accept custom limit', async () => {
      planRepo.getHistory.mockResolvedValue([]);
      await service.getHistory('user-1', 'plan-1', 5);
      expect(planRepo.getHistory).toHaveBeenCalledWith('plan-1', 5);
    });
  });

  describe('recalculateProgress', () => {
    it('should delegate to repo', async () => {
      planRepo.recalculateProgress.mockResolvedValue(undefined);
      await service.recalculateProgress('user-1', 'plan-1');
      expect(planRepo.recalculateProgress).toHaveBeenCalledWith('plan-1');
    });
  });

  describe('getStats', () => {
    it('should return plan stats from repo', async () => {
      const stats = {
        total: 8,
        byStatus: { pending: 2, running: 1, completed: 5 },
        completionRate: 62.5,
        avgStepsPerPlan: 4,
        avgDurationMs: 300000,
      };
      planRepo.getStats.mockResolvedValue(stats);
      const result = await service.getStats('user-1');
      expect(result).toEqual(stats);
    });
  });
});

// ###########################################################################
// GOAL SERVICE
// ###########################################################################

describe('GoalService', () => {
  let service: GoalService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GoalService();
  });

  // ========================================================================
  // createGoal
  // ========================================================================

  describe('createGoal', () => {
    it('should create a goal and emit resource.created', async () => {
      const goal = fakeGoal();
      goalRepo.create.mockResolvedValue(goal);
      const result = await service.createGoal('user-1', { title: 'Learn Rust' });
      expect(result).toBe(goal);
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'resource.created',
        'resource',
        'goal-service',
        { resourceType: 'goal', id: 'goal-1' },
      );
    });

    it('should throw GoalServiceError with VALIDATION_ERROR for empty title', async () => {
      const err = await service.createGoal('user-1', { title: '' }).catch((e) => e);
      expect(err).toBeInstanceOf(GoalServiceError);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.name).toBe('GoalServiceError');
    });

    it('should throw for whitespace-only title', async () => {
      await expect(service.createGoal('user-1', { title: '   ' })).rejects.toThrow(/Title is required/);
    });

    it('should throw for null title', async () => {
      await expect(
        service.createGoal('user-1', { title: null as unknown as string }),
      ).rejects.toThrow(GoalServiceError);
    });

    it('should not call repo.create on validation failure', async () => {
      await service.createGoal('user-1', { title: '' }).catch(() => {});
      expect(goalRepo.create).not.toHaveBeenCalled();
    });

    it('should pass all optional fields to repo', async () => {
      goalRepo.create.mockResolvedValue(fakeGoal());
      const input = {
        title: 'Goal',
        description: 'Desc',
        status: 'paused' as const,
        priority: 10,
        parentId: 'parent-1',
        dueDate: '2025-12-31',
        metadata: { key: true },
      };
      await service.createGoal('user-1', input);
      expect(goalRepo.create).toHaveBeenCalledWith(input);
    });
  });

  // ========================================================================
  // getGoal / getGoalWithSteps
  // ========================================================================

  describe('getGoal', () => {
    it('should return goal from repo', async () => {
      goalRepo.get.mockResolvedValue(fakeGoal());
      const result = await service.getGoal('user-1', 'goal-1');
      expect(result!.title).toBe('Learn Rust');
    });

    it('should return null for missing goal', async () => {
      goalRepo.get.mockResolvedValue(null);
      expect(await service.getGoal('user-1', 'missing')).toBeNull();
    });
  });

  describe('getGoalWithSteps', () => {
    it('should merge goal with its steps', async () => {
      goalRepo.get.mockResolvedValue(fakeGoal());
      goalRepo.getSteps.mockResolvedValue([fakeGoalStep(), fakeGoalStep({ id: 'gstep-2' })]);
      const result = await service.getGoalWithSteps('user-1', 'goal-1');
      expect(result!.steps).toHaveLength(2);
      expect(result!.title).toBe('Learn Rust');
    });

    it('should return null and not fetch steps when goal not found', async () => {
      goalRepo.get.mockResolvedValue(null);
      const result = await service.getGoalWithSteps('user-1', 'gone');
      expect(result).toBeNull();
      expect(goalRepo.getSteps).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // updateGoal / deleteGoal
  // ========================================================================

  describe('updateGoal', () => {
    it('should emit resource.updated with changes', async () => {
      goalRepo.update.mockResolvedValue(fakeGoal({ priority: 10 }));
      await service.updateGoal('user-1', 'goal-1', { priority: 10 });
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'resource.updated',
        'resource',
        'goal-service',
        { resourceType: 'goal', id: 'goal-1', changes: { priority: 10 } },
      );
    });

    it('should not emit event when goal not found', async () => {
      goalRepo.update.mockResolvedValue(null);
      const result = await service.updateGoal('user-1', 'gone', { title: 'x' });
      expect(result).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('deleteGoal', () => {
    it('should emit resource.deleted on success', async () => {
      goalRepo.delete.mockResolvedValue(true);
      expect(await service.deleteGoal('user-1', 'goal-1')).toBe(true);
      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('should not emit when goal not found', async () => {
      goalRepo.delete.mockResolvedValue(false);
      expect(await service.deleteGoal('user-1', 'nope')).toBe(false);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Queries
  // ========================================================================

  describe('listGoals', () => {
    it('should delegate with query params', async () => {
      goalRepo.list.mockResolvedValue([fakeGoal()]);
      await service.listGoals('user-1', { status: 'active', minPriority: 5 });
      expect(goalRepo.list).toHaveBeenCalledWith({ status: 'active', minPriority: 5 });
    });

    it('should default to empty query', async () => {
      goalRepo.list.mockResolvedValue([]);
      await service.listGoals('user-1');
      expect(goalRepo.list).toHaveBeenCalledWith({});
    });
  });

  describe('getActive', () => {
    it('should pass limit to repo', async () => {
      goalRepo.getActive.mockResolvedValue([]);
      await service.getActive('user-1', 3);
      expect(goalRepo.getActive).toHaveBeenCalledWith(3);
    });

    it('should use default limit when not provided', async () => {
      goalRepo.getActive.mockResolvedValue([]);
      await service.getActive('user-1');
      expect(goalRepo.getActive).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getUpcoming', () => {
    it('should pass days to repo', async () => {
      goalRepo.getUpcoming.mockResolvedValue([fakeGoal()]);
      await service.getUpcoming('user-1', 14);
      expect(goalRepo.getUpcoming).toHaveBeenCalledWith(14);
    });

    it('should use default 7 days when not provided', async () => {
      goalRepo.getUpcoming.mockResolvedValue([]);
      await service.getUpcoming('user-1');
      expect(goalRepo.getUpcoming).toHaveBeenCalledWith(7);
    });
  });

  describe('getNextActions', () => {
    it('should delegate with limit', async () => {
      goalRepo.getNextActions.mockResolvedValue([]);
      await service.getNextActions('user-1', 10);
      expect(goalRepo.getNextActions).toHaveBeenCalledWith(10);
    });

    it('should use default limit of 5', async () => {
      goalRepo.getNextActions.mockResolvedValue([]);
      await service.getNextActions('user-1');
      expect(goalRepo.getNextActions).toHaveBeenCalledWith(5);
    });
  });

  describe('getStats', () => {
    it('should return stats from repo', async () => {
      const stats = {
        total: 12,
        byStatus: { active: 5, paused: 2, completed: 4, abandoned: 1 },
        completedThisWeek: 2,
        averageProgress: 45,
        overdueCount: 3,
      };
      goalRepo.getStats.mockResolvedValue(stats);
      expect(await service.getStats('user-1')).toEqual(stats);
    });
  });

  // ========================================================================
  // Step operations
  // ========================================================================

  describe('addStep', () => {
    it('should add step to existing goal', async () => {
      goalRepo.get.mockResolvedValue(fakeGoal());
      goalRepo.addStep.mockResolvedValue(fakeGoalStep());
      const result = await service.addStep('user-1', 'goal-1', { title: 'Read Ch 1' });
      expect(result.title).toBe('Read The Book');
    });

    it('should throw GoalServiceError NOT_FOUND when goal missing', async () => {
      goalRepo.get.mockResolvedValue(null);
      const err = await service.addStep('user-1', 'gone', { title: 'x' }).catch((e) => e);
      expect(err).toBeInstanceOf(GoalServiceError);
      expect(err.code).toBe('NOT_FOUND');
    });

    it('should throw INTERNAL_ERROR when addStep returns null', async () => {
      goalRepo.get.mockResolvedValue(fakeGoal());
      goalRepo.addStep.mockResolvedValue(null);
      const err = await service.addStep('user-1', 'goal-1', { title: 'x' }).catch((e) => e);
      expect(err).toBeInstanceOf(GoalServiceError);
      expect(err.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('decomposeGoal', () => {
    it('should create multiple steps and recalculate progress', async () => {
      goalRepo.get.mockResolvedValue(fakeGoal());
      goalRepo.addStep
        .mockResolvedValueOnce(fakeGoalStep({ id: 's1', title: 'A' }))
        .mockResolvedValueOnce(fakeGoalStep({ id: 's2', title: 'B' }))
        .mockResolvedValueOnce(fakeGoalStep({ id: 's3', title: 'C' }));
      goalRepo.recalculateProgress.mockResolvedValue(0);

      const result = await service.decomposeGoal('user-1', 'goal-1', [
        { title: 'A' },
        { title: 'B' },
        { title: 'C', description: 'Third step' },
      ]);

      expect(result).toHaveLength(3);
      expect(goalRepo.addStep).toHaveBeenCalledTimes(3);
      expect(goalRepo.recalculateProgress).toHaveBeenCalledWith('goal-1');
    });

    it('should throw VALIDATION_ERROR for empty steps array', async () => {
      const err = await service.decomposeGoal('user-1', 'goal-1', []).catch((e) => e);
      expect(err).toBeInstanceOf(GoalServiceError);
      expect(err.code).toBe('VALIDATION_ERROR');
    });

    it('should throw NOT_FOUND when goal does not exist', async () => {
      goalRepo.get.mockResolvedValue(null);
      await expect(
        service.decomposeGoal('user-1', 'gone', [{ title: 'x' }]),
      ).rejects.toThrow(/Goal not found/);
    });

    it('should throw when addStep returns null during decompose', async () => {
      goalRepo.get.mockResolvedValue(fakeGoal());
      goalRepo.addStep
        .mockResolvedValueOnce(fakeGoalStep({ id: 's1' }))
        .mockResolvedValueOnce(null);
      goalRepo.recalculateProgress.mockResolvedValue(50);

      await expect(
        service.decomposeGoal('user-1', 'goal-1', [
          { title: 'A' },
          { title: 'B' },
        ]),
      ).rejects.toThrow(/Failed to create step/);
    });

    it('should use repo.transaction for atomicity', async () => {
      goalRepo.get.mockResolvedValue(fakeGoal());
      goalRepo.addStep.mockResolvedValue(fakeGoalStep());
      goalRepo.recalculateProgress.mockResolvedValue(100);

      await service.decomposeGoal('user-1', 'goal-1', [{ title: 'A' }]);
      expect(goalRepo.transaction).toHaveBeenCalledOnce();
    });
  });

  describe('getSteps', () => {
    it('should return steps for a goal', async () => {
      goalRepo.getSteps.mockResolvedValue([fakeGoalStep(), fakeGoalStep({ id: 'gs-2' })]);
      const result = await service.getSteps('user-1', 'goal-1');
      expect(result).toHaveLength(2);
    });
  });

  describe('updateStep', () => {
    it('should recalculate progress when status changes', async () => {
      goalRepo.getStep.mockResolvedValue(fakeGoalStep());
      goalRepo.updateStep.mockResolvedValue(fakeGoalStep({ status: 'completed' }));
      goalRepo.recalculateProgress.mockResolvedValue(100);

      await service.updateStep('user-1', 'gstep-1', { status: 'completed' });
      expect(goalRepo.recalculateProgress).toHaveBeenCalledWith('goal-1');
    });

    it('should not recalculate progress when only title changes', async () => {
      goalRepo.getStep.mockResolvedValue(fakeGoalStep());
      goalRepo.updateStep.mockResolvedValue(fakeGoalStep({ title: 'Updated' }));

      await service.updateStep('user-1', 'gstep-1', { title: 'Updated' });
      expect(goalRepo.recalculateProgress).not.toHaveBeenCalled();
    });

    it('should return null when step not found', async () => {
      goalRepo.getStep.mockResolvedValue(null);
      const result = await service.updateStep('user-1', 'gone', { status: 'completed' });
      expect(result).toBeNull();
      expect(goalRepo.updateStep).not.toHaveBeenCalled();
    });
  });

  describe('completeStep', () => {
    it('should mark step completed with result and recalculate progress', async () => {
      goalRepo.getStep.mockResolvedValue(fakeGoalStep());
      goalRepo.updateStep.mockResolvedValue(fakeGoalStep({ status: 'completed' }));
      goalRepo.recalculateProgress.mockResolvedValue(50);

      const result = await service.completeStep('user-1', 'gstep-1', 'Success!');
      expect(result).toBeTruthy();
      expect(goalRepo.updateStep).toHaveBeenCalledWith('gstep-1', {
        status: 'completed',
        result: 'Success!',
      });
      expect(goalRepo.recalculateProgress).toHaveBeenCalledWith('goal-1');
    });

    it('should handle missing result parameter', async () => {
      goalRepo.getStep.mockResolvedValue(fakeGoalStep());
      goalRepo.updateStep.mockResolvedValue(fakeGoalStep({ status: 'completed' }));
      goalRepo.recalculateProgress.mockResolvedValue(100);

      await service.completeStep('user-1', 'gstep-1');
      expect(goalRepo.updateStep).toHaveBeenCalledWith('gstep-1', {
        status: 'completed',
        result: undefined,
      });
    });

    it('should return null when step not found', async () => {
      goalRepo.getStep.mockResolvedValue(null);
      expect(await service.completeStep('user-1', 'nope')).toBeNull();
      expect(goalRepo.updateStep).not.toHaveBeenCalled();
    });

    it('should not recalculate progress when updateStep returns null', async () => {
      goalRepo.getStep.mockResolvedValue(fakeGoalStep());
      goalRepo.updateStep.mockResolvedValue(null);

      await service.completeStep('user-1', 'gstep-1');
      expect(goalRepo.recalculateProgress).not.toHaveBeenCalled();
    });
  });

  describe('deleteStep', () => {
    it('should delete and recalculate progress', async () => {
      goalRepo.getStep.mockResolvedValue(fakeGoalStep());
      goalRepo.deleteStep.mockResolvedValue(true);
      goalRepo.recalculateProgress.mockResolvedValue(0);

      expect(await service.deleteStep('user-1', 'gstep-1')).toBe(true);
      expect(goalRepo.recalculateProgress).toHaveBeenCalledWith('goal-1');
    });

    it('should return false and not recalculate when step not found', async () => {
      goalRepo.getStep.mockResolvedValue(null);
      expect(await service.deleteStep('user-1', 'gone')).toBe(false);
      expect(goalRepo.deleteStep).not.toHaveBeenCalled();
      expect(goalRepo.recalculateProgress).not.toHaveBeenCalled();
    });

    it('should not recalculate progress when deleteStep returns false', async () => {
      goalRepo.getStep.mockResolvedValue(fakeGoalStep());
      goalRepo.deleteStep.mockResolvedValue(false);

      await service.deleteStep('user-1', 'gstep-1');
      expect(goalRepo.recalculateProgress).not.toHaveBeenCalled();
    });
  });
});

// ###########################################################################
// TRIGGER SERVICE
// ###########################################################################

describe('TriggerService', () => {
  let service: TriggerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TriggerService();
  });

  // ========================================================================
  // createTrigger
  // ========================================================================

  describe('createTrigger', () => {
    it('should create a trigger and emit resource.created', async () => {
      const trigger = fakeTrigger();
      triggerRepo.create.mockResolvedValue(trigger);

      const result = await service.createTrigger('user-1', {
        name: 'Morning check',
        type: 'schedule',
        config: { cron: '0 8 * * *' },
        action: { type: 'notification', payload: { message: 'Hi' } },
      });

      expect(result).toBe(trigger);
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'resource.created',
        'resource',
        'trigger-service',
        { resourceType: 'trigger', id: 'trg-1' },
      );
    });

    it('should throw TriggerServiceError with VALIDATION_ERROR for empty name', async () => {
      const err = await service
        .createTrigger('user-1', {
          name: '',
          type: 'event',
          config: { eventType: 'test' },
          action: { type: 'chat', payload: {} },
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(TriggerServiceError);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.name).toBe('TriggerServiceError');
    });

    it('should throw VALIDATION_ERROR for whitespace-only name', async () => {
      await expect(
        service.createTrigger('user-1', {
          name: '   ',
          type: 'schedule',
          config: {},
          action: { type: 'chat', payload: {} },
        }),
      ).rejects.toThrow(/Name is required/);
    });

    it('should throw VALIDATION_ERROR for null name', async () => {
      await expect(
        service.createTrigger('user-1', {
          name: null as unknown as string,
          type: 'schedule',
          config: {},
          action: { type: 'chat', payload: {} },
        }),
      ).rejects.toThrow(TriggerServiceError);
    });

    it('should not call repo.create when validation fails', async () => {
      await service
        .createTrigger('user-1', {
          name: '',
          type: 'event',
          config: {},
          action: { type: 'chat', payload: {} },
        })
        .catch(() => {});
      expect(triggerRepo.create).not.toHaveBeenCalled();
    });

    it('should pass all fields including optional ones to repo', async () => {
      triggerRepo.create.mockResolvedValue(fakeTrigger());
      const input = {
        name: 'Webhook',
        description: 'Incoming',
        type: 'webhook' as const,
        config: { secret: 's3cret' },
        action: { type: 'tool' as const, payload: { toolName: 'fetch' } },
        enabled: false,
        priority: 9,
      };
      await service.createTrigger('user-1', input);
      expect(triggerRepo.create).toHaveBeenCalledWith(input);
    });
  });

  // ========================================================================
  // getTrigger / listTriggers
  // ========================================================================

  describe('getTrigger', () => {
    it('should return trigger when found', async () => {
      triggerRepo.get.mockResolvedValue(fakeTrigger());
      const result = await service.getTrigger('user-1', 'trg-1');
      expect(result!.name).toBe('Morning check');
    });

    it('should return null when not found', async () => {
      triggerRepo.get.mockResolvedValue(null);
      expect(await service.getTrigger('user-1', 'missing')).toBeNull();
    });
  });

  describe('listTriggers', () => {
    it('should pass query including type and enabled filters', async () => {
      triggerRepo.list.mockResolvedValue([fakeTrigger()]);
      await service.listTriggers('user-1', { type: 'schedule', enabled: true, limit: 10 });
      expect(triggerRepo.list).toHaveBeenCalledWith({ type: 'schedule', enabled: true, limit: 10 });
    });

    it('should default to empty query', async () => {
      triggerRepo.list.mockResolvedValue([]);
      await service.listTriggers('user-1');
      expect(triggerRepo.list).toHaveBeenCalledWith({});
    });
  });

  // ========================================================================
  // updateTrigger / deleteTrigger
  // ========================================================================

  describe('updateTrigger', () => {
    it('should emit resource.updated with changes on success', async () => {
      const updated = fakeTrigger({ enabled: false });
      triggerRepo.update.mockResolvedValue(updated);
      await service.updateTrigger('user-1', 'trg-1', { enabled: false });
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'resource.updated',
        'resource',
        'trigger-service',
        { resourceType: 'trigger', id: 'trg-1', changes: { enabled: false } },
      );
    });

    it('should return null and skip emit for missing trigger', async () => {
      triggerRepo.update.mockResolvedValue(null);
      const result = await service.updateTrigger('user-1', 'gone', { name: 'x' });
      expect(result).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('deleteTrigger', () => {
    it('should emit resource.deleted on success', async () => {
      triggerRepo.delete.mockResolvedValue(true);
      expect(await service.deleteTrigger('user-1', 'trg-1')).toBe(true);
      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('should not emit when trigger not found', async () => {
      triggerRepo.delete.mockResolvedValue(false);
      expect(await service.deleteTrigger('user-1', 'nope')).toBe(false);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Query methods
  // ========================================================================

  describe('getDueTriggers', () => {
    it('should delegate to repo', async () => {
      triggerRepo.getDueTriggers.mockResolvedValue([fakeTrigger()]);
      const result = await service.getDueTriggers('user-1');
      expect(result).toHaveLength(1);
    });

    it('should return empty array when none are due', async () => {
      triggerRepo.getDueTriggers.mockResolvedValue([]);
      expect(await service.getDueTriggers('user-1')).toHaveLength(0);
    });
  });

  describe('getByEventType', () => {
    it('should delegate with event type string', async () => {
      triggerRepo.getByEventType.mockResolvedValue([fakeTrigger({ type: 'event' })]);
      const result = await service.getByEventType('user-1', 'goal_completed');
      expect(result).toHaveLength(1);
      expect(triggerRepo.getByEventType).toHaveBeenCalledWith('goal_completed');
    });
  });

  describe('getConditionTriggers', () => {
    it('should delegate to repo', async () => {
      triggerRepo.getConditionTriggers.mockResolvedValue([]);
      await service.getConditionTriggers('user-1');
      expect(triggerRepo.getConditionTriggers).toHaveBeenCalledOnce();
    });
  });

  // ========================================================================
  // Execution tracking
  // ========================================================================

  describe('markFired', () => {
    it('should delegate with nextFire', async () => {
      triggerRepo.markFired.mockResolvedValue(undefined);
      await service.markFired('user-1', 'trg-1', '2025-02-01T08:00:00Z');
      expect(triggerRepo.markFired).toHaveBeenCalledWith('trg-1', '2025-02-01T08:00:00Z');
    });

    it('should delegate without nextFire', async () => {
      triggerRepo.markFired.mockResolvedValue(undefined);
      await service.markFired('user-1', 'trg-1');
      expect(triggerRepo.markFired).toHaveBeenCalledWith('trg-1', undefined);
    });
  });

  describe('logExecution', () => {
    it('should delegate success execution', async () => {
      triggerRepo.logExecution.mockResolvedValue(undefined);
      await service.logExecution('user-1', 'trg-1', 'Test Trigger', 'success', { data: 1 }, undefined, 50);
      expect(triggerRepo.logExecution).toHaveBeenCalledWith('trg-1', 'Test Trigger', 'success', { data: 1 }, undefined, 50);
    });

    it('should delegate failure execution with error', async () => {
      triggerRepo.logExecution.mockResolvedValue(undefined);
      await service.logExecution('user-1', 'trg-1', 'Test Trigger', 'failure', undefined, 'Timeout', 5000);
      expect(triggerRepo.logExecution).toHaveBeenCalledWith('trg-1', 'Test Trigger', 'failure', undefined, 'Timeout', 5000);
    });

    it('should delegate skipped execution', async () => {
      triggerRepo.logExecution.mockResolvedValue(undefined);
      await service.logExecution('user-1', 'trg-1', 'Test Trigger', 'skipped');
      expect(triggerRepo.logExecution).toHaveBeenCalledWith('trg-1', 'Test Trigger', 'skipped', undefined, undefined, undefined);
    });
  });

  describe('getRecentHistory', () => {
    it('should use default empty query', async () => {
      triggerRepo.getRecentHistory.mockResolvedValue({ rows: [fakeTriggerHistory()], total: 1 });
      const result = await service.getRecentHistory('user-1');
      expect(result.history).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(triggerRepo.getRecentHistory).toHaveBeenCalledWith({});
    });

    it('should accept custom limit', async () => {
      triggerRepo.getRecentHistory.mockResolvedValue({ rows: [], total: 0 });
      await service.getRecentHistory('user-1', { limit: 100 });
      expect(triggerRepo.getRecentHistory).toHaveBeenCalledWith({ limit: 100 });
    });
  });

  describe('getHistoryForTrigger', () => {
    it('should delegate with trigger id and default query', async () => {
      triggerRepo.getHistoryForTrigger.mockResolvedValue({ rows: [], total: 0 });
      await service.getHistoryForTrigger('user-1', 'trg-1');
      expect(triggerRepo.getHistoryForTrigger).toHaveBeenCalledWith('trg-1', {});
    });

    it('should accept custom limit', async () => {
      triggerRepo.getHistoryForTrigger.mockResolvedValue({ rows: [fakeTriggerHistory()], total: 1 });
      await service.getHistoryForTrigger('user-1', 'trg-1', { limit: 5 });
      expect(triggerRepo.getHistoryForTrigger).toHaveBeenCalledWith('trg-1', { limit: 5 });
    });
  });

  describe('cleanupHistory', () => {
    it('should use default maxAgeDays of 30', async () => {
      triggerRepo.cleanupHistory.mockResolvedValue(15);
      const result = await service.cleanupHistory('user-1');
      expect(result).toBe(15);
      expect(triggerRepo.cleanupHistory).toHaveBeenCalledWith(30);
    });

    it('should accept custom maxAgeDays', async () => {
      triggerRepo.cleanupHistory.mockResolvedValue(3);
      const result = await service.cleanupHistory('user-1', 7);
      expect(result).toBe(3);
      expect(triggerRepo.cleanupHistory).toHaveBeenCalledWith(7);
    });
  });

  // ========================================================================
  // Stats
  // ========================================================================

  describe('getStats', () => {
    it('should return stats from repo', async () => {
      const stats = {
        total: 20,
        enabled: 15,
        byType: { schedule: 10, event: 5, condition: 3, webhook: 2 },
        totalFires: 500,
        firesThisWeek: 42,
        successRate: 95,
      };
      triggerRepo.getStats.mockResolvedValue(stats);
      expect(await service.getStats('user-1')).toEqual(stats);
    });
  });
});
