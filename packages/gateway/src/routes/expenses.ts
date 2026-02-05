/**
 * Expenses API Routes
 *
 * REST API for expense tracking and management.
 */

import { Hono } from 'hono';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { apiResponse, apiError, ERROR_CODES, getIntParam } from './helpers.js';

// =============================================================================
// Types
// =============================================================================

export type ExpenseCategory =
  | 'food'
  | 'transport'
  | 'utilities'
  | 'entertainment'
  | 'shopping'
  | 'health'
  | 'education'
  | 'travel'
  | 'subscription'
  | 'housing'
  | 'other';

export interface ExpenseEntry {
  id: string;
  date: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  description: string;
  paymentMethod?: string;
  tags?: string[];
  source: string;
  receiptImage?: string;
  createdAt: string;
  notes?: string;
}

export interface ExpenseDatabase {
  version: string;
  lastUpdated: string;
  expenses: ExpenseEntry[];
  categories: Record<ExpenseCategory, { budget?: number; color?: string }>;
}

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_EXPENSE_DB_PATH =
  process.env.EXPENSE_DB_PATH ??
  path.join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.ownpilot', 'expenses.json');

const DEFAULT_CATEGORIES: ExpenseDatabase['categories'] = {
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

// =============================================================================
// Database Operations
// =============================================================================

async function loadExpenseDb(): Promise<ExpenseDatabase> {
  try {
    const content = await fs.readFile(DEFAULT_EXPENSE_DB_PATH, 'utf-8');
    return JSON.parse(content) as ExpenseDatabase;
  } catch {
    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      expenses: [],
      categories: DEFAULT_CATEGORIES,
    };
  }
}

