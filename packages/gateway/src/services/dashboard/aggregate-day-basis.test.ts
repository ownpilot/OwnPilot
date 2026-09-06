/**
 * aggregateDailyData task-bounds day-basis regression (round 18).
 *
 * aggregateDailyData feeds the dashboard, the AI daily briefing, and the
 * /timeline route. Its dueToday/overdue TasksRepository bounds must be on the
 * LOCAL day basis — task dueDate values are user-local 'YYYY-MM-DD' strings.
 * The UTC-derived bounds misfiled yesterday-local tasks as "due today" and
 * dropped today-local tasks for |UTC offset| hours after local midnight.
 *
 * Kept in a SEPARATE file from index.test.ts: this harness needs repository +
 * service-registry partial mocks, which index.test.ts (pure fixture tests)
 * does not use.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockTasksList = vi.fn();

vi.mock('../../db/repositories/index.js', async (importOriginal) => {
  // Partial mock: only TasksRepository is intercepted (its list() bounds are
  // under test). Every other real repository class stays; their aggregation
  // sections are individually try/caught and degrade without a DB.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    TasksRepository: vi.fn(function (this: unknown, _userId: string) {
      return { list: mockTasksList };
    }),
  };
});

vi.mock('@ownpilot/core/services', async (importOriginal) => {
  // The eager service getters at the top of aggregateDailyData throw
  // "not initialized" outside gateway startup; benign stand-ins keep the
  // real aggregation flow running.
  const actual = (await importOriginal()) as Record<string, unknown>;
  const benign = {
    getActive: vi.fn(async () => []),
    getNextActions: vi.fn(async () => []),
    listTriggers: vi.fn(async () => []),
    getRecentHistory: vi.fn(async () => ({ history: [] })),
    getStats: vi.fn(async () => ({ total: 0, recentCount: 0 })),
  };
  return {
    ...actual,
    getMemoryService: vi.fn(() => benign),
    getGoalService: vi.fn(() => benign),
    getTriggerService: vi.fn(() => benign),
    getDatabaseService: vi.fn(() => benign),
    getPlanService: vi.fn(() => benign),
  };
});

import { DashboardService } from './index.js';

describe('aggregateDailyData task-bounds day-basis', () => {
  beforeEach(() => {
    // Fake ONLY the clock — real timers/promises keep everything else honest.
    vi.useFakeTimers({ toFake: ['Date'] });
    mockTasksList.mockReset();
    mockTasksList.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries dueToday/overdue bounds on the LOCAL day basis after local midnight', async () => {
    // Local-component Date constructors keep the scenario timezone-agnostic;
    // the discriminator engages only where local ≠ UTC (vacuously green on
    // UTC/UTC− hosts).
    vi.setSystemTime(new Date(2026, 8, 6, 1, 0, 0)); // local 09-06 01:00

    const service = new DashboardService('user-1');
    await service.aggregateDailyData();

    const calls = mockTasksList.mock.calls as unknown as Array<
      [{ dueAfter?: string; dueBefore?: string }]
    >;
    const dueToday = calls.find((c) => c[0]?.dueAfter !== undefined);
    const overdue = calls.find(
      (c) => c[0]?.dueAfter === undefined && c[0]?.dueBefore !== undefined
    );

    expect(dueToday?.[0]).toMatchObject({ dueAfter: '2026-09-06', dueBefore: '2026-09-06' });
    expect(overdue?.[0]?.dueBefore).toBe('2026-09-05');
  });

  it('boundary: the pending-tasks query stays unbounded (basis-independent)', async () => {
    vi.setSystemTime(new Date(2026, 8, 6, 1, 0, 0));

    const service = new DashboardService('user-1');
    await service.aggregateDailyData();

    const calls = mockTasksList.mock.calls as unknown as Array<
      [{ dueAfter?: string; dueBefore?: string }]
    >;
    const pending = calls.find(
      (c) => c[0]?.dueAfter === undefined && c[0]?.dueBefore === undefined
    );
    expect(pending).toBeDefined();
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
});
