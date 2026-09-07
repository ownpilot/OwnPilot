// @vitest-environment happy-dom

/**
 * Render-basis day-basis regression for GoalsPage (round 55).
 *
 * The goal card rendered the stored LOCAL 'YYYY-MM-DD' due date through
 * `new Date(goal.dueDate).toLocaleDateString()`. Date-only strings parse as
 * UTC midnight — the previous local evening west of UTC — so a goal due
 * 2026-09-13 displayed as the 12th in America/New_York. Same defect class as
 * round 53 (ExpensesPage row date); stored goal due dates are local day
 * strings (GoalsRepository writes them via localDayString, round 16).
 * Fixed by rendering through parseLocalDay() from utils/formatters.
 *
 * TZ control: launch-time TZ env is IGNORED on Windows; runtime
 * process.env.TZ mutation IS honored — set the zone inside beforeEach.
 * Locale note: assertions are locale-free (day-of-month getters and
 * formatter-relative comparisons); this host's default ICU locale is de-DE,
 * so US-format literals would be wrong here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { GoalsPage } from './GoalsPage';
import { parseLocalDay } from '../utils/formatters';
import type { Goal } from '../api';

const ORIGINAL_TZ = process.env.TZ;

// 2026-09-14T03:00Z === Sun 13 Sep 2026, 23:00 in America/New_York.
const INSTANT = '2026-09-14T03:00:00.000Z';
const STORED_DAY = '2026-09-13';

const mockList = vi.fn();

vi.mock('../api', () => ({
  goalsApi: {
    list: (...a: unknown[]) => mockList(...a),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
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

function goal(over: Partial<Goal>): Goal {
  return {
    id: 'g1',
    title: 'Run a marathon',
    status: 'active',
    priority: 5,
    progress: 40,
    ...over,
  } as unknown as Goal;
}

function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(goals: Goal[]): Promise<void> {
  mockList.mockResolvedValue({ goals });
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/goals?tab=goals'] },
        createElement(GoalsPage)
      )
    );
  });
  await flush();
}

/** Text of the "Due: <date>" line of a goal card. */
function dueText(): string | null {
  const el = Array.from(container.querySelectorAll('p')).find((p) =>
    (p.textContent ?? '').startsWith('Due:')
  );
  return el?.textContent ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = 'America/New_York';
  // The trap is TZ-dependent, not clock-dependent; pin the clock only to keep
  // the fixture deterministic (rounds 48-53 idiom).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(INSTANT));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('GoalsPage due-date render basis (America/New_York)', () => {
  it('setup: UTC-midnight parsing really lands on the previous local evening', () => {
    // Precondition for the assertion below: the parse trap is live in this TZ
    // and the two candidate renderings actually differ. Asserted via local
    // day-of-month getters — locale-free.
    expect(new Date(STORED_DAY).getDate()).toBe(12);
    expect(parseLocalDay(STORED_DAY).getDate()).toBe(13);
    expect(new Date(STORED_DAY).toLocaleDateString()).not.toBe(
      parseLocalDay(STORED_DAY).toLocaleDateString()
    );
  });

  it('lists a goal due 2026-09-13 as the 13th, not the day before', async () => {
    await mount([goal({ dueDate: STORED_DAY })]);

    const text = dueText();
    // Anti-false-pass: the goal card rendered, so a wrong date below is a wrong
    // render, never an unmounted list.
    expect(text, 'goal card due line did not render').not.toBeNull();
    // Locale-tolerant: compare against the same formatter call the fix uses.
    expect(text).toContain(parseLocalDay(STORED_DAY).toLocaleDateString());
  });

  it('CONTROL: at UTC the render is identical before and after the fix', async () => {
    // At UTC the old code was accidentally correct; this guards against the
    // local-anchored fix changing anything for UTC users.
    process.env.TZ = 'UTC';
    await mount([goal({ dueDate: STORED_DAY })]);
    expect(dueText()).toContain(parseLocalDay(STORED_DAY).toLocaleDateString());
  });
});
