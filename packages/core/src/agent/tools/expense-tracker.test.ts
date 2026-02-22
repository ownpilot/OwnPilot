import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks for fs and path
const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('node:path', () => ({
  join: (...parts: string[]) => parts.join('/'),
  dirname: (p: string) => {
    const idx = p.lastIndexOf('/');
    return idx >= 0 ? p.substring(0, idx) : '.';
  },
}));

import {
  addExpenseTool,
  addExpenseExecutor,
  batchAddExpensesTool,
  batchAddExpensesExecutor,
  parseReceiptTool,
  parseReceiptExecutor,
  queryExpensesTool,
  queryExpensesExecutor,
  exportExpensesTool,
  exportExpensesExecutor,
  expenseSummaryTool,
  expenseSummaryExecutor,
  deleteExpenseTool,
  deleteExpenseExecutor,
  EXPENSE_TRACKER_TOOLS,
} from './expense-tracker.js';
import type { ExpenseEntry, ExpenseDatabase } from './expense-tracker.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dummyContext: any = {
  callId: 'test-call',
  conversationId: 'test-conv',
};

// Helper to parse JSON content from a successful result
function parseContent(content: unknown): Record<string, unknown> {
  return JSON.parse(content as string) as Record<string, unknown>;
}

// Helper to build a minimal expense entry
function makeExpense(overrides: Partial<ExpenseEntry> = {}): ExpenseEntry {
  return {
    id: 'exp_test_001',
    date: '2025-01-15',
    amount: 100,
    currency: 'TRY',
    category: 'food',
    description: 'Test expense',
    source: 'manual',
    createdAt: '2025-01-15T10:00:00.000Z',
    ...overrides,
  };
}

// Helper to build a minimal expense database
function makeDb(expenses: ExpenseEntry[] = []): ExpenseDatabase {
  return {
    version: '1.0',
    lastUpdated: '2025-01-15T10:00:00.000Z',
    expenses,
    categories: {
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
    },
  };
}

// Setup: stub fs to return a fresh DB by default
function setupFs(db?: ExpenseDatabase): void {
  const dbData = db ?? makeDb();
  mockReadFile.mockResolvedValue(JSON.stringify(dbData));
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
}

// =============================================================================
// addExpenseTool / addExpenseExecutor
// =============================================================================

describe('addExpenseTool definition', () => {
  it('has the correct name', () => {
    expect(addExpenseTool.name).toBe('add_expense');
  });

  it('has a description', () => {
    expect(addExpenseTool.description).toBeTypeOf('string');
    expect(addExpenseTool.description.length).toBeGreaterThan(0);
  });

  it('requires amount, category, and description', () => {
    expect(addExpenseTool.parameters.required).toEqual(['amount', 'category', 'description']);
  });

  it('defines all expected properties', () => {
    const props = addExpenseTool.parameters.properties;
    expect(props).toHaveProperty('date');
    expect(props).toHaveProperty('amount');
    expect(props).toHaveProperty('currency');
    expect(props).toHaveProperty('category');
    expect(props).toHaveProperty('description');
    expect(props).toHaveProperty('paymentMethod');
    expect(props).toHaveProperty('tags');
    expect(props).toHaveProperty('notes');
  });
});

describe('addExpenseExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFs();
  });

  it('adds an expense successfully with required fields only', async () => {
    const result = await addExpenseExecutor(
      { amount: 50, category: 'food', description: 'Lunch' },
      dummyContext
    );
    expect(result.isError).toBeUndefined();
    const data = parseContent(result.content);
    expect(data.success).toBe(true);
    expect(data.totalExpenses).toBe(1);
    expect(data.message).toContain('50');
    expect(data.message).toContain('Lunch');
  });

  it('uses default currency TRY when not provided', async () => {
    const result = await addExpenseExecutor(
      { amount: 100, category: 'shopping', description: 'Clothes' },
      dummyContext
    );
    const data = parseContent(result.content);
    const expense = data.expense as ExpenseEntry;
    expect(expense.currency).toBe('TRY');
  });

  it('uses provided currency', async () => {
    const result = await addExpenseExecutor(
      { amount: 20, category: 'food', description: 'Coffee', currency: 'USD' },
      dummyContext
    );
    const data = parseContent(result.content);
    const expense = data.expense as ExpenseEntry;
    expect(expense.currency).toBe('USD');
  });

  it('sets default date to today when not provided', async () => {
    const result = await addExpenseExecutor(
      { amount: 10, category: 'transport', description: 'Bus' },
      dummyContext
    );
    const data = parseContent(result.content);
    const expense = data.expense as ExpenseEntry;
    expect(expense.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses provided date', async () => {
    const result = await addExpenseExecutor(
      { amount: 200, category: 'utilities', description: 'Electric bill', date: '2025-02-01' },
      dummyContext
    );
    const data = parseContent(result.content);
    const expense = data.expense as ExpenseEntry;
    expect(expense.date).toBe('2025-02-01');
  });

  it('includes optional fields: paymentMethod, tags, notes', async () => {
    const result = await addExpenseExecutor(
      {
        amount: 300,
        category: 'health',
        description: 'Doctor visit',
        paymentMethod: 'credit_card',
        tags: ['medical', 'routine'],
        notes: 'Annual checkup',
      },
      dummyContext
    );
    const data = parseContent(result.content);
    const expense = data.expense as ExpenseEntry;
    expect(expense.paymentMethod).toBe('credit_card');
    expect(expense.tags).toEqual(['medical', 'routine']);
    expect(expense.notes).toBe('Annual checkup');
  });

  it('sets source to "manual"', async () => {
    const result = await addExpenseExecutor(
      { amount: 10, category: 'other', description: 'Misc' },
      dummyContext
    );
    const data = parseContent(result.content);
    const expense = data.expense as ExpenseEntry;
    expect(expense.source).toBe('manual');
  });

  it('generates a unique expense ID', async () => {
    const result = await addExpenseExecutor(
      { amount: 10, category: 'other', description: 'Misc' },
      dummyContext
    );
    const data = parseContent(result.content);
    const expense = data.expense as ExpenseEntry;
    expect(expense.id).toMatch(/^exp_/);
  });

  it('saves the database after adding', async () => {
    await addExpenseExecutor({ amount: 10, category: 'other', description: 'Misc' }, dummyContext);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockMkdir).toHaveBeenCalledTimes(1);
  });

  it('returns error when loadExpenseDb throws', async () => {
    mockReadFile.mockRejectedValue(new Error('disk full'));
    // loadExpenseDb catches read errors and returns a fresh DB,
    // but saveExpenseDb may throw if writeFile fails
    mockWriteFile.mockRejectedValue(new Error('disk full'));
    const result = await addExpenseExecutor(
      { amount: 10, category: 'other', description: 'Misc' },
      dummyContext
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('disk full');
  });

  it('adds expense to existing expenses in the database', async () => {
    const existing = makeExpense({ id: 'exp_existing_001', description: 'Old expense' });
    setupFs(makeDb([existing]));

    const result = await addExpenseExecutor(
      { amount: 50, category: 'food', description: 'New expense' },
      dummyContext
    );
    const data = parseContent(result.content);
    expect(data.totalExpenses).toBe(2);
  });
});

