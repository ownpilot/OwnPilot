/**
 * Write-path day-basis regression for POST /expenses (round 54).
 *
 * The optional `date` field's fallback came from
 * `new Date().toISOString().split('T')[0]` — the UTC calendar day — while
 * every other expense write path (UI form, round 49; AI tool path, round 27)
 * and this same route file's read side (computePeriodDates, round 29) use the
 * user-LOCAL day basis. West of UTC that stored TOMORROW's date during the
 * local evening; east of UTC it stored YESTERDAY's date after local midnight.
 * Because expense `date` is a user-local 'YYYY-MM-DD' value, the misfiled
 * record then dropped out of local-basis period views (today / this_week /
 * this_month) or surfaced in the wrong one.
 *
 * Same defect family as rounds 15-18/24/25/27/28/29/49/53 (records and their
 * windows must share ONE local-day basis).
 *
 * TZ control note: launch-time TZ env is IGNORED by Node/ICU on Windows;
 * runtime `process.env.TZ` mutation IS honored — set it inside beforeEach.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const ORIGINAL_TZ = process.env.TZ;

// 2026-09-14T03:00Z === Sun 13 Sep 2026, 23:00 in America/New_York (EDT):
// the local day is 2026-09-13 while the UTC day has already rolled to 2026-09-14.
const NY_INSTANT = '2026-09-14T03:00:00.000Z';
const NY_LOCAL_TODAY = '2026-09-13';
// 2026-09-06T15:30Z === Mon 7 Sep 2026, 00:30 in Asia/Tokyo (JST, fixed +9):
// the local day is 2026-09-07 while the UTC day is still 2026-09-06.
const TOKYO_INSTANT = '2026-09-06T15:30:00.000Z';
const TOKYO_LOCAL_TODAY = '2026-09-07';

const mockRepo = {
  list: vi.fn(async () => []),
  count: vi.fn(async () => 0),
  get: vi.fn(async () => null),
  create: vi.fn(async (input: Record<string, unknown>) => ({
    id: 'exp-1',
    userId: 'user-1',
    tags: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...input,
  })),
  update: vi.fn(async () => null),
  delete: vi.fn(async () => true),
  getSummary: vi.fn(async () => null),
};

vi.mock('../db/repositories/expenses.js', () => ({
  ExpensesRepository: vi.fn(function () {
    return mockRepo;
  }),
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

const { expensesRoutes } = await import('./expenses.js');

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/expenses', expensesRoutes);
  return app;
}

async function postExpense(body: Record<string, unknown>) {
  return createApp().request('/expenses', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createdInput(): Record<string, unknown> {
  expect(mockRepo.create).toHaveBeenCalledTimes(1);
  return mockRepo.create.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = 'America/New_York';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(NY_INSTANT));
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('POST /expenses omitted-date fallback (round 54)', () => {
  it('setup: the fixture instant really is a local-evening/next-UTC-day split', () => {
    // If this ever stops holding, the assertions below prove nothing.
    const now = new Date();
    expect(now.toISOString().split('T')[0]).toBe('2026-09-14');
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
    expect(local).toBe(NY_LOCAL_TODAY);
  });

  it('UTC- evening: stores the LOCAL today (2026-09-13), not the UTC day (2026-09-14)', async () => {
    const res = await postExpense({ amount: 10, description: 'Late-night coffee' });
    expect(res.status).toBe(201);
    expect(createdInput().date).toBe(NY_LOCAL_TODAY);
  });

  it('UTC+ morning: stores the LOCAL today (2026-09-07), not the UTC day (2026-09-06)', async () => {
    process.env.TZ = 'Asia/Tokyo';
    vi.setSystemTime(Date.parse(TOKYO_INSTANT));
    const res = await postExpense({ amount: 10, description: 'After-midnight fare' });
    expect(res.status).toBe(201);
    expect(createdInput().date).toBe(TOKYO_LOCAL_TODAY);
  });

  it('CONTROL: an explicit date passes through unchanged (true before AND after the fix)', async () => {
    // Guards against "fixing" the fallback by forcing local today on every request.
    const res = await postExpense({ amount: 10, description: 'Groceries', date: '2026-03-15' });
    expect(res.status).toBe(201);
    expect(createdInput().date).toBe('2026-03-15');
  });
});
