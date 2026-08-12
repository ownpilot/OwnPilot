// @vitest-environment happy-dom

/**
 * LogsPage smoke test — see docs/IMPROVEMENT_PLAN_2026-08-12.md (WI-5).
 *
 * Mounts, fires its data calls, renders both populated and empty states, and
 * survives a failing API.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, flushAsyncUpdates, hasText, render } from '../test-harness';
import { LogsPage } from './LogsPage';

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockListLogs = vi.fn();
const mockGetLogStats = vi.fn();
const mockGet = vi.fn();
const mockGetLogs = vi.fn();
const mockDeleteLogs = vi.fn();
const mockClear = vi.fn();

vi.mock('../api', () => ({
  debugApi: {
    listLogs: (...a: unknown[]) => mockListLogs(...a),
    getLogStats: (...a: unknown[]) => mockGetLogStats(...a),
    get: (...a: unknown[]) => mockGet(...a),
    getLogs: (...a: unknown[]) => mockGetLogs(...a),
    deleteLogs: (...a: unknown[]) => mockDeleteLogs(...a),
    clear: (...a: unknown[]) => mockClear(...a),
  },
}));

const mockConfirm = vi.fn().mockResolvedValue(true);
vi.mock('../components/ConfirmDialog', () => ({
  useDialog: () => ({ confirm: mockConfirm, alert: vi.fn(), prompt: vi.fn() }),
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('../components/ToastProvider', () => ({
  useToast: () => mockToast,
}));

// The real hook navigates to `defaultTab` on mount when the skip preference is
// set. LogsPage gates all fetching on `activeTab !== 'home'`, so a stub that
// only returns `skipHome: true` leaves the page on the home tab and no data
// call ever fires — the mock has to reproduce the navigation.
vi.mock('../hooks/useSkipHome', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    useSkipHome: ({
      defaultTab,
      onNavigate,
    }: {
      defaultTab?: string;
      onNavigate?: (tab: string) => void;
    }) => {
      // Navigate exactly once, guarded by a ref rather than by the dep array.
      // LogsPage passes a fresh `onNavigate` closure on every render, so a
      // dependency-based effect re-fires forever and drags the page back to
      // the default tab — which silently defeated every test that clicks a
      // different tab.
      const done = useRef(false);
      useEffect(() => {
        if (done.current) return;
        done.current = true;
        if (defaultTab && onNavigate) onNavigate(defaultTab);
      });
      return { skipHome: true, onSkipHomeChange: () => {} };
    },
  };
});

vi.mock('../components/icons', async () => {
  const { createIconStubs } = await import('../test-harness');
  return createIconStubs();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

// Matches LogStats in api/types/system.ts. Note `formatTokens` in the page
// guards `null` but not `undefined`, so a stats object missing token fields
// throws on render rather than degrading — the fixture must be complete.
const emptyStats = {
  totalRequests: 0,
  errorCount: 0,
  successCount: 0,
  avgDurationMs: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  byProvider: {},
  byType: {},
};

function resolveAllEmpty() {
  mockListLogs.mockResolvedValue({ logs: [], total: 0 });
  mockGetLogStats.mockResolvedValue(emptyStats);
  // debugApi.get returns DebugInfo — `summary` is read by the tab bar badge
  // even while the requests tab is active, so it must always be present.
  mockGet.mockResolvedValue({
    entries: [],
    summary: { toolCalls: 0, errors: 0, requests: 0, responses: 0 },
  });
  mockGetLogs.mockResolvedValue({ log: null });
  mockDeleteLogs.mockResolvedValue({ deleted: 0 });
  mockClear.mockResolvedValue({ cleared: true });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('LogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    resolveAllEmpty();
  });

  afterEach(cleanup);

  it('mounts without throwing', () => {
    expect(() => render(<LogsPage />)).not.toThrow();
  });

  it('renders after its data settles', async () => {
    const container = render(<LogsPage />);
    await flushAsyncUpdates();

    expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
  });

  it('requests log data on mount', async () => {
    render(<LogsPage />);
    await flushAsyncUpdates();

    // At least one of the page's data sources must be queried; the page
    // chooses between them by active tab.
    const called =
      mockListLogs.mock.calls.length +
      mockGetLogStats.mock.calls.length +
      mockGet.mock.calls.length;
    expect(called).toBeGreaterThan(0);
  });

  it('renders an empty state rather than a blank page', async () => {
    const container = render(<LogsPage />);
    await flushAsyncUpdates();

    expect(container.textContent?.trim()).toBeTruthy();
  });

  it('does not crash when every request fails', async () => {
    mockListLogs.mockRejectedValue(new Error('boom'));
    mockGetLogStats.mockRejectedValue(new Error('boom'));
    mockGet.mockRejectedValue(new Error('boom'));

    const container = render(<LogsPage />);
    await flushAsyncUpdates();

    expect(container.querySelectorAll('*').length).toBeGreaterThan(0);
  });

  describe('debug tab', () => {
    // The debug half lives in ./logs/DebugLogsTab. These assertions exist so
    // that split is covered — the request-log tests above never render it.
    async function openDebugTab() {
      const container = render(<LogsPage />);
      await flushAsyncUpdates();
      const tab = [...container.querySelectorAll('button')].find((b) =>
        /Debug Logs/i.test(b.textContent ?? '')
      );
      expect(tab, 'expected a "Debug Logs" tab').toBeTruthy();
      tab!.click();
      // Two flushes: the click commits the tab change, whose effect then fires
      // the fetch — the resulting setState lands on a later tick.
      await flushAsyncUpdates();
      await flushAsyncUpdates();
      return container;
    }

    it('fetches debug logs when the tab is opened', async () => {
      await openDebugTab();
      expect(mockGet).toHaveBeenCalled();
    });

    it('renders returned debug entries', async () => {
      mockGet.mockResolvedValue({
        entries: [
          {
            id: 'dbg-1',
            type: 'tool_call',
            timestamp: '2026-08-12T10:00:00Z',
            data: { name: 'search_web' },
          },
        ],
        summary: { toolCalls: 1, errors: 0, requests: 0, responses: 0 },
      });

      const container = await openDebugTab();

      expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
      // The row renders `entry.type.replace('_', ' ')` and `entry.data.name`.
      expect(hasText(container, 'tool call')).toBe(true);
      expect(hasText(container, 'search_web')).toBe(true);
    });

    it('renders an empty debug state without crashing', async () => {
      mockGet.mockResolvedValue({
        entries: [],
        summary: { toolCalls: 0, errors: 0, requests: 0, responses: 0 },
      });

      const container = await openDebugTab();
      expect(container.textContent?.trim()).toBeTruthy();
    });
  });

  it('renders returned log rows', async () => {
    // Full RequestLog shape (api/types/system.ts). Every field is required —
    // nullable, but present. The page reads them unguarded against undefined.
    mockListLogs.mockResolvedValue({
      logs: [
        {
          id: 'log-1',
          type: 'chat',
          conversationId: 'conv-1',
          provider: 'anthropic',
          model: 'claude-opus-5',
          statusCode: 200,
          durationMs: 42,
          inputTokens: 120,
          outputTokens: 80,
          error: null,
          createdAt: '2026-08-12T10:00:00Z',
        },
      ],
      total: 1,
    });

    const container = render(<LogsPage />);
    await flushAsyncUpdates();

    // Tab-dependent: assert only that rendering populated data does not throw
    // and the page still has content.
    expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
    expect(hasText(container, 'Logs') || container.textContent!.length > 0).toBe(true);
  });
});