// =============================================================================
// batchAddExpensesTool / batchAddExpensesExecutor
// =============================================================================

describe('batchAddExpensesTool definition', () => {
  it('has the correct name', () => {
    expect(batchAddExpensesTool.name).toBe('batch_add_expenses');
  });

  it('has a description', () => {
    expect(batchAddExpensesTool.description).toBeTypeOf('string');
    expect(batchAddExpensesTool.description.length).toBeGreaterThan(0);
  });

  it('requires expenses array', () => {
    expect(batchAddExpensesTool.parameters.required).toEqual(['expenses']);
  });
});

describe('batchAddExpensesExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFs();
  });

  it('adds multiple expenses at once', async () => {
    const result = await batchAddExpensesExecutor(
      {
        expenses: [
          { amount: 10, category: 'food', description: 'Coffee' },
          { amount: 20, category: 'transport', description: 'Taxi' },
          { amount: 30, category: 'shopping', description: 'Book' },
        ],
      },
      dummyContext
    );
    const data = parseContent(result.content);
    expect(data.success).toBe(true);
    expect(data.addedCount).toBe(3);
    expect(data.totalAmount).toBe(60);
  });

  it('uses default currency TRY when not provided', async () => {
    const result = await batchAddExpensesExecutor(
      {
        expenses: [{ amount: 10, category: 'food', description: 'Coffee' }],
      },
      dummyContext
    );
    const data = parseContent(result.content);
    const expenses = data.expenses as ExpenseEntry[];
    expect(expenses[0]!.currency).toBe('TRY');
  });

  it('uses provided currency for each expense', async () => {
    const result = await batchAddExpensesExecutor(
      {
        expenses: [
          { amount: 10, category: 'food', description: 'Coffee', currency: 'USD' },
          { amount: 20, category: 'food', description: 'Lunch', currency: 'EUR' },
        ],
      },
      dummyContext
    );
    const data = parseContent(result.content);
    const expenses = data.expenses as ExpenseEntry[];
    expect(expenses[0]!.currency).toBe('USD');
    expect(expenses[1]!.currency).toBe('EUR');
  });

  it('sets default date when not provided', async () => {
    const result = await batchAddExpensesExecutor(
      {
        expenses: [{ amount: 10, category: 'food', description: 'Coffee' }],
      },
      dummyContext
    );
    const data = parseContent(result.content);
    const expenses = data.expenses as ExpenseEntry[];
    expect(expenses[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('includes message with total amount and currency', async () => {
    const result = await batchAddExpensesExecutor(
      {
        expenses: [{ amount: 50, category: 'food', description: 'Dinner', currency: 'EUR' }],
      },
      dummyContext
    );
    const data = parseContent(result.content);
    expect(data.message).toContain('1 expenses');
    expect(data.message).toContain('50');
  });

  it('saves the database once after batch add', async () => {
    await batchAddExpensesExecutor(
      {
        expenses: [
          { amount: 10, category: 'food', description: 'A' },
          { amount: 20, category: 'food', description: 'B' },
        ],
      },
      dummyContext
    );
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('returns error when save fails', async () => {
    mockWriteFile.mockRejectedValue(new Error('write failed'));
    const result = await batchAddExpensesExecutor(
      {
        expenses: [{ amount: 10, category: 'food', description: 'Coffee' }],
      },
      dummyContext
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('write failed');
  });

  it('generates unique IDs for each expense', async () => {
    const result = await batchAddExpensesExecutor(
      {
        expenses: [
          { amount: 10, category: 'food', description: 'A' },
          { amount: 20, category: 'food', description: 'B' },
        ],
      },
      dummyContext
    );
    const data = parseContent(result.content);
    const expenses = data.expenses as ExpenseEntry[];
    expect(expenses[0]!.id).not.toBe(expenses[1]!.id);
  });

  it('preserves optional fields like tags and notes', async () => {
    const result = await batchAddExpensesExecutor(
      {
        expenses: [
          {
            amount: 100,
            category: 'shopping',
            description: 'Gadget',
            tags: ['tech'],
            notes: 'Birthday gift',
            paymentMethod: 'credit_card',
          },
        ],
      },
      dummyContext
    );
    const data = parseContent(result.content);
    const expenses = data.expenses as ExpenseEntry[];
    expect(expenses[0]!.tags).toEqual(['tech']);
    expect(expenses[0]!.notes).toBe('Birthday gift');
    expect(expenses[0]!.paymentMethod).toBe('credit_card');
  });
});

// =============================================================================
// parseReceiptTool / parseReceiptExecutor
// =============================================================================

describe('parseReceiptTool definition', () => {
  it('has the correct name', () => {
    expect(parseReceiptTool.name).toBe('parse_receipt');
  });

  it('has a description', () => {
    expect(parseReceiptTool.description).toBeTypeOf('string');
    expect(parseReceiptTool.description.length).toBeGreaterThan(0);
  });

  it('has no required parameters', () => {
    expect(parseReceiptTool.parameters.required).toEqual([]);
  });

  it('defines imagePath and imageBase64 properties', () => {
    const props = parseReceiptTool.parameters.properties;
    expect(props).toHaveProperty('imagePath');
    expect(props).toHaveProperty('imageBase64');
    expect(props).toHaveProperty('saveReceipt');
  });
});

describe('parseReceiptExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when neither imagePath nor imageBase64 is provided', async () => {
    const result = await parseReceiptExecutor({}, dummyContext);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('imagePath or imageBase64');
  });

  it('returns instruction data when imagePath is provided', async () => {
    const result = await parseReceiptExecutor({ imagePath: '/path/to/receipt.jpg' }, dummyContext);
    expect(result.isError).toBeUndefined();
    const data = parseContent(result.content);
    expect(data.imagePath).toBe('/path/to/receipt.jpg');
    expect(data.hasImageData).toBe(false);
    expect(data.instruction).toBeTypeOf('string');
    expect(data.extractFields).toBeDefined();
  });

  it('returns instruction data when imageBase64 is provided', async () => {
    const result = await parseReceiptExecutor({ imageBase64: 'base64data...' }, dummyContext);
    expect(result.isError).toBeUndefined();
    const data = parseContent(result.content);
    expect(data.hasImageData).toBe(true);
    expect(data.imagePath).toBeUndefined();
  });

  it('sets requiresVision in metadata', async () => {
    const result = await parseReceiptExecutor({ imagePath: '/path/to/receipt.jpg' }, dummyContext);
    expect(result.metadata).toEqual({ requiresVision: true });
  });

  it('includes extractFields with expected keys', async () => {
    const result = await parseReceiptExecutor({ imagePath: '/path/to/receipt.jpg' }, dummyContext);
    const data = parseContent(result.content);
    const fields = data.extractFields as Record<string, string>;
    expect(fields).toHaveProperty('date');
    expect(fields).toHaveProperty('amount');
    expect(fields).toHaveProperty('currency');
    expect(fields).toHaveProperty('merchant');
    expect(fields).toHaveProperty('items');
    expect(fields).toHaveProperty('category');
    expect(fields).toHaveProperty('paymentMethod');
  });

  it('includes note about using add_expense tool', async () => {
    const result = await parseReceiptExecutor({ imagePath: '/path/to/receipt.jpg' }, dummyContext);
    const data = parseContent(result.content);
    expect(data.note).toContain('add_expense');
  });
});

// =============================================================================
// queryExpensesTool / queryExpensesExecutor
// =============================================================================

describe('queryExpensesTool definition', () => {
  it('has the correct name', () => {
    expect(queryExpensesTool.name).toBe('query_expenses');
  });

  it('has a description', () => {
    expect(queryExpensesTool.description).toBeTypeOf('string');
  });

  it('has no required parameters', () => {
    expect(queryExpensesTool.parameters.required).toEqual([]);
  });

  it('defines filter properties', () => {
    const props = queryExpensesTool.parameters.properties;
    expect(props).toHaveProperty('startDate');
    expect(props).toHaveProperty('endDate');
    expect(props).toHaveProperty('category');
    expect(props).toHaveProperty('minAmount');
    expect(props).toHaveProperty('maxAmount');
    expect(props).toHaveProperty('search');
    expect(props).toHaveProperty('tags');
    expect(props).toHaveProperty('limit');
    expect(props).toHaveProperty('aggregate');
  });
});

describe('queryExpensesExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all expenses when no filters are applied', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', amount: 50, description: 'A' }),
      makeExpense({ id: 'exp_2', amount: 100, description: 'B' }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({}, dummyContext);
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(2);
    expect(data.count).toBe(2);
  });

  it('filters by startDate', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', date: '2025-01-01' }),
      makeExpense({ id: 'exp_2', date: '2025-02-01' }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ startDate: '2025-01-15' }, dummyContext);
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(1);
  });

  it('filters by endDate', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', date: '2025-01-01' }),
      makeExpense({ id: 'exp_2', date: '2025-03-01' }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ endDate: '2025-02-01' }, dummyContext);
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(1);
  });

  it('filters by category', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', category: 'food' }),
      makeExpense({ id: 'exp_2', category: 'transport' }),
      makeExpense({ id: 'exp_3', category: 'food' }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ category: 'food' }, dummyContext);
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(2);
  });

  it('filters by minAmount', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', amount: 10 }),
      makeExpense({ id: 'exp_2', amount: 50 }),
      makeExpense({ id: 'exp_3', amount: 200 }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ minAmount: 50 }, dummyContext);
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(2);
  });

  it('filters by maxAmount', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', amount: 10 }),
      makeExpense({ id: 'exp_2', amount: 50 }),
      makeExpense({ id: 'exp_3', amount: 200 }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ maxAmount: 50 }, dummyContext);
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(2);
  });

  it('filters by search text in description', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', description: 'Coffee shop' }),
      makeExpense({ id: 'exp_2', description: 'Bus ticket' }),
      makeExpense({ id: 'exp_3', description: 'Iced coffee' }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ search: 'coffee' }, dummyContext);
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(2);
  });

  it('filters by search text in notes', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', description: 'Lunch', notes: 'business meeting' }),
      makeExpense({ id: 'exp_2', description: 'Dinner', notes: 'family' }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ search: 'business' }, dummyContext);
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(1);
  });

  it('filters by tags', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', tags: ['work', 'urgent'] }),
      makeExpense({ id: 'exp_2', tags: ['personal'] }),
      makeExpense({ id: 'exp_3' }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ tags: ['work'] }, dummyContext);
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(1);
  });

  it('applies limit to results', async () => {
    const expenses = Array.from({ length: 10 }, (_, i) =>
      makeExpense({ id: `exp_${i}`, description: `Item ${i}` })
    );
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ limit: 3 }, dummyContext);
    const data = parseContent(result.content);
    expect(data.count).toBe(3);
    expect(data.totalCount).toBe(10);
  });

  it('defaults limit to 50', async () => {
    const expenses = Array.from({ length: 60 }, (_, i) =>
      makeExpense({ id: `exp_${i}`, description: `Item ${i}` })
    );
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({}, dummyContext);
    const data = parseContent(result.content);
    expect(data.count).toBe(50);
    expect(data.totalCount).toBe(60);
  });

  it('sorts results by date descending', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', date: '2025-01-01' }),
      makeExpense({ id: 'exp_2', date: '2025-03-01' }),
      makeExpense({ id: 'exp_3', date: '2025-02-01' }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({}, dummyContext);
    const data = parseContent(result.content);
    const resultExpenses = data.expenses as ExpenseEntry[];
    expect(resultExpenses[0]!.date).toBe('2025-03-01');
    expect(resultExpenses[1]!.date).toBe('2025-02-01');
    expect(resultExpenses[2]!.date).toBe('2025-01-01');
  });

  it('includes aggregation summary when aggregate is true', async () => {
    const expenses = [
      makeExpense({
        id: 'exp_1',
        category: 'food',
        amount: 100,
        currency: 'TRY',
        date: '2025-01-10',
      }),
      makeExpense({
        id: 'exp_2',
        category: 'transport',
        amount: 50,
        currency: 'TRY',
        date: '2025-01-20',
      }),
      makeExpense({
        id: 'exp_3',
        category: 'food',
        amount: 80,
        currency: 'TRY',
        date: '2025-01-15',
      }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ aggregate: true }, dummyContext);
    const data = parseContent(result.content);
    const summary = data.summary as Record<string, unknown>;
    expect(summary).toBeDefined();
    expect(summary.grandTotalTRY).toBe(230);
    expect(summary.averageExpense).toBeCloseTo(230 / 3, 4);
    const totalByCategory = summary.totalByCategory as Record<string, number>;
    expect(totalByCategory.food).toBe(180);
    expect(totalByCategory.transport).toBe(50);
  });

  it('calculates grand total only for TRY expenses', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', amount: 100, currency: 'TRY' }),
      makeExpense({ id: 'exp_2', amount: 50, currency: 'USD' }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ aggregate: true }, dummyContext);
    const data = parseContent(result.content);
    const summary = data.summary as Record<string, unknown>;
    expect(summary.grandTotalTRY).toBe(100);
  });

  it('handles empty expense database', async () => {
    setupFs(makeDb([]));

    const result = await queryExpensesExecutor({}, dummyContext);
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(0);
    expect(data.count).toBe(0);
  });

  it('returns error when loading fails and saving is attempted', async () => {
    mockReadFile.mockRejectedValue(new Error('read fail'));
    // loadExpenseDb catches and returns fresh DB; query does not save.
    // So this should actually succeed with an empty DB.
    const result = await queryExpensesExecutor({}, dummyContext);
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(0);
  });

  it('includes date range in aggregation summary', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', date: '2025-01-01', currency: 'TRY' }),
      makeExpense({ id: 'exp_2', date: '2025-03-01', currency: 'TRY' }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor({ aggregate: true }, dummyContext);
    const data = parseContent(result.content);
    const summary = data.summary as Record<string, unknown>;
    const dateRange = summary.dateRange as Record<string, string | null>;
    expect(dateRange.latest).toBe('2025-03-01');
    expect(dateRange.earliest).toBe('2025-01-01');
  });

  it('handles aggregate with empty results', async () => {
    setupFs(makeDb([]));

    const result = await queryExpensesExecutor({ aggregate: true }, dummyContext);
    const data = parseContent(result.content);
    const summary = data.summary as Record<string, unknown>;
    expect(summary.grandTotalTRY).toBe(0);
    expect(summary.averageExpense).toBe(0);
    const dateRange = summary.dateRange as Record<string, string | null>;
    expect(dateRange.earliest).toBeNull();
    expect(dateRange.latest).toBeNull();
  });

  it('combines multiple filters', async () => {
    const expenses = [
      makeExpense({
        id: 'exp_1',
        date: '2025-01-10',
        category: 'food',
        amount: 50,
        description: 'Coffee',
      }),
      makeExpense({
        id: 'exp_2',
        date: '2025-01-20',
        category: 'food',
        amount: 200,
        description: 'Restaurant',
      }),
      makeExpense({
        id: 'exp_3',
        date: '2025-02-01',
        category: 'transport',
        amount: 30,
        description: 'Coffee bus',
      }),
    ];
    setupFs(makeDb(expenses));

    const result = await queryExpensesExecutor(
      { category: 'food', minAmount: 100, startDate: '2025-01-01', endDate: '2025-01-31' },
      dummyContext
    );
    const data = parseContent(result.content);
    expect(data.totalCount).toBe(1);
  });
});

