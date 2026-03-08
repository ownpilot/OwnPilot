/**
 * Coding Agent Orchestrator Tests
 *
 * Tests for the orchestration engine that chains CLI sessions together.
 * Covers: startOrchestration, continueOrchestration, cancelOrchestration,
 *         getOrchestration, listOrchestrations, and the internal loop logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRunsRepo = {
  create: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  updateStatus: vi.fn(),
  updateSteps: vi.fn(),
};

const mockResultsRepo = {
  getBySessionId: vi.fn(),
};

const mockSession = {
  id: 'sess-1',
  status: 'running',
  provider: 'claude-code',
};

const mockService = {
  createSession: vi.fn(async () => mockSession),
  waitForCompletion: vi.fn(async () => ({ exitCode: 0 })),
  getOutputBuffer: vi.fn(() => 'Build succeeded. All tests pass.'),
};

const mockBroadcast = vi.fn();

vi.mock('../db/repositories/orchestration-runs.js', () => ({
  orchestrationRunsRepo: mockRunsRepo,
}));

vi.mock('../db/repositories/coding-agent-results.js', () => ({
  codingAgentResultsRepo: mockResultsRepo,
}));

vi.mock('./coding-agent-service.js', () => ({
  getCodingAgentService: () => mockService,
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: (...args: unknown[]) => mockBroadcast(...args) },
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the AI analysis (resolveProviderAndModel + createProvider)
vi.mock('../routes/settings.js', () => ({
  resolveProviderAndModel: vi.fn(async () => ({ provider: 'openai', model: 'gpt-4o' })),
}));

vi.mock('../routes/agent-cache.js', () => ({
  getProviderApiKey: vi.fn(async () => 'test-key'),
  loadProviderConfig: vi.fn(() => null),
  NATIVE_PROVIDERS: new Set(['openai', 'anthropic', 'google']),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createProvider: vi.fn(() => ({
      complete: vi.fn(async () => ({
        ok: true,
        value: {
          content: JSON.stringify({
            summary: 'Code compiled successfully',
            goalComplete: true,
            hasErrors: false,
            errors: [],
            nextPrompt: null,
            confidence: 0.95,
            needsUserInput: false,
          }),
        },
      })),
    })),
  };
});

const {
  startOrchestration,
  continueOrchestration,
  cancelOrchestration,
  getOrchestration,
  listOrchestrations,
} = await import('./coding-agent-orchestrator.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';

function makeRunRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'orch_abc123',
    userId: USER_ID,
    goal: 'Build a REST API',
    provider: 'claude-code',
    cwd: '/project',
    model: undefined,
    status: 'running',
    steps: [],
    currentStep: 0,
    maxSteps: 10,
    autoMode: true,
    enableAnalysis: true,
    skillIds: undefined,
    permissions: undefined,
    createdAt: '2026-03-08T10:00:00Z',
    updatedAt: '2026-03-08T10:00:00Z',
    completedAt: undefined,
    totalDurationMs: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Coding Agent Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // startOrchestration
  // =========================================================================

  describe('startOrchestration', () => {
    it('creates a run record and returns it', async () => {
      const record = makeRunRecord();
      mockRunsRepo.create.mockResolvedValue(record);
      // The loop runs async — mock enough to prevent crash
      mockResultsRepo.getBySessionId.mockResolvedValue(null);

      const run = await startOrchestration(
        {
          goal: 'Build a REST API',
          provider: 'claude-code',
          cwd: '/project',
          autoMode: true,
        },
        USER_ID
      );

      expect(run.goal).toBe('Build a REST API');
      expect(run.provider).toBe('claude-code');
      expect(run.userId).toBe(USER_ID);
      expect(run.maxSteps).toBe(10);
      expect(run.autoMode).toBe(true);
      expect(mockRunsRepo.create).toHaveBeenCalledOnce();
    });

    it('uses default maxSteps when not provided', async () => {
      const record = makeRunRecord();
      mockRunsRepo.create.mockResolvedValue(record);
      mockResultsRepo.getBySessionId.mockResolvedValue(null);

      await startOrchestration({ goal: 'Fix bug', provider: 'codex', cwd: '/' }, USER_ID);

      expect(mockRunsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ maxSteps: 10 })
      );
    });

    it('broadcasts orchestration:created event', async () => {
      const record = makeRunRecord();
      mockRunsRepo.create.mockResolvedValue(record);
      mockResultsRepo.getBySessionId.mockResolvedValue(null);

      await startOrchestration(
        { goal: 'Deploy', provider: 'claude-code', cwd: '/app' },
        USER_ID
      );

      expect(mockBroadcast).toHaveBeenCalledWith(
        'orchestration:created',
        expect.objectContaining({ goal: 'Deploy' })
      );
    });

    it('respects custom maxSteps', async () => {
      const record = makeRunRecord({ maxSteps: 3 });
      mockRunsRepo.create.mockResolvedValue(record);
      mockResultsRepo.getBySessionId.mockResolvedValue(null);

      await startOrchestration(
        { goal: 'Quick task', provider: 'gemini-cli', cwd: '/', maxSteps: 3 },
        USER_ID
      );

      expect(mockRunsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ maxSteps: 3 })
      );
    });

    it('passes skillIds and permissions through', async () => {
      const record = makeRunRecord();
      mockRunsRepo.create.mockResolvedValue(record);
      mockResultsRepo.getBySessionId.mockResolvedValue(null);

      await startOrchestration(
        {
          goal: 'Task',
          provider: 'claude-code',
          cwd: '/',
          skillIds: ['skill-1'],
          permissions: { allowWrite: true },
        },
        USER_ID
      );

      expect(mockRunsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          skillIds: ['skill-1'],
          permissions: { allowWrite: true },
        })
      );
    });
  });

  // =========================================================================
  // cancelOrchestration
  // =========================================================================

  describe('cancelOrchestration', () => {
    it('marks run as cancelled and returns true', async () => {
      mockRunsRepo.getById.mockResolvedValue(makeRunRecord());

      const result = await cancelOrchestration('orch_abc123', USER_ID);
      expect(result).toBe(true);
      expect(mockRunsRepo.updateStatus).toHaveBeenCalledWith(
        'orch_abc123',
        USER_ID,
        'cancelled',
        expect.objectContaining({ completedAt: expect.any(String) })
      );
    });

    it('returns false when run not found', async () => {
      mockRunsRepo.getById.mockResolvedValue(null);

      const result = await cancelOrchestration('nonexistent', USER_ID);
      expect(result).toBe(false);
    });

    it('broadcasts cancellation event', async () => {
      mockRunsRepo.getById.mockResolvedValue(makeRunRecord());

      await cancelOrchestration('orch_abc123', USER_ID);
      expect(mockBroadcast).toHaveBeenCalledWith('orchestration:cancelled', { id: 'orch_abc123' });
    });
  });

  // =========================================================================
  // continueOrchestration
  // =========================================================================

  describe('continueOrchestration', () => {
    it('returns null when run not found', async () => {
      mockRunsRepo.getById.mockResolvedValue(null);

      const result = await continueOrchestration('missing', USER_ID, 'continue');
      expect(result).toBeNull();
    });

    it('returns null when run is not waiting_user', async () => {
      mockRunsRepo.getById.mockResolvedValue(makeRunRecord({ status: 'running' }));

      const result = await continueOrchestration('orch_abc123', USER_ID, 'continue');
      expect(result).toBeNull();
    });

    it('continues a waiting run with user response', async () => {
      const record = makeRunRecord({
        status: 'waiting_user',
        steps: [{ index: 0, prompt: 'initial', status: 'completed' }],
        currentStep: 0,
      });
      mockRunsRepo.getById.mockResolvedValue(record);
      mockResultsRepo.getBySessionId.mockResolvedValue(null);

      const run = await continueOrchestration('orch_abc123', USER_ID, 'Fix the tests');
      expect(run).not.toBeNull();
      expect(run!.status).toBe('running');
      expect(mockRunsRepo.updateStatus).toHaveBeenCalledWith('orch_abc123', USER_ID, 'running');
    });

    it('broadcasts continuation event', async () => {
      const record = makeRunRecord({ status: 'waiting_user', steps: [] });
      mockRunsRepo.getById.mockResolvedValue(record);
      mockResultsRepo.getBySessionId.mockResolvedValue(null);

      await continueOrchestration('orch_abc123', USER_ID, 'next step');
      expect(mockBroadcast).toHaveBeenCalledWith('orchestration:continued', {
        id: 'orch_abc123',
      });
    });
  });

  // =========================================================================
  // getOrchestration
  // =========================================================================

  describe('getOrchestration', () => {
    it('returns run when found', async () => {
      mockRunsRepo.getById.mockResolvedValue(makeRunRecord());

      const run = await getOrchestration('orch_abc123', USER_ID);
      expect(run).not.toBeNull();
      expect(run!.id).toBe('orch_abc123');
      expect(run!.goal).toBe('Build a REST API');
    });

    it('returns null when not found', async () => {
      mockRunsRepo.getById.mockResolvedValue(null);

      const run = await getOrchestration('missing', USER_ID);
      expect(run).toBeNull();
    });
  });

  // =========================================================================
  // listOrchestrations
  // =========================================================================

  describe('listOrchestrations', () => {
    it('returns mapped runs', async () => {
      mockRunsRepo.list.mockResolvedValue([makeRunRecord(), makeRunRecord({ id: 'orch_def456' })]);

      const runs = await listOrchestrations(USER_ID);
      expect(runs).toHaveLength(2);
      expect(runs[0].id).toBe('orch_abc123');
      expect(runs[1].id).toBe('orch_def456');
    });

    it('passes limit and offset to repo', async () => {
      mockRunsRepo.list.mockResolvedValue([]);

      await listOrchestrations(USER_ID, 5, 10);
      expect(mockRunsRepo.list).toHaveBeenCalledWith(USER_ID, 5, 10);
    });

    it('returns empty array when no runs', async () => {
      mockRunsRepo.list.mockResolvedValue([]);

      const runs = await listOrchestrations(USER_ID);
      expect(runs).toEqual([]);
    });

    it('uses default limit and offset', async () => {
      mockRunsRepo.list.mockResolvedValue([]);

      await listOrchestrations(USER_ID);
      expect(mockRunsRepo.list).toHaveBeenCalledWith(USER_ID, 20, 0);
    });
  });

  // =========================================================================
  // Orchestration loop behavior (integration-like)
  // =========================================================================

  describe('orchestration loop', () => {
    it('completes a single-step run with analysis', async () => {
      const record = makeRunRecord({ enableAnalysis: true, autoMode: true });
      mockRunsRepo.create.mockResolvedValue(record);
      mockResultsRepo.getBySessionId.mockResolvedValue({ id: 'result-1' });

      await startOrchestration(
        { goal: 'Build API', provider: 'claude-code', cwd: '/project', autoMode: true },
        USER_ID
      );

      // Give the async loop time to execute
      await vi.waitFor(
        () => {
          expect(mockService.createSession).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );

      await vi.waitFor(
        () => {
          expect(mockService.waitForCompletion).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );
    });

    it('completes immediately without analysis when enableAnalysis=false', async () => {
      const record = makeRunRecord({ enableAnalysis: false });
      mockRunsRepo.create.mockResolvedValue(record);
      mockResultsRepo.getBySessionId.mockResolvedValue(null);

      await startOrchestration(
        {
          goal: 'Quick fix',
          provider: 'claude-code',
          cwd: '/',
          enableAnalysis: false,
        },
        USER_ID
      );

      await vi.waitFor(
        () => {
          expect(mockRunsRepo.updateStatus).toHaveBeenCalledWith(
            expect.any(String),
            USER_ID,
            'completed',
            expect.objectContaining({ completedAt: expect.any(String) })
          );
        },
        { timeout: 2000 }
      );
    });

    it('pauses on step error and sets waiting_user', async () => {
      const record = makeRunRecord();
      mockRunsRepo.create.mockResolvedValue(record);
      mockService.createSession.mockRejectedValueOnce(new Error('Provider unavailable'));

      await startOrchestration(
        { goal: 'Task', provider: 'claude-code', cwd: '/' },
        USER_ID
      );

      await vi.waitFor(
        () => {
          expect(mockRunsRepo.updateStatus).toHaveBeenCalledWith(
            expect.any(String),
            USER_ID,
            'waiting_user'
          );
        },
        { timeout: 2000 }
      );

      // Restore mock for other tests
      mockService.createSession.mockResolvedValue(mockSession);
    });
  });
});
