/**
 * Expenses Repository
 *
 * PostgreSQL-backed expense tracking. Replaces the file-based JSON storage
 * that was in core/agent/tools/expense-tracker.ts.
 */

import { BaseRepository } from './base.js';
import { generateId } from '@ownpilot/core';

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

export interface Expense {
  id: string;
  userId: string;
  date: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  description: string;
  paymentMethod?: string;
  tags: string[];
  source: string;
  receiptImage?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExpenseInput {
  date: string;
  amount: number;
  currency?: string;
  category?: string;
  description: string;
  paymentMethod?: string;
  tags?: string[];
  source?: string;
  receiptImage?: string;
  notes?: string;
}

export interface UpdateExpenseInput {
  date?: string;
  amount?: number;
  currency?: string;
  category?: string;
  description?: string;
  paymentMethod?: string;
  tags?: string[];
  notes?: string;
}

export interface ExpenseQuery {
  dateFrom?: string;
  dateTo?: string;
  category?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

// =============================================================================
// Row Types
// =============================================================================

interface ExpenseRow {
  id: string;
  user_id: string;
  date: string;
  amount: string;
  currency: string;
  category: string;
  description: string;
  payment_method: string | null;
  tags: string;
  source: string;
  receipt_image: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToExpense(row: ExpenseRow): Expense {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags ?? '[]');
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    amount: parseFloat(row.amount),
    currency: row.currency,
    category: row.category as ExpenseCategory,
    description: row.description,
    paymentMethod: row.payment_method ?? undefined,
    tags,
    source: row.source,
    receiptImage: row.receipt_image ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// =============================================================================
// Repository
// =============================================================================

export class ExpensesRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async create(input: CreateExpenseInput): Promise<Expense> {
    const id = generateId('exp');
    const row = await this.queryOne<ExpenseRow>(
      `INSERT INTO expenses (id, user_id, date, amount, currency, category, description, payment_method, tags, source, receipt_image, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        id,
        this.userId,
        input.date,
        input.amount,
        input.currency ?? 'TRY',
        input.category ?? 'other',
        input.description,
        input.paymentMethod ?? null,
        JSON.stringify(input.tags ?? []),
        input.source ?? 'manual',
        input.receiptImage ?? null,
        input.notes ?? null,
      ]
    );
    return rowToExpense(row!);
  }

  async get(id: string): Promise<Expense | null> {
    const row = await this.queryOne<ExpenseRow>(
      `SELECT * FROM expenses WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return row ? rowToExpense(row) : null;
  }

  async update(id: string, input: UpdateExpenseInput): Promise<Expense | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (input.date !== undefined) {
      fields.push(`date = $${paramIdx++}`);
      values.push(input.date);
    }
    if (input.amount !== undefined) {
      fields.push(`amount = $${paramIdx++}`);
      values.push(input.amount);
    }
    if (input.currency !== undefined) {
      fields.push(`currency = $${paramIdx++}`);
      values.push(input.currency);
    }
    if (input.category !== undefined) {
      fields.push(`category = $${paramIdx++}`);
      values.push(input.category);
    }
    if (input.description !== undefined) {
      fields.push(`description = $${paramIdx++}`);
      values.push(input.description);
    }
    if (input.paymentMethod !== undefined) {
      fields.push(`payment_method = $${paramIdx++}`);
      values.push(input.paymentMethod);
    }
    if (input.tags !== undefined) {
      fields.push(`tags = $${paramIdx++}`);
      values.push(JSON.stringify(input.tags));
    }
    if (input.notes !== undefined) {
      fields.push(`notes = $${paramIdx++}`);
      values.push(input.notes);
    }

    if (fields.length === 0) return this.get(id);

    fields.push(`updated_at = NOW()`);
    values.push(id, this.userId);

    const row = await this.queryOne<ExpenseRow>(
      `UPDATE expenses SET ${fields.join(', ')} WHERE id = $${paramIdx++} AND user_id = $${paramIdx} RETURNING *`,
      values
    );
    return row ? rowToExpense(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(`DELETE FROM expenses WHERE id = $1 AND user_id = $2`, [
      id,
      this.userId,
    ]);
    return ((result as { changes?: number })?.changes ?? 0) > 0;
  }

  async list(query: ExpenseQuery = {}): Promise<Expense[]> {
    const conditions = ['user_id = $1'];
    const params: unknown[] = [this.userId];
    let paramIdx = 2;

    if (query.dateFrom) {
      conditions.push(`date >= $${paramIdx++}`);
      params.push(query.dateFrom);
    }
    if (query.dateTo) {
      conditions.push(`date <= $${paramIdx++}`);
      params.push(query.dateTo);
    }
    if (query.category) {
      conditions.push(`category = $${paramIdx++}`);
      params.push(query.category);
    }
    if (query.minAmount !== undefined) {
      conditions.push(`amount >= $${paramIdx++}`);
      params.push(query.minAmount);
    }
    if (query.maxAmount !== undefined) {
      conditions.push(`amount <= $${paramIdx++}`);
      params.push(query.maxAmount);
    }
    if (query.search) {
      conditions.push(`description ILIKE $${paramIdx++}`);
      params.push(`%${query.search}%`);
    }

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const rows = await this.query<ExpenseRow>(
      `SELECT * FROM expenses WHERE ${conditions.join(' AND ')} ORDER BY date DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );
    return rows.map(rowToExpense);
  }

  async count(query?: { dateFrom?: string; dateTo?: string; category?: string }): Promise<number> {
    const conditions = ['user_id = $1'];
    const params: unknown[] = [this.userId];
    let paramIdx = 2;

    if (query?.dateFrom) {
      conditions.push(`date >= $${paramIdx++}`);
      params.push(query.dateFrom);
    }
    if (query?.dateTo) {
      conditions.push(`date <= $${paramIdx++}`);
      params.push(query.dateTo);
    }
    if (query?.category) {
      conditions.push(`category = $${paramIdx++}`);
      params.push(query.category);
    }

    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM expenses WHERE ${conditions.join(' AND ')}`,
      params
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async getSummary(
    dateFrom?: string,
    dateTo?: string
  ): Promise<{
    totalAmount: number;
    count: number;
    byCategory: Record<string, { amount: number; count: number }>;
    byCurrency: Record<string, number>;
  }> {
    const conditions = ['user_id = $1'];
    const params: unknown[] = [this.userId];
    let paramIdx = 2;

    if (dateFrom) {
      conditions.push(`date >= $${paramIdx++}`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`date <= $${paramIdx++}`);
      params.push(dateTo);
    }

    const where = conditions.join(' AND ');

    const [totalRow, categoryRows, currencyRows] = await Promise.all([
      this.queryOne<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE ${where}`,
        params
      ),
      this.query<{ category: string; total: string; count: string }>(
        `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE ${where} GROUP BY category`,
        params
      ),
      this.query<{ currency: string; total: string }>(
        `SELECT currency, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE ${where} GROUP BY currency`,
        params
      ),
    ]);

    const byCategory: Record<string, { amount: number; count: number }> = {};
    for (const row of categoryRows) {
      byCategory[row.category] = { amount: parseFloat(row.total), count: parseInt(row.count, 10) };
    }

    const byCurrency: Record<string, number> = {};
    for (const row of currencyRows) {
      byCurrency[row.currency] = parseFloat(row.total);
    }

    return {
      totalAmount: parseFloat(totalRow?.total ?? '0'),
      count: parseInt(totalRow?.count ?? '0', 10),
      byCategory,
      byCurrency,
    };
  }
}