// =============================================================================
// exportExpensesTool / exportExpensesExecutor
// =============================================================================

describe('exportExpensesTool definition', () => {
  it('has the correct name', () => {
    expect(exportExpensesTool.name).toBe('export_expenses');
  });

  it('has a description', () => {
    expect(exportExpensesTool.description).toBeTypeOf('string');
  });

  it('requires format and outputPath', () => {
    expect(exportExpensesTool.parameters.required).toEqual(['format', 'outputPath']);
  });
});

describe('exportExpensesExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports expenses to CSV format', async () => {
    const expenses = [makeExpense({ id: 'exp_1', amount: 100, description: 'Test' })];
    setupFs(makeDb(expenses));

    const result = await exportExpensesExecutor(
      { format: 'csv', outputPath: '/tmp/expenses.csv' },
      dummyContext
    );
    const data = parseContent(result.content);
    expect(data.success).toBe(true);
    expect(data.format).toBe('csv');
    expect(data.path).toBe('/tmp/expenses.csv');
    expect(data.expenseCount).toBe(1);
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('exports expenses to JSON format', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', amount: 50 }),
      makeExpense({ id: 'exp_2', amount: 75 }),
    ];
    setupFs(makeDb(expenses));

    const result = await exportExpensesExecutor(
      { format: 'json', outputPath: '/tmp/expenses.json' },
      dummyContext
    );
    const data = parseContent(result.content);
    expect(data.success).toBe(true);
    expect(data.format).toBe('json');
    expect(data.expenseCount).toBe(2);
  });

  it('filters by startDate for export', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', date: '2025-01-01' }),
      makeExpense({ id: 'exp_2', date: '2025-02-01' }),
    ];
    setupFs(makeDb(expenses));

    const result = await exportExpensesExecutor(
      { format: 'json', outputPath: '/tmp/out.json', startDate: '2025-01-15' },
      dummyContext
    );
    const data = parseContent(result.content);
    expect(data.expenseCount).toBe(1);
  });

  it('filters by endDate for export', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', date: '2025-01-01' }),
      makeExpense({ id: 'exp_2', date: '2025-03-01' }),
    ];
    setupFs(makeDb(expenses));

    const result = await exportExpensesExecutor(
      { format: 'json', outputPath: '/tmp/out.json', endDate: '2025-02-01' },
      dummyContext
    );
    const data = parseContent(result.content);
    expect(data.expenseCount).toBe(1);
  });

  it('filters by category for export', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', category: 'food' }),
      makeExpense({ id: 'exp_2', category: 'transport' }),
    ];
    setupFs(makeDb(expenses));

    const result = await exportExpensesExecutor(
      { format: 'json', outputPath: '/tmp/out.json', category: 'food' },
      dummyContext
    );
    const data = parseContent(result.content);
    expect(data.expenseCount).toBe(1);
  });

  it('creates directory for output path', async () => {
    setupFs(makeDb([]));

    await exportExpensesExecutor(
      { format: 'json', outputPath: '/some/deep/path/out.json' },
      dummyContext
    );
    expect(mockMkdir).toHaveBeenCalled();
  });

  it('returns error when write fails', async () => {
    setupFs(makeDb([]));
    mockWriteFile.mockRejectedValue(new Error('write error'));

    const result = await exportExpensesExecutor(
      { format: 'json', outputPath: '/tmp/out.json' },
      dummyContext
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('write error');
  });

  it('exports empty list when no expenses match', async () => {
    setupFs(makeDb([]));

    const result = await exportExpensesExecutor(
      { format: 'csv', outputPath: '/tmp/empty.csv' },
      dummyContext
    );
    const data = parseContent(result.content);
    expect(data.expenseCount).toBe(0);
  });

  it('CSV export includes proper headers and data', async () => {
    const expenses = [
      makeExpense({
        id: 'exp_1',
        date: '2025-01-15',
        amount: 100,
        currency: 'TRY',
        category: 'food',
        description: 'Test "quoted"',
        paymentMethod: 'cash',
        tags: ['tag1', 'tag2'],
        notes: 'Some notes',
      }),
    ];
    setupFs(makeDb(expenses));

    await exportExpensesExecutor({ format: 'csv', outputPath: '/tmp/expenses.csv' }, dummyContext);

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    expect(writtenContent).toContain('Date,Amount,Currency,Category,Description');
    expect(writtenContent).toContain('2025-01-15');
    expect(writtenContent).toContain('100');
    expect(writtenContent).toContain('tag1;tag2');
  });

  it('sorts exported expenses by date ascending', async () => {
    const expenses = [
      makeExpense({ id: 'exp_2', date: '2025-03-01' }),
      makeExpense({ id: 'exp_1', date: '2025-01-01' }),
    ];
    setupFs(makeDb(expenses));

    await exportExpensesExecutor({ format: 'json', outputPath: '/tmp/out.json' }, dummyContext);

    // The second writeFile call is from exportExpensesExecutor (first is from the mock setup).
    // Actually, the first writeFile call is the JSON export.
    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent) as ExpenseEntry[];
    expect(parsed[0]!.date).toBe('2025-01-01');
    expect(parsed[1]!.date).toBe('2025-03-01');
  });
});

