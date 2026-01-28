/**
 * Expense Tracker Tools
 *
 * Financial tracking tools for personal expense management:
 * - Parse receipts/invoices from images
 * - Store expenses in CSV/JSON format
 * - Query and summarize expenses
 * - Category management
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult, ToolContext } from '../types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Expense category
 */
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

/**
 * Expense entry
 */
export interface ExpenseEntry {
  /** Unique ID */
  id: string;
  /** Expense date (ISO string) */
  date: string;
  /** Amount */
  amount: number;
  /** Currency code (TRY, USD, EUR) */
  currency: string;
  /** Category */
  category: ExpenseCategory;
  /** Description/merchant */
  description: string;
  /** Payment method */
  paymentMethod?: string;
  /** Tags for filtering */
  tags?: string[];
  /** Source (manual, receipt, telegram, etc.) */
  source: string;
  /** Original image path (if from receipt) */
  receiptImage?: string;
  /** Created timestamp */
  createdAt: string;
  /** Notes */
  notes?: string;
}

/**
 * Expense database (JSON format)
 */
export interface ExpenseDatabase {
  version: string;
  lastUpdated: string;
  expenses: ExpenseEntry[];
  categories: Record<ExpenseCategory, { budget?: number; color?: string }>;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Default expense database path
 */
const DEFAULT_EXPENSE_DB_PATH = process.env.EXPENSE_DB_PATH ??
  path.join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.ownpilot', 'expenses.json');

/**
 * Default categories with optional budgets
 */
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

/**
 * Load expense database
 */
async function loadExpenseDb(dbPath: string = DEFAULT_EXPENSE_DB_PATH): Promise<ExpenseDatabase> {
  try {
    const content = await fs.readFile(dbPath, 'utf-8');
    return JSON.parse(content) as ExpenseDatabase;
  } catch {
    // Initialize new database
    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      expenses: [],
      categories: DEFAULT_CATEGORIES,
    };
  }
}

/**
 * Save expense database
 */
async function saveExpenseDb(db: ExpenseDatabase, dbPath: string = DEFAULT_EXPENSE_DB_PATH): Promise<void> {
  db.lastUpdated = new Date().toISOString();

  // Ensure directory exists
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  // Write with pretty formatting
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf-8');
}

/**
 * Generate expense ID
 */
function generateExpenseId(): string {
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// CSV Export
// =============================================================================

/**
 * Export expenses to CSV
 */
async function exportToCsv(expenses: ExpenseEntry[], filePath: string): Promise<void> {
  const headers = ['Date', 'Amount', 'Currency', 'Category', 'Description', 'Payment Method', 'Tags', 'Source', 'Notes'];

  const rows = expenses.map(e => [
    e.date,
    e.amount.toString(),
    e.currency,
    e.category,
    `"${e.description.replace(/"/g, '""')}"`,
    e.paymentMethod ?? '',
    e.tags?.join(';') ?? '',
    e.source,
    e.notes ? `"${e.notes.replace(/"/g, '""')}"` : '',
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, csv, 'utf-8');
}

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * Add expense tool
 */
export const addExpenseTool: ToolDefinition = {
  name: 'add_expense',
  description: 'Add a new expense entry to the tracker. Use this to record purchases, payments, or any financial transaction.',
  parameters: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Expense date in YYYY-MM-DD format. Defaults to today if not provided.',
      },
      amount: {
        type: 'number',
        description: 'Expense amount (positive number)',
      },
      currency: {
        type: 'string',
        description: 'Currency code (TRY, USD, EUR). Defaults to TRY.',
        enum: ['TRY', 'USD', 'EUR', 'GBP'],
      },
      category: {
        type: 'string',
        description: 'Expense category',
        enum: ['food', 'transport', 'utilities', 'entertainment', 'shopping', 'health', 'education', 'travel', 'subscription', 'housing', 'other'],
      },
      description: {
        type: 'string',
        description: 'Description or merchant name',
      },
      paymentMethod: {
        type: 'string',
        description: 'Payment method (cash, credit_card, debit_card, bank_transfer)',
      },
      tags: {
        type: 'array',
        description: 'Optional tags for filtering',
        items: { type: 'string' },
      },
      notes: {
        type: 'string',
        description: 'Additional notes',
      },
    },
    required: ['amount', 'category', 'description'],
  },
};

