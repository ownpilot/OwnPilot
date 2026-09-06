// @vitest-environment happy-dom

/**
 * View-range regression for CalendarPage's date helpers (round 47).
 *
 * `getViewStartDate` / `getViewEndDate` / `navigateDate` (CalendarPage.tsx
 * :636-:668) parse a *local* 'YYYY-MM-DD' day with `new Date(dateStr)`, which is
 * UTC midnight. They then mutate with LOCAL getters (`getDay`/`getDate`/
 * `setMonth`) and re-serialize with `toISOString()` (UTC). West of UTC the
 * UTC-midnight instant lands on the *previous local day*, so `getDay()` reports
 * the wrong weekday and `getMonth()` the wrong month.
 *
 * Observable target: `fetchEvents` (:79-87) passes the computed range straight
 * to `calendarApi.list({ startAfter, startBefore })`. That is the helpers' raw
 * output AND the real user impact — the app asks the server for the wrong dates,
 * so a month view silently drops Sep 1 and includes Oct 1.
 *
 * Header text is deliberately NOT asserted: `formatDateRange` re-parses the day
 * string with `new Date()` itself, so it renders "Sep 12" for a *correct*
 * "2026-09-13". Proving it would conflate a separate defect.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { CalendarPage } from './CalendarPage';

const ORIGINAL_TZ = process.env.TZ;
const mockList = vi.fn();

vi.mock('../api', () => ({
  calendarApi: {
    list: (...args: unknown[]) => mockList(...args),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
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

/** Local calendar day for an instant, under the test's TZ. */
function localDay(ms: number): string {
  const d = new Date(ms);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(instantISO: string): Promise<void> {
  vi.setSystemTime(Date.parse(instantISO));
  mockList.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/calendar?tab=calendar'] },
        createElement(CalendarPage)
      )
    );
  });
  await flush();
}

function findButton(label: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label
  );
  if (!btn) throw new Error(`button "${label}" not rendered`);
  return btn as HTMLButtonElement;
}

async function click(label: string): Promise<void> {
  await act(async () => {
    findButton(label).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

/** The date range of the most recent fetch the page issued. */
function lastRange(): { startAfter: string; startBefore: string } {
  const calls = mockList.mock.calls;
  expect(calls.length, 'calendarApi.list was never called').toBeGreaterThan(0);
  const params = calls[calls.length - 1]![0] as Record<string, string>;
  expect(params).toMatchObject({ startAfter: expect.any(String), startBefore: expect.any(String) });
  return { startAfter: params.startAfter!, startBefore: params.startBefore! };
}

beforeEach(() => {
  vi.clearAllMocks();
  // America/New_York (EDT, UTC-4): UTC midnight of a day string lands on the
  // previous local evening, so getDay()/getMonth() read the wrong day.
  process.env.TZ = 'America/New_York';
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('CalendarPage view ranges (America/New_York)', () => {
  it('setup: the chosen instants really are Sun 2026-09-13 and Thu 2026-10-01 locally', () => {
    // If this stops holding, every assertion below proves nothing.
    expect(localDay(Date.parse('2026-09-13T13:00:00Z'))).toBe('2026-09-13');
    expect(localDay(Date.parse('2026-10-01T13:00:00Z'))).toBe('2026-10-01');
    // Both days share one 7-day week, so the week anchor is unambiguous.
    expect(new Date('2026-09-13').getUTCDay()).toBe(0);
  });

  it('fetches the week Sunday 2026-09-13 .. Saturday 2026-09-19', async () => {
    await mount('2026-09-13T13:00:00Z');
    // Default viewMode is 'week' and selectedDate is local today.
    // Buggy basis: new Date('2026-09-13') is Sep 12 20:00 EDT -> getDay()===6
    // -> the whole week is pulled back to 2026-09-07 .. 2026-09-13.
    expect(lastRange()).toEqual({ startAfter: '2026-09-13', startBefore: '2026-09-19' });
  });

  it('fetches the full calendar month 2026-09-01 .. 2026-09-30', async () => {
    await mount('2026-09-13T13:00:00Z');
    await click('Month');
    // Buggy basis yields 2026-09-02 .. 2026-10-01: Sep 1 events never load and
    // Oct 1 events wrongly do.
    expect(lastRange()).toEqual({ startAfter: '2026-09-01', startBefore: '2026-09-30' });
  });

  it('Next from October 1 advances to November 2026, not back into October', async () => {
    // Day-1 fixture on purpose: from mid-month navigateDate self-cancels, so a
    // mid-month date would not exercise this helper at all.
    await mount('2026-10-01T13:00:00Z');
    await click('Month');
    await click('Next');
    // Buggy: navigateDate('2026-10-01',...,+1) -> '2026-10-31' (UTC midnight of
    // Oct 1 is Sep 30 evening local, so getMonth() is still September), leaving
    // the view stuck in October.
    expect(lastRange()).toEqual({ startAfter: '2026-11-01', startBefore: '2026-11-30' });
  });

  it('Previous from October 1 goes to September 2026, not August', async () => {
    await mount('2026-10-01T13:00:00Z');
    await click('Month');
    await click('Previous');
    expect(lastRange()).toEqual({ startAfter: '2026-09-01', startBefore: '2026-09-30' });
  });

  it('CONTROL: day mode fetches exactly the selected day, unchanged by the fix', async () => {
    // Day mode returns `date` verbatim in both branches, so this holds BEFORE and
    // AFTER the fix. It is a regression guard against a localization change that
    // over-reaches into the one branch that was already correct — not a bug demo.
    await mount('2026-09-13T13:00:00Z');
    await click('Day');
    expect(lastRange()).toEqual({ startAfter: '2026-09-13', startBefore: '2026-09-13' });
  });
});
