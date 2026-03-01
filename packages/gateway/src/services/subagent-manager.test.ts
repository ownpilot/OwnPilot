/**
 * SubagentManager Tests
 *
 * Tests lifecycle management: spawn, budget enforcement, cancel, cleanup, events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  let idCounter = 0;
  return {
    ...actual,
    generateId: vi.fn(() => `sub-${++idCounter}`),
    getEventSystem: vi.fn(() => ({
      emit: vi.fn(),
    })),
    getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  };
});

const mockRepo = {
  saveExecution: vi.fn().mockResolvedValue(undefined),
  getHistory: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
  getByUser: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
  cleanupOld: vi.fn().mockResolvedValue(0),
};

vi.mock('../db/repositories/subagents.js', () => ({
  SubagentsRepository: vi.fn().mockImplementation(() => mockRepo),
}));

// Mock SubagentRunner — do NOT actually run agents
const completedResult = {
  success: true,
  result: 'Task completed',
  toolCalls: [],
  turnsUsed: 1,
  toolCallsUsed: 0,
  tokensUsed: null,
  durationMs: 100,
  error: null,
  provider: 'openai',
  model: 'gpt-4o-mini',
};

/** Deferred promises for controlling runner completion per test */
let pendingRunners: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];

/** When true, runners never complete (for concurrent limit / cancel tests) */
let runnerHangs = false;

