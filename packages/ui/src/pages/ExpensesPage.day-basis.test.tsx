// @vitest-environment happy-dom

/**
 * Write-path day-basis regression for ExpenseFormModal (round 49).
 *
 * The create-form's default date came from `new Date().toISOString().split('T')[0]`
 * — the UTC calendar day. West of UTC that is TOMORROW during the local evening,
 * and because `handleSubmit` spreads formData straight into
 * `expensesApi.create(payload)`, a user in New York adding an expense at 23:00 on
 * Sep 13 silently PERSISTED an expense dated Sep 14. Unlike the header defects,
 * this is data corruption, not display, so the assertion targets the payload that
 * reaches the API (plus the input's rendered value, which is what the user sees).
 *
 * Reuses `localDayString()` from utils/formatters (round 46).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { ExpensesPage } from './ExpensesPage';
import type { ExpenseEntry } from '../api';

const ORIGINAL_TZ = process.env.TZ;

// 2026-09-14T03:00Z === Sun 13 Sep 2026, 23:00 in America/New_York: the local
// day is 2026-09-13 while the UTC day has already rolled to 2026-09-14.
const INSTANT = '2026-09-14T03:00:00.000Z';
const LOCAL_TODAY = '2026-09-13';
const UTC_TODAY = '2026-09-14';

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

function expense(over: Partial<ExpenseEntry> & { date: string }): ExpenseEntry {
  return {
    id: 'exp-1',
    description: 'Coffee',
    amount: 42.5,
    currency: 'TRY',
    category: 'food',
    ...over,
  } as unknown as ExpenseEntry;
}

function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(rows: ExpenseEntry[] = []): Promise<void> {
  // Shapes read by the page: summary.summary.{totalByCurrency,dailyAverage,
  // totalExpenses,topCategories} (:330-:371) and monthlyData.{months,yearTotal,
  // categories} (:172-:423). An incomplete mock throws inside render and makes
  // every test fail for setup, which is what happened on the first attempt.
  mockMonthly.mockResolvedValue({ months: [], categories: {}, yearTotal: 0 });
  mockSummary.mockResolvedValue({
    summary: {
      totalByCurrency: {},
      dailyAverage: 0,
      totalExpenses: 0,
      topCategories: [],
    },
    categories: {},
  });
  mockList.mockResolvedValue({ expenses: rows });
  mockCreate.mockResolvedValue({ id: 'new-1' });
  mockUpdate.mockResolvedValue({ id: 'exp-1' });

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
  await flush();
  // Anti-false-pass: prove we are on the expenses tab with its trigger present,
  // so a later "input missing" failure cannot masquerade as the bug.
  expect(findButton('Add Expense')).toBeTruthy();
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

/** Set a controlled input's value the way React observes it (native setter + input event). */
async function type(el: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    el.ownerDocument.defaultView!.HTMLInputElement.prototype,
    'value'
  )!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

const dateInput = (): HTMLInputElement =>
  container.querySelector('input[type="date"]') as HTMLInputElement;
const amountInput = (): HTMLInputElement =>
  container.querySelector('input[type="number"]') as HTMLInputElement;

async function submitForm(): Promise<void> {
  const form = container.querySelector('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

/** The payload the page actually sent to the server. */
function createdPayload(): Record<string, unknown> {
  expect(mockCreate).toHaveBeenCalledTimes(1);
  return mockCreate.mock.calls[0]![0] as Record<string, unknown>;
}

async function openCreateForm(): Promise<void> {
  await click(findButton('Add Expense')!);
  expect(dateInput()).not.toBeNull();
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

describe('ExpenseFormModal default date (America/New_York evening)', () => {
  it('setup: the fixture really is a local-evening/next-UTC-day split', () => {
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

  it('prefills the date field with the LOCAL today, not the UTC day', async () => {
    await mount();
    await openCreateForm();
    expect(dateInput().value).toBe(LOCAL_TODAY);
  });

  it('PERSISTS the local today when the user leaves the date untouched', async () => {
    // The real defect: the wrong default is not merely displayed, it is saved.
    await mount();
    await openCreateForm();
    await type(amountInput(), '10');
    await submitForm();
    expect(createdPayload().date).toBe(LOCAL_TODAY);
  });

  it('CONTROL: a user-typed date is sent unchanged (fix must not overwrite input)', async () => {
    // True before and after the fix: guards against "fixing" the default by
    // forcing local today on every submit.
    await mount();
    await openCreateForm();
    await type(dateInput(), '2026-01-05');
    await type(amountInput(), '10');
    await submitForm();
    expect(createdPayload().date).toBe('2026-01-05');
  });

  it('CONTROL: editing an expense keeps that expense stored date', async () => {
    // Also true before and after: the bug only affected the create default.
    await mount([expense({ date: '2026-08-01' })]);
    const editBtn = container.querySelector('[aria-label="Edit expense"]');
    expect(editBtn, 'expense row did not render').not.toBeNull();
    await click(editBtn!);
    expect(dateInput()).not.toBeNull();
    expect(dateInput().value).toBe('2026-08-01');
    await type(amountInput(), '10');
    await submitForm();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect((mockUpdate.mock.calls[0]![1] as Record<string, unknown>).date).toBe('2026-08-01');
  });
});