// =============================================================================
// expenseSummaryTool / expenseSummaryExecutor
// =============================================================================

describe('expenseSummaryTool definition', () => {
  it('has the correct name', () => {
    expect(expenseSummaryTool.name).toBe('expense_summary');
  });

  it('has a description', () => {
    expect(expenseSummaryTool.description).toBeTypeOf('string');
  });

  it('has no required parameters', () => {
    expect(expenseSummaryTool.parameters.required).toEqual([]);
  });

  it('defines period, startDate, and endDate properties', () => {
    const props = expenseSummaryTool.parameters.properties;
    expect(props).toHaveProperty('period');
    expect(props).toHaveProperty('startDate');
    expect(props).toHaveProperty('endDate');
  });
});

describe('expenseSummaryExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns summary for this_month by default', async () => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const expenses = [
      makeExpense({ id: 'exp_1', date: `${thisMonth}-10`, amount: 100, currency: 'TRY' }),
      makeExpense({ id: 'exp_2', date: `${thisMonth}-20`, amount: 200, currency: 'TRY' }),
    ];
    setupFs(makeDb(expenses));

    const result = await expenseSummaryExecutor({}, dummyContext);
    const data = parseContent(result.content);
    expect(data.period).toBeDefined();
    const period = data.period as Record<string, string>;
    expect(period.name).toBe('this_month');
  });

  it('returns summary for custom date range', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', date: '2025-01-05', amount: 50, currency: 'TRY' }),
      makeExpense({ id: 'exp_2', date: '2025-01-20', amount: 100, currency: 'TRY' }),
      makeExpense({ id: 'exp_3', date: '2025-02-10', amount: 200, currency: 'TRY' }),
    ];
    setupFs(makeDb(expenses));

    const result = await expenseSummaryExecutor(
      { startDate: '2025-01-01', endDate: '2025-01-31' },
      dummyContext
    );
    const data = parseContent(result.content);
    const summary = data.summary as Record<string, unknown>;
    expect(summary.totalExpenses).toBe(2);
    expect(summary.grandTotalTRY).toBe(150);
  });

  it('calculates top categories sorted by amount', async () => {
    const expenses = [
      makeExpense({
        id: 'exp_1',
        category: 'food',
        amount: 500,
        currency: 'TRY',
        date: '2025-01-01',
      }),
      makeExpense({
        id: 'exp_2',
        category: 'transport',
        amount: 200,
        currency: 'TRY',
        date: '2025-01-02',
      }),
      makeExpense({
        id: 'exp_3',
        category: 'food',
        amount: 300,
        currency: 'TRY',
        date: '2025-01-03',
      }),
    ];
    setupFs(makeDb(expenses));

    const result = await expenseSummaryExecutor(
      { startDate: '2025-01-01', endDate: '2025-01-31' },
      dummyContext
    );
    const data = parseContent(result.content);
    const summary = data.summary as Record<string, unknown>;
    const topCategories = summary.topCategories as Array<Record<string, unknown>>;
    expect(topCategories[0]!.category).toBe('food');
    expect(topCategories[0]!.amount).toBe(800);
    expect(topCategories[1]!.category).toBe('transport');
  });

  it('calculates daily average', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', date: '2025-01-01', amount: 100, currency: 'TRY' }),
      makeExpense({ id: 'exp_2', date: '2025-01-02', amount: 200, currency: 'TRY' }),
    ];
    setupFs(makeDb(expenses));

    const result = await expenseSummaryExecutor(
      { startDate: '2025-01-01', endDate: '2025-01-31' },
      dummyContext
    );
    const data = parseContent(result.content);
    const summary = data.summary as Record<string, unknown>;
    // grandTotal = 300, 2 unique days, dailyAverage = 150
    expect(summary.dailyAverage).toBe(150);
  });

  it('returns biggest expenses', async () => {
    const expenses = [
      makeExpense({
        id: 'exp_1',
        amount: 50,
        description: 'Small',
        currency: 'TRY',
        date: '2025-01-01',
      }),
      makeExpense({
        id: 'exp_2',
        amount: 500,
        description: 'Big',
        currency: 'TRY',
        date: '2025-01-02',
      }),
      makeExpense({
        id: 'exp_3',
        amount: 200,
        description: 'Medium',
        currency: 'TRY',
        date: '2025-01-03',
      }),
    ];
    setupFs(makeDb(expenses));

    const result = await expenseSummaryExecutor(
      { startDate: '2025-01-01', endDate: '2025-01-31' },
      dummyContext
    );
    const data = parseContent(result.content);
    const summary = data.summary as Record<string, unknown>;
    const biggest = summary.biggestExpenses as Array<Record<string, unknown>>;
    expect(biggest[0]!.amount).toBe(500);
    expect(biggest[0]!.description).toBe('Big');
  });

  it('generates insights for non-empty period', async () => {
    const expenses = [
      makeExpense({
        id: 'exp_1',
        category: 'food',
        amount: 100,
        currency: 'TRY',
        date: '2025-01-01',
      }),
    ];
    setupFs(makeDb(expenses));

    const result = await expenseSummaryExecutor(
      { startDate: '2025-01-01', endDate: '2025-01-31' },
      dummyContext
    );
    const data = parseContent(result.content);
    const insights = data.insights as string[];
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.some((i) => i.includes('Top spending category'))).toBe(true);
  });

  it('generates insight for empty period', async () => {
    setupFs(makeDb([]));

    const result = await expenseSummaryExecutor(
      { startDate: '2025-01-01', endDate: '2025-01-31' },
      dummyContext
    );
    const data = parseContent(result.content);
    const insights = data.insights as string[];
    expect(insights).toContain('No expenses recorded in this period.');
  });

  it('handles "today" period', async () => {
    const today = new Date().toISOString().split('T')[0]!;
    const expenses = [makeExpense({ id: 'exp_1', date: today, amount: 42, currency: 'TRY' })];
    setupFs(makeDb(expenses));

    const result = await expenseSummaryExecutor({ period: 'today' }, dummyContext);
    const data = parseContent(result.content);
    const period = data.period as Record<string, string>;
    expect(period.name).toBe('today');
  });

  it('handles "all_time" period', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', date: '2020-01-01', amount: 10, currency: 'TRY' }),
    ];
    setupFs(makeDb(expenses));

    const result = await expenseSummaryExecutor({ period: 'all_time' }, dummyContext);
    const data = parseContent(result.content);
    const period = data.period as Record<string, string>;
    expect(period.name).toBe('all_time');
    expect(period.startDate).toBe('1970-01-01');
  });

  it('returns error when expense data causes runtime error', async () => {
    // Return a DB where expenses is not iterable to trigger error in filter
    const brokenDb = { version: '1.0', lastUpdated: '', expenses: null, categories: {} };
    mockReadFile.mockResolvedValue(JSON.stringify(brokenDb));

    const result = await expenseSummaryExecutor({}, dummyContext);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error generating summary');
  });

  it('handles "this_week" period', async () => {
    setupFs(makeDb([]));
    const result = await expenseSummaryExecutor({ period: 'this_week' }, dummyContext);
    expect(result.isError).toBeUndefined();
    const data = parseContent(result.content);
    const period = data.period as Record<string, string>;
    expect(period.name).toBe('this_week');
  });

  it('handles "last_month" period', async () => {
    setupFs(makeDb([]));
    const result = await expenseSummaryExecutor({ period: 'last_month' }, dummyContext);
    expect(result.isError).toBeUndefined();
    const data = parseContent(result.content);
    const period = data.period as Record<string, string>;
    expect(period.name).toBe('last_month');
  });

  it('handles "this_year" period', async () => {
    setupFs(makeDb([]));
    const result = await expenseSummaryExecutor({ period: 'this_year' }, dummyContext);
    expect(result.isError).toBeUndefined();
    const data = parseContent(result.content);
    const period = data.period as Record<string, string>;
    expect(period.name).toBe('this_year');
    expect(period.startDate).toBe(`${new Date().getFullYear()}-01-01`);
  });

  it('rounds grand total and daily average to 2 decimal places', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1', date: '2025-01-01', amount: 33.333, currency: 'TRY' }),
      makeExpense({ id: 'exp_2', date: '2025-01-02', amount: 33.333, currency: 'TRY' }),
      makeExpense({ id: 'exp_3', date: '2025-01-03', amount: 33.334, currency: 'TRY' }),
    ];
    setupFs(makeDb(expenses));

    const result = await expenseSummaryExecutor(
      { startDate: '2025-01-01', endDate: '2025-01-31' },
      dummyContext
    );
    const data = parseContent(result.content);
    const summary = data.summary as Record<string, number>;
    // Math.round(100 * 100) / 100 = 100
    expect(summary.grandTotalTRY).toBe(100);
    // dailyAverage = 100 / 3 ≈ 33.33
    expect(summary.dailyAverage).toBe(33.33);
  });
});

