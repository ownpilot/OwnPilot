/**
 * Expenses API Routes
 *
 * REST API for expense tracking and management.
 * Backed by PostgreSQL via ExpensesRepository (migrated from file-based JSON).
 */

import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { Hono } from 'hono';
import {
  apiResponse,
  apiError,
  notFoundError,
  validateQueryEnum,
  ERROR_CODES,
  getErrorMessage,
  parseJsonBody,
} from './helpers.js';
import { wsGateway } from '../ws/server.js';
import { pagination } from '../middleware/pagination.js';
import { ExpensesRepository, type ExpenseCategory } from '../db/repositories/expenses.js';

// =============================================================================
// Constants
// =============================================================================

const VALID_CATEGORIES: readonly ExpenseCategory[] = [
  'food',
  'transport',
  'utilities',
  'entertainment',
  'shopping',
  'health',
  'education',
  'travel',
  'subscription',
  'housing',
  'other',
];

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i).toLocaleString('en-US', { month: 'long' })
);

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  food: '#FF6B6B',
  transport: '#4ECDC4',
  utilities: '#45B7D1',
  entertainment: '#96CEB4',
  shopping: '#FFEAA7',
  health: '#DDA0DD',
  education: '#98D8C8',
  travel: '#F7DC6F',
  subscription: '#BB8FCE',
  housing: '#85C1E9',
  other: '#AEB6BF',
};

const CATEGORY_METADATA: Record<ExpenseCategory, { color: string }> = Object.fromEntries(
  VALID_CATEGORIES.map((cat) => [cat, { color: CATEGORY_COLORS[cat] }])
) as Record<ExpenseCategory, { color: string }>;

function computePeriodDates(
  period: string,
  customStartDate?: string,
  customEndDate?: string
): { startDate: string | undefined; endDate: string | undefined } {
  if (customStartDate && customEndDate) {
    return { startDate: customStartDate, endDate: customEndDate };
  }

  const now = new Date();
  const endDate = now.toISOString().split('T')[0];

  switch (period) {
    case 'today':
      return { startDate: endDate, endDate };
    case 'this_week': {
      const ws = new Date(now);
      ws.setDate(now.getDate() - now.getDay());
      return { startDate: ws.toISOString().split('T')[0], endDate };
    }
    case 'this_month':
      return {
        startDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
        endDate,
      };
    case 'last_month': {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lme = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        startDate: lm.toISOString().split('T')[0],
        endDate: lme.toISOString().split('T')[0],
      };
    }
    case 'this_year':
      return { startDate: `${now.getFullYear()}-01-01`, endDate };
    case 'all_time':
    default:
      return { startDate: undefined, endDate: undefined };
  }
}

// =============================================================================
// Routes
// =============================================================================

export const expensesRoutes = new Hono();

/**
 * GET /expenses - List expenses with optional filtering
 */
expensesRoutes.get('/', pagination({ defaultLimit: 100, maxLimit: 1000 }), async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const repo = new ExpensesRepository(userId);
    const { limit, offset } = c.get('pagination')!;

    const category = validateQueryEnum(c.req.query('category'), VALID_CATEGORIES);

    const expenses = await repo.list({
      dateFrom: c.req.query('startDate') ?? undefined,
      dateTo: c.req.query('endDate') ?? undefined,
      category: category ?? undefined,
      search: c.req.query('search') ?? undefined,
      limit,
      offset,
    });

    const total = await repo.count({
      dateFrom: c.req.query('startDate') ?? undefined,
      dateTo: c.req.query('endDate') ?? undefined,
      category: category ?? undefined,
    });

    return apiResponse(c, {
      expenses,
      total,
      limit,
      offset,
      categories: CATEGORY_METADATA,
    });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(error) }, 500);
  }
});

/**
 * GET /expenses/summary - Get expense summary for a period
 */
expensesRoutes.get('/summary', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const repo = new ExpensesRepository(userId);

    const period = c.req.query('period') ?? 'this_month';
    const customStartDate = c.req.query('startDate');
    const customEndDate = c.req.query('endDate');

    const { startDate, endDate } = computePeriodDates(period, customStartDate, customEndDate);

    const summary = await repo.getSummary(startDate, endDate);

    // Compute top categories
    const topCategories = Object.entries(summary.byCategory)
      .map(([category, data]) => ({
        category,
        amount: data.amount,
        count: data.count,
        percentage: summary.totalAmount > 0 ? (data.amount / summary.totalAmount) * 100 : 0,
        color: CATEGORY_COLORS[category as ExpenseCategory] ?? '#AEB6BF',
      }))
      .sort((a, b) => b.amount - a.amount);

    // Compute daily average
    let dailyAverage = 0;
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const dayCount =
        Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))) + 1;
      dailyAverage = summary.totalAmount / dayCount;
    }

    return apiResponse(c, {
      period,
      startDate,
      endDate,
      summary: {
        totalExpenses: summary.count,
        grandTotal: summary.totalAmount,
        dailyAverage,
        totalByCurrency: summary.byCurrency,
        totalByCategory: Object.fromEntries(
          Object.entries(summary.byCategory).map(([k, v]) => [k, v.amount])
        ),
        topCategories,
        biggestExpenses: [],
      },
      categories: CATEGORY_METADATA,
    });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(error) }, 500);
  }
});