vi.mock('./subagent-runner.js', () => ({
  SubagentRunner: vi.fn().mockImplementation(function () {
    return {
      run: vi.fn(() => {
        if (runnerHangs) {
          return new Promise((resolve, reject) => {
            pendingRunners.push({ resolve, reject });
          });
        }
        return Promise.resolve(completedResult);
      }),
      cancel: vi.fn(),
      cancelled: false,
    };
  }),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

const { SubagentManager } = await import('./subagent-manager.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpawnInput(overrides: Record<string, unknown> = {}) {
  return {
    parentId: 'conv-1',
    parentType: 'chat' as const,
    userId: 'user-1',
    name: 'Research pricing',
    task: 'Find competitor pricing data',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubagentManager', () => {
  let manager: InstanceType<typeof SubagentManager>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    pendingRunners = [];
    runnerHangs = false;
    manager = new SubagentManager({ maxConcurrent: 3, maxTotalSpawns: 5, maxTotalTokens: 0 }, mockRepo as never);
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // spawn
  // -------------------------------------------------------------------------

  describe('spawn', () => {
    it('creates a new session and returns it', async () => {
      const session = await manager.spawn(makeSpawnInput());

      expect(session).toBeDefined();
      expect(session.id).toBeTruthy();
      expect(session.parentId).toBe('conv-1');
      expect(session.parentType).toBe('chat');
      expect(session.userId).toBe('user-1');
      expect(session.name).toBe('Research pricing');
      expect(session.task).toBe('Find competitor pricing data');
      // State transitions to 'running' immediately as executeInBackground is called synchronously
      expect(['pending', 'running']).toContain(session.state);
      expect(session.spawnedAt).toBeInstanceOf(Date);
    });

    it('increments spawn count per parent', async () => {
      await manager.spawn(makeSpawnInput());
      await manager.spawn(makeSpawnInput({ name: 'Task 2' }));

      const stats = manager.getStats();
      expect(stats.total).toBe(2);
    });

    it('rejects when concurrent limit is reached', async () => {
      // Make runners hang so they stay "active"
      runnerHangs = true;

      // Spawn 3 (the max)
      await manager.spawn(makeSpawnInput({ name: 'Task 1' }));
      await manager.spawn(makeSpawnInput({ name: 'Task 2' }));
      await manager.spawn(makeSpawnInput({ name: 'Task 3' }));

      // 4th should fail
      await expect(manager.spawn(makeSpawnInput({ name: 'Task 4' }))).rejects.toThrow(
        /Concurrent subagent limit/
      );
    });

    it('rejects when total spawn limit is reached', async () => {
      // Spawn 5 (the max) — but max concurrent is 3, so we need to complete some
      // Since runner resolves immediately (mock), they'll be completed after awaiting
      await manager.spawn(makeSpawnInput({ name: 'T1' }));
      await manager.spawn(makeSpawnInput({ name: 'T2' }));
      await manager.spawn(makeSpawnInput({ name: 'T3' }));

      // Wait for runners to complete so they're no longer active
      await vi.advanceTimersByTimeAsync(50);

      await manager.spawn(makeSpawnInput({ name: 'T4' }));
      await manager.spawn(makeSpawnInput({ name: 'T5' }));

      // 6th should fail (total limit = 5)
      await expect(manager.spawn(makeSpawnInput({ name: 'T6' }))).rejects.toThrow(
        /Total subagent spawn limit/
      );
    });

    it('rejects when nesting depth exceeds max', async () => {
      await expect(
        manager.spawn(makeSpawnInput({ _depth: 3 }))
      ).rejects.toThrow(/nesting depth limit/);
    });

    it('allows depth = 0 (top-level)', async () => {
      const session = await manager.spawn(makeSpawnInput({ _depth: 0 }));
      expect(session).toBeDefined();
    });

    it('allows depth = 1 (one level deep)', async () => {
      const session = await manager.spawn(makeSpawnInput({ _depth: 1 }));
      expect(session).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getSession
  // -------------------------------------------------------------------------

  describe('getSession', () => {
    it('returns session by ID', async () => {
      const spawned = await manager.spawn(makeSpawnInput());
      const session = manager.getSession(spawned.id);

      expect(session).toBeDefined();
      expect(session!.id).toBe(spawned.id);
    });

    it('returns null for unknown ID', () => {
      const session = manager.getSession('nonexistent');
      expect(session).toBeNull();
    });

    it('returns a copy (not the original reference)', async () => {
      const spawned = await manager.spawn(makeSpawnInput());
      const s1 = manager.getSession(spawned.id);
      const s2 = manager.getSession(spawned.id);

      expect(s1).not.toBe(s2);
      expect(s1).toEqual(s2);
    });
  });

  // -------------------------------------------------------------------------
  // listByParent
  // -------------------------------------------------------------------------

  describe('listByParent', () => {
    it('returns all sessions for a parent', async () => {
      await manager.spawn(makeSpawnInput({ name: 'Task A' }));
      await manager.spawn(makeSpawnInput({ name: 'Task B' }));

      const list = manager.listByParent('conv-1');
      expect(list).toHaveLength(2);
    });

    it('returns empty for unknown parent', () => {
      const list = manager.listByParent('unknown-parent');
      expect(list).toEqual([]);
    });

    it('does not mix parents', async () => {
      await manager.spawn(makeSpawnInput({ parentId: 'conv-1', name: 'T1' }));
      await manager.spawn(makeSpawnInput({ parentId: 'conv-2', name: 'T2' }));

      const list1 = manager.listByParent('conv-1');
      const list2 = manager.listByParent('conv-2');

      expect(list1).toHaveLength(1);
      expect(list2).toHaveLength(1);
      expect(list1[0].name).toBe('T1');
      expect(list2[0].name).toBe('T2');
    });
  });

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  describe('cancel', () => {
    it('cancels a pending/running subagent', async () => {
      // Make runner hang so it stays active
      runnerHangs = true;
      const spawned = await manager.spawn(makeSpawnInput());

      const cancelled = manager.cancel(spawned.id);
      expect(cancelled).toBe(true);

      const session = manager.getSession(spawned.id);
      expect(session!.state).toBe('cancelled');
      expect(session!.completedAt).toBeInstanceOf(Date);
    });

    it('returns false for unknown ID', () => {
      expect(manager.cancel('nonexistent')).toBe(false);
    });

    it('returns false for already completed subagent', async () => {
      const spawned = await manager.spawn(makeSpawnInput());

      // Wait for runner to complete
      await vi.advanceTimersByTimeAsync(50);

      // Now session is completed
      const cancelled = manager.cancel(spawned.id);
      expect(cancelled).toBe(false);
    });

    it('persists cancelled session to DB', async () => {
      runnerHangs = true;
      const spawned = await manager.spawn(makeSpawnInput());
      manager.cancel(spawned.id);

      expect(mockRepo.saveExecution).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // cleanup
  // -------------------------------------------------------------------------

  describe('cleanup', () => {
    it('removes completed sessions older than TTL', async () => {
      const spawned = await manager.spawn(makeSpawnInput());

      // Wait for runner to complete
      await vi.advanceTimersByTimeAsync(50);

      // Session should exist
      expect(manager.getSession(spawned.id)).not.toBeNull();

      // Advance past TTL (30 min)
      vi.advanceTimersByTime(31 * 60 * 1000);

      manager.cleanup(30 * 60 * 1000);

      // Session should be cleaned up
      expect(manager.getSession(spawned.id)).toBeNull();
    });

    it('does not remove active sessions', async () => {
      // Runner hangs so sessions stay active
      runnerHangs = true;
      const spawned = await manager.spawn(makeSpawnInput());

      vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour
      manager.cleanup(0); // TTL = 0ms (immediate cleanup of completed)

      // Session should still exist (still running)
      expect(manager.getSession(spawned.id)).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  describe('getStats', () => {
    it('returns current statistics', async () => {
      await manager.spawn(makeSpawnInput({ name: 'T1' }));
      await manager.spawn(makeSpawnInput({ name: 'T2' }));

      const stats = manager.getStats();
      expect(stats.total).toBe(2);
      expect(stats.parents).toBe(1);
    });

    it('tracks multiple parents', async () => {
      await manager.spawn(makeSpawnInput({ parentId: 'conv-1', name: 'T1' }));
      await manager.spawn(makeSpawnInput({ parentId: 'conv-2', name: 'T2' }));

      const stats = manager.getStats();
      expect(stats.parents).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // dispose
  // -------------------------------------------------------------------------

  describe('dispose', () => {
    it('stops the cleanup timer', () => {
      const spy = vi.spyOn(global, 'clearInterval');
      manager.dispose();
      expect(spy).toHaveBeenCalled();
    });
  });
});