// =============================================================================
// deleteExpenseTool / deleteExpenseExecutor
// =============================================================================

describe('deleteExpenseTool definition', () => {
  it('has the correct name', () => {
    expect(deleteExpenseTool.name).toBe('delete_expense');
  });

  it('has a description', () => {
    expect(deleteExpenseTool.description).toBeTypeOf('string');
  });

  it('requires expenseId', () => {
    expect(deleteExpenseTool.parameters.required).toEqual(['expenseId']);
  });
});

describe('deleteExpenseExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes an existing expense by ID', async () => {
    const expenses = [
      makeExpense({ id: 'exp_to_delete', description: 'To Delete', amount: 99, currency: 'EUR' }),
      makeExpense({ id: 'exp_keep', description: 'Keep' }),
    ];
    setupFs(makeDb(expenses));

    const result = await deleteExpenseExecutor({ expenseId: 'exp_to_delete' }, dummyContext);
    const data = parseContent(result.content);
    expect(data.success).toBe(true);
    expect(data.message).toContain('To Delete');
    expect(data.message).toContain('99');
    expect(data.message).toContain('EUR');
  });

  it('saves the database after deletion', async () => {
    const expenses = [makeExpense({ id: 'exp_del' })];
    setupFs(makeDb(expenses));

    await deleteExpenseExecutor({ expenseId: 'exp_del' }, dummyContext);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('returns error when expense ID is not found', async () => {
    setupFs(makeDb([]));

    const result = await deleteExpenseExecutor({ expenseId: 'nonexistent' }, dummyContext);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('nonexistent');
  });

  it('returns the deleted expense in the response', async () => {
    const expense = makeExpense({
      id: 'exp_del_info',
      description: 'Deleted item',
      amount: 42,
      currency: 'USD',
    });
    setupFs(makeDb([expense]));

    const result = await deleteExpenseExecutor({ expenseId: 'exp_del_info' }, dummyContext);
    const data = parseContent(result.content);
    const deleted = data.deleted as ExpenseEntry;
    expect(deleted.id).toBe('exp_del_info');
    expect(deleted.description).toBe('Deleted item');
    expect(deleted.amount).toBe(42);
  });

  it('returns error when save fails', async () => {
    const expenses = [makeExpense({ id: 'exp_fail' })];
    setupFs(makeDb(expenses));
    mockWriteFile.mockRejectedValue(new Error('permission denied'));

    const result = await deleteExpenseExecutor({ expenseId: 'exp_fail' }, dummyContext);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('permission denied');
  });

  it('only removes the targeted expense from the database', async () => {
    const expenses = [
      makeExpense({ id: 'exp_1' }),
      makeExpense({ id: 'exp_2' }),
      makeExpense({ id: 'exp_3' }),
    ];
    setupFs(makeDb(expenses));

    await deleteExpenseExecutor({ expenseId: 'exp_2' }, dummyContext);

    // Check what was written back - should have 2 expenses
    const writtenJson = mockWriteFile.mock.calls[0]![1] as string;
    const writtenDb = JSON.parse(writtenJson) as ExpenseDatabase;
    expect(writtenDb.expenses).toHaveLength(2);
    expect(writtenDb.expenses.map((e) => e.id)).toEqual(['exp_1', 'exp_3']);
  });
});

