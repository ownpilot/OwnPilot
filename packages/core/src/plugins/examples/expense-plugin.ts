/**
 * Expense Tracker Plugin
 *
 * Example plugin demonstrating the plugin architecture.
 * Provides expense tracking tools and natural language handling.
 */

import { createPlugin, type MessageHandler, type HandlerContext, type HandlerResult } from '../index.js';
import {
  addExpenseTool,
  addExpenseExecutor,
  queryExpensesTool,
  queryExpensesExecutor,
  expenseSummaryTool,
  expenseSummaryExecutor,
  exportExpensesTool,
  exportExpensesExecutor,
  deleteExpenseTool,
  deleteExpenseExecutor,
  parseReceiptTool,
  parseReceiptExecutor,
  type ExpenseCategory,
} from '../../agent/tools/expense-tracker.js';

// =============================================================================
// Natural Language Expense Handler
// =============================================================================

/**
 * Patterns for recognizing expense-related messages
 * NOTE: Pattern matching should eventually be replaced by AI-based intent recognition
 * for language-independent operation. The AI should understand user intent and
 * convert it to proper tool parameters.
 */
const EXPENSE_PATTERNS = {
  addExpense: [
    /(?:spent|paid|bought)\s+(\d+(?:[.,]\d+)?)\s*(usd|\$|eur|€|gbp|£)?/i,
    /(\d+(?:[.,]\d+)?)\s*(usd|\$|eur|€|gbp|£)?\s+(?:for|on)\s+/i,
  ],
  queryExpense: [
    /how\s+much\s+(?:did\s+I\s+)?spen[dt]/i,
    /(?:show|list)\s+(?:my\s+)?expense/i,
    /expense\s+(?:summary|report|list)/i,
  ],
  category: [
    /food|restaurant|grocery|coffee|meal/i,
    /transport|taxi|bus|gas|uber|fuel/i,
    /utility|bill|electricity|water|internet/i,
    /entertainment|movie|concert|game/i,
    /shopping|clothes|clothing/i,
    /health|medicine|doctor|hospital/i,
    /education|course|book|training/i,
    /travel|hotel|flight|vacation/i,
    /subscription|netflix|spotify|youtube/i,
    /housing|rent|mortgage/i,
  ],
};

/**
 * Detect category from text
 * NOTE: This pattern matching should be replaced by AI-based categorization
 */
function detectCategory(text: string): ExpenseCategory {
  const lower = text.toLowerCase();

  if (/food|restaurant|grocery|coffee|meal|lunch|dinner|breakfast/.test(lower)) return 'food';
  if (/transport|taxi|bus|gas|uber|fuel|parking|metro|subway/.test(lower)) return 'transport';
  if (/utility|bill|electricity|water|internet|phone/.test(lower)) return 'utilities';
  if (/entertainment|movie|concert|game|music|streaming/.test(lower)) return 'entertainment';
  if (/shopping|clothes|clothing|apparel|fashion/.test(lower)) return 'shopping';
  if (/health|medicine|doctor|hospital|pharmacy|medical/.test(lower)) return 'health';
  if (/education|course|book|training|school|university/.test(lower)) return 'education';
  if (/travel|hotel|flight|vacation|trip|airbnb/.test(lower)) return 'travel';
  if (/subscription|netflix|spotify|youtube|membership/.test(lower)) return 'subscription';
  if (/housing|rent|mortgage|apartment/.test(lower)) return 'housing';

  return 'other';
}

/**
 * Parse currency from text
 */
function parseCurrency(text?: string): string {
  if (!text) return 'USD';
  const lower = text.toLowerCase();
  if (lower.includes('$') || lower.includes('usd')) return 'USD';
  if (lower.includes('€') || lower.includes('eur')) return 'EUR';
  if (lower.includes('£') || lower.includes('gbp')) return 'GBP';
  return 'USD';
}

/**
 * Expense message handler
 */
