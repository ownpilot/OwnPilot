/**
 * Expense Override Registration Tests
 *
 * Verifies registerExpenseOverrides swaps the file-based executors for
 * DB-backed ones without touching parse_receipt, and forwards args and
 * errors correctly through the new executor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExpenseOverrides } from './expense-overrides.js';

const mockExecuteExpenseTool = vi.fn();

vi.mock('./expense-tools.js', () => ({
  executeExpenseTool: (...args: unknown[]) => mockExecuteExpenseTool(...args),
}));

type Handler = (args: unknown) => Promise<{ content: string; isError: boolean }>;

/**
 * Minimal fake of the ToolRegistry interface surface that registerExpenseOverrides
 * actually uses: `get(name)` returning { definition } and `register(def, handler)`.
 * We avoid pulling in the real ToolRegistry so the test stays focused.
 */
function makeFakeRegistry(existing: string[]): {
  get: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  handlers: Map<string, Handler>;
} {
  const handlers = new Map<string, Handler>();
  const register = vi.fn((def: { name: string }, handler: Handler) => {
    handlers.set(def.name, handler);
  });
  const get = vi.fn((name: string) => {
    if (!existing.includes(name)) return undefined;
    return { definition: { name, description: `${name} def` } };
  });
  return { get, register, handlers };
}

const DB_TOOLS = [
  'add_expense',
  'batch_add_expenses',
  'query_expenses',
  'expense_summary',
  'update_expense',
  'delete_expense',
  'export_expenses',
];

describe('registerExpenseOverrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers every DB-backed tool when all originals exist', () => {
    const registry = makeFakeRegistry(DB_TOOLS);

    registerExpenseOverrides(registry as never, 'user-1');

    expect(registry.register).toHaveBeenCalledTimes(7);
    for (const name of DB_TOOLS) {
      expect(registry.handlers.has(name)).toBe(true);
    }
  });

  it('does NOT override parse_receipt (vision-based, stays in core)', () => {
    const registry = makeFakeRegistry([...DB_TOOLS, 'parse_receipt']);

    registerExpenseOverrides(registry as never, 'user-1');

    expect(registry.handlers.has('parse_receipt')).toBe(false);
  });

  it('skips tools that are not registered in the registry', () => {
    const registry = makeFakeRegistry(['add_expense', 'query_expenses']);

    registerExpenseOverrides(registry as never, 'user-1');

    expect(registry.register).toHaveBeenCalledTimes(2);
  });

  it('produces no-op registrations when none of the expected tools are present', () => {
    const registry = makeFakeRegistry([]);

    registerExpenseOverrides(registry as never, 'user-1');

    expect(registry.register).not.toHaveBeenCalled();
  });

  it('forwards tool name, args, and userId to executeExpenseTool; serializes success', async () => {
    const registry = makeFakeRegistry(['add_expense']);
    mockExecuteExpenseTool.mockResolvedValue({
      success: true,
      result: { id: 'exp-1', amount: 12 },
    });

    registerExpenseOverrides(registry as never, 'user-42');
    const handler = registry.handlers.get('add_expense')!;
    const result = await handler({ amount: 12, description: 'coffee' });

    expect(mockExecuteExpenseTool).toHaveBeenCalledWith(
      'add_expense',
      { amount: 12, description: 'coffee' },
      'user-42'
    );
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toEqual({ id: 'exp-1', amount: 12 });
  });

  it('marks handler result as error when the underlying executor fails with an error string', async () => {
    const registry = makeFakeRegistry(['delete_expense']);
    mockExecuteExpenseTool.mockResolvedValue({ success: false, error: 'not found' });

    registerExpenseOverrides(registry as never, 'user-1');
    const handler = registry.handlers.get('delete_expense')!;
    const result = await handler({ id: 'exp-x' });

    expect(result.isError).toBe(true);
    expect(result.content).toBe('not found');
  });

  it('falls back to generic message when executor returns failure without an error field', async () => {
    const registry = makeFakeRegistry(['query_expenses']);
    mockExecuteExpenseTool.mockResolvedValue({ success: false });

    registerExpenseOverrides(registry as never, 'user-1');
    const handler = registry.handlers.get('query_expenses')!;
    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content).toBe('Expense operation failed');
  });

  it('passes through the existing tool definition when re-registering', () => {
    const registry = makeFakeRegistry(['add_expense']);

    registerExpenseOverrides(registry as never, 'user-1');

    const [def] = registry.register.mock.calls[0]!;
    expect((def as { name: string }).name).toBe('add_expense');
    expect((def as { description: string }).description).toBe('add_expense def');
  });
});
