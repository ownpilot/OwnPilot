/**
 * Expense Tools — Gateway DB-backed Implementation
 *
 * Replaces the file-based expense executors from core/agent/tools/expense-tracker.ts.
 * Uses ExpensesRepository (PostgreSQL) instead of JSON file storage.
 *
 * The tool DEFINITIONS remain in core (for portability). Only the EXECUTORS
 * are overridden here to use the DB.
 */

import { getErrorMessage } from '@ownpilot/core';
import { ExpensesRepository } from '../db/repositories/expenses.js';
import type { ToolExecutionResult } from '../services/tool-executor.js';

// ============================================================================
// Executor
// ============================================================================

export async function executeExpenseTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult> {
  try {
    const repo = new ExpensesRepository(userId);

    switch (toolName) {
      case 'add_expense': {
        const expense = await repo.create({
          date: (args.date as string) ?? new Date().toISOString().split('T')[0]!,
          amount: args.amount as number,
          currency: (args.currency as string) ?? 'TRY',
          category: (args.category as string) ?? 'other',
          description: args.description as string,
          paymentMethod: args.paymentMethod as string | undefined,
          tags: args.tags as string[] | undefined,
          notes: args.notes as string | undefined,
          source: 'manual',
        });
        return { success: true, result: expense };
      }

      case 'batch_add_expenses': {
        const items = args.expenses as Array<Record<string, unknown>>;
        if (!Array.isArray(items)) return { success: false, error: 'expenses must be an array' };
        if (items.length > 100) return { success: false, error: 'Max 100 expenses per batch' };

        const results = [];
        for (const item of items) {
          const expense = await repo.create({
            date: (item.date as string) ?? new Date().toISOString().split('T')[0]!,
            amount: item.amount as number,
            currency: (item.currency as string) ?? 'TRY',
            category: (item.category as string) ?? 'other',
            description: item.description as string,
            paymentMethod: item.paymentMethod as string | undefined,
            tags: item.tags as string[] | undefined,
            notes: item.notes as string | undefined,
            source: 'batch',
          });
          results.push(expense);
        }
        return { success: true, result: { added: results.length, expenses: results } };
      }

      case 'query_expenses': {
        const expenses = await repo.list({
          dateFrom: args.dateFrom as string | undefined,
          dateTo: args.dateTo as string | undefined,
          category: args.category as string | undefined,
          minAmount: args.minAmount as number | undefined,
          maxAmount: args.maxAmount as number | undefined,
          search: args.search as string | undefined,
          limit: (args.limit as number) ?? 50,
        });
        return {
          success: true,
          result: {
            expenses,
            count: expenses.length,
            message:
              expenses.length === 0 ? 'No expenses found.' : `Found ${expenses.length} expense(s).`,
          },
        };
      }

      case 'expense_summary': {
        const period = (args.period as string) ?? 'this_month';
        const now = new Date();
        let dateFrom: string | undefined;
        let dateTo: string | undefined;

        switch (period) {
          case 'today':
            dateFrom = dateTo = now.toISOString().split('T')[0]!;
            break;
          case 'this_week': {
            const day = now.getDay();
            const start = new Date(now);
            start.setDate(now.getDate() - day);
            dateFrom = start.toISOString().split('T')[0]!;
            dateTo = now.toISOString().split('T')[0]!;
            break;
          }
          case 'this_month':
            dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            dateTo = now.toISOString().split('T')[0]!;
            break;
          case 'last_month': {
            const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0);
            dateFrom = last.toISOString().split('T')[0]!;
            dateTo = lastEnd.toISOString().split('T')[0]!;
            break;
          }
          case 'this_year':
            dateFrom = `${now.getFullYear()}-01-01`;
            dateTo = now.toISOString().split('T')[0]!;
            break;
          case 'all_time':
            break;
        }

        const summary = await repo.getSummary(dateFrom, dateTo);
        return { success: true, result: { period, ...summary } };
      }

      case 'update_expense': {
        const expenseId = args.expenseId as string;
        const updated = await repo.update(expenseId, {
          date: args.date as string | undefined,
          amount: args.amount as number | undefined,
          currency: args.currency as string | undefined,
          category: args.category as string | undefined,
          description: args.description as string | undefined,
          paymentMethod: args.paymentMethod as string | undefined,
          tags: args.tags as string[] | undefined,
          notes: args.notes as string | undefined,
        });
        if (!updated) return { success: false, error: `Expense not found: ${expenseId}` };
        return { success: true, result: updated };
      }

      case 'delete_expense': {
        const deleted = await repo.delete(args.expenseId as string);
        if (!deleted) return { success: false, error: `Expense not found: ${args.expenseId}` };
        return { success: true, result: { message: 'Expense deleted.' } };
      }

      case 'export_expenses': {
        const format = (args.format as string) ?? 'json';
        const expenses = await repo.list({
          dateFrom: args.dateFrom as string | undefined,
          dateTo: args.dateTo as string | undefined,
          category: args.category as string | undefined,
        });

        if (format === 'csv') {
          const header = 'id,date,amount,currency,category,description,paymentMethod,tags,notes';
          const rows = expenses.map(
            (e) =>
              `${e.id},${e.date},${e.amount},${e.currency},${e.category},"${e.description}",${e.paymentMethod ?? ''},"${(e.tags ?? []).join(';')}","${e.notes ?? ''}"`
          );
          return {
            success: true,
            result: { format: 'csv', data: [header, ...rows].join('\n'), count: expenses.length },
          };
        }

        return {
          success: true,
          result: { format: 'json', data: expenses, count: expenses.length },
        };
      }

      default:
        return { success: false, error: `Unknown expense tool: ${toolName}` };
    }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}
