/**
 * SubagentService Tests
 *
 * Tests the facade layer: delegation to manager + userId filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockManager = {
  spawn: vi.fn(),
  getSession: vi.fn(),
  listByParent: vi.fn(),
  cancel: vi.fn(),
  getStats: vi.fn(),
  cleanup: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('./subagent-manager.js', () => ({
  SubagentManager: vi.fn(),
  getSubagentManager: vi.fn(() => mockManager),
  resetSubagentManager: vi.fn(),
}));

const mockRepo = {
  saveExecution: vi.fn(),
  getHistory: vi.fn(),
  getByUser: vi.fn(),
  cleanupOld: vi.fn(),
};

vi.mock('../db/repositories/subagents.js', () => ({
  SubagentsRepository: vi.fn().mockImplementation(() => mockRepo),
}));

const { SubagentServiceImpl, getSubagentService, resetSubagentService } =
  await import('./subagent-service.js');
const { SubagentsRepository: MockSubagentsRepository } =
  await import('../db/repositories/subagents.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    parentId: 'conv-1',
    parentType: 'chat',
    userId: 'user-1',
    name: 'Research',
    task: 'Research pricing',
    state: 'running',
    spawnedAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    turnsUsed: 0,
    toolCallsUsed: 0,
    tokensUsed: null,
    durationMs: null,
    result: null,
    error: null,
    toolCalls: [],
    provider: 'openai',
    model: 'gpt-4o-mini',
    limits: { maxTurns: 20, maxToolCalls: 100, timeoutMs: 120000, maxTokens: 8192 },
    ...overrides,
  };
}

function makeHistoryEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    parentId: 'conv-1',
    parentType: 'chat',
    userId: 'user-1',
    name: 'Research',
    task: 'Research pricing',
    state: 'completed',
    result: 'Found data',
    error: null,
    toolCalls: [],
    turnsUsed: 1,
    toolCallsUsed: 0,
    tokensUsed: null,
    durationMs: 1000,
    provider: 'openai',
    model: 'gpt-4o-mini',
    spawnedAt: new Date(),
    completedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubagentServiceImpl', () => {
  let service: InstanceType<typeof SubagentServiceImpl>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SubagentServiceImpl(mockManager as never, mockRepo as never);
  });

  // -------------------------------------------------------------------------
  // spawn
  // -------------------------------------------------------------------------

  describe('spawn', () => {
    it('delegates to manager.spawn', async () => {
      const session = makeSession();
      mockManager.spawn.mockResolvedValue(session);

      const input = {
        parentId: 'conv-1',
        parentType: 'chat' as const,
        userId: 'user-1',
        name: 'Research',
        task: 'Do research',
      };

      const result = await service.spawn(input);

      expect(mockManager.spawn).toHaveBeenCalledWith(input);
      expect(result).toBe(session);
    });
  });

  // -------------------------------------------------------------------------
  // getSession
  // -------------------------------------------------------------------------

  describe('getSession', () => {
    it('returns session for matching userId', () => {
      mockManager.getSession.mockReturnValue(makeSession({ userId: 'user-1' }));

      const result = service.getSession('sub-1', 'user-1');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-1');
    });

    it('returns null for different userId (multi-tenant filter)', () => {
      mockManager.getSession.mockReturnValue(makeSession({ userId: 'user-1' }));

      const result = service.getSession('sub-1', 'user-2');

      expect(result).toBeNull();
    });

    it('returns null when manager returns null', () => {
      mockManager.getSession.mockReturnValue(null);

      const result = service.getSession('sub-1', 'user-1');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // listByParent
  // -------------------------------------------------------------------------

  describe('listByParent', () => {
    it('filters sessions by userId', () => {
      mockManager.listByParent.mockReturnValue([
        makeSession({ id: 'sub-1', userId: 'user-1' }),
        makeSession({ id: 'sub-2', userId: 'user-2' }),
        makeSession({ id: 'sub-3', userId: 'user-1' }),
      ]);

      const result = service.listByParent('conv-1', 'user-1');

      expect(result).toHaveLength(2);
      expect(result.map((s: { id: string }) => s.id)).toEqual(['sub-1', 'sub-3']);
    });

    it('returns empty when no matching userId', () => {
      mockManager.listByParent.mockReturnValue([makeSession({ userId: 'user-1' })]);

      const result = service.listByParent('conv-1', 'user-other');
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getResult
  // -------------------------------------------------------------------------

  describe('getResult', () => {
    it('delegates to getSession', () => {
      const session = makeSession({ userId: 'user-1', state: 'completed', result: 'Done' });
      mockManager.getSession.mockReturnValue(session);

      const result = service.getResult('sub-1', 'user-1');

      expect(result).not.toBeNull();
      expect(result!.result).toBe('Done');
    });
  });

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  describe('cancel', () => {
    it('cancels when userId matches', () => {
      mockManager.getSession.mockReturnValue(makeSession({ userId: 'user-1' }));
      mockManager.cancel.mockReturnValue(true);

      const result = service.cancel('sub-1', 'user-1');

      expect(result).toBe(true);
      expect(mockManager.cancel).toHaveBeenCalledWith('sub-1');
    });

    it('rejects when userId does not match', () => {
      mockManager.getSession.mockReturnValue(makeSession({ userId: 'user-1' }));

      const result = service.cancel('sub-1', 'user-2');

      expect(result).toBe(false);
      expect(mockManager.cancel).not.toHaveBeenCalled();
    });

    it('returns false when session not found', () => {
      mockManager.getSession.mockReturnValue(null);

      const result = service.cancel('sub-1', 'user-1');

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getHistory
  // -------------------------------------------------------------------------

  describe('getHistory', () => {
    it('returns filtered history from repo', async () => {
      mockRepo.getHistory.mockResolvedValue({
        entries: [
          makeHistoryEntry({ userId: 'user-1' }),
          makeHistoryEntry({ id: 'sub-2', userId: 'user-2' }),
          makeHistoryEntry({ id: 'sub-3', userId: 'user-1' }),
        ],
        total: 3,
      });

      const result = await service.getHistory('conv-1', 'user-1', 20, 0);

      expect(result.entries).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('passes pagination to repo', async () => {
      mockRepo.getHistory.mockResolvedValue({ entries: [], total: 0 });

      await service.getHistory('conv-1', 'user-1', 10, 5);

      expect(mockRepo.getHistory).toHaveBeenCalledWith('conv-1', 10, 5);
    });
  });
});

// ── getSubagentService / resetSubagentService singletons ────────────────────

describe('getSubagentService', () => {
  beforeEach(() => {
    // Re-apply with regular function (not arrow) for `new` constructor compatibility
    vi.mocked(MockSubagentsRepository).mockImplementation(function () {
      return mockRepo as never;
    });
    resetSubagentService();
  });
  afterEach(() => {
    resetSubagentService();
  });

  it('returns a SubagentServiceImpl instance', () => {
    const svc = getSubagentService();
    expect(svc).toBeInstanceOf(SubagentServiceImpl);
  });

  it('returns same singleton on repeated calls', () => {
    const s1 = getSubagentService();
    const s2 = getSubagentService();
    expect(s1).toBe(s2);
  });

  it('resetSubagentService creates a new instance on next call', () => {
    const s1 = getSubagentService();
    resetSubagentService();
    const s2 = getSubagentService();
    expect(s1).not.toBe(s2);
  });
});
