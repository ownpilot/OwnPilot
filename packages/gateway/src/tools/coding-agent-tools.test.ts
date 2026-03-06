/**
 * Coding Agent Tools Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockService, mockMgr, mockResultsRepo, mockGetCodingAgentService, mockGetSessionManager } =
  vi.hoisted(() => {
    const mockService = {
      createSession: vi.fn(),
      getStatus: vi.fn(),
    };
    const mockMgr = {
      waitForCompletion: vi.fn(),
    };
    const mockResultsRepo = {
      getBySessionId: vi.fn(),
      getById: vi.fn(),
      list: vi.fn(),
    };
    const mockGetCodingAgentService = vi.fn(() => mockService);
    const mockGetSessionManager = vi.fn(() => mockMgr);
    return {
      mockService,
      mockMgr,
      mockResultsRepo,
      mockGetCodingAgentService,
      mockGetSessionManager,
    };
  });

vi.mock('../services/coding-agent-service.js', () => ({
  getCodingAgentService: mockGetCodingAgentService,
}));

vi.mock('../services/coding-agent-sessions.js', () => ({
  getCodingAgentSessionManager: mockGetSessionManager,
}));

vi.mock('../db/repositories/coding-agent-results.js', () => ({
  codingAgentResultsRepo: mockResultsRepo,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
  };
});

import { executeCodingAgentTool, CODING_AGENT_TOOLS } from './coding-agent-tools.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleSession = { id: 'session-1', state: 'running' };
const sampleCompletedSession = { id: 'session-1', state: 'completed', exitCode: 0 };
const sampleResult = {
  id: 'result-1',
  sessionId: 'session-1',
  provider: 'claude-code',
  prompt: 'Fix the bug',
  cwd: '/project',
  model: 'claude-sonnet-4-6',
  success: true,
  output: 'Fixed the bug in 3 files',
  exitCode: 0,
  error: undefined,
  durationMs: 5000,
  costUsd: 0.05,
  mode: 'auto',
  createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CODING_AGENT_TOOLS', () => {
  it('exports an array of 4 tool definitions', () => {
    expect(Array.isArray(CODING_AGENT_TOOLS)).toBe(true);
    expect(CODING_AGENT_TOOLS.length).toBe(4);
  });

  it('includes run_coding_task, list_coding_agents, get_task_result, list_task_results', () => {
    const names = CODING_AGENT_TOOLS.map((t) => t.name);
    expect(names).toContain('run_coding_task');
    expect(names).toContain('list_coding_agents');
    expect(names).toContain('get_task_result');
    expect(names).toContain('list_task_results');
  });

  it('run_coding_task has required params: provider, prompt', () => {
    const def = CODING_AGENT_TOOLS.find((t) => t.name === 'run_coding_task')!;
    expect(def.parameters.required).toContain('provider');
    expect(def.parameters.required).toContain('prompt');
  });
});

describe('executeCodingAgentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.createSession.mockResolvedValue(sampleSession);
    mockMgr.waitForCompletion.mockResolvedValue(sampleCompletedSession);
    mockResultsRepo.getBySessionId.mockResolvedValue(sampleResult);
  });

  // ---- run_coding_task ----

  describe('run_coding_task', () => {
    it('creates session, waits for completion, returns persisted result', async () => {
      const result = await executeCodingAgentTool(
        'run_coding_task',
        { provider: 'claude-code', prompt: 'Fix the bug', cwd: '/project' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(mockService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude-code',
          prompt: 'Fix the bug',
          cwd: '/project',
        }),
        'user-1'
      );
      expect(mockMgr.waitForCompletion).toHaveBeenCalledWith('session-1', 'user-1', 300_000);
      expect(result.result).toMatchObject({
        resultId: 'result-1',
        sessionId: 'session-1',
        provider: 'claude-code',
        exitCode: 0,
      });
    });

    it('uses custom timeout when timeout_seconds is provided (capped at 1800)', async () => {
      await executeCodingAgentTool('run_coding_task', {
        provider: 'claude-code',
        prompt: 'task',
        timeout_seconds: 600,
      });
      expect(mockMgr.waitForCompletion).toHaveBeenCalledWith('session-1', 'default', 600_000);
    });

    it('caps timeout to 1800 seconds', async () => {
      await executeCodingAgentTool('run_coding_task', {
        provider: 'claude-code',
        prompt: 'task',
        timeout_seconds: 9999,
      });
      expect(mockMgr.waitForCompletion).toHaveBeenCalledWith('session-1', 'default', 1_800_000);
    });

    it('falls back to session state when result not in DB', async () => {
      mockResultsRepo.getBySessionId.mockResolvedValueOnce(null);

      const result = await executeCodingAgentTool('run_coding_task', {
        provider: 'claude-code',
        prompt: 'task',
      });
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).state).toBe('completed');
    });

    it('falls back with error when session state is not completed', async () => {
      mockResultsRepo.getBySessionId.mockResolvedValueOnce(null);
      mockMgr.waitForCompletion.mockResolvedValueOnce({
        id: 'session-1',
        state: 'failed',
        exitCode: 1,
      });

      const result = await executeCodingAgentTool('run_coding_task', {
        provider: 'claude-code',
        prompt: 'task',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('failed');
    });

    it('truncates long output', async () => {
      const longOutput = 'x'.repeat(10000);
      mockResultsRepo.getBySessionId.mockResolvedValueOnce({ ...sampleResult, output: longOutput });

      const result = await executeCodingAgentTool('run_coding_task', {
        provider: 'claude-code',
        prompt: 'task',
      });
      const r = result.result as Record<string, string>;
      expect(r.output.length).toBeLessThan(longOutput.length);
      expect(r.output).toContain('truncated');
    });

    it('returns error when createSession throws', async () => {
      mockService.createSession.mockRejectedValueOnce(new Error('Provider not configured'));

      const result = await executeCodingAgentTool('run_coding_task', {
        provider: 'claude-code',
        prompt: 'task',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Provider not configured');
    });

    it('passes model and max options to createSession', async () => {
      await executeCodingAgentTool('run_coding_task', {
        provider: 'claude-code',
        prompt: 'task',
        model: 'claude-opus-4-6',
        max_turns: 5,
        max_budget_usd: 0.5,
      });
      expect(mockService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-opus-4-6', maxTurns: 5, maxBudgetUsd: 0.5 }),
        'default'
      );
    });
  });

  // ---- list_coding_agents ----

  describe('list_coding_agents', () => {
    it('returns status from service', async () => {
      const status = [{ provider: 'claude-code', installed: true }];
      mockService.getStatus.mockResolvedValueOnce(status);

      const result = await executeCodingAgentTool('list_coding_agents', {});
      expect(result.success).toBe(true);
      expect(result.result).toEqual(status);
    });
  });

  // ---- get_task_result ----

  describe('get_task_result', () => {
    it('returns result by ID', async () => {
      mockResultsRepo.getById.mockResolvedValueOnce(sampleResult);

      const result = await executeCodingAgentTool(
        'get_task_result',
        { result_id: 'result-1' },
        'user-1'
      );
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).id).toBe('result-1');
      expect(mockResultsRepo.getById).toHaveBeenCalledWith('result-1', 'user-1');
    });

    it('returns error when result_id missing', async () => {
      const result = await executeCodingAgentTool('get_task_result', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('result_id is required');
    });

    it('returns error when result not found', async () => {
      mockResultsRepo.getById.mockResolvedValueOnce(null);

      const result = await executeCodingAgentTool('get_task_result', { result_id: 'nonexistent' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when repo throws', async () => {
      mockResultsRepo.getById.mockRejectedValueOnce(new Error('DB error'));
      const result = await executeCodingAgentTool('get_task_result', { result_id: 'r1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('DB error');
    });
  });

  // ---- list_task_results ----

  describe('list_task_results', () => {
    it('lists results with default limit 10', async () => {
      mockResultsRepo.list.mockResolvedValueOnce([sampleResult]);

      const result = await executeCodingAgentTool('list_task_results', {}, 'user-1');
      expect(result.success).toBe(true);
      expect(mockResultsRepo.list).toHaveBeenCalledWith('user-1', 10);
    });

    it('respects custom limit (capped at 50)', async () => {
      mockResultsRepo.list.mockResolvedValueOnce([]);
      await executeCodingAgentTool('list_task_results', { limit: 100 });
      expect(mockResultsRepo.list).toHaveBeenCalledWith('default', 50);
    });

    it('uses default of 10 for limit=0 (max(0||10, 1))', async () => {
      mockResultsRepo.list.mockResolvedValueOnce([]);
      await executeCodingAgentTool('list_task_results', { limit: 0 });
      // Math.min(Math.max(0 || 10, 1), 50) = Math.min(10, 50) = 10
      expect(mockResultsRepo.list).toHaveBeenCalledWith('default', 10);
    });

    it('truncates long prompts', async () => {
      const longPrompt = 'Write tests for '.repeat(20); // > 100 chars
      mockResultsRepo.list.mockResolvedValueOnce([{ ...sampleResult, prompt: longPrompt }]);

      const result = await executeCodingAgentTool('list_task_results', {});
      const items = result.result as Array<Record<string, unknown>>;
      expect((items[0]!.prompt as string).endsWith('...')).toBe(true);
      expect((items[0]!.prompt as string).length).toBeLessThanOrEqual(103);
    });

    it('returns error when repo throws', async () => {
      mockResultsRepo.list.mockRejectedValueOnce(new Error('DB unavailable'));
      const result = await executeCodingAgentTool('list_task_results', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('DB unavailable');
    });
  });

  // ---- unknown tool ----

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeCodingAgentTool('nonexistent_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown coding agent tool');
    });
  });
});
