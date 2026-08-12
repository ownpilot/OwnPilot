// @vitest-environment happy-dom

/**
 * ClawsPage smoke test — see docs/IMPROVEMENT_PLAN_2026-08-12.md (WI-5).
 *
 * Mounts, fires its data calls, renders populated and empty states, and
 * survives a failing list request.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, flushAsyncUpdates, hasText, render } from '../test-harness';
import { ClawsPage } from './ClawsPage';

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockList = vi.fn();
const mockRecommendations = vi.fn();
const mockStats = vi.fn();

vi.mock('../api/endpoints/claws', () => ({
  clawsApi: {
    list: (...a: unknown[]) => mockList(...a),
    recommendations: (...a: unknown[]) => mockRecommendations(...a),
    stats: (...a: unknown[]) => mockStats(...a),
    start: vi.fn().mockResolvedValue({}),
    pause: vi.fn().mockResolvedValue({}),
    resume: vi.fn().mockResolvedValue({}),
    stop: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    approveEscalation: vi.fn().mockResolvedValue({}),
    denyEscalation: vi.fn().mockResolvedValue({}),
    applyRecommendations: vi.fn().mockResolvedValue({}),
    applyRecommendationBatch: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('react-router', async () => {
  const { createElement } = await import('react');
  return {
    useSearchParams: () => [new URLSearchParams(), () => {}],
    Link: ({ children, to }: { children?: unknown; to?: string }) =>
      createElement('a', { href: to }, children as never),
  };
});

// vi.hoisted: the factory below is hoisted above imports, so it cannot close
// over a plain module-level const.
const mockSubscribe = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useWebSocket', () => ({
  useGateway: () => ({ subscribe: mockSubscribe }),
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('../components/ToastProvider', () => ({ useToast: () => mockToast }));

vi.mock('../components/ConfirmDialog', () => ({
  useDialog: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    alert: vi.fn(),
    prompt: vi.fn(),
  }),
}));

vi.mock('../components/icons', async () => {
  const { createIconStubs } = await import('../test-harness');
  return createIconStubs();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

const sampleClaw = {
  id: 'claw-1',
  name: 'Nightly researcher',
  mission: 'Summarise the daily feed',
  mode: 'interval',
  state: 'idle',
  status: 'active',
  enabled: true,
  cycleCount: 3,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-11T00:00:00Z',
};

function resolveEmpty() {
  mockList.mockResolvedValue({ claws: [], total: 0 });
  mockRecommendations.mockResolvedValue({ recommendations: [] });
  mockStats.mockResolvedValue({ needsAttention: 0, llmConcurrency: null });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ClawsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The page collects unsubscribe callbacks and invokes them on unmount, so
    // subscribe must return a function or teardown throws.
    mockSubscribe.mockReturnValue(() => {});
    resolveEmpty();
  });

  afterEach(cleanup);

  it('mounts without throwing', () => {
    expect(() => render(<ClawsPage />)).not.toThrow();
  });

  it('fetches claws, recommendations and stats on mount', async () => {
    render(<ClawsPage />);
    await flushAsyncUpdates();

    expect(mockList).toHaveBeenCalled();
    expect(mockRecommendations).toHaveBeenCalled();
    expect(mockStats).toHaveBeenCalled();
  });

  it('renders an empty state rather than a blank page', async () => {
    const container = render(<ClawsPage />);
    await flushAsyncUpdates();

    expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
  });

  it('renders a returned claw', async () => {
    mockList.mockResolvedValue({ claws: [sampleClaw], total: 1 });

    const container = render(<ClawsPage />);
    await flushAsyncUpdates();

    expect(hasText(container, 'Nightly researcher')).toBe(true);
  });

  it('does not crash when the list request fails', async () => {
    // recommendations/stats have their own .catch() in the page; list does not,
    // so a rejection here exercises the page's own error path.
    mockList.mockRejectedValue(new Error('boom'));

    const container = render(<ClawsPage />);
    await flushAsyncUpdates();

    expect(container.querySelectorAll('*').length).toBeGreaterThan(0);
  });

  it('unsubscribes from gateway events on unmount', async () => {
    const unsubscribe = vi.fn();
    mockSubscribe.mockReturnValue(unsubscribe);

    render(<ClawsPage />);
    await flushAsyncUpdates();

    expect(mockSubscribe, 'page should subscribe to live claw events').toHaveBeenCalled();

    cleanup();
    expect(unsubscribe, 'every subscription must be torn down').toHaveBeenCalled();
  });
});