/**
 * GET /expenses/monthly - Get monthly aggregated expenses
 */
expensesRoutes.get('/monthly', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const repo = new ExpensesRepository(userId);
    const year = c.req.query('year') ?? String(new Date().getFullYear());

    const months = await Promise.all(
      Array.from({ length: 12 }, async (_, m) => {
        const monthNum = m + 1;
        const dateFrom = `${year}-${String(monthNum).padStart(2, '0')}-01`;
        const lastDay = new Date(Number(year), monthNum, 0).getDate();
        const dateTo = `${year}-${String(monthNum).padStart(2, '0')}-${lastDay}`;
        const summary = await repo.getSummary(dateFrom, dateTo);
        return {
          month: MONTH_NAMES[m],
          monthNum: String(monthNum),
          total: summary.totalAmount,
          count: summary.count,
          byCategory: Object.fromEntries(
            Object.entries(summary.byCategory).map(([category, data]) => [category, data.amount])
          ),
          year: Number(year),
        };
      })
    );

    return apiResponse(c, {
      year: Number(year),
      months,
      yearTotal: months.reduce((s, m) => s + m.total, 0),
      expenseCount: months.reduce((s, m) => s + m.count, 0),
      categories: CATEGORY_METADATA,
    });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(error) }, 500);
  }
});

/**
 * GET /expenses/:id - Get single expense
 */
expensesRoutes.get('/:id', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const repo = new ExpensesRepository(userId);
    const expense = await repo.get(c.req.param('id'));
    if (!expense) return notFoundError(c, 'Expense', c.req.param('id'));
    return apiResponse(c, expense);
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(error) }, 500);
  }
});

/**
 * POST /expenses - Create expense
 */
expensesRoutes.post('/', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const repo = new ExpensesRepository(userId);
    const body = await parseJsonBody(c);
    if (!body)
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);

    const { date, amount, currency, category, description, paymentMethod, tags, notes } =
      body as Record<string, unknown>;

    if (!description || !amount) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'amount and description are required' },
        400
      );
    }

    // Reject NaN / Infinity / negative amounts — `Number('abc')` is NaN and a
    // negative spend corrupts budget/aggregation math downstream.
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'amount must be a finite, non-negative number',
        },
        400
      );
    }

    const expense = await repo.create({
      date: (date as string) ?? new Date().toISOString().split('T')[0]!,
      amount: amountNum,
      currency: (currency as string) ?? 'TRY',
      category: (category as string) ?? 'other',
      description: description as string,
      paymentMethod: paymentMethod as string | undefined,
      tags: tags as string[] | undefined,
      notes: notes as string | undefined,
      source: 'web',
    });

    wsGateway.broadcast(
      'data:changed' as never,
      { entity: 'expense', action: 'created', id: expense.id } as never
    );
    return apiResponse(c, expense, 201);
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(error) }, 500);
  }
});

/**
 * PUT /expenses/:id - Update expense
 */
expensesRoutes.put('/:id', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const repo = new ExpensesRepository(userId);
    const body = await parseJsonBody(c);
    if (!body)
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);

    // Validate amount on update too (when present) — same rule as create.
    const updateFields = body as Record<string, unknown>;
    if (updateFields.amount !== undefined) {
      const amountNum = Number(updateFields.amount);
      if (!Number.isFinite(amountNum) || amountNum < 0) {
        return apiError(
          c,
          {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'amount must be a finite, non-negative number',
          },
          400
        );
      }
      updateFields.amount = amountNum;
    }

    const updated = await repo.update(c.req.param('id'), updateFields);
    if (!updated) return notFoundError(c, 'Expense', c.req.param('id'));

    wsGateway.broadcast(
      'data:changed' as never,
      { entity: 'expense', action: 'updated', id: updated.id } as never
    );
    return apiResponse(c, updated);
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(error) }, 500);
  }
});

/**
 * DELETE /expenses/:id - Delete expense
 */
expensesRoutes.delete('/:id', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    const repo = new ExpensesRepository(userId);
    const id = c.req.param('id');
    const deleted = await repo.delete(id);
    if (!deleted) return notFoundError(c, 'Expense', id);

    wsGateway.broadcast(
      'data:changed' as never,
      { entity: 'expense', action: 'deleted', id } as never
    );
    return apiResponse(c, { message: 'Expense deleted' });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(error) }, 500);
  }
});
