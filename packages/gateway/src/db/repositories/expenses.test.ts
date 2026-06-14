/**
 * ExpensesRepository Tests
 *
 * Unit tests for the PostgreSQL-backed expense tracker — CRUD with user
 * scoping, dynamic update field building, JSON tags round-trip (including
 * malformed-tag fallback), numeric string → number coercion, list with
 * multi-filter composition, count with optional filters, and summary
 * aggregation across category + currency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('@ownpilot/core/services', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, generateId: vi.fn(() => 'exp-test-id') };
});

const { ExpensesRepository } = await import('./expenses.js');

const NOW = '2026-01-01T00:00:00Z';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exp-1',
    user_id: 'user-1',
    date: '2026-01-15',
    amount: '12.50',
    currency: 'TRY',
    category: 'food',
    description: 'Lunch',
    payment_method: 'card',
    tags: '["work","deductible"]',
    source: 'manual',
    receipt_image: null,
    notes: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('ExpensesRepository', () => {
  let repo: InstanceType<typeof ExpensesRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ExpensesRepository('user-1');
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe('create', () => {
    it('inserts all fields with defaults filled in and maps the returned row', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());

      const expense = await repo.create({
        date: '2026-01-15',
        amount: 12.5,
        description: 'Lunch',
      });

      expect(expense.id).toBe('exp-1');
      expect(expense.amount).toBe(12.5);
      expect(expense.tags).toEqual(['work', 'deductible']);
      expect(expense.createdAt).toBeInstanceOf(Date);

      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO expenses');
      expect(sql).toContain('RETURNING *');
      expect(params).toEqual([
        'exp-test-id',
        'user-1',
        '2026-01-15',
        12.5,
        'TRY', // default currency
        'other', // default category
        'Lunch',
        null, // paymentMethod default
        JSON.stringify([]), // tags default
        'manual', // source default
        null, // receiptImage default
        null, // notes default
      ]);
    });

    it('serializes custom tags array as JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ tags: '["a","b","c"]' }));

      await repo.create({
        date: '2026-01-15',
        amount: 5,
        description: 'x',
        tags: ['a', 'b', 'c'],
      });

      const [, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(params[8]).toBe(JSON.stringify(['a', 'b', 'c']));
    });
  });

  // ---------------------------------------------------------------------------
  // get
  // ---------------------------------------------------------------------------

  describe('get', () => {
    it('scopes lookup by id AND user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());

      const expense = await repo.get('exp-1');

      expect(expense?.id).toBe('exp-1');
      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE id = $1 AND user_id = $2');
      expect(params).toEqual(['exp-1', 'user-1']);
    });

    it('returns null when no row found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      expect(await repo.get('missing')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  describe('update', () => {
    it('builds SET clause only for provided fields and appends updated_at = NOW()', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ amount: '20.00' }));

      await repo.update('exp-1', { amount: 20, description: 'Dinner' });

      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE expenses SET');
      expect(sql).toContain('amount = $1');
      expect(sql).toContain('description = $2');
      expect(sql).toContain('updated_at = NOW()');
      expect(sql).toContain('WHERE id = $3 AND user_id = $4');
      expect(sql).toContain('RETURNING *');
      // values are [amount, description, id, userId]
      expect(params).toEqual([20, 'Dinner', 'exp-1', 'user-1']);
    });

    it('serializes tags as JSON when supplied', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());

      await repo.update('exp-1', { tags: ['x', 'y'] });

      const [, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBe(JSON.stringify(['x', 'y']));
    });

    it('when no fields provided, short-circuits to get() (single SELECT call, no UPDATE)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow());

      const result = await repo.update('exp-1', {});

      expect(result?.id).toBe('exp-1');
      const [sql] = mockAdapter.queryOne.mock.calls[0] as [string];
      expect(sql).toContain('SELECT * FROM expenses');
      expect(sql).not.toContain('UPDATE');
    });

    it('returns null when UPDATE matches no rows', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.update('exp-1', { amount: 5 });
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------

  describe('delete', () => {
    it('returns true when a row was removed', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const ok = await repo.delete('exp-1');

      expect(ok).toBe(true);
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM expenses WHERE id = $1 AND user_id = $2');
      expect(params).toEqual(['exp-1', 'user-1']);
    });

    it('returns false when no row matched', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      expect(await repo.delete('missing')).toBe(false);
    });

    it('returns false when adapter returns an object without changes field', async () => {
      mockAdapter.execute.mockResolvedValueOnce({} as never);
      expect(await repo.delete('exp-1')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  describe('list', () => {
    it('returns all expenses for the user with default limit/offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow(), makeRow({ id: 'exp-2' })]);

      const rows = await repo.list();

      expect(rows).toHaveLength(2);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE user_id = $1');
      expect(sql).toContain('ORDER BY date DESC');
      expect(sql).toContain('LIMIT $2 OFFSET $3');
      expect(params).toEqual(['user-1', 100, 0]);
    });

    it('composes all filters with incrementing param indices', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        category: 'food',
        minAmount: 5,
        maxAmount: 100,
        search: 'lunch',
        limit: 25,
        offset: 50,
      });

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('date >= $2');
      expect(sql).toContain('date <= $3');
      expect(sql).toContain('category = $4');
      expect(sql).toContain('amount >= $5');
      expect(sql).toContain('amount <= $6');
      expect(sql).toContain('description ILIKE $7');
      expect(sql).toContain('LIMIT $8 OFFSET $9');
      expect(params).toEqual([
        'user-1',
        '2026-01-01',
        '2026-01-31',
        'food',
        5,
        100,
        '%lunch%',
        25,
        50,
      ]);
    });

    it('returns empty array when no rows match', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      expect(await repo.list()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // count
  // ---------------------------------------------------------------------------

  describe('count', () => {
    it('parses count from queryOne and user-scopes', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });

      const n = await repo.count();

      expect(n).toBe(42);
      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SELECT COUNT(*) AS count FROM expenses WHERE user_id = $1');
      expect(params).toEqual(['user-1']);
    });

    it('returns 0 when no row is returned', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      expect(await repo.count()).toBe(0);
    });

    it('applies optional date and category filters', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '5' });

      await repo.count({ dateFrom: '2026-01-01', dateTo: '2026-01-31', category: 'travel' });

      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('date >= $2');
      expect(sql).toContain('date <= $3');
      expect(sql).toContain('category = $4');
      expect(params).toEqual(['user-1', '2026-01-01', '2026-01-31', 'travel']);
    });
  });

  // ---------------------------------------------------------------------------
  // getSummary
  // ---------------------------------------------------------------------------

  describe('getSummary', () => {
    it('aggregates total + per-category + per-currency in parallel', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ total: '123.45', count: '7' });
      mockAdapter.query
        .mockResolvedValueOnce([
          { category: 'food', total: '80.00', count: '4' },
          { category: 'transport', total: '43.45', count: '3' },
        ])
        .mockResolvedValueOnce([
          { currency: 'TRY', total: '100.00' },
          { currency: 'USD', total: '23.45' },
        ]);

      const summary = await repo.getSummary();

      expect(summary.totalAmount).toBe(123.45);
      expect(summary.count).toBe(7);
      expect(summary.byCategory).toEqual({
        food: { amount: 80, count: 4 },
        transport: { amount: 43.45, count: 3 },
      });
      expect(summary.byCurrency).toEqual({ TRY: 100, USD: 23.45 });

      const [totalSql] = mockAdapter.queryOne.mock.calls[0] as [string];
      expect(totalSql).toContain('COALESCE(SUM(amount), 0) AS total');
      expect(totalSql).toContain('WHERE user_id = $1');
    });

    it('returns zero totals when the table is empty', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ total: '0', count: '0' });
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const summary = await repo.getSummary();

      expect(summary.totalAmount).toBe(0);
      expect(summary.count).toBe(0);
      expect(summary.byCategory).toEqual({});
      expect(summary.byCurrency).toEqual({});
    });

    it('handles null total row gracefully', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const summary = await repo.getSummary();

      expect(summary.totalAmount).toBe(0);
      expect(summary.count).toBe(0);
    });

    it('threads dateFrom/dateTo through all three aggregation queries', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ total: '0', count: '0' });
      mockAdapter.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await repo.getSummary('2026-01-01', '2026-01-31');

      // Every aggregation call should have the same param list
      const totalParams = (mockAdapter.queryOne.mock.calls[0] as [string, unknown[]])[1];
      const catParams = (mockAdapter.query.mock.calls[0] as [string, unknown[]])[1];
      const curParams = (mockAdapter.query.mock.calls[1] as [string, unknown[]])[1];

      expect(totalParams).toEqual(['user-1', '2026-01-01', '2026-01-31']);
      expect(catParams).toEqual(['user-1', '2026-01-01', '2026-01-31']);
      expect(curParams).toEqual(['user-1', '2026-01-01', '2026-01-31']);
    });
  });

  // ---------------------------------------------------------------------------
  // Row mapping edge cases
  // ---------------------------------------------------------------------------

  describe('row mapping', () => {
    it('parses numeric amount string to number', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ amount: '99.99' }));
      const e = await repo.get('exp-1');
      expect(e?.amount).toBe(99.99);
    });

    it('returns empty tags array when JSON is malformed', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ tags: 'not-json' }));
      const e = await repo.get('exp-1');
      expect(e?.tags).toEqual([]);
    });

    it('coerces null optional columns to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeRow({ payment_method: null, receipt_image: null, notes: null })
      );
      const e = await repo.get('exp-1');
      expect(e?.paymentMethod).toBeUndefined();
      expect(e?.receiptImage).toBeUndefined();
      expect(e?.notes).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Constructor default
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('defaults userId to "default" when not provided', async () => {
      const defaultRepo = new ExpensesRepository();
      mockAdapter.queryOne.mockResolvedValueOnce(makeRow({ user_id: 'default' }));

      await defaultRepo.get('exp-1');

      const [, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual(['exp-1', 'default']);
    });
  });
});
