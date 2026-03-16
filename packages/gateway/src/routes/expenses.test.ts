/**
 * Expenses Routes Tests
 *
 * Tests for the DB-backed expenses API endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ── Mocks ──

const sampleExpense = {
  id: 'exp-1',
  userId: 'user-1',
  date: '2026-03-15',
  amount: 42.50,
  currency: 'TRY',
  category: 'food',
  description: 'Coffee',
  paymentMethod: 'card',
  tags: ['morning'],
  source: 'web',
  notes: 'Good coffee',
  createdAt: new Date('2026-03-15'),
  updatedAt: new Date('2026-03-15'),
};

const mockRepo = {
  list: vi.fn(async () => [sampleExpense]),
  count: vi.fn(async () => 1),
  get: vi.fn(async () => sampleExpense),
  create: vi.fn(async (input: Record<string, unknown>) => ({ ...sampleExpense, ...input })),
  update: vi.fn(async (_id: string, input: Record<string, unknown>) => ({ ...sampleExpense, ...input })),
  delete: vi.fn(async () => true),
  getSummary: vi.fn(async () => ({
    totalAmount: 150,
    count: 3,
    byCategory: { food: { amount: 100, count: 2 }, transport: { amount: 50, count: 1 } },
    byCurrency: { TRY: 150 },
  })),
};

vi.mock('../db/repositories/expenses.js', () => ({
  ExpensesRepository: vi.fn(function () {
    return mockRepo;
  }),
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

const { expensesRoutes } = await import('./expenses.js');

// ── App ──

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/expenses', expensesRoutes);
  return app;
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.list.mockResolvedValue([sampleExpense]);
  mockRepo.count.mockResolvedValue(1);
  mockRepo.get.mockResolvedValue(sampleExpense);
  mockRepo.delete.mockResolvedValue(true);
});

describe('Expenses Routes', () => {
  describe('GET /expenses', () => {
    it('returns expenses list', async () => {
      const app = createApp();
      const res = await app.request('/expenses');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.expenses).toHaveLength(1);
      expect(json.data.total).toBe(1);
      expect(json.data.categories).toBeDefined();
    });

    it('passes filter params to repo', async () => {
      const app = createApp();
      await app.request('/expenses?startDate=2026-01-01&endDate=2026-12-31&category=food&search=coffee');
      expect(mockRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: '2026-01-01',
          dateTo: '2026-12-31',
          category: 'food',
          search: 'coffee',
        })
      );
    });
  });

  describe('GET /expenses/summary', () => {
    it('returns summary with defaults', async () => {
      const app = createApp();
      const res = await app.request('/expenses/summary');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.totalAmount).toBe(150);
      expect(json.data.count).toBe(3);
      expect(json.data.byCategory.food.amount).toBe(100);
    });

    it('supports period parameter', async () => {
      const app = createApp();
      const res = await app.request('/expenses/summary?period=this_year');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.period).toBe('this_year');
    });
  });

  describe('GET /expenses/monthly', () => {
    it('returns 12 months', async () => {
      const app = createApp();
      const res = await app.request('/expenses/monthly?year=2026');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.months).toHaveLength(12);
      expect(json.data.year).toBe(2026);
    });
  });

  describe('GET /expenses/:id', () => {
    it('returns single expense', async () => {
      const app = createApp();
      const res = await app.request('/expenses/exp-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('exp-1');
    });

    it('returns 404 for missing', async () => {
      mockRepo.get.mockResolvedValue(null);
      const app = createApp();
      const res = await app.request('/expenses/missing');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /expenses', () => {
    it('creates expense', async () => {
      const app = createApp();
      const res = await app.request('/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 25, description: 'Lunch', category: 'food' }),
      });
      expect(res.status).toBe(201);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 25, description: 'Lunch' })
      );
    });

    it('returns 400 without amount', async () => {
      const app = createApp();
      const res = await app.request('/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'No amount' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /expenses/:id', () => {
    it('updates expense', async () => {
      const app = createApp();
      const res = await app.request('/expenses/exp-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 99 }),
      });
      expect(res.status).toBe(200);
      expect(mockRepo.update).toHaveBeenCalledWith('exp-1', expect.objectContaining({ amount: 99 }));
    });

    it('returns 404 for missing', async () => {
      mockRepo.update.mockResolvedValue(null);
      const app = createApp();
      const res = await app.request('/expenses/missing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1 }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /expenses/:id', () => {
    it('deletes expense', async () => {
      const app = createApp();
      const res = await app.request('/expenses/exp-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
    });

    it('returns 404 for missing', async () => {
      mockRepo.delete.mockResolvedValue(false);
      const app = createApp();
      const res = await app.request('/expenses/missing', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });
});
