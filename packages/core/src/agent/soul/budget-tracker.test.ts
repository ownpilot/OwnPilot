import { describe, it, expect, vi } from 'vitest';
import { BudgetTracker } from './budget-tracker.js';
import type { SoulAutonomy } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(rows: object[] = [{ total: '0.50' }]) {
  return { query: vi.fn().mockResolvedValue(rows) };
}

function makeAutonomy(overrides: Partial<SoulAutonomy> = {}): SoulAutonomy {
  return {
    level: 2,
    allowedActions: [],
    blockedActions: [],
    requiresApproval: [],
    maxCostPerCycle: 1,
    maxCostPerDay: 10,
    maxCostPerMonth: 100,
    pauseOnConsecutiveErrors: 5,
    pauseOnBudgetExceeded: true,
    notifyUserOnPause: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkBudget()
// ---------------------------------------------------------------------------

describe('BudgetTracker.checkBudget()', () => {
  it('returns true when daily spend is below the limit', async () => {
    const tracker = new BudgetTracker(makeDb([{ total: '4.00' }]));
    const result = await tracker.checkBudget('agent-1', makeAutonomy({ maxCostPerDay: 10 }));
    expect(result).toBe(true);
  });

  it('returns false when daily spend equals the limit (strict less-than)', async () => {
    const tracker = new BudgetTracker(makeDb([{ total: '10.00' }]));
    const result = await tracker.checkBudget('agent-1', makeAutonomy({ maxCostPerDay: 10 }));
    expect(result).toBe(false);
  });

  it('returns false when daily spend exceeds the limit', async () => {
    const tracker = new BudgetTracker(makeDb([{ total: '15.50' }]));
    const result = await tracker.checkBudget('agent-1', makeAutonomy({ maxCostPerDay: 10 }));
    expect(result).toBe(false);
  });

  it('passes the agentId to getDailySpend', async () => {
    const db = makeDb([{ total: '0' }]);
    const tracker = new BudgetTracker(db);
    await tracker.checkBudget('my-agent', makeAutonomy());
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['my-agent']);
  });
});

// ---------------------------------------------------------------------------
// getDailySpend()
// ---------------------------------------------------------------------------

describe('BudgetTracker.getDailySpend()', () => {
  it('returns parsed float from DB row', async () => {
    const tracker = new BudgetTracker(makeDb([{ total: '3.75' }]));
    expect(await tracker.getDailySpend('agent-1')).toBe(3.75);
  });

  it('returns 0 when DB returns no rows', async () => {
    const tracker = new BudgetTracker(makeDb([]));
    expect(await tracker.getDailySpend('agent-1')).toBe(0);
  });

  it('returns 0 when DB row total is undefined', async () => {
    const tracker = new BudgetTracker(makeDb([{}]));
    expect(await tracker.getDailySpend('agent-1')).toBe(0);
  });

  it('passes agentId as query param and queries heartbeat_log', async () => {
    const db = makeDb();
    const tracker = new BudgetTracker(db);
    await tracker.getDailySpend('my-agent');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('heartbeat_log');
    expect(params).toEqual(['my-agent']);
  });
});

// ---------------------------------------------------------------------------
// getMonthlySpend()
// ---------------------------------------------------------------------------

describe('BudgetTracker.getMonthlySpend()', () => {
  it('returns parsed float from DB row', async () => {
    const tracker = new BudgetTracker(makeDb([{ total: '42.00' }]));
    expect(await tracker.getMonthlySpend('agent-1')).toBe(42);
  });

  it('returns 0 when DB returns no rows', async () => {
    const tracker = new BudgetTracker(makeDb([]));
    expect(await tracker.getMonthlySpend('agent-1')).toBe(0);
  });

  it('queries heartbeat_log with agentId', async () => {
    const db = makeDb();
    const tracker = new BudgetTracker(db);
    await tracker.getMonthlySpend('agent-x');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('heartbeat_log');
    expect(params).toEqual(['agent-x']);
  });
});

// ---------------------------------------------------------------------------
// recordSpend()
// ---------------------------------------------------------------------------

describe('BudgetTracker.recordSpend()', () => {
  it('is a no-op and never queries the DB', async () => {
    const db = makeDb();
    const tracker = new BudgetTracker(db);
    await expect(tracker.recordSpend('agent-1', 5.0)).resolves.toBeUndefined();
    expect(db.query).not.toHaveBeenCalled();
  });
});
