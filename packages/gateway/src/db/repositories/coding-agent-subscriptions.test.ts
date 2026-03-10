/**
 * CodingAgentSubscriptionsRepository Tests
 *
 * Tests the repository for managing coding agent subscription tracking,
 * including budget management, spend tracking, and monthly resets.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// Mock the adapter module
const mockAdapter: {
  [K in keyof DatabaseAdapter]: ReturnType<typeof vi.fn>;
} = {
  type: 'postgres' as unknown as ReturnType<typeof vi.fn>,
  isConnected: vi.fn().mockReturnValue(true),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ changes: 0 }),
  exec: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  now: vi.fn().mockReturnValue('NOW()'),
  date: vi.fn().mockImplementation((col: string) => `DATE(${col})`),
  dateSubtract: vi.fn(),
  placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
  boolean: vi.fn().mockImplementation((v: boolean) => v),
  parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue(mockAdapter),
  getAdapterSync: vi.fn().mockReturnValue(mockAdapter),
}));

const {
  CodingAgentSubscriptionsRepository,
  codingAgentSubscriptionsRepo,
  createCodingAgentSubscriptionsRepository,
} = await import('./coding-agent-subscriptions.js');

// Test fixtures
function createMockSubscriptionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-123',
    user_id: 'default',
    provider_ref: 'claude-code',
    tier: 'pro',
    monthly_budget_usd: 50,
    current_spend_usd: 15.5,
    max_concurrent_sessions: 3,
    reset_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-15T12:00:00Z',
    ...overrides,
  };
}

describe('CodingAgentSubscriptionsRepository', () => {
  let repo: CodingAgentSubscriptionsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createCodingAgentSubscriptionsRepository();
  });

  describe('getByProvider', () => {
    it('returns mapped record when subscription exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(createMockSubscriptionRow());

      const result = await repo.getByProvider('claude-code', 'default');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        'SELECT * FROM coding_agent_subscriptions WHERE provider_ref = $1 AND user_id = $2',
        ['claude-code', 'default']
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe('sub-123');
      expect(result?.userId).toBe('default');
      expect(result?.providerRef).toBe('claude-code');
      expect(result?.tier).toBe('pro');
      expect(result?.monthlyBudgetUsd).toBe(50);
      expect(result?.currentSpendUsd).toBe(15.5);
      expect(result?.maxConcurrentSessions).toBe(3);
      expect(result?.resetAt).toBe('2026-01-01T00:00:00Z');
    });

    it('returns null when subscription does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getByProvider('nonexistent', 'default');

      expect(result).toBeNull();
    });

    it('uses default userId when not provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(createMockSubscriptionRow());

      await repo.getByProvider('claude-code');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(expect.any(String), [
        'claude-code',
        'default',
      ]);
    });

    it('handles null tier as undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockSubscriptionRow({ tier: null })
      );

      const result = await repo.getByProvider('claude-code');

      expect(result?.tier).toBeUndefined();
    });

    it('handles null reset_at as undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockSubscriptionRow({ reset_at: null })
      );

      const result = await repo.getByProvider('claude-code');

      expect(result?.resetAt).toBeUndefined();
    });

    it('converts numeric fields from string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockSubscriptionRow({
          monthly_budget_usd: '100',
          current_spend_usd: '25.5',
          max_concurrent_sessions: '5',
        })
      );

      const result = await repo.getByProvider('claude-code');

      expect(result?.monthlyBudgetUsd).toBe(100);
      expect(result?.currentSpendUsd).toBe(25.5);
      expect(result?.maxConcurrentSessions).toBe(5);
      expect(typeof result?.monthlyBudgetUsd).toBe('number');
    });
  });

  describe('list', () => {
    it('returns empty array when no subscriptions', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list('default');

      expect(result).toEqual([]);
    });

    it('returns subscriptions ordered by provider_ref', async () => {
      const mockRows = [
        createMockSubscriptionRow({ provider_ref: 'claude-code', id: 'sub-1' }),
        createMockSubscriptionRow({ provider_ref: 'copilot', id: 'sub-2' }),
        createMockSubscriptionRow({ provider_ref: 'cursor', id: 'sub-3' }),
      ];
      mockAdapter.query.mockResolvedValueOnce(mockRows);

      const result = await repo.list('default');

      expect(mockAdapter.query).toHaveBeenCalledWith(
        'SELECT * FROM coding_agent_subscriptions WHERE user_id = $1 ORDER BY provider_ref',
        ['default']
      );

      expect(result).toHaveLength(3);
      expect(result[0].providerRef).toBe('claude-code');
      expect(result[1].providerRef).toBe('copilot');
      expect(result[2].providerRef).toBe('cursor');
    });

    it('uses default userId when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      expect(mockAdapter.query).toHaveBeenCalledWith(expect.any(String), ['default']);
    });
  });

  describe('upsert', () => {
    it('creates subscription with all fields', async () => {
      const input = {
        providerRef: 'claude-code',
        tier: 'enterprise',
        monthlyBudgetUsd: 200,
        currentSpendUsd: 50,
        maxConcurrentSessions: 10,
        resetAt: '2026-02-01T00:00:00Z',
      };
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockSubscriptionRow({
          provider_ref: 'claude-code',
          tier: 'enterprise',
          monthly_budget_usd: 200,
          current_spend_usd: 50,
          max_concurrent_sessions: 10,
          reset_at: '2026-02-01T00:00:00Z',
        })
      );

      const result = await repo.upsert(input, 'default');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO coding_agent_subscriptions'),
        expect.arrayContaining([
          expect.any(String), // id
          'default',
          'claude-code',
          'enterprise',
          200,
          50,
          10,
          '2026-02-01T00:00:00Z',
          expect.any(String), // created_at
          expect.any(String), // updated_at
        ])
      );

      expect(result.providerRef).toBe('claude-code');
      expect(result.tier).toBe('enterprise');
      expect(result.monthlyBudgetUsd).toBe(200);
    });

    it('uses default values when optional fields omitted', async () => {
      const input = { providerRef: 'new-provider' };
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockSubscriptionRow({
          provider_ref: 'new-provider',
          tier: null,
          monthly_budget_usd: 0,
          current_spend_usd: 0,
          max_concurrent_sessions: 3,
          reset_at: null,
        })
      );

      await repo.upsert(input);

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[3]).toBeNull(); // tier
      expect(params[4]).toBe(0); // monthlyBudgetUsd default
      expect(params[5]).toBe(0); // currentSpendUsd default
      expect(params[6]).toBe(3); // maxConcurrentSessions default
      expect(params[7]).toBeNull(); // resetAt
    });

    it('updates existing subscription on conflict', async () => {
      const input = {
        providerRef: 'claude-code',
        monthlyBudgetUsd: 300,
      };
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        createMockSubscriptionRow({ monthly_budget_usd: 300 })
      );

      await repo.upsert(input);

      const [sql] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('ON CONFLICT (user_id, provider_ref) DO UPDATE SET');
      expect(sql).toContain('monthly_budget_usd = EXCLUDED.monthly_budget_usd');
    });

    it('throws error when getByProvider returns null after upsert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.upsert({ providerRef: 'test' })).rejects.toThrow(
        'Failed to upsert subscription'
      );
    });
  });

  describe('addSpend', () => {
    it('increments current_spend_usd by amount', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.addSpend('claude-code', 'default', 5.5);

      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('UPDATE coding_agent_subscriptions');
      expect(sql).toContain('current_spend_usd = current_spend_usd + $1');
      expect(sql).toContain('updated_at = $2');
      expect(params[0]).toBe(5.5);
      expect(params[1]).toEqual(expect.any(String)); // ISO timestamp
      expect(params[2]).toBe('claude-code');
      expect(params[3]).toBe('default');
    });

    it('handles zero amount', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.addSpend('claude-code', 'default', 0);

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[0]).toBe(0);
    });

    it('handles negative amount (refund scenario)', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.addSpend('claude-code', 'default', -10);

      const [, params] = mockAdapter.execute.mock.calls[0];
      expect(params[0]).toBe(-10);
    });
  });

  describe('resetMonthlySpend', () => {
    it('resets all subscriptions spend to 0 for user', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 3 });

      await repo.resetMonthlySpend('default');

      const [sql, params] = mockAdapter.execute.mock.calls[0];
      expect(sql).toContain('UPDATE coding_agent_subscriptions');
      expect(sql).toContain('current_spend_usd = 0');
      expect(sql).toContain('reset_at = $1');
      expect(sql).toContain('updated_at = $1');
      expect(params[0]).toEqual(expect.any(String)); // ISO timestamp
      expect(params[1]).toBe('default');
    });

    it('uses default userId when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.resetMonthlySpend();

      expect(mockAdapter.execute).toHaveBeenCalledWith(expect.any(String), [
        expect.any(String),
        'default',
      ]);
    });

    it('updates reset_at timestamp', async () => {
      const before = Date.now();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.resetMonthlySpend('default');
      const after = Date.now();

      const [, params] = mockAdapter.execute.mock.calls[0];
      const resetAt = new Date(params[0] as string).getTime();
      expect(resetAt).toBeGreaterThanOrEqual(before);
      expect(resetAt).toBeLessThanOrEqual(after);
    });
  });

  describe('delete', () => {
    it('returns true when subscription was deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('claude-code', 'default');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'DELETE FROM coding_agent_subscriptions WHERE provider_ref = $1 AND user_id = $2',
        ['claude-code', 'default']
      );
      expect(result).toBe(true);
    });

    it('returns false when no subscription found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('nonexistent', 'default');

      expect(result).toBe(false);
    });

    it('uses default userId when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('claude-code');

      expect(mockAdapter.execute).toHaveBeenCalledWith(expect.any(String), [
        'claude-code',
        'default',
      ]);
    });

    it('handles null result from execute', async () => {
      mockAdapter.execute.mockResolvedValueOnce(null);

      const result = await repo.delete('test');

      expect(result).toBe(false);
    });
  });

  describe('singleton', () => {
    it('createCodingAgentSubscriptionsRepository creates new instances', () => {
      const repo1 = createCodingAgentSubscriptionsRepository();
      const repo2 = createCodingAgentSubscriptionsRepository();

      expect(repo1).toBeInstanceOf(CodingAgentSubscriptionsRepository);
      expect(repo2).toBeInstanceOf(CodingAgentSubscriptionsRepository);
      expect(repo1).not.toBe(repo2);
    });

    it('codingAgentSubscriptionsRepo is singleton', () => {
      expect(codingAgentSubscriptionsRepo).toBeInstanceOf(
        CodingAgentSubscriptionsRepository
      );
    });
  });

  describe('error handling', () => {
    it('propagates database errors on getByProvider', async () => {
      mockAdapter.queryOne.mockRejectedValueOnce(new Error('connection failed'));

      await expect(repo.getByProvider('test')).rejects.toThrow('connection failed');
    });

    it('propagates database errors on list', async () => {
      mockAdapter.query.mockRejectedValueOnce(new Error('query timeout'));

      await expect(repo.list()).rejects.toThrow('query timeout');
    });

    it('propagates database errors on upsert', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('constraint violation'));

      await expect(repo.upsert({ providerRef: 'test' })).rejects.toThrow(
        'constraint violation'
      );
    });

    it('propagates database errors on addSpend', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('permission denied'));

      await expect(repo.addSpend('test', 'user', 5)).rejects.toThrow('permission denied');
    });

    it('propagates database errors on resetMonthlySpend', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('disk full'));

      await expect(repo.resetMonthlySpend()).rejects.toThrow('disk full');
    });

    it('propagates database errors on delete', async () => {
      mockAdapter.execute.mockRejectedValueOnce(new Error('timeout'));

      await expect(repo.delete('test')).rejects.toThrow('timeout');
    });
  });
});
