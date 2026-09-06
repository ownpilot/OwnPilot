// @vitest-environment happy-dom

/**
 * Date-input `min` day-basis regression for GoalWizard (round 50).
 *
 * Step 1 renders the Due Date field with `min={new Date().toISOString().split('T')[0]}`
 * (GoalWizard.tsx:288) — the UTC calendar day. West of UTC the UTC day is already
 * TOMORROW during the local evening, so a user in New York at 23:00 on 2026-09-13
 * gets min="2026-09-14" and can no longer pick today: per HTML constraint
 * validation a date value below `min` fails (rangeUnderflow) and the native picker
 * greys the day out. Fixed by using localDayString().
 *
 * WHY the assertions read the attribute + inequality instead of `input.validity`:
 * happy-dom's ValidityState implements rangeUnderflow/rangeOverflow only for
 * `type === 'number' || type === 'range'` (see
 * node_modules/happy-dom/lib/validity-state/ValidityState.js), so `type="date"`
 * min/max is NOT modelled there — asserting `validity.rangeUnderflow === true`
 * would fail for a missing-environment reason, and asserting `=== false` would
 * "pass" without proving anything. `min` is the exact string the browser consumes,
 * so the attribute plus the value >= min rule is the honest observable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { GoalWizard } from './GoalWizard';

const ORIGINAL_TZ = process.env.TZ;

// 2026-09-14T03:00Z === Sun 13 Sep 2026, 23:00 in America/New_York.
const INSTANT = '2026-09-14T03:00:00.000Z';
const LOCAL_TODAY = '2026-09-13';
const UTC_TODAY = '2026-09-14';

const mockGoalCreate = vi.fn();

vi.mock('../../api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    goalsApi: {
      ...(actual as { goalsApi?: Record<string, unknown> }).goalsApi,
      create: (...a: unknown[]) => mockGoalCreate(...a),
    },
  };
});

let root: Root | null = null;
let container: HTMLElement;

function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label
  ) as HTMLButtonElement | undefined;
}

async function click(btn: Element): Promise<void> {
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

/** Set a controlled input the way React observes it (native setter + input event). */
async function type(el: HTMLInputElement, value: string): Promise<void> {
  const proto = el.ownerDocument.defaultView!.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

const dateInput = (): HTMLInputElement | null => container.querySelector('input[type="date"]');

/**
 * Mount the wizard and walk to step 1 (Set Target) the way a user does:
 * step 0's canGoNext requires a title of >= 3 chars (GoalWizard.tsx:73).
 */
async function openTargetStep(): Promise<HTMLInputElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(GoalWizard, {
          onComplete: vi.fn(),
          onCancel: vi.fn(),
        })
      )
    );
  });
  await flush();

  const title = container.querySelector('input[type="text"]') as HTMLInputElement;
  expect(title, 'step 0 did not render').not.toBeNull();
  await type(title, 'Run a marathon');
  await click(findButton('Next')!);

  const date = dateInput();
  // Anti-false-pass: reachability of the field under test, so a later failure
  // cannot be a navigation/setup artifact.
  expect(date, 'step 1 (Due Date) did not render after Next').not.toBeNull();
  return date!;
}

function localDayOf(ms: number): string {
  const d = new Date(ms);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = 'America/New_York';
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

describe('GoalWizard Due Date min (America/New_York evening)', () => {
  it('setup: the fixture really is local-evening / already-next-UTC-day', () => {
    // If this stops holding, nothing below proves anything.
    const now = new Date();
    expect(now.toISOString().split('T')[0]).toBe(UTC_TODAY);
    expect(localDayOf(now.getTime())).toBe(LOCAL_TODAY);
    expect(LOCAL_TODAY).not.toBe(UTC_TODAY);
  });

  it('sets the min attribute to the LOCAL today', async () => {
    const date = await openTargetStep();
    // Buggy: min="2026-09-14" (tomorrow) on a Sep-13 evening.
    expect(date.getAttribute('min')).toBe(LOCAL_TODAY);
  });

  it('lets the user pick today (value >= min, the HTML date constraint)', async () => {
    const date = await openTargetStep();
    const min = date.getAttribute('min')!;
    // Today is selectable only when min <= today; browsers reject values below
    // min for type=date via rangeUnderflow.
    expect(LOCAL_TODAY >= min).toBe(true);
  });

  it('CONTROL: a future date stays selectable (min must not over-restrict)', async () => {
    const date = await openTargetStep();
    const min = date.getAttribute('min')!;
    expect('2026-12-31' >= min).toBe(true);
    // And the min must be a real date, not empty/garbage that would let any day
    // through: it has to be exactly one calendar day.
    expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('CONTROL: typing a date keeps it in the field (fix must not clear input)', async () => {
    const date = await openTargetStep();
    await type(date, LOCAL_TODAY);
    expect(dateInput()!.value).toBe(LOCAL_TODAY);
  });
});
