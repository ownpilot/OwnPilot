/**
 * Costs Repository Tests
 *
 * Unit tests for CostsRepository CRUD, summaries, aggregations, and pagination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = {
  type: 'postgres' as const,
  isConnected: () => true,
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ changes: 1 })),
  transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  exec: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  now: () => 'NOW()',
  date: (col: string) => `DATE(${col})`,
  dateSubtract: (col: string, n: number, u: string) => `${col} - INTERVAL '${n} ${u}'`,
  placeholder: (i: number) => `$${i}`,
  boolean: (v: boolean) => v,
  parseBoolean: (v: unknown) => Boolean(v),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { CostsRepository } from './costs.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeCostRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cost-1',
    provider: 'openai',
    model: 'gpt-4',
    conversation_id: null,
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    input_cost: 0.003,
    output_cost: 0.006,
    total_cost: 0.009,
    created_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CostsRepository', () => {
  let repo: CostsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new CostsRepository();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a cost record and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCostRow());

      const result = await repo.create({
        id: 'cost-1',
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        inputCost: 0.003,
        outputCost: 0.006,
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.id).toBe('cost-1');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.totalTokens).toBe(150);
      expect(result.inputCost).toBe(0.003);
      expect(result.outputCost).toBe(0.006);
      expect(result.totalCost).toBe(0.009);
    });

    it('should compute totalTokens and totalCost from inputs', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCostRow());

      await repo.create({
        id: 'cost-1',
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        inputCost: 0.003,
        outputCost: 0.006,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // totalTokens = 100 + 50 = 150
      expect(params[6]).toBe(150);
      // totalCost = 0.003 + 0.006 = 0.009
      expect(params[9]).toBeCloseTo(0.009);
    });

    it('should store conversationId when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCostRow({ conversation_id: 'conv-1' }));

      const result = await repo.create({
        id: 'cost-1',
        provider: 'openai',
        model: 'gpt-4',
        conversationId: 'conv-1',
        inputTokens: 100,
        outputTokens: 50,
        inputCost: 0.003,
        outputCost: 0.006,
      });

      expect(result.conversationId).toBe('conv-1');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBe('conv-1');
    });

    it('should store null conversationId when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCostRow());

      await repo.create({
        id: 'cost-1',
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        inputCost: 0.003,
        outputCost: 0.006,
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[3]).toBeNull();
    });

    it('should throw when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          id: 'cost-1',
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 100,
          outputTokens: 50,
          inputCost: 0.003,
          outputCost: 0.006,
        })
      ).rejects.toThrow('Failed to create cost');
    });

    it('should include INSERT INTO costs in the SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeCostRow());

      await repo.create({
        id: 'cost-1',
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        inputCost: 0.003,
        outputCost: 0.006,
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO costs');
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe('getById', () => {
    it('should return a cost when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCostRow());

      const result = await repo.getById('cost-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('cost-1');
      expect(result!.provider).toBe('openai');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getById('missing')).toBeNull();
    });

    it('should parse createdAt as Date', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCostRow());

      const result = await repo.getById('cost-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
    });

    it('should convert null conversation_id to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCostRow({ conversation_id: null }));

      const result = await repo.getById('cost-1');

      expect(result!.conversationId).toBeUndefined();
    });

    it('should convert non-null conversation_id to string', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCostRow({ conversation_id: 'conv-1' }));

      const result = await repo.getById('cost-1');

      expect(result!.conversationId).toBe('conv-1');
    });

    it('should convert numeric string tokens to numbers', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCostRow({
          input_tokens: '200',
          output_tokens: '100',
          total_tokens: '300',
        })
      );

      const result = await repo.getById('cost-1');

      expect(result!.inputTokens).toBe(200);
      expect(result!.outputTokens).toBe(100);
      expect(result!.totalTokens).toBe(300);
    });

    it('should query with WHERE id = $1', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getById('cost-1');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE id = $1');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['cost-1']);
    });
  });

  // =========================================================================
  // getAll
  // =========================================================================

  describe('getAll', () => {
    it('should return empty array when no costs', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getAll()).toEqual([]);
    });

    it('should return mapped cost records', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeCostRow({ id: 'cost-1' }),
        makeCostRow({ id: 'cost-2', provider: 'anthropic' }),
      ]);

      const result = await repo.getAll();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('cost-1');
      expect(result[1]!.provider).toBe('anthropic');
    });

    it('should order by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should use default limit of 100 and offset of 0', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual([100, 0]);
    });

    it('should apply custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll(50, 25);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual([50, 25]);
    });

    it('should contain LIMIT and OFFSET in SQL', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll(10, 5);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });
  });

  // =========================================================================
  // getByProvider
  // =========================================================================

  describe('getByProvider', () => {
    it('should return costs filtered by provider', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeCostRow({ provider: 'anthropic' })]);

      const result = await repo.getByProvider('anthropic');

      expect(result).toHaveLength(1);
      expect(result[0]!.provider).toBe('anthropic');
    });

    it('should filter with WHERE provider = $1', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByProvider('openai');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE provider = $1');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('openai');
    });

    it('should use default limit of 100', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByProvider('openai');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe(100);
    });

    it('should apply custom limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByProvider('openai', 10);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe(10);
    });

    it('should order by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByProvider('openai');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should return empty array when no costs for provider', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getByProvider('unknown')).toEqual([]);
    });
  });

  // =========================================================================
  // getByConversation
  // =========================================================================

  describe('getByConversation', () => {
    it('should return costs for a conversation', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeCostRow({ conversation_id: 'conv-1' }),
        makeCostRow({ id: 'cost-2', conversation_id: 'conv-1' }),
      ]);

      const result = await repo.getByConversation('conv-1');

      expect(result).toHaveLength(2);
    });

    it('should filter by conversation_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByConversation('conv-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('WHERE conversation_id = $1');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['conv-1']);
    });

    it('should order by created_at ASC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByConversation('conv-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at ASC');
    });

    it('should return empty array when no costs for conversation', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getByConversation('missing')).toEqual([]);
    });
  });

  // =========================================================================
  // getSummaryByProvider
  // =========================================================================

  describe('getSummaryByProvider', () => {
    it('should return aggregated summaries grouped by provider and model', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          provider: 'openai',
          model: 'gpt-4',
          total_calls: '10',
          total_input_tokens: '1000',
          total_output_tokens: '500',
          total_tokens: '1500',
          total_cost: '0.15',
        },
      ]);

      const result = await repo.getSummaryByProvider();

      expect(result).toHaveLength(1);
      expect(result[0]!.provider).toBe('openai');
      expect(result[0]!.model).toBe('gpt-4');
      expect(result[0]!.totalCalls).toBe(10);
      expect(result[0]!.totalInputTokens).toBe(1000);
      expect(result[0]!.totalOutputTokens).toBe(500);
      expect(result[0]!.totalTokens).toBe(1500);
      expect(result[0]!.totalCost).toBe(0.15);
    });

    it('should handle multiple providers', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          provider: 'openai',
          model: 'gpt-4',
          total_calls: '5',
          total_input_tokens: '500',
          total_output_tokens: '250',
          total_tokens: '750',
          total_cost: '0.075',
        },
        {
          provider: 'anthropic',
          model: 'claude-3',
          total_calls: '3',
          total_input_tokens: '300',
          total_output_tokens: '150',
          total_tokens: '450',
          total_cost: '0.045',
        },
      ]);

      const result = await repo.getSummaryByProvider();

      expect(result).toHaveLength(2);
      expect(result[0]!.provider).toBe('openai');
      expect(result[1]!.provider).toBe('anthropic');
    });

    it('should handle null/empty aggregate values', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          provider: 'openai',
          model: 'gpt-4',
          total_calls: '0',
          total_input_tokens: null,
          total_output_tokens: null,
          total_tokens: null,
          total_cost: null,
        },
      ]);

      const result = await repo.getSummaryByProvider();

      expect(result[0]!.totalInputTokens).toBe(0);
      expect(result[0]!.totalOutputTokens).toBe(0);
      expect(result[0]!.totalTokens).toBe(0);
      expect(result[0]!.totalCost).toBe(0);
    });

    it('should return empty array when no data', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getSummaryByProvider()).toEqual([]);
    });

    it('should contain GROUP BY provider, model', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getSummaryByProvider();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('GROUP BY provider, model');
    });

    it('should order by total_cost DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getSummaryByProvider();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY total_cost DESC');
    });
  });

  // =========================================================================
  // getDailyCosts
  // =========================================================================

  describe('getDailyCosts', () => {
    it('should return daily cost aggregates', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          date: '2025-01-15',
          total_calls: '5',
          total_tokens: '750',
          total_cost: '0.075',
        },
        {
          date: '2025-01-14',
          total_calls: '3',
          total_tokens: '450',
          total_cost: '0.045',
        },
      ]);

      const result = await repo.getDailyCosts();

      expect(result).toHaveLength(2);
      expect(result[0]!.date).toBe('2025-01-15');
      expect(result[0]!.totalCalls).toBe(5);
      expect(result[0]!.totalTokens).toBe(750);
      expect(result[0]!.totalCost).toBe(0.075);
    });

    it('should use default of 30 days', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getDailyCosts();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual([30]);
    });

    it('should accept custom number of days', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getDailyCosts(7);

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual([7]);
    });

    it('should handle null aggregate values', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          date: '2025-01-15',
          total_calls: '0',
          total_tokens: null,
          total_cost: null,
        },
      ]);

      const result = await repo.getDailyCosts();

      expect(result[0]!.totalTokens).toBe(0);
      expect(result[0]!.totalCost).toBe(0);
    });

    it('should return empty array when no data', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getDailyCosts()).toEqual([]);
    });

    it('should order by date ASC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getDailyCosts();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY date ASC');
    });

    it('should group by DATE(created_at)', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getDailyCosts();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('GROUP BY DATE(created_at)');
    });
  });

  // =========================================================================
  // getTotalCost
  // =========================================================================

  describe('getTotalCost', () => {
    it('should return the total cost', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ total: '1.234' });

      expect(await repo.getTotalCost()).toBe(1.234);
    });

    it('should return 0 when total is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ total: null });

      expect(await repo.getTotalCost()).toBe(0);
    });

    it('should return 0 when row is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getTotalCost()).toBe(0);
    });

    it('should query SUM(total_cost)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ total: '0' });

      await repo.getTotalCost();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SUM(total_cost)');
    });
  });

  // =========================================================================
  // getTotalTokens
  // =========================================================================

  describe('getTotalTokens', () => {
    it('should return input, output, and total tokens', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        input: '10000',
        output: '5000',
        total: '15000',
      });

      const result = await repo.getTotalTokens();

      expect(result.input).toBe(10000);
      expect(result.output).toBe(5000);
      expect(result.total).toBe(15000);
    });

    it('should return zeros when all values are null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        input: null,
        output: null,
        total: null,
      });

      const result = await repo.getTotalTokens();

      expect(result.input).toBe(0);
      expect(result.output).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should return zeros when row is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getTotalTokens();

      expect(result.input).toBe(0);
      expect(result.output).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should query SUM of input_tokens, output_tokens, total_tokens', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ input: '0', output: '0', total: '0' });

      await repo.getTotalTokens();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('SUM(input_tokens)');
      expect(sql).toContain('SUM(output_tokens)');
      expect(sql).toContain('SUM(total_tokens)');
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

    it('should return 0 when row is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });

    it('should return 0 for empty table', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      expect(await repo.count()).toBe(0);
    });

    it('should query COUNT(*) from costs', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });

      await repo.count();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('costs');
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createCostsRepository', () => {
    it('should be importable and return a CostsRepository instance', async () => {
      const { createCostsRepository } = await import('./costs.js');
      const r = createCostsRepository();
      expect(r).toBeInstanceOf(CostsRepository);
    });
  });

  describe('costsRepo', () => {
    it('should export a singleton instance', async () => {
      const { costsRepo } = await import('./costs.js');
      expect(costsRepo).toBeInstanceOf(CostsRepository);
    });
  });
});
