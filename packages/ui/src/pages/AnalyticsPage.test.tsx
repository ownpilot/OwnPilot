// @vitest-environment happy-dom

/**
 * AnalyticsPage smoke test.
 *
 * Covers the shape defined in docs/IMPROVEMENT_PLAN_2026-08-12.md (WI-5):
 * mounts, shows a loading state, fires its data calls, renders an empty state,
 * and survives a failing API. It deliberately does not assert chart internals —
 * recharts is stubbed so the test exercises the page, not the charting library.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, flushAsyncUpdates, hasText, render } from '../test-harness';
import { AnalyticsPage } from './AnalyticsPage';

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockUsage = vi.fn();
const mockBreakdown = vi.fn();
const mockSubscriptions = vi.fn();
const mockSummary = vi.fn();
const mockClawStats = vi.fn();
const mockSoulsList = vi.fn();
const mockWorkflowsList = vi.fn();

vi.mock('../api', () => ({
  costsApi: {
    usage: (...a: unknown[]) => mockUsage(...a),
    getBreakdown: (...a: unknown[]) => mockBreakdown(...a),
    getSubscriptions: (...a: unknown[]) => mockSubscriptions(...a),
  },
  summaryApi: { get: (...a: unknown[]) => mockSummary(...a) },
  clawsApi: { stats: (...a: unknown[]) => mockClawStats(...a) },
  soulsApi: { list: (...a: unknown[]) => mockSoulsList(...a) },
  workflowsApi: { list: (...a: unknown[]) => mockWorkflowsList(...a) },
}));

vi.mock('react-router', async () => {
  const { createElement } = await import('react');
  return {
    Link: ({ children, to }: { children?: unknown; to?: string }) =>
      createElement('a', { href: to }, children as never),
  };
});

vi.mock('../components/icons', async () => {
  const { createIconStubs } = await import('../test-harness');
  return createIconStubs();
});

// recharts renders nothing meaningful without a measured container in
// happy-dom, and its internals are not this page's contract.
vi.mock('recharts', async () => {
  const { createElement } = await import('react');
  const stub =
    (name: string) =>
    ({ children }: { children?: unknown }) =>
      createElement('div', { 'data-testid': `chart-${name}` }, children as never);
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (typeof prop !== 'string') return undefined;
        if (prop === '__esModule') return true;
        // `then` must not be callable, or the module namespace looks like a
        // thenable and `await import('recharts')` hangs the worker.
        if (prop === 'then' || prop === 'default') return undefined;
        return stub(prop);
      },
      has: () => true,
    }
  );
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

// Matches CostsData in types/api.ts — `daily` and `monthly` are required, and
// the page dereferences `usage.daily.totalCost` unguarded.
const emptyPeriod = {
  totalTokens: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCost: 0,
  totalCostFormatted: '$0.00',
  totalRequests: 0,
};
const emptyUsage = { daily: emptyPeriod, monthly: emptyPeriod };
const emptyBreakdown = { daily: [], providers: [] };

// Matches SummaryData in types/api.ts. The page dereferences these nested
// fields unguarded (e.g. `summary.calendar.total`), so every required group
// must be present — a partial summary response crashes the render.
const emptySummary = {
  tasks: { total: 0, pending: 0, completed: 0, overdue: 0, dueToday: 0 },
  notes: { total: 0, recent: 0, pinned: 0 },
  bookmarks: { total: 0, favorites: 0 },
  calendar: { total: 0, today: 0, upcoming: 0 },
  contacts: { total: 0, favorites: 0, upcomingBirthdays: 0 },
};
const emptyClawStats = {
  total: 0,
  running: 0,
  totalCost: 0,
  totalCycles: 0,
  totalToolCalls: 0,
  byMode: {},
  byState: {},
};

function resolveAllEmpty() {
  mockUsage.mockResolvedValue(emptyUsage);
  mockBreakdown.mockResolvedValue(emptyBreakdown);
  mockSubscriptions.mockResolvedValue({
    subscriptions: [],
    totalMonthlyUsd: 0,
    counts: { subscription: 0, payPerUse: 0, free: 0 },
  });
  mockSummary.mockResolvedValue(emptySummary);
  mockClawStats.mockResolvedValue(emptyClawStats);
  mockSoulsList.mockResolvedValue([]);
  mockWorkflowsList.mockResolvedValue([]);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty();
  });

  afterEach(cleanup);

  it('mounts without throwing', () => {
    expect(() => render(<AnalyticsPage />)).not.toThrow();
  });

  it('fires every data call on mount', async () => {
    render(<AnalyticsPage />);
    await flushAsyncUpdates();

    expect(mockUsage).toHaveBeenCalled();
    expect(mockBreakdown).toHaveBeenCalled();
    expect(mockSummary).toHaveBeenCalled();
    expect(mockClawStats).toHaveBeenCalled();
    expect(mockSoulsList).toHaveBeenCalled();
    expect(mockWorkflowsList).toHaveBeenCalled();
  });

  it('renders content once loading resolves', async () => {
    const container = render(<AnalyticsPage />);
    await flushAsyncUpdates();

    expect(container.textContent).toBeTruthy();
    expect(hasText(container, 'Analytics')).toBe(true);
  });

  it('renders an empty dataset without crashing', async () => {
    const container = render(<AnalyticsPage />);
    await flushAsyncUpdates();

    // Zero-state must render real content, not a blank page or an error.
    expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
  });

  it('degrades rather than crashing when every request fails', async () => {
    // The page uses Promise.allSettled, so rejections must leave it rendered
    // with zeroed data rather than blanking or throwing.
    mockUsage.mockRejectedValue(new Error('boom'));
    mockBreakdown.mockRejectedValue(new Error('boom'));
    mockSummary.mockRejectedValue(new Error('boom'));
    mockClawStats.mockRejectedValue(new Error('boom'));
    mockSoulsList.mockRejectedValue(new Error('boom'));
    mockWorkflowsList.mockRejectedValue(new Error('boom'));
    mockSubscriptions.mockRejectedValue(new Error('boom'));

    const container = render(<AnalyticsPage />);
    await flushAsyncUpdates();

    expect(hasText(container, 'Analytics')).toBe(true);
  });

  it('refetches when the period toggle changes', async () => {
    const container = render(<AnalyticsPage />);
    await flushAsyncUpdates();

    const callsBefore = mockBreakdown.mock.calls.length;
    const toggle = [...container.querySelectorAll('button')].find((b) =>
      /30 Days/i.test(b.textContent ?? '')
    );
    expect(toggle, 'expected a "30 Days" period toggle').toBeTruthy();

    toggle!.click();
    await flushAsyncUpdates();

    expect(mockBreakdown.mock.calls.length).toBeGreaterThan(callsBefore);
    // The toggle drives the query, not just local state.
    expect(mockBreakdown).toHaveBeenLastCalledWith('month');
  });
});
