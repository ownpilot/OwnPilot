// @vitest-environment happy-dom

/**
 * Day-basis regression for the task "overdue" marker (TasksPage → TaskItem).
 *
 * `task.dueDate` is a *local calendar day* ('YYYY-MM-DD'). The overdue test
 * compared `new Date(task.dueDate)` (a bare date parses as UTC midnight) against
 * a "today" derived from `toISOString()` — the UTC calendar day. East of UTC,
 * `toISOString()` still reports *yesterday* during the early local morning, so a
 * genuinely overdue task renders as not overdue. Fixed by comparing local days.
 *
 * Rendered signal: an overdue due-date span gains the `text-error` class and an
 * AlertTriangle icon instead of Calendar (TasksPage.tsx:426-427).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { TasksPage } from './TasksPage';
import type { Task } from '../types';

const ORIGINAL_TZ = process.env.TZ;
const mockList = vi.fn();

vi.mock('../api', () => ({
  tasksApi: {
    list: (...args: unknown[]) => mockList(...args),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    complete: vi.fn(),
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

// Icons become <span data-icon="Name"> so the overdue glyph is queryable.
vi.mock('../components/icons', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    out[key] = (props: { className?: string }) =>
      createElement('span', { 'data-icon': key, className: props?.className });
  }
  return out;
});

let root: Root | null = null;

function task(over: Partial<Task> & { dueDate: string }): Task {
  return {
    id: 't-1',
    title: 'Pay the invoice',
    status: 'pending',
    ...over,
  } as unknown as Task;
}

/**
 * Render one task and wait for the async list() to settle. `Date` alone is
 * faked, so real timers still flush effects (package idiom).
 */
async function renderTask(over: Partial<Task> & { dueDate: string }): Promise<HTMLElement> {
  const item = task(over);
  mockList.mockResolvedValue([item]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/tasks?tab=tasks'] },
        createElement(TasksPage)
      )
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  // Anti-false-pass guard: a 0 marker count below must mean "not overdue",
  // never "the row never rendered".
  expect(container.textContent).toContain(item.title);
  return container;
}

function markerCount(container: HTMLElement): number {
  return container.querySelectorAll('span.text-error').length;
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

describe('TasksPage overdue day-basis', () => {
  it('setup: the fixture instant really diverges local day from UTC day', () => {
    // If this ever stops holding, the assertions below prove nothing.
    const utcDay = new Date(INSTANT).toISOString().split('T')[0]!;
    expect(localDay(INSTANT)).toBe('2026-09-06');
    expect(utcDay).toBe('2026-09-05');
    expect(utcDay).not.toBe(localDay(INSTANT));
  });

  it('marks a task due yesterday (local) as overdue in the UTC+X early morning', async () => {
    // Local today is 2026-09-06; the task was due 2026-09-05, so it IS overdue.
    const container = await renderTask({ dueDate: '2026-09-05' });
    expect(markerCount(container)).toBe(1);
    expect(container.querySelector('[data-icon="AlertTriangle"]')).not.toBeNull();
  });

  it('still marks a clearly past task as overdue (no "never overdue" fake fix)', async () => {
    const container = await renderTask({ dueDate: '2026-09-03' });
    expect(markerCount(container)).toBe(1);
  });

  it('does not mark a task due today (local) as overdue', async () => {
    const container = await renderTask({ dueDate: localDay(INSTANT) });
    expect(markerCount(container)).toBe(0);
    expect(container.querySelector('[data-icon="Calendar"]')).not.toBeNull();
  });

  it('does not mark a completed task as overdue even when its date has passed', async () => {
    const container = await renderTask({ dueDate: '2026-09-03', status: 'completed' });
    expect(markerCount(container)).toBe(0);
    expect(container.querySelector('[data-icon="Calendar"]')).not.toBeNull();
  });
});
