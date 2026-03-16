/**
 * Expenses API Routes
 *
 * REST API for expense tracking and management.
 * Backed by PostgreSQL via ExpensesRepository (migrated from file-based JSON).
 */

import { Hono } from 'hono';
import {
  apiResponse,
  apiError,
  notFoundError,
  validateQueryEnum,
  ERROR_CODES,
  getErrorMessage,
  parseJsonBody,
  getUserId,
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

// =============================================================================
// Routes
// =============================================================================

export const expensesRoutes = new Hono();

/**
 * GET /expenses - List expenses with optional filtering
 */
expensesRoutes.get('/', pagination({ defaultLimit: 100, maxLimit: 1000 }), async (c) => {
  try {
    const userId = getUserId(c);
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
      categories: Object.fromEntries(
        VALID_CATEGORIES.map((cat) => [cat, { color: CATEGORY_COLORS[cat] }])
      ),
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
    const userId = getUserId(c);
    const repo = new ExpensesRepository(userId);

    const period = c.req.query('period') ?? 'this_month';
    const customStartDate = c.req.query('startDate');
    const customEndDate = c.req.query('endDate');

    const now = new Date();
    let startDate: string | undefined;
    let endDate: string | undefined;

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
          const ws = new Date(now);
          ws.setDate(now.getDate() - now.getDay());
          startDate = ws.toISOString().split('T')[0]!;
          break;
        }
        case 'this_month':
          startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
          break;
        case 'last_month': {
          const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const lme = new Date(now.getFullYear(), now.getMonth(), 0);
          startDate = lm.toISOString().split('T')[0]!;
          endDate = lme.toISOString().split('T')[0]!;
          break;
        }
        case 'this_year':
          startDate = `${now.getFullYear()}-01-01`;
          break;
        case 'all_time':
        default:
          startDate = undefined;
          endDate = undefined;
      }
    }

    const summary = await repo.getSummary(startDate, endDate);

    return apiResponse(c, {
      period,
      startDate,
      endDate,
      ...summary,
      categories: CATEGORY_COLORS,
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
    const userId = getUserId(c);
    const repo = new ExpensesRepository(userId);
    const year = c.req.query('year') ?? String(new Date().getFullYear());

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const dateFrom = `${year}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(Number(year), m, 0).getDate();
      const dateTo = `${year}-${String(m).padStart(2, '0')}-${lastDay}`;
      const summary = await repo.getSummary(dateFrom, dateTo);
      months.push({
        month: m,
        year: Number(year),
        ...summary,
      });
    }

    return apiResponse(c, { year: Number(year), months });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(error) }, 500);
  }
});

/**
 * GET /expenses/:id - Get single expense
 */
expensesRoutes.get('/:id', async (c) => {
  try {
    const userId = getUserId(c);
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
    const userId = getUserId(c);
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

    const expense = await repo.create({
      date: (date as string) ?? new Date().toISOString().split('T')[0]!,
      amount: Number(amount),
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
    const userId = getUserId(c);
    const repo = new ExpensesRepository(userId);
    const body = await parseJsonBody(c);
    if (!body)
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' }, 400);

    const updated = await repo.update(c.req.param('id'), body as Record<string, unknown>);
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
    const userId = getUserId(c);
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