// =============================================================================
// EXPENSE_TRACKER_TOOLS export
// =============================================================================

describe('EXPENSE_TRACKER_TOOLS export', () => {
  it('exports a non-empty array of tool pairs', () => {
    expect(EXPENSE_TRACKER_TOOLS.length).toBeGreaterThan(0);
  });

  it('contains exactly 7 tools', () => {
    expect(EXPENSE_TRACKER_TOOLS).toHaveLength(7);
  });

  it('each entry has a definition and executor', () => {
    for (const tool of EXPENSE_TRACKER_TOOLS) {
      expect(tool.definition).toBeDefined();
      expect(tool.definition.name).toBeTypeOf('string');
      expect(tool.executor).toBeTypeOf('function');
    }
  });

  it('all tool names are unique', () => {
    const names = EXPENSE_TRACKER_TOOLS.map((t) => t.definition.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('contains all expected tool names', () => {
    const names = EXPENSE_TRACKER_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('add_expense');
    expect(names).toContain('batch_add_expenses');
    expect(names).toContain('parse_receipt');
    expect(names).toContain('query_expenses');
    expect(names).toContain('export_expenses');
    expect(names).toContain('expense_summary');
    expect(names).toContain('delete_expense');
  });

  it('maps the correct executors to definitions', () => {
    const toolMap = new Map(EXPENSE_TRACKER_TOOLS.map((t) => [t.definition.name, t.executor]));
    expect(toolMap.get('add_expense')).toBe(addExpenseExecutor);
    expect(toolMap.get('batch_add_expenses')).toBe(batchAddExpensesExecutor);
    expect(toolMap.get('parse_receipt')).toBe(parseReceiptExecutor);
    expect(toolMap.get('query_expenses')).toBe(queryExpensesExecutor);
    expect(toolMap.get('export_expenses')).toBe(exportExpensesExecutor);
    expect(toolMap.get('expense_summary')).toBe(expenseSummaryExecutor);
    expect(toolMap.get('delete_expense')).toBe(deleteExpenseExecutor);
  });
});

// =============================================================================
// Edge cases and database initialization
// =============================================================================

describe('database initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new database when file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);

    const result = await addExpenseExecutor(
      { amount: 10, category: 'other', description: 'First expense' },
      dummyContext
    );
    const data = parseContent(result.content);
    expect(data.success).toBe(true);
    expect(data.totalExpenses).toBe(1);
  });

  it('creates a new database when file contains invalid JSON', async () => {
    mockReadFile.mockResolvedValue('not valid json');
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);

    const result = await addExpenseExecutor(
      { amount: 10, category: 'other', description: 'After corrupt' },
      dummyContext
    );
    // JSON.parse throws SyntaxError, loadExpenseDb catches and returns fresh DB
    const data = parseContent(result.content);
    expect(data.success).toBe(true);
    expect(data.totalExpenses).toBe(1);
  });

  it('ensures directory exists when saving', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);

    await addExpenseExecutor(
      { amount: 10, category: 'other', description: 'Dir test' },
      dummyContext
    );
    expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });
});

