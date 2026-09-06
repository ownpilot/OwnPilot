// @vitest-environment happy-dom

/**
 * Row-date day-basis regression for ExpensesPage (round 53).
 *
 * `expense.date` is a stored LOCAL calendar day ('YYYY-MM-DD'), but the row
 * renders it through `new Date(expense.date)` (ExpensesPage.tsx:532) — UTC
 * midnight, which is 20:00 on the PREVIOUS local evening in America/New_York —
 * then formats with local `toLocaleDateString`. An expense saved on 2026-09-13
 * therefore lists as 9/12/2026 for every user west of UTC, on every stored
 * day. Same defect class as round 48's CalendarPage headers; the write-path
 * default on this page was fixed in round 49 (see ExpensesPage.day-basis.test).
 *
 * Fix: render through `parseLocalDay()` (inverse of localDayString, now
 * exported from utils/formatters) so the stored day is parsed at LOCAL midnight.
 *
 * Note: this trap does NOT depend on the faked clock — `new Date(dayString)` is
 * always UTC midnight — so the setup guard asserts the parse trap itself, not an
 * instant divergence (same as round 48's header test).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { ExpensesPage } from './ExpensesPage';
import type { ExpenseEntry } from '../api';

const ORIGINAL_TZ = process.env.TZ;

const mockMonthly = vi.fn();
const mockSummary = vi.fn();
const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../api', () => ({
  expensesApi: {
    monthly: (...a: unknown[]) => mockMonthly(...a),
    summary: (...a: unknown[]) => mockSummary(...a),
    list: (...a: unknown[]) => mockList(...a),
    create: (...a: unknown[]) => mockCreate(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}));

vi.mock('../hooks/useWebSocket', () => ({
  useGateway: () => ({ subscribe: vi.fn(() => () => {}) }),
}));
vi.mock('../components/ConfirmDialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../hooks/useSkipHome', () => ({
  useSkipHome: () => ({ skipHome: false, onSkipHomeChange: vi.fn() }),
}));

let root: Root | null = null;
let container: HTMLElement;

/** Local-anchored parse, mirroring the production fix. */
function parseLocalDay(day: string): Date {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function expense(over: Partial<ExpenseEntry> & { date: string }): ExpenseEntry {
  return {
    id: `exp-${over.date}`,
    description: 'Coffee run',
    amount: 4.5,
    currency: 'USD',
    category: 'unknown-cat',
    ...over,
  } as unknown as ExpenseEntry;
}

async function mount(rows: ExpenseEntry[]): Promise<void> {
  // Shapes read by the page at :172-:423 (validated in round 49).
  mockMonthly.mockResolvedValue({ months: [], categories: {}, yearTotal: 0 });
  mockSummary.mockResolvedValue({
    summary: { totalByCurrency: {}, dailyAverage: 0, totalExpenses: 0, topCategories: [] },
    categories: {},
  });
  mockList.mockResolvedValue({ expenses: rows });

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/expenses?tab=expenses'] },
        createElement(ExpensesPage)
      )
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Text of the div holding "M/D/YYYY • <category>" for a row. */
function rowMetaText(): string | null {
  const el = Array.from(container.querySelectorAll('div')).find((d) =>
    /\d{1,2}\/\d{1,2}\/\d{4}\s•/.test(d.textContent ?? '')
  );
  return el?.textContent ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = 'America/New_York';
  // The trap is TZ-dependent, not clock-dependent; pin the clock only to keep
  // the fixture deterministic (rounds 48-52 idiom).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-09-14T03:00:00.000Z'));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('ExpensesPage row date (America/New_York)', () => {
  it('setup: UTC-midnight parsing really lands on the previous local evening', () => {
    // Precondition for every assertion below: the parse trap is live in this TZ.
    expect(new Date('2026-09-13').toLocaleDateString('en-US')).toBe('9/12/2026');
    expect(parseLocalDay('2026-09-13').toLocaleDateString('en-US')).toBe('9/13/2026');
  });

  it('lists an expense stored on 2026-09-13 as 9/13/2026, not the day before', async () => {
    await mount([expense({ date: '2026-09-13' })]);

    const meta = rowMetaText();
    // Anti-false-pass: the row and its meta line rendered, so a wrong date below
    // means a wrong render, never an unmounted list.
    expect(meta, 'expense row meta line did not render').not.toBeNull();
    // Category fallback renders verbatim — passes before and after the fix.
    expect(meta).toContain('unknown-cat');
    // The bug: this rendered "9/12/2026" west of UTC.
    expect(meta).toContain('9/13/2026');
  });

  it('CONTROL: UTC rendering is identical before and after the fix', async () => {
    // At UTC the old code was accidentally correct; this guards against the
    // local-anchored fix changing anything for UTC users.
    process.env.TZ = 'UTC';
    await mount([expense({ date: '2026-09-13' })]);
    const meta = rowMetaText();
    expect(meta).toContain('9/13/2026');
  });
});
