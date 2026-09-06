// @vitest-environment happy-dom

/**
 * Header day-basis regression for CalendarPage's display formatters (round 48).
 *
 * `formatDateRange` (:689) and `formatDateHeader` (:709) receive a LOCAL
 * 'YYYY-MM-DD' calendar day but parse it with `new Date(dateString)`, which is
 * UTC midnight — 20:00 on the PREVIOUS local day in America/New_York. They then
 * format/read it with local accessors, so every rendered label lands one day
 * early:
 *
 *   selectedDate 2026-09-13, local today 2026-09-13
 *     week header   "Sep 12 - Sep 18, 2026"   correct "Sep 13 - Sep 19, 2026"
 *     event today   "Saturday, September 12"  correct "Today"
 *     event tomorrow "Today"                  correct "Tomorrow"
 *     month header  "September 2026" for Oct 1 correct "October 2026"
 *
 * `formatDateHeader`'s mismatch is the severe one: it does not merely shift a
 * label, it actively mislabels TOMORROW's group as "Today".
 *
 * This is the counterpart to CalendarPage.view-range.test.tsx. That file could
 * not use header text because the helpers under test there were corrupted by
 * these very formatters; here the formatters ARE the subject, so displayed text
 * is the correct observable. Fix reuses round 47's `parseLocalDay`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { CalendarPage } from './CalendarPage';
import type { CalendarEvent } from '../api';

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

function event(startDate: string, title: string): CalendarEvent {
  return {
    id: `ev-${startDate}`,
    title,
    startDate,
    isAllDay: true,
    reminders: [],
  } as unknown as CalendarEvent;
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Text of the `<h3>` date-range header (:260). */
function headerTexts(): string[] {
  return Array.from(container.querySelectorAll('h3'))
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean);
}

/** Text of the `<h4>` per-day group headers (:312), rendered by formatDateHeader. */
function groupHeaderTexts(): string[] {
  return Array.from(container.querySelectorAll('h4'))
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean);
}

function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(instantISO: string, events: CalendarEvent[] = []): Promise<void> {
  vi.setSystemTime(Date.parse(instantISO));
  mockList.mockResolvedValue(events);
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
  // Anti-false-pass: the tab rendered and the date header exists, so an empty
  // assertion below means a wrong day, never an unmounted component.
  expect(headerTexts().length).toBeGreaterThan(0);
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

// A Sunday, so the week it anchors is unambiguous.
const TODAY_ISO = '2026-09-13T13:00:00Z';

beforeEach(() => {
  vi.clearAllMocks();
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

describe('CalendarPage header day-basis (America/New_York)', () => {
  it('setup: UTC-midnight parsing really lands on the previous local evening', () => {
    // The precondition for every assertion below. Unlike round 47 this trap does
    // NOT depend on the faked instant: `new Date('YYYY-MM-DD')` is always UTC
    // midnight, which is 20:00 the day before here, whatever "now" is.
    const utcMidnight = new Date('2026-09-13');
    expect(utcMidnight.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).toBe(
      'Sep 12'
    );
    const localMidnight = new Date(2026, 8, 13);
    expect(localMidnight.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).toBe(
      'Sep 13'
    );
    expect(localDay(Date.parse(TODAY_ISO))).toBe('2026-09-13');
  });

  it('renders the week range Sep 13 - Sep 19, 2026 for Sunday the 13th', async () => {
    await mount(TODAY_ISO, [event('2026-09-13', 'Kickoff')]);
    // viewMode defaults to 'week'.
    expect(headerTexts()).toContain('Sep 13 - Sep 19, 2026');
  });

  it('labels an event on the local today as "Today"', async () => {
    await mount(TODAY_ISO, [event('2026-09-13', 'Kickoff')]);
    expect(groupHeaderTexts()).toContain('Today');
  });

  it('labels an event on the local tomorrow as "Tomorrow", not "Today"', async () => {
    await mount(TODAY_ISO, [event('2026-09-14', 'Dentist')]);
    const groups = groupHeaderTexts();
    expect(groups).toContain('Tomorrow');
    // The inverse face of the same bug: tomorrow must not borrow today's label.
    expect(groups).not.toContain('Today');
  });

  it('labels an older event with its own weekday, not the day before', async () => {
    await mount(TODAY_ISO, [event('2026-09-20', 'Review')]);
    expect(groupHeaderTexts()).toContain('Sunday, September 20');
  });

  it('shows "October 2026" when the month view is on 2026-10-01', async () => {
    // Day 1 of the month: UTC midnight of 10-01 is 20:00 on Sep 30 locally, so
    // the buggy month label reads a whole month back.
    await mount('2026-10-01T13:00:00Z', [event('2026-10-01', 'Sprint start')]);
    await click('Month');
    expect(headerTexts()).toContain('October 2026');
  });

  it('shows "Sunday, September 13, 2026" in day mode', async () => {
    await mount(TODAY_ISO, [event('2026-09-13', 'Kickoff')]);
    await click('Day');
    expect(headerTexts()).toContain('Sunday, September 13, 2026');
  });

  it('CONTROL: today/upcoming counters stay correct (round-46 fix not regressed)', async () => {
    // These read the hoisted localToday, so they are right BEFORE and AFTER this
    // change — a guard that localizing the formatters does not disturb the
    // counters that were already fixed.
    await mount(TODAY_ISO, [
      event('2026-09-13', 'Kickoff'),
      event('2026-09-14', 'Dentist'),
      event('2026-09-20', 'Review'),
    ]);
    expect(container.textContent).toContain('1 event today, 2 upcoming');
  });
});
