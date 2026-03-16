import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockRepo = {
  create: vi.fn(async (input: Record<string, unknown>) => ({ id: 'exp-1', ...input })),
  list: vi.fn(async () => []),
  get: vi.fn(async () => null),
  update: vi.fn(async () => null),
  delete: vi.fn(async () => true),
  getSummary: vi.fn(async () => ({ totalAmount: 0, count: 0, byCategory: {}, byCurrency: {} })),
};

vi.mock('../db/repositories/expenses.js', () => ({
  ExpensesRepository: vi.fn(function () {
    return mockRepo;
  }),
}));

const { executeExpenseTool } = await import('./expense-tools.js');

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeExpenseTool', () => {
  it('add_expense creates an expense', async () => {
    const result = await executeExpenseTool(
      'add_expense',
      {
        amount: 42.5,
        description: 'Coffee',
        category: 'food',
      },
      'user-1'
    );

    expect(result.success).toBe(true);
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 42.5, description: 'Coffee', category: 'food' })
    );
  });

  it('batch_add_expenses creates multiple', async () => {
    const result = await executeExpenseTool(
      'batch_add_expenses',
      {
        expenses: [
          { amount: 10, description: 'A' },
          { amount: 20, description: 'B' },
        ],
      },
      'user-1'
    );

    expect(result.success).toBe(true);
    expect(mockRepo.create).toHaveBeenCalledTimes(2);
    expect((result.result as { added: number }).added).toBe(2);
  });

  it('batch_add_expenses rejects non-array', async () => {
    const result = await executeExpenseTool(
      'batch_add_expenses',
      { expenses: 'not array' },
      'user-1'
    );
    expect(result.success).toBe(false);
  });

  it('query_expenses returns expenses', async () => {
    mockRepo.list.mockResolvedValue([{ id: 'e1', amount: 50 }]);
    const result = await executeExpenseTool('query_expenses', { category: 'food' }, 'user-1');

    expect(result.success).toBe(true);
    expect((result.result as { count: number }).count).toBe(1);
  });

  it('expense_summary returns aggregated data', async () => {
    mockRepo.getSummary.mockResolvedValue({
      totalAmount: 150,
      count: 3,
      byCategory: { food: { amount: 100, count: 2 } },
      byCurrency: { TRY: 150 },
    });

    const result = await executeExpenseTool('expense_summary', { period: 'this_month' }, 'user-1');

    expect(result.success).toBe(true);
    expect((result.result as { totalAmount: number }).totalAmount).toBe(150);
  });

  it('update_expense updates and returns', async () => {
    mockRepo.update.mockResolvedValue({ id: 'e1', amount: 99 });
    const result = await executeExpenseTool(
      'update_expense',
      { expenseId: 'e1', amount: 99 },
      'user-1'
    );

    expect(result.success).toBe(true);
  });

  it('update_expense returns error for missing', async () => {
    mockRepo.update.mockResolvedValue(null);
    const result = await executeExpenseTool('update_expense', { expenseId: 'missing' }, 'user-1');
    expect(result.success).toBe(false);
  });

  it('delete_expense succeeds', async () => {
    const result = await executeExpenseTool('delete_expense', { expenseId: 'e1' }, 'user-1');
    expect(result.success).toBe(true);
  });

  it('delete_expense returns error for missing', async () => {
    mockRepo.delete.mockResolvedValue(false);
    const result = await executeExpenseTool('delete_expense', { expenseId: 'missing' }, 'user-1');
    expect(result.success).toBe(false);
  });

  it('export_expenses returns JSON format', async () => {
    mockRepo.list.mockResolvedValue([{ id: 'e1', amount: 50 }]);
    const result = await executeExpenseTool('export_expenses', { format: 'json' }, 'user-1');

    expect(result.success).toBe(true);
    expect((result.result as { format: string }).format).toBe('json');
  });

  it('export_expenses returns CSV format', async () => {
    mockRepo.list.mockResolvedValue([
      {
        id: 'e1',
        date: '2026-01-01',
        amount: 50,
        currency: 'TRY',
        category: 'food',
        description: 'Test',
        paymentMethod: 'card',
        tags: [],
        notes: '',
      },
    ]);
    const result = await executeExpenseTool('export_expenses', { format: 'csv' }, 'user-1');

    expect(result.success).toBe(true);
    expect((result.result as { format: string }).format).toBe('csv');
    expect((result.result as { data: string }).data).toContain('id,date,amount');
  });

  it('returns error for unknown tool', async () => {
    const result = await executeExpenseTool('unknown', {}, 'user-1');
    expect(result.success).toBe(false);
  });

  it('catches exceptions', async () => {
    mockRepo.create.mockRejectedValue(new Error('DB down'));
    const result = await executeExpenseTool(
      'add_expense',
      { amount: 1, description: 'x' },
      'user-1'
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('DB down');
  });
});
