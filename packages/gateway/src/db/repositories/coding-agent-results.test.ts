/**
 * Coding Agent Results Repository Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

import { CodingAgentResultsRepository } from './coding-agent-results.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2026-02-25T12:00:00.000Z';

function makeResultRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'result-1',
    user_id: 'default',
    session_id: 'sess-1',
    provider: 'claude-code',
    prompt: 'List files in current directory',
    cwd: '/home/user/project',
    model: 'claude-sonnet-4-5-20250929',
    success: true,
    output: 'file1.ts\nfile2.ts',
    exit_code: 0,
    error: null,
    duration_ms: 5000,
    cost_usd: 0.12,
    mode: 'auto',
    created_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodingAgentResultsRepository', () => {
  let repo: CodingAgentResultsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new CodingAgentResultsRepository();
  });

  // =========================================================================
  // save
  // =========================================================================

  describe('save', () => {
    it('should insert a result and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeResultRow());

      const result = await repo.save({
        id: 'result-1',
        provider: 'claude-code',
        prompt: 'List files in current directory',
        success: true,
        output: 'file1.ts\nfile2.ts',
        durationMs: 5000,
        sessionId: 'sess-1',
        cwd: '/home/user/project',
        model: 'claude-sonnet-4-5-20250929',
        exitCode: 0,
        costUsd: 0.12,
        mode: 'auto',
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.id).toBe('result-1');
      expect(result.provider).toBe('claude-code');
      expect(result.success).toBe(true);
      expect(result.durationMs).toBe(5000);
      expect(result.costUsd).toBe(0.12);
    });

    it('should use default userId when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeResultRow());

      await repo.save({
        id: 'result-1',
        provider: 'claude-code',
        prompt: 'test',
        success: true,
        output: '',
        durationMs: 0,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('default');
    });

    it('should store null for optional fields when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeResultRow({ session_id: null, cwd: null }));

      await repo.save({
        id: 'result-1',
        provider: 'codex',
        prompt: 'test',
        success: false,
        output: '',
        durationMs: 100,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // sessionId, cwd, model, exitCode, error, costUsd, mode
      expect(params[2]).toBeNull(); // sessionId
      expect(params[5]).toBeNull(); // cwd
      expect(params[6]).toBeNull(); // model
      expect(params[9]).toBeNull(); // exitCode
      expect(params[10]).toBeNull(); // error
      expect(params[12]).toBeNull(); // costUsd
      expect(params[13]).toBeNull(); // mode
    });

    it('should throw when result not found after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.save({
          id: 'result-1',
          provider: 'claude-code',
          prompt: 'test',
          success: true,
          output: '',
          durationMs: 0,
        })
      ).rejects.toThrow('Failed to save coding agent result');
    });

    it('should include INSERT INTO coding_agent_results in SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeResultRow());

      await repo.save({
        id: 'result-1',
        provider: 'claude-code',
        prompt: 'test',
        success: true,
        output: '',
        durationMs: 0,
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO coding_agent_results');
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe('getById', () => {
    it('should return a result when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeResultRow());

      const result = await repo.getById('result-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('result-1');
      expect(result!.provider).toBe('claude-code');
      expect(result!.success).toBe(true);
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getById('missing')).toBeNull();
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeResultRow({
          session_id: null,
          cwd: null,
          model: null,
          error: null,
          cost_usd: null,
          mode: null,
        })
      );

      const result = await repo.getById('result-1');

      expect(result!.sessionId).toBeUndefined();
      expect(result!.cwd).toBeUndefined();
      expect(result!.model).toBeUndefined();
      expect(result!.error).toBeUndefined();
      expect(result!.costUsd).toBeUndefined();
      expect(result!.mode).toBeUndefined();
    });

    it('should filter by userId', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getById('result-1', 'user-42');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['result-1', 'user-42']);
    });

    it('should parse boolean success from numeric value', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeResultRow({ success: 0 }));

      const result = await repo.getById('result-1');

      expect(result!.success).toBe(false);
    });

    it('should convert numeric string duration_ms', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeResultRow({ duration_ms: '12345' }));

      const result = await repo.getById('result-1');

      expect(result!.durationMs).toBe(12345);
    });
  });

  // =========================================================================
  // getBySessionId
  // =========================================================================

  describe('getBySessionId', () => {
    it('should return result by session ID', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeResultRow());

      const result = await repo.getBySessionId('sess-1');

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe('sess-1');
    });

    it('should return null when no result for session', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getBySessionId('missing-sess')).toBeNull();
    });

    it('should filter by session_id and user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getBySessionId('sess-1', 'user-42');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('session_id = $1');
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['sess-1', 'user-42']);
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no results', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.list()).toEqual([]);
    });

    it('should return mapped result records', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeResultRow({ id: 'result-1' }),
        makeResultRow({ id: 'result-2', provider: 'codex' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('result-1');
      expect(result[1]!.provider).toBe('codex');
    });

    it('should order by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should use default limit 50 and offset 0', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default', 50, 0]);
    });

    it('should apply custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list('default', 10, 20);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default', 10, 20]);
    });

    it('should filter by user_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list('user-42');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE user_id = $1');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('user-42');
    });
  });

  // =========================================================================
  // count
  // =========================================================================

  describe('count', () => {
    it('should return the count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });

      expect(await repo.count()).toBe(42);
    });

    it('should return 0 when no results', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      expect(await repo.count()).toBe(0);
    });

    it('should return 0 when row is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });

    it('should filter by user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '5' });

      await repo.count('user-42');

      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-42']);
    });

    it('should query COUNT(*) from coding_agent_results', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      await repo.count();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('coding_agent_results');
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('factory', () => {
    it('createCodingAgentResultsRepository should return instance', async () => {
      const { createCodingAgentResultsRepository } = await import('./coding-agent-results.js');
      const r = createCodingAgentResultsRepository();
      expect(r).toBeInstanceOf(CodingAgentResultsRepository);
    });

    it('codingAgentResultsRepo should be a singleton', async () => {
      const { codingAgentResultsRepo } = await import('./coding-agent-results.js');
      expect(codingAgentResultsRepo).toBeInstanceOf(CodingAgentResultsRepository);
    });
  });
});
