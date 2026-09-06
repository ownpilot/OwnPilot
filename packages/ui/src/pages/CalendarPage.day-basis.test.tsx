// @vitest-environment happy-dom

/**
 * Day-basis regression for CalendarPage's "today" counters (round 46).
 *
 * `CalendarEvent.startDate` is a *local* calendar day ('YYYY-MM-DD'). The
 * today/upcoming split compared it against `new Date().toISOString()`, which is
 * the UTC calendar day. East of UTC, `toISOString()` still reports yesterday in
 * the early local morning, so today's events are counted as "upcoming" while
 * yesterday's events are wrongly counted as "today".
 *
 * Observable target: the page header renders
 *   `{todayEvents.length} event{s} today, {upcomingEvents.length} upcoming`
 * (CalendarPage.tsx:137-138), so the assertion is made on user-visible text.
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

function event(startDate: string, title: string): CalendarEvent {
  return {
    id: `ev-${startDate}-${title}`,
    title,
    startDate,
    isAllDay: true,
    reminders: [],
  } as unknown as CalendarEvent;
}

/** Local calendar day ('YYYY-MM-DD') for the faked instant. */
function localDay(ms: number): string {
  const d = new Date(ms);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

async function renderPage(events: CalendarEvent[]): Promise<HTMLElement> {
  mockList.mockResolvedValue(events);
  const container = document.createElement('div');
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  // Anti-false-pass guard: the counters must be present before we read them,
  // otherwise "0" could just mean "nothing rendered".
  expect(container.textContent).toMatch(/\d+ event[s]? today, \d+ upcoming/);
  return container;
}

function counters(container: HTMLElement): string | null {
  return container.textContent?.match(/\d+ events? today, \d+ upcoming/)?.[0] ?? null;
}

const INSTANT = Date.parse('2026-09-05T22:30:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  // Asia/Kolkata (UTC+05:30): local day is 2026-09-06 while UTC still reports
  // 2026-09-05 — the divergence that drives the defect.
  process.env.TZ = 'Asia/Kolkata';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(INSTANT);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('CalendarPage today/upcoming day-basis', () => {
  it('setup: the fixture instant really diverges local day from UTC day', () => {
    // If this ever stops holding, the assertions below prove nothing.
    expect(localDay(INSTANT)).toBe('2026-09-06');
    expect(new Date(INSTANT).toISOString().split('T')[0]).toBe('2026-09-05');
  });

  it("counts an event starting local-today as today's, not upcoming", async () => {
    const container = await renderPage([event(localDay(INSTANT), 'Standup')]);
    // Local today is 2026-09-06. The buggy UTC basis puts this in "upcoming".
    expect(counters(container)).toBe('1 event today, 0 upcoming');
  });

  it('does not count yesterdays event as todays', async () => {
    const container = await renderPage([event('2026-09-05', 'Old planning')]);
    expect(counters(container)).toBe('0 events today, 0 upcoming');
  });

  it('splits a mixed list correctly', async () => {
    const container = await renderPage([
      event(localDay(INSTANT), 'Standup'),
      event('2026-09-05', 'Old planning'),
      event('2026-09-20', 'Review'),
    ]);
    expect(counters(container)).toBe('1 event today, 1 upcoming');
  });

  // NOTE: the selectedDate default (:51) and the "Today" button (:259) are the
  // same UTC-vs-local expression and are fixed with the same helper, but they
  // get no render assertion here: the week header renders getViewStartDate(),
  // which yields "Sep 5" as the week anchor under BOTH bases in this fixture, so
  // no observable text distinguishes a correct default from a wrong one. A test
  // that passes either way would be assertion theatre, so the counters above
  // carry the proof and the :51/:259 edits are covered by construction.
});