describe('CSV export edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('escapes double quotes in description for CSV', async () => {
    const expenses = [makeExpense({ id: 'exp_q', description: 'Item "A"' })];
    setupFs(makeDb(expenses));

    await exportExpensesExecutor({ format: 'csv', outputPath: '/tmp/test.csv' }, dummyContext);

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    // Double quotes should be escaped as ""
    expect(writtenContent).toContain('""A""');
  });

  it('escapes double quotes in notes for CSV', async () => {
    const expenses = [makeExpense({ id: 'exp_n', notes: 'Said "hello"' })];
    setupFs(makeDb(expenses));

    await exportExpensesExecutor({ format: 'csv', outputPath: '/tmp/test.csv' }, dummyContext);

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    expect(writtenContent).toContain('""hello""');
  });

  it('handles expenses with no optional fields in CSV', async () => {
    const expenses = [makeExpense({ id: 'exp_min' })];
    setupFs(makeDb(expenses));

    await exportExpensesExecutor({ format: 'csv', outputPath: '/tmp/test.csv' }, dummyContext);

    expect(mockWriteFile).toHaveBeenCalled();
    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    // tags and paymentMethod should be empty
    expect(writtenContent).toContain('manual');
  });

  it('joins tags with semicolons in CSV', async () => {
    const expenses = [makeExpense({ id: 'exp_tags', tags: ['a', 'b', 'c'] })];
    setupFs(makeDb(expenses));

    await exportExpensesExecutor({ format: 'csv', outputPath: '/tmp/test.csv' }, dummyContext);

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    expect(writtenContent).toContain('a;b;c');
  });
});
