/**
 * Expenses Routes Tests
 *
 * Integration tests for the expenses API endpoints.
 * Mocks node:fs/promises for file-based expense storage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const sampleExpenses = [
  {
    id: 'exp_001',
    date: '2026-01-15',
    amount: 150,
    currency: 'TRY',
    category: 'food',
    description: 'Grocery shopping at Migros',
    paymentMethod: 'credit_card',
    tags: ['groceries'],
    source: 'web',
    createdAt: '2026-01-15T10:00:00Z',
    notes: 'Weekly groceries',
  },
  {
    id: 'exp_002',
    date: '2026-01-20',
    amount: 500,
    currency: 'TRY',
    category: 'transport',
    description: 'Monthly metro card',
    source: 'web',
    createdAt: '2026-01-20T08:00:00Z',
  },
  {
    id: 'exp_003',
    date: '2026-01-25',
    amount: 1200,
    currency: 'TRY',
    category: 'entertainment',
    description: 'Concert tickets',
    source: 'web',
    createdAt: '2026-01-25T14:00:00Z',
    notes: 'Jazz festival',
  },
];

const DEFAULT_CATEGORIES = {
  food: { color: '#FF6B6B' },
  transport: { color: '#4ECDC4' },
  utilities: { color: '#45B7D1' },
  entertainment: { color: '#96CEB4' },
  shopping: { color: '#FFEAA7' },
  health: { color: '#DDA0DD' },
  education: { color: '#98D8C8' },
  travel: { color: '#F7DC6F' },
  subscription: { color: '#BB8FCE' },
  housing: { color: '#85C1E9' },
  other: { color: '#AEB6BF' },
};

let mockDbContent = {
  version: '1.0',
  lastUpdated: '2026-01-25T14:00:00Z',
  expenses: [...sampleExpenses],
  categories: DEFAULT_CATEGORIES,
};

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => JSON.stringify(mockDbContent)),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}));

// Import after mocks
const { expensesRoutes } = await import('./expenses.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/expenses', expensesRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Expenses Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock db to fresh copy each test
    mockDbContent = {
      version: '1.0',
      lastUpdated: '2026-01-25T14:00:00Z',
      expenses: [...sampleExpenses],
      categories: DEFAULT_CATEGORIES,
    };
    app = createApp();
  });

  // ========================================================================
  // GET /expenses
  // ========================================================================

  describe('GET /expenses', () => {
    it('returns all expenses sorted by date descending', async () => {
      const res = await app.request('/expenses');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.expenses).toHaveLength(3);
      expect(json.data.total).toBe(3);
      // Sorted descending
      expect(json.data.expenses[0].date).toBe('2026-01-25');
      expect(json.data.expenses[2].date).toBe('2026-01-15');
    });

    it('filters by category', async () => {
      const res = await app.request('/expenses?category=food');

      const json = await res.json();
      expect(json.data.expenses).toHaveLength(1);
      expect(json.data.expenses[0].category).toBe('food');
    });

    it('filters by date range', async () => {
      const res = await app.request('/expenses?startDate=2026-01-18&endDate=2026-01-22');

      const json = await res.json();
      expect(json.data.expenses).toHaveLength(1);
      expect(json.data.expenses[0].id).toBe('exp_002');
    });

    it('filters by search term in description', async () => {
      const res = await app.request('/expenses?search=metro');

      const json = await res.json();
      expect(json.data.expenses).toHaveLength(1);
      expect(json.data.expenses[0].description).toContain('metro');
    });

    it('filters by search term in notes', async () => {
      const res = await app.request('/expenses?search=jazz');

      const json = await res.json();
      expect(json.data.expenses).toHaveLength(1);
      expect(json.data.expenses[0].notes).toContain('Jazz');
    });

    it('respects pagination', async () => {
      const res = await app.request('/expenses?limit=2&offset=1');

      const json = await res.json();
      expect(json.data.expenses).toHaveLength(2);
      expect(json.data.total).toBe(3);
      expect(json.data.limit).toBe(2);
      expect(json.data.offset).toBe(1);
    });

    it('returns empty when no file exists', async () => {
      const fsMod = await import('node:fs/promises');
      vi.mocked(fsMod.readFile).mockRejectedValueOnce(new Error('ENOENT'));

      const res = await app.request('/expenses');
      const json = await res.json();

      expect(json.data.expenses).toHaveLength(0);
      expect(json.data.total).toBe(0);
    });
  });

  // ========================================================================
  // GET /expenses/summary
  // ========================================================================

  describe('GET /expenses/summary', () => {
    it('returns summary for default period (this_month)', async () => {
      const res = await app.request('/expenses/summary');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.period).toBeDefined();
      expect(json.data.summary).toBeDefined();
      expect(json.data.summary.totalByCategory).toBeDefined();
    });

    it('returns summary with custom date range', async () => {
      const res = await app.request('/expenses/summary?startDate=2026-01-01&endDate=2026-01-31');

      const json = await res.json();
      expect(json.data.summary.totalExpenses).toBe(3);
      expect(json.data.summary.grandTotal).toBe(1850);
      expect(json.data.summary.topCategories).toBeDefined();
    });

    it('returns summary for all_time', async () => {
      const res = await app.request('/expenses/summary?period=all_time');

      const json = await res.json();
      expect(json.data.period.name).toBe('all_time');
      expect(json.data.summary.totalExpenses).toBe(3);
    });
  });

  // ========================================================================
  // GET /expenses/monthly
  // ========================================================================

  describe('GET /expenses/monthly', () => {
    it('returns monthly breakdown for current year', async () => {
      const res = await app.request('/expenses/monthly?year=2026');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.year).toBe(2026);
      expect(json.data.months).toHaveLength(12);
      expect(json.data.yearTotal).toBe(1850);
      expect(json.data.expenseCount).toBe(3);

      // January should have data
      const jan = json.data.months.find((m: { monthNum: string }) => m.monthNum === '01');
      expect(jan.total).toBe(1850);
      expect(jan.count).toBe(3);
    });
  });

  // ========================================================================
  // POST /expenses
  // ========================================================================

  describe('POST /expenses', () => {
    it('creates a new expense', async () => {
      const res = await app.request('/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 75,
          category: 'food',
          description: 'Coffee shop',
          currency: 'USD',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.id).toMatch(/^exp_/);
      expect(json.data.amount).toBe(75);
      expect(json.data.currency).toBe('USD');
      expect(json.data.source).toBe('web');
    });

    it('defaults currency to TRY', async () => {
      const res = await app.request('/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 50,
          category: 'food',
          description: 'Lunch',
        }),
      });

      const json = await res.json();
      expect(json.data.currency).toBe('TRY');
    });
  });

  // ========================================================================
  // PUT /expenses/:id
  // ========================================================================

  describe('PUT /expenses/:id', () => {
    it('updates an existing expense', async () => {
      const res = await app.request('/expenses/exp_001', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 200, description: 'Updated groceries' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.amount).toBe(200);
      expect(json.data.description).toBe('Updated groceries');
      // Preserves original id and createdAt
      expect(json.data.id).toBe('exp_001');
      expect(json.data.createdAt).toBe('2026-01-15T10:00:00Z');
    });

    it('returns 404 for unknown expense', async () => {
      const res = await app.request('/expenses/exp_nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 999 }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // DELETE /expenses/:id
  // ========================================================================

  describe('DELETE /expenses/:id', () => {
    it('deletes an expense', async () => {
      const res = await app.request('/expenses/exp_002', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted.id).toBe('exp_002');
    });

    it('returns 404 for unknown expense', async () => {
      const res = await app.request('/expenses/exp_nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });
});