const expenseHandler: MessageHandler = {
  name: 'expense-handler',
  description: 'Handles expense-related messages like "spent $50 on food"',
  priority: 50, // Medium priority

  canHandle: async (message: string, _context: HandlerContext): Promise<boolean> => {
    // Check if message matches any expense pattern
    for (const pattern of EXPENSE_PATTERNS.addExpense) {
      if (pattern.test(message)) return true;
    }
    for (const pattern of EXPENSE_PATTERNS.queryExpense) {
      if (pattern.test(message)) return true;
    }
    return false;
  },

  handle: async (message: string, _context: HandlerContext): Promise<HandlerResult> => {
    // Check if it's a query
    for (const pattern of EXPENSE_PATTERNS.queryExpense) {
      if (pattern.test(message)) {
        return {
          handled: true,
          toolCalls: [
            {
              tool: 'expense_summary',
              args: { period: 'this_month' },
            },
          ],
        };
      }
    }

    // Try to parse expense from message
    for (const pattern of EXPENSE_PATTERNS.addExpense) {
      const match = message.match(pattern);
      if (match) {
        // Extract amount
        let amount: number | null = null;
        let currency = 'USD';

        for (const group of match) {
          if (group && /^\d+(?:[.,]\d+)?$/.test(group.replace(',', '.'))) {
            amount = parseFloat(group.replace(',', '.'));
          }
          if (group) {
            currency = parseCurrency(group);
          }
        }

        if (amount) {
          const category = detectCategory(message);
          const description = message.slice(0, 100); // Use message as description

          return {
            handled: true,
            toolCalls: [
              {
                tool: 'add_expense',
                args: {
                  amount,
                  currency,
                  category,
                  description,
                  source: 'conversation',
                },
              },
            ],
          };
        }
      }
    }

    return { handled: false };
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

/**
 * Create the expense tracker plugin
 * Uses a factory function to avoid circular dependency issues
 */
export function createExpenseTrackerPlugin() {
  return createPlugin()
    .meta({
      id: 'expense-tracker',
      name: 'Expense Tracker',
      version: '1.0.0',
      description: 'Track personal expenses, parse receipts, and generate financial reports',
      author: {
        name: 'OwnPilot',
      },
      capabilities: ['tools', 'handlers', 'storage'],
      permissions: ['file_read', 'file_write', 'storage'],
      configSchema: {
        type: 'object',
        properties: {
          defaultCurrency: {
            type: 'string',
            enum: ['USD', 'EUR', 'GBP'],
            default: 'USD',
          },
          categories: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      defaultConfig: {
        defaultCurrency: 'USD',
        categories: ['food', 'transport', 'utilities', 'entertainment', 'shopping', 'health', 'education', 'travel', 'subscription', 'housing', 'other'],
      },
    })
    .tools([
      { definition: addExpenseTool, executor: addExpenseExecutor },
      { definition: queryExpensesTool, executor: queryExpensesExecutor },
      { definition: expenseSummaryTool, executor: expenseSummaryExecutor },
      { definition: exportExpensesTool, executor: exportExpensesExecutor },
      { definition: deleteExpenseTool, executor: deleteExpenseExecutor },
      { definition: parseReceiptTool, executor: parseReceiptExecutor },
    ])
    .handler(expenseHandler)
    .publicApi({
      // Expose for other plugins
      detectCategory,
      parseCurrency,
    })
    .hooks({
      onLoad: async () => {
        console.log('[ExpensePlugin] Loaded');
      },
      onEnable: async () => {
        console.log('[ExpensePlugin] Enabled');
      },
      onDisable: async () => {
        console.log('[ExpensePlugin] Disabled');
      },
    })
    .build();
}

// Lazy-initialized singleton for backward compatibility
let _expenseTrackerPlugin: ReturnType<typeof createExpenseTrackerPlugin> | null = null;

export function getExpenseTrackerPlugin() {
  if (!_expenseTrackerPlugin) {
    _expenseTrackerPlugin = createExpenseTrackerPlugin();
  }
  return _expenseTrackerPlugin;
}

// For backward compatibility - will be lazily initialized on first access
export const expenseTrackerPlugin = {
  get instance() {
    return getExpenseTrackerPlugin();
  }
};
