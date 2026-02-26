import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

import { CliToolPoliciesRepository } from './cli-tool-policies.js';

describe('CliToolPoliciesRepository', () => {
  let repo: CliToolPoliciesRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new CliToolPoliciesRepository();
  });

  // =========================================================================
  // getPolicy
  // =========================================================================

  describe('getPolicy', () => {
    it('should return policy when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        id: '1', user_id: 'default', tool_name: 'eslint', policy: 'allowed',
        created_at: '2026-01-01', updated_at: '2026-01-01',
      });

      const result = await repo.getPolicy('eslint');
      expect(result).toBe('allowed');

      const [sql, params] = mockAdapter.queryOne.mock.calls[0];
      expect(sql).toContain('cli_tool_policies');
      expect(sql).toContain('tool_name = $1');
      expect(params).toEqual(['eslint', 'default']);
    });

    it('should return null when no policy exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getPolicy('unknown-tool');
      expect(result).toBeNull();
    });

    it('should filter by userId', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getPolicy('eslint', 'user-42');
      const [, params] = mockAdapter.queryOne.mock.calls[0];
      expect(params).toEqual(['eslint', 'user-42']);
    });
  });

  // =========================================================================
  // setPolicy
  // =========================================================================

  describe('setPolicy', () => {
    it('should upsert a policy', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.setPolicy('prettier', 'blocked');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('INSERT INTO cli_tool_policies');
      expect(sql).toContain('ON CONFLICT');
      expect(params[1]).toBe('default'); // userId
      expect(params[2]).toBe('prettier'); // tool_name
      expect(params[3]).toBe('blocked'); // policy
    });

    it('should use provided userId', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.setPolicy('docker', 'allowed', 'admin');
      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[1]).toBe('admin');
      expect(params[2]).toBe('docker');
      expect(params[3]).toBe('allowed');
    });
  });

  // =========================================================================
  // listPolicies
  // =========================================================================

  describe('listPolicies', () => {
    it('should return all policies for a user', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { id: '1', user_id: 'default', tool_name: 'docker', policy: 'blocked', created_at: '2026-01-01', updated_at: '2026-01-01' },
        { id: '2', user_id: 'default', tool_name: 'eslint', policy: 'allowed', created_at: '2026-01-01', updated_at: '2026-01-01' },
      ]);

      const result = await repo.listPolicies();
      expect(result).toEqual([
        { toolName: 'docker', policy: 'blocked' },
        { toolName: 'eslint', policy: 'allowed' },
      ]);
    });

    it('should return empty array when no policies', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listPolicies('new-user');
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // deletePolicy
  // =========================================================================

  describe('deletePolicy', () => {
    it('should return true when deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.deletePolicy('eslint');
      expect(result).toBe(true);

      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('DELETE FROM cli_tool_policies');
      expect(params).toEqual(['eslint', 'default']);
    });

    it('should return false when nothing to delete', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.deletePolicy('unknown');
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // batchSetPolicies
  // =========================================================================

  describe('batchSetPolicies', () => {
    it('should set multiple policies', async () => {
      mockAdapter.execute.mockResolvedValue({ changes: 1 });

      await repo.batchSetPolicies([
        { toolName: 'eslint', policy: 'allowed' },
        { toolName: 'docker', policy: 'blocked' },
      ]);

      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
    });
  });
});