export const addExpenseExecutor: ToolExecutor = async (args, context): Promise<ToolExecutionResult> => {
  try {
    const db = await loadExpenseDb();

    const expense: ExpenseEntry = {
      id: generateExpenseId(),
      date: (args.date as string) ?? new Date().toISOString().split('T')[0]!,
      amount: args.amount as number,
      currency: (args.currency as string) ?? 'TRY',
      category: args.category as ExpenseCategory,
      description: args.description as string,
      paymentMethod: args.paymentMethod as string | undefined,
      tags: args.tags as string[] | undefined,
      source: 'manual',
      createdAt: new Date().toISOString(),
      notes: args.notes as string | undefined,
    };

    db.expenses.push(expense);
    await saveExpenseDb(db);

    return {
      content: JSON.stringify({
        success: true,
        expense,
        message: `Added expense: ${expense.amount} ${expense.currency} for ${expense.description}`,
        totalExpenses: db.expenses.length,
      }),
    };
  } catch (error) {
    return {
      content: `Error adding expense: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

/**
 * Parse receipt image tool
 * This tool extracts expense data from receipt images using vision models
 */
export const parseReceiptTool: ToolDefinition = {
  name: 'parse_receipt',
  description: 'Parse expense information from a receipt image. Returns extracted data that can be used with add_expense. Requires a vision-capable model.',
  parameters: {
    type: 'object',
    properties: {
      imagePath: {
        type: 'string',
        description: 'Path to the receipt image file',
      },
      imageBase64: {
        type: 'string',
        description: 'Base64-encoded image data (alternative to imagePath)',
      },
      saveReceipt: {
        type: 'boolean',
        description: 'Whether to save the receipt image for records. Defaults to true.',
      },
    },
    required: [],
  },
};

export const parseReceiptExecutor: ToolExecutor = async (args, _context): Promise<ToolExecutionResult> => {
  // Note: This is a placeholder. The actual image parsing would be done by the AI model
  // when this tool is called. The model should analyze the image and return structured data.

  const imagePath = args.imagePath as string | undefined;
  const imageBase64 = args.imageBase64 as string | undefined;

  if (!imagePath && !imageBase64) {
    return {
      content: 'Error: Either imagePath or imageBase64 must be provided',
      isError: true,
    };
  }

  // Return instruction for the AI to parse the image
  return {
    content: JSON.stringify({
      instruction: 'Please analyze the receipt image and extract the following information:',
      extractFields: {
        date: 'Transaction date (YYYY-MM-DD format)',
        amount: 'Total amount (number)',
        currency: 'Currency code if visible',
        merchant: 'Store/merchant name',
        items: 'List of purchased items if visible',
        category: 'Suggested category based on merchant/items',
        paymentMethod: 'Payment method if visible',
      },
      note: 'After extracting, use add_expense tool to save the expense',
      imagePath,
      hasImageData: !!imageBase64,
    }),
    metadata: {
      requiresVision: true,
    },
  };
};

/**
 * Query expenses tool
 */
export const queryExpensesTool: ToolDefinition = {
  name: 'query_expenses',
  description: 'Query and filter expenses from the tracker. Returns matching expenses with optional aggregations.',
  parameters: {
    type: 'object',
    properties: {
      startDate: {
        type: 'string',
        description: 'Filter expenses from this date (YYYY-MM-DD)',
      },
      endDate: {
        type: 'string',
        description: 'Filter expenses until this date (YYYY-MM-DD)',
      },
      category: {
        type: 'string',
        description: 'Filter by category',
        enum: ['food', 'transport', 'utilities', 'entertainment', 'shopping', 'health', 'education', 'travel', 'subscription', 'housing', 'other'],
      },
      minAmount: {
        type: 'number',
        description: 'Minimum amount filter',
      },
      maxAmount: {
        type: 'number',
        description: 'Maximum amount filter',
      },
      search: {
        type: 'string',
        description: 'Search in description and notes',
      },
      tags: {
        type: 'array',
        description: 'Filter by tags (any match)',
        items: { type: 'string' },
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 50)',
      },
      aggregate: {
        type: 'boolean',
        description: 'Include aggregated summary (totals by category, etc.)',
      },
    },
    required: [],
  },
};

export const queryExpensesExecutor: ToolExecutor = async (args, _context): Promise<ToolExecutionResult> => {
  try {
    const db = await loadExpenseDb();
    let expenses = [...db.expenses];

    // Apply filters
    const startDate = args.startDate as string | undefined;
    const endDate = args.endDate as string | undefined;
    const category = args.category as ExpenseCategory | undefined;
    const minAmount = args.minAmount as number | undefined;
    const maxAmount = args.maxAmount as number | undefined;
    const search = args.search as string | undefined;
    const tags = args.tags as string[] | undefined;
    const limit = (args.limit as number) ?? 50;
    const aggregate = args.aggregate as boolean | undefined;

    if (startDate) {
      expenses = expenses.filter(e => e.date >= startDate);
    }
    if (endDate) {
      expenses = expenses.filter(e => e.date <= endDate);
    }
    if (category) {
      expenses = expenses.filter(e => e.category === category);
    }
    if (minAmount !== undefined) {
      expenses = expenses.filter(e => e.amount >= minAmount);
    }
    if (maxAmount !== undefined) {
      expenses = expenses.filter(e => e.amount <= maxAmount);
    }
    if (search) {
      const searchLower = search.toLowerCase();
      expenses = expenses.filter(e =>
        e.description.toLowerCase().includes(searchLower) ||
        e.notes?.toLowerCase().includes(searchLower)
      );
    }
    if (tags && tags.length > 0) {
      expenses = expenses.filter(e =>
        e.tags?.some(t => tags.includes(t))
      );
    }

    // Sort by date descending
    expenses.sort((a, b) => b.date.localeCompare(a.date));

    // Apply limit
    const limitedExpenses = expenses.slice(0, limit);

    // Build result
    const result: Record<string, unknown> = {
      count: limitedExpenses.length,
      totalCount: expenses.length,
      expenses: limitedExpenses,
    };

    // Add aggregations if requested
    if (aggregate) {
      const totalByCategory: Record<string, number> = {};
      const totalByCurrency: Record<string, number> = {};
      let grandTotal = 0;

      for (const e of expenses) {
        totalByCategory[e.category] = (totalByCategory[e.category] ?? 0) + e.amount;
        totalByCurrency[e.currency] = (totalByCurrency[e.currency] ?? 0) + e.amount;
        if (e.currency === 'TRY') {
          grandTotal += e.amount;
        }
      }

      result.summary = {
        totalByCategory,
        totalByCurrency,
        grandTotalTRY: grandTotal,
        averageExpense: expenses.length > 0 ? grandTotal / expenses.length : 0,
        dateRange: {
          earliest: expenses.length > 0 ? expenses[expenses.length - 1]?.date : null,
          latest: expenses.length > 0 ? expenses[0]?.date : null,
        },
      };
    }

    return {
      content: JSON.stringify(result),
    };
  } catch (error) {
    return {
      content: `Error querying expenses: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

/**
 * Export expenses tool
 */
export const exportExpensesTool: ToolDefinition = {
  name: 'export_expenses',
  description: 'Export expenses to CSV or JSON file for external use (Excel, spreadsheets, etc.)',
  parameters: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        description: 'Export format',
        enum: ['csv', 'json'],
      },
      outputPath: {
        type: 'string',
        description: 'Output file path',
      },
      startDate: {
        type: 'string',
        description: 'Filter expenses from this date (YYYY-MM-DD)',
      },
      endDate: {
        type: 'string',
        description: 'Filter expenses until this date (YYYY-MM-DD)',
      },
      category: {
        type: 'string',
        description: 'Filter by category',
      },
    },
    required: ['format', 'outputPath'],
  },
};

