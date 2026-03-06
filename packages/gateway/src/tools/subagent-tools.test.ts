/**
 * Subagent Tools Tests
 *
 * Tests for all 5 subagent LLM-callable tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockService = {
  spawn: vi.fn(),
  getSession: vi.fn(),
  getResult: vi.fn(),
  cancel: vi.fn(),
  listByParent: vi.fn(),
  getHistory: vi.fn(),
};

vi.mock('../services/subagent-service.js', () => ({
  getSubagentService: () => mockService,
}));

vi.mock('@ownpilot/core', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const { executeSubagentTool, SUBAGENT_TOOLS } = await import('./subagent-tools.js');

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
    turnsUsed: 2,
    toolCallsUsed: 3,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SUBAGENT_TOOLS', () => {
  it('exports 5 tool definitions', () => {
    expect(SUBAGENT_TOOLS).toHaveLength(5);
  });

  it('all tools have category Subagents', () => {
    for (const tool of SUBAGENT_TOOLS) {
      expect(tool.category).toBe('Subagents');
    }
  });

  it('all tools are workflow-usable', () => {
    for (const tool of SUBAGENT_TOOLS) {
      expect(tool.workflowUsable).toBe(true);
    }
  });

  it('includes the expected tool names', () => {
    const names = SUBAGENT_TOOLS.map((t) => t.name);
    expect(names).toContain('spawn_subagent');
    expect(names).toContain('check_subagent');
    expect(names).toContain('get_subagent_result');
    expect(names).toContain('cancel_subagent');
    expect(names).toContain('list_subagents');
  });
});

describe('executeSubagentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // spawn_subagent
  // -------------------------------------------------------------------------

  describe('spawn_subagent', () => {
    it('spawns a subagent and returns session info', async () => {
      mockService.spawn.mockResolvedValue(makeSession({ id: 'sub-99', state: 'pending' }));

      const result = await executeSubagentTool(
        'spawn_subagent',
        { name: 'Research', task: 'Find data' },
        'user-1',
        'conv-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(
        expect.objectContaining({
          subagentId: 'sub-99',
          name: 'Research',
          state: 'pending',
        })
      );
      expect(mockService.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'conv-1',
          parentType: 'chat',
          userId: 'user-1',
          name: 'Research',
          task: 'Find data',
        })
      );
    });

    it('passes optional fields to service', async () => {
      mockService.spawn.mockResolvedValue(makeSession());

      await executeSubagentTool(
        'spawn_subagent',
        {
          name: 'Test',
          task: 'Do it',
          context: 'Extra info',
          allowed_tools: ['web_search'],
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
        },
        'user-1',
        'conv-1'
      );

      expect(mockService.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'Extra info',
          allowedTools: ['web_search'],
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
        })
      );
    });

    it('returns error when name is missing', async () => {
      const result = await executeSubagentTool(
        'spawn_subagent',
        { task: 'Do something' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('returns error when task is missing', async () => {
      const result = await executeSubagentTool('spawn_subagent', { name: 'Test' }, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('task');
    });

    it('handles service errors', async () => {
      mockService.spawn.mockRejectedValue(new Error('Budget exceeded'));

      const result = await executeSubagentTool(
        'spawn_subagent',
        { name: 'Test', task: 'Do it' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Budget exceeded');
    });

    it('uses defaults for userId and conversationId when not provided', async () => {
      mockService.spawn.mockResolvedValue(makeSession());

      await executeSubagentTool('spawn_subagent', { name: 'Test', task: 'Do it' });

      expect(mockService.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'default',
          parentId: 'unknown',
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // check_subagent
  // -------------------------------------------------------------------------

  describe('check_subagent', () => {
    it('returns session status', async () => {
      mockService.getSession.mockReturnValue(makeSession({ state: 'running', turnsUsed: 2 }));

      const result = await executeSubagentTool(
        'check_subagent',
        { subagent_id: 'sub-1' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(
        expect.objectContaining({
          subagentId: 'sub-1',
          state: 'running',
          turnsUsed: 2,
        })
      );
    });

    it('includes result when completed', async () => {
      mockService.getSession.mockReturnValue(
        makeSession({ state: 'completed', result: 'Found 3 items' })
      );

      const result = await executeSubagentTool(
        'check_subagent',
        { subagent_id: 'sub-1' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).result).toBe('Found 3 items');
    });

    it('returns error when not found', async () => {
      mockService.getSession.mockReturnValue(null);

      const result = await executeSubagentTool(
        'check_subagent',
        { subagent_id: 'sub-999' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when subagent_id is missing', async () => {
      const result = await executeSubagentTool('check_subagent', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('subagent_id');
    });
  });

  // -------------------------------------------------------------------------
  // get_subagent_result
  // -------------------------------------------------------------------------

  describe('get_subagent_result', () => {
    it('returns result for completed subagent', async () => {
      mockService.getResult.mockReturnValue(
        makeSession({ state: 'completed', result: 'Analysis done', durationMs: 5000 })
      );

      const result = await executeSubagentTool(
        'get_subagent_result',
        { subagent_id: 'sub-1' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).result).toBe('Analysis done');
      expect((result.result as Record<string, unknown>).state).toBe('completed');
    });

    it('returns status message for still-running subagent', async () => {
      mockService.getResult.mockReturnValue(makeSession({ state: 'running' }));

      const result = await executeSubagentTool(
        'get_subagent_result',
        { subagent_id: 'sub-1' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).state).toBe('running');
      expect((result.result as Record<string, unknown>).message).toContain('still running');
    });

    it('returns error info for failed subagent', async () => {
      mockService.getResult.mockReturnValue(
        makeSession({ state: 'failed', error: 'API key invalid' })
      );

      const result = await executeSubagentTool(
        'get_subagent_result',
        { subagent_id: 'sub-1' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).state).toBe('failed');
      expect((result.result as Record<string, unknown>).error).toBe('API key invalid');
    });

    it('returns error when not found', async () => {
      mockService.getResult.mockReturnValue(null);

      const result = await executeSubagentTool(
        'get_subagent_result',
        { subagent_id: 'sub-999' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when subagent_id is empty (line 226)', async () => {
      const result = await executeSubagentTool(
        'get_subagent_result',
        { subagent_id: '' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('subagent_id is required');
    });
  });

  // -------------------------------------------------------------------------
  // cancel_subagent
  // -------------------------------------------------------------------------

  describe('cancel_subagent', () => {
    it('cancels a running subagent', async () => {
      mockService.cancel.mockReturnValue(true);

      const result = await executeSubagentTool(
        'cancel_subagent',
        { subagent_id: 'sub-1' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(mockService.cancel).toHaveBeenCalledWith('sub-1', 'user-1');
    });

    it('returns error when cancel fails', async () => {
      mockService.cancel.mockReturnValue(false);

      const result = await executeSubagentTool(
        'cancel_subagent',
        { subagent_id: 'sub-1' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found or already completed');
    });

    it('returns error when subagent_id is missing', async () => {
      const result = await executeSubagentTool('cancel_subagent', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('subagent_id');
    });
  });

  // -------------------------------------------------------------------------
  // list_subagents
  // -------------------------------------------------------------------------

  describe('list_subagents', () => {
    it('lists all subagents for the session', async () => {
      mockService.listByParent.mockReturnValue([
        makeSession({ id: 'sub-1', name: 'T1', state: 'running' }),
        makeSession({ id: 'sub-2', name: 'T2', state: 'completed', result: 'Done' }),
      ]);

      const result = await executeSubagentTool('list_subagents', {}, 'user-1', 'conv-1');

      expect(result.success).toBe(true);
      const data = result.result as { count: number; active: number; subagents: unknown[] };
      expect(data.count).toBe(2);
      expect(data.active).toBe(1);
      expect(data.subagents).toHaveLength(2);
    });

    it('returns empty list when no subagents', async () => {
      mockService.listByParent.mockReturnValue([]);

      const result = await executeSubagentTool('list_subagents', {}, 'user-1', 'conv-1');

      expect(result.success).toBe(true);
      const data = result.result as { count: number; active: number };
      expect(data.count).toBe(0);
      expect(data.active).toBe(0);
    });

    it('truncates long task descriptions', async () => {
      const longTask = 'A'.repeat(200);
      mockService.listByParent.mockReturnValue([makeSession({ task: longTask })]);

      const result = await executeSubagentTool('list_subagents', {}, 'user-1', 'conv-1');

      const data = result.result as { subagents: Array<{ task: string }> };
      expect(data.subagents[0].task.length).toBeLessThanOrEqual(103); // 100 chars + "..."
    });
  });

  // -------------------------------------------------------------------------
  // unknown tool
  // -------------------------------------------------------------------------

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeSubagentTool('unknown_tool', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });
});
