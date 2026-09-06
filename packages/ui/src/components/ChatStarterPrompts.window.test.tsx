// @vitest-environment happy-dom

/**
 * Calendar-window regression for the "Prep my week" starter chip (round 52).
 *
 * ChatStarterPrompts.tsx:77 queried `calendarApi.list({ start, end })`, but the
 * gateway GET /calendar handler reads ONLY `startAfter`/`startBefore`
 * (packages/gateway/src/routes/personal-data.ts:411-412) — no handler anywhere
 * in packages/gateway/src reads start/end. The date filter therefore never
 * applied, and the chip — whose prompt says "next 7 days" — listed ALL calendar
 * events, in every timezone, at every hour.
 *
 * The calendarApi mock below mirrors the real server faithfully instead of
 * returning a canned list:
 *   - like the route, it recognizes ONLY startAfter/startBefore and silently
 *     drops every other param (that drop is the defect);
 *   - like the repo (packages/gateway/src/db/repositories/calendar.ts:122-123,
 *     :249-257), it passes day strings through verbatim and compares them
 *     lexically against full-ISO startTime values, so
 *     `'2026-09-20T09:00Z' <= '2026-09-20'` is FALSE: a bare-day startBefore
 *     makes the end day exclusive, i.e. [today, today+7) is exactly 7 days.
 *
 * Fixture: America/New_York, Sun 13 Sep 2026 23:00 local — the local day is
 * 2026-09-13 while the UTC day is already 2026-09-14, so a UTC-derived window
 * (the old isoDate()) would ALSO have excluded today.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatStarterPrompts } from './ChatStarterPrompts';

const ORIGINAL_TZ = process.env.TZ;
const INSTANT = '2026-09-14T03:00:00.000Z'; // Sun 13 Sep 2026 23:00 America/New_York
const LOCAL_TODAY = '2026-09-13';
const UTC_TODAY = '2026-09-14';

const mockCalendarList = vi.fn();

/** Events as the server would return them: full-ISO startTime (DB column shape). */
function event(startTime: string, title: string) {
  return {
    id: `ev-${title}`,
    title,
    startTime,
    startDate: startTime.slice(0, 10),
    isAllDay: false,
  };
}

// Unambiguous fixtures: mid-window, far-future, far-past — the window's edge day
// (2026-09-20) is deliberately NOT exercised here; its semantics are reported
// separately (bare-day startBefore is exclusive of that day).
const IN_WINDOW = event('2026-09-16T12:00:00.000Z', 'Design review');
const OUT_FUTURE = event('2026-12-24T18:00:00.000Z', 'Christmas dinner');
const OUT_PAST = event('2026-08-01T09:00:00.000Z', 'Old planning');

vi.mock('../api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    calendarApi: {
      ...(actual as { calendarApi?: Record<string, unknown> }).calendarApi,
      list: (...a: unknown[]) => mockCalendarList(...a),
    },
    // Everything else empty so the calendar chip is the ONLY personal starter.
    tasksApi: {
      ...(actual as { tasksApi?: Record<string, unknown> }).tasksApi,
      list: vi.fn().mockResolvedValue([]),
    },
    goalsApi: {
      ...(actual as { goalsApi?: Record<string, unknown> }).goalsApi,
      list: vi.fn().mockResolvedValue({ goals: [] }),
    },
    notesApi: {
      ...(actual as { notesApi?: Record<string, unknown> }).notesApi,
      list: vi.fn().mockResolvedValue([]),
    },
    memoriesApi: {
      ...(actual as { memoriesApi?: Record<string, unknown> }).memoriesApi,
      list: vi.fn().mockResolvedValue({ memories: [] }),
    },
    habitsApi: {
      ...(actual as { habitsApi?: Record<string, unknown> }).habitsApi,
      getToday: vi.fn().mockResolvedValue({ total: 0, habits: [] }),
    },
  };
});

let root: Root | null = null;
let container: HTMLElement;

/** Route+repo-faithful stand-in: honors ONLY startAfter/startBefore, lexical compare. */
function serverRespondsWith(events: ReturnType<typeof event>[]) {
  mockCalendarList.mockImplementation((params?: Record<string, string>) => {
    const after = params?.startAfter;
    const before = params?.startBefore;
    return Promise.resolve(
      events.filter(
        (ev) =>
          (after == null || ev.startTime >= after) && (before == null || ev.startTime <= before)
      )
    );
  });
}

async function mount(events: ReturnType<typeof event>[] = [IN_WINDOW, OUT_FUTURE, OUT_PAST]) {
  serverRespondsWith(events);
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(
        ChatStarterPrompts,
        {
          show: true,
          onSend: vi.fn(),
          onDraftQuestions: vi.fn(),
          isLoadingModels: false,
          configuredProviders: ['anthropic'],
          currentProviderName: 'Anthropic',
          model: 'claude',
        },
        undefined
      )
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  // Anti-false-pass: the fetch must have actually run, so a wrong chip can only
  // come from the window logic, never from a cache hit or an unmounted tree.
  expect(mockCalendarList).toHaveBeenCalled();
  return container;
}

/** The rendered detail text of the 📅 "Prep my week" chip. */
function prepWeekDetail(): string | null {
  const chip = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes('Prep my week')
  );
  return chip ? (chip.textContent ?? null) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  // writeStarterMenuCache persists prompts for 1h (ChatPage.starters.ts:95);
  // a stale cache would skip the fetch and freeze the previous test's chips.
  localStorage.clear();
  process.env.TZ = 'America/New_York';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(INSTANT));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('ChatStarterPrompts "Prep my week" window (America/New_York evening)', () => {
  it('setup: the fixture really is local-evening / already-next-UTC-day', () => {
    const now = new Date();
    expect(now.toISOString().split('T')[0]).toBe(UTC_TODAY);
    const local = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    expect(local).toBe(LOCAL_TODAY);
    expect(LOCAL_TODAY).not.toBe(UTC_TODAY);
  });

  it('CONTROL: the chip renders and lists the in-window event (both states)', async () => {
    await mount();
    const detail = prepWeekDetail();
    expect(detail, 'chip did not render').not.toBeNull();
    expect(detail).toContain('Design review');
  });

  it('does not list events outside the 7-day window', async () => {
    await mount();
    const detail = prepWeekDetail();
    expect(detail, 'chip did not render').not.toBeNull();
    expect(detail).not.toContain('Christmas dinner');
    expect(detail).not.toContain('Old planning');
  });

  it('sends the params the route actually reads, with LOCAL days', async () => {
    await mount();
    expect(mockCalendarList).toHaveBeenCalled();
    const params = mockCalendarList.mock.calls[0]![0] as Record<string, string>;
    expect(params).toEqual({ startAfter: LOCAL_TODAY, startBefore: '2026-09-20' });
  });

  it('shows no chip when the window contains no events (absence direction)', async () => {
    // Bug assertion, not a control: pre-fix the dropped filter leaks these in.
    await mount([OUT_FUTURE, OUT_PAST]);
    expect(prepWeekDetail()).toBeNull();
  });

  it('CONTROL: no chip when the server returns nothing (both states)', async () => {
    await mount([]);
    expect(prepWeekDetail()).toBeNull();
  });
});