export const exportExpensesExecutor: ToolExecutor = async (args, _context): Promise<ToolExecutionResult> => {
  try {
    const db = await loadExpenseDb();
    let expenses = [...db.expenses];

    // Apply filters
    const startDate = args.startDate as string | undefined;
    const endDate = args.endDate as string | undefined;
    const category = args.category as ExpenseCategory | undefined;

    if (startDate) {
      expenses = expenses.filter(e => e.date >= startDate);
    }
    if (endDate) {
      expenses = expenses.filter(e => e.date <= endDate);
    }
    if (category) {
      expenses = expenses.filter(e => e.category === category);
    }

    // Sort by date
    expenses.sort((a, b) => a.date.localeCompare(b.date));

    const format = args.format as 'csv' | 'json';
    const outputPath = args.outputPath as string;

    if (format === 'csv') {
      await exportToCsv(expenses, outputPath);
    } else {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify(expenses, null, 2), 'utf-8');
    }

    return {
      content: JSON.stringify({
        success: true,
        format,
        path: outputPath,
        expenseCount: expenses.length,
        message: `Exported ${expenses.length} expenses to ${outputPath}`,
      }),
    };
  } catch (error) {
    return {
      content: `Error exporting expenses: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

/**
 * Get expense summary tool
 */
export const expenseSummaryTool: ToolDefinition = {
  name: 'expense_summary',
  description: 'Get a summary of expenses for a time period. Shows totals by category, trends, and insights.',
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        description: 'Time period for summary',
        enum: ['today', 'this_week', 'this_month', 'last_month', 'this_year', 'all_time'],
      },
      startDate: {
        type: 'string',
        description: 'Custom start date (YYYY-MM-DD). Overrides period.',
      },
      endDate: {
        type: 'string',
        description: 'Custom end date (YYYY-MM-DD). Overrides period.',
      },
    },
    required: [],
  },
};

export const expenseSummaryExecutor: ToolExecutor = async (args, _context): Promise<ToolExecutionResult> => {
  try {
    const db = await loadExpenseDb();
    let startDate: string;
    let endDate: string;

    // Calculate date range
    const now = new Date();
    const period = (args.period as string) ?? 'this_month';

    if (args.startDate && args.endDate) {
      startDate = args.startDate as string;
      endDate = args.endDate as string;
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
    const expenses = db.expenses.filter(e => e.date >= startDate && e.date <= endDate);

    // Calculate summary
    const totalByCategory: Record<string, number> = {};
    const totalByCurrency: Record<string, number> = {};
    const expensesByDay: Record<string, number> = {};
    let grandTotal = 0;

    for (const e of expenses) {
      totalByCategory[e.category] = (totalByCategory[e.category] ?? 0) + e.amount;
      totalByCurrency[e.currency] = (totalByCurrency[e.currency] ?? 0) + e.amount;
      expensesByDay[e.date] = (expensesByDay[e.date] ?? 0) + e.amount;

      if (e.currency === 'TRY') {
        grandTotal += e.amount;
      }
    }

    // Find top categories
    const topCategories = Object.entries(totalByCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: grandTotal > 0 ? Math.round((amount / grandTotal) * 100) : 0,
      }));

    // Calculate daily average
    const days = Object.keys(expensesByDay).length || 1;
    const dailyAverage = grandTotal / days;

    // Find biggest expenses
    const biggestExpenses = [...expenses]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map(e => ({
        date: e.date,
        amount: e.amount,
        currency: e.currency,
        description: e.description,
        category: e.category,
      }));

    return {
      content: JSON.stringify({
        period: {
          name: period,
          startDate,
          endDate,
        },
        summary: {
          totalExpenses: expenses.length,
          grandTotalTRY: Math.round(grandTotal * 100) / 100,
          dailyAverage: Math.round(dailyAverage * 100) / 100,
          totalByCurrency,
          topCategories,
          biggestExpenses,
        },
        insights: generateInsights(expenses, grandTotal, topCategories),
      }),
    };
  } catch (error) {
    return {
      content: `Error generating summary: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

/**
 * Generate simple insights from expense data
 */
function generateInsights(
  expenses: ExpenseEntry[],
  total: number,
  topCategories: Array<{ category: string; amount: number; percentage: number }>
): string[] {
  const insights: string[] = [];

  if (expenses.length === 0) {
    insights.push('No expenses recorded in this period.');
    return insights;
  }

  // Top spending category
  if (topCategories.length > 0 && topCategories[0]) {
    const top = topCategories[0];
    insights.push(
      `Top spending category: ${top.category} (${top.percentage}% of total, ${top.amount.toFixed(2)} TRY)`
    );
  }

  // Average transaction
  const avgTransaction = total / expenses.length;
  insights.push(`Average transaction: ${avgTransaction.toFixed(2)} TRY`);

  // Most active day
  const dayCount: Record<string, number> = {};
  for (const e of expenses) {
    const day = new Date(e.date).toLocaleDateString('en-US', { weekday: 'long' });
    dayCount[day] = (dayCount[day] ?? 0) + 1;
  }
  const mostActiveDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0];
  if (mostActiveDay) {
    insights.push(`Most transactions on: ${mostActiveDay[0]} (${mostActiveDay[1]} transactions)`);
  }

  return insights;
}

/**
 * Delete expense tool
 */
export const deleteExpenseTool: ToolDefinition = {
  name: 'delete_expense',
  description: 'Delete an expense entry by ID',
  parameters: {
    type: 'object',
    properties: {
      expenseId: {
        type: 'string',
        description: 'The expense ID to delete',
      },
    },
    required: ['expenseId'],
  },
};

export const deleteExpenseExecutor: ToolExecutor = async (args, _context): Promise<ToolExecutionResult> => {
  try {
    const db = await loadExpenseDb();
    const expenseId = args.expenseId as string;

    const index = db.expenses.findIndex(e => e.id === expenseId);
    if (index === -1) {
      return {
        content: `Expense not found: ${expenseId}`,
        isError: true,
      };
    }

    const deleted = db.expenses.splice(index, 1)[0];
    await saveExpenseDb(db);

    return {
      content: JSON.stringify({
        success: true,
        deleted,
        message: `Deleted expense: ${deleted?.description} (${deleted?.amount} ${deleted?.currency})`,
      }),
    };
  } catch (error) {
    return {
      content: `Error deleting expense: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// Export All Tools
// =============================================================================

export const EXPENSE_TRACKER_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: addExpenseTool, executor: addExpenseExecutor },
  { definition: parseReceiptTool, executor: parseReceiptExecutor },
  { definition: queryExpensesTool, executor: queryExpensesExecutor },
  { definition: exportExpensesTool, executor: exportExpensesExecutor },
  { definition: expenseSummaryTool, executor: expenseSummaryExecutor },
  { definition: deleteExpenseTool, executor: deleteExpenseExecutor },
];