async function saveExpenseDb(db: ExpenseDatabase): Promise<void> {
  db.lastUpdated = new Date().toISOString();
  await fs.mkdir(path.dirname(DEFAULT_EXPENSE_DB_PATH), { recursive: true });
  await fs.writeFile(DEFAULT_EXPENSE_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

function generateExpenseId(): string {
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Routes
// =============================================================================

/** Sanitize user-supplied IDs for safe interpolation in error messages */
const sanitizeId = (id: string) => id.replace(/[^\w-]/g, '').slice(0, 100);

export const expensesRoutes = new Hono();

/**
 * GET /api/v1/expenses - List all expenses with optional filtering
 */
expensesRoutes.get('/', async (c) => {
  const db = await loadExpenseDb();

  // Query params
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const category = c.req.query('category') as ExpenseCategory | undefined;
  const search = c.req.query('search');
  const limit = getIntParam(c, 'limit', 100, 1, 1000);
  const offset = getIntParam(c, 'offset', 0, 0);

  let expenses = [...db.expenses];

  // Apply filters
  if (startDate) {
    expenses = expenses.filter((e) => e.date >= startDate);
  }
  if (endDate) {
    expenses = expenses.filter((e) => e.date <= endDate);
  }
  if (category) {
    expenses = expenses.filter((e) => e.category === category);
  }
  if (search) {
    const searchLower = search.toLowerCase();
    expenses = expenses.filter(
      (e) =>
        e.description.toLowerCase().includes(searchLower) ||
        e.notes?.toLowerCase().includes(searchLower)
    );
  }

  // Sort by date descending
  expenses.sort((a, b) => b.date.localeCompare(a.date));

  // Pagination
  const total = expenses.length;
  const paginatedExpenses = expenses.slice(offset, offset + limit);

  return apiResponse(c, {
      expenses: paginatedExpenses,
      total,
      limit,
      offset,
      categories: db.categories,
    });
});

/**
 * GET /api/v1/expenses/summary - Get expense summary for a period
 */
expensesRoutes.get('/summary', async (c) => {
  const db = await loadExpenseDb();

  const period = c.req.query('period') ?? 'this_month';
  const customStartDate = c.req.query('startDate');
  const customEndDate = c.req.query('endDate');

  // Calculate date range
  const now = new Date();
  let startDate: string;
  let endDate: string;

  if (customStartDate && customEndDate) {
    startDate = customStartDate;
    endDate = customEndDate;
  } else {
    endDate = now.toISOString().split('T')[0]!;

    switch (period) {
      case 'today':
        startDate = endDate;
        break;
      case 'this_week': {
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        startDate = weekStart.toISOString().split('T')[0]!;
        break;
      }
      case 'this_month':
        startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        break;
      case 'last_month': {
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
        startDate = lastMonth.toISOString().split('T')[0]!;
        endDate = lastMonthEnd.toISOString().split('T')[0]!;
        break;
      }
      case 'this_year':
        startDate = `${now.getFullYear()}-01-01`;
        break;
      case 'all_time':
      default:
        startDate = '1970-01-01';
    }
  }

  // Filter expenses
  const expenses = db.expenses.filter((e) => e.date >= startDate && e.date <= endDate);

  // Calculate summary
  const totalByCategory: Record<string, number> = {};
  const totalByCurrency: Record<string, number> = {};
  let grandTotal = 0;

  for (const e of expenses) {
    totalByCategory[e.category] = (totalByCategory[e.category] ?? 0) + e.amount;
    totalByCurrency[e.currency] = (totalByCurrency[e.currency] ?? 0) + e.amount;
    grandTotal += e.amount;
  }

  // Top categories
  const topCategories = Object.entries(totalByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: grandTotal > 0 ? Math.round((amount / grandTotal) * 100) : 0,
      color: db.categories[category as ExpenseCategory]?.color ?? '#AEB6BF',
    }));

  // Biggest expenses
  const biggestExpenses = [...expenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Daily average
  const uniqueDays = new Set(expenses.map((e) => e.date)).size || 1;
  const dailyAverage = grandTotal / uniqueDays;

  return apiResponse(c, {
      period: {
        name: period,
        startDate,
        endDate,
      },
      summary: {
        totalExpenses: expenses.length,
        grandTotal: Math.round(grandTotal * 100) / 100,
        dailyAverage: Math.round(dailyAverage * 100) / 100,
        totalByCurrency,
        totalByCategory,
        topCategories,
        biggestExpenses,
      },
      categories: db.categories,
    });
});

/**
 * GET /api/v1/expenses/monthly - Get expenses grouped by month
 */
expensesRoutes.get('/monthly', async (c) => {
  const db = await loadExpenseDb();
  const year = getIntParam(c, 'year', new Date().getFullYear(), 2000, 2100);

  // Filter expenses for the year
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const expenses = db.expenses.filter((e) => e.date >= yearStart && e.date <= yearEnd);

  // Group by month
  const monthlyData: Record<
    string,
    { total: number; count: number; byCategory: Record<string, number> }
  > = {};

  for (let m = 1; m <= 12; m++) {
    const monthKey = String(m).padStart(2, '0');
    monthlyData[monthKey] = { total: 0, count: 0, byCategory: {} };
  }

  for (const e of expenses) {
    const month = e.date.slice(5, 7);
    const data = monthlyData[month];
    if (data) {
      data.total += e.amount;
      data.count += 1;
      data.byCategory[e.category] = (data.byCategory[e.category] ?? 0) + e.amount;
    }
  }

  // Format for chart
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const chartData = Object.entries(monthlyData).map(([monthNum, data]) => ({
    month: months[parseInt(monthNum, 10) - 1],
    monthNum,
    total: Math.round(data.total * 100) / 100,
    count: data.count,
    byCategory: data.byCategory,
  }));

  const yearTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

  return apiResponse(c, {
      year,
      months: chartData,
      yearTotal: Math.round(yearTotal * 100) / 100,
      expenseCount: expenses.length,
      categories: db.categories,
    });
});

/**
 * POST /api/v1/expenses - Add a new expense
 */
expensesRoutes.post('/', async (c) => {
  const rawBody = await c.req.json();
  const { validateBody, createExpenseSchema } = await import('../middleware/validation.js');
  const body = validateBody(createExpenseSchema, rawBody) as {
    date?: string;
    amount: number;
    currency?: string;
    category: ExpenseCategory;
    description: string;
    paymentMethod?: string;
    tags?: string[];
    notes?: string;
  };

  const db = await loadExpenseDb();

  const expense: ExpenseEntry = {
    id: generateExpenseId(),
    date: body.date ?? new Date().toISOString().split('T')[0]!,
    amount: body.amount,
    currency: body.currency ?? 'TRY',
    category: body.category,
    description: body.description,
    paymentMethod: body.paymentMethod,
    tags: body.tags,
    source: 'web',
    createdAt: new Date().toISOString(),
    notes: body.notes,
  };

  db.expenses.push(expense);
  await saveExpenseDb(db);

  return apiResponse(c, expense, 201);
});

/**
 * PUT /api/v1/expenses/:id - Update an expense
 */
expensesRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  const rawBody = await c.req.json();
  const { validateBody, updateExpenseSchema } = await import('../middleware/validation.js');
  const body = validateBody(updateExpenseSchema, rawBody) as Partial<ExpenseEntry>;

  const db = await loadExpenseDb();
  const index = db.expenses.findIndex((e) => e.id === id);

  if (index === -1) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Expense not found: ${sanitizeId(id)}` }, 404);
  }

  const existing = db.expenses[index]!;
  const updated: ExpenseEntry = {
    ...existing,
    ...body,
    id: existing.id,
    createdAt: existing.createdAt,
  };

  db.expenses[index] = updated;
  await saveExpenseDb(db);

  return apiResponse(c, updated);
});

/**
 * DELETE /api/v1/expenses/:id - Delete an expense
 */
expensesRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const db = await loadExpenseDb();
  const index = db.expenses.findIndex((e) => e.id === id);

  if (index === -1) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Expense not found: ${sanitizeId(id)}` }, 404);
  }

  const deleted = db.expenses.splice(index, 1)[0];
  await saveExpenseDb(db);

  return apiResponse(c, { deleted });
});
