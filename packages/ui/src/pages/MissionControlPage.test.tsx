// @vitest-environment happy-dom

/**
 * MissionControlPage smoke test — see docs/IMPROVEMENT_PLAN_2026-08-12.md (WI-5).
 *
 * Mounts, fires its data calls, renders populated and empty states, survives a
 * failing list request, and tears down its gateway subscriptions.
 *
 * Written before splitting the page (1109 LOC) so the decomposition has a net
 * underneath it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, flushAsyncUpdates, hasText, render } from '../test-harness';
import { MissionControlPage } from './MissionControlPage';

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockList = vi.fn();
const mockListSessions = vi.fn();

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  clawsApi: {
    list: (...a: unknown[]) => mockList(...a),
    start: vi.fn().mockResolvedValue({}),
    pause: vi.fn().mockResolvedValue({}),
    resume: vi.fn().mockResolvedValue({}),
    stop: vi.fn().mockResolvedValue({}),
    resetFailures: vi.fn().mockResolvedValue({}),
    approveEscalation: vi.fn().mockResolvedValue({}),
    denyEscalation: vi.fn().mockResolvedValue({}),
    sendMessage: vi.fn().mockResolvedValue({}),
    setIntent: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../api/endpoints/coding-agents', () => ({
  codingAgentsApi: { listSessions: (...a: unknown[]) => mockListSessions(...a) },
}));

vi.mock('react-router', async () => {
  const { createElement } = await import('react');
  return {
    Link: ({ children, to }: { children?: unknown; to?: string }) =>
      createElement('a', { href: to }, children as never),
  };
});

// vi.hoisted: the factory is hoisted above imports, so it cannot close over a
// plain module-level const.
const mockSubscribe = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useWebSocket', () => ({
  useGateway: () => ({ subscribe: mockSubscribe }),
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('../components/ToastProvider', () => ({ useToast: () => mockToast }));

vi.mock('./claws/CreateClawModal', () => ({ CreateClawModal: () => null }));

vi.mock('../components/icons', async () => {
  const { createIconStubs } = await import('../test-harness');
  return createIconStubs();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

function claw(over: Record<string, unknown> = {}) {
  return {
    id: 'claw-1',
    name: 'Nightly researcher',
    mission: 'Summarise the daily feed',
    mode: 'interval',
    status: 'active',
    enabled: true,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    ...over,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('MissionControlPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The page collects unsubscribe callbacks and invokes them on unmount, so
    // subscribe must return a function or teardown throws.
    mockSubscribe.mockReturnValue(() => {});
    mockList.mockResolvedValue({ claws: [], total: 0 });
    mockListSessions.mockResolvedValue([]);
  });

  afterEach(cleanup);

  it('mounts without throwing', () => {
    expect(() => render(<MissionControlPage />)).not.toThrow();
  });

  it('loads claws and coding-agent sessions on mount', async () => {
    render(<MissionControlPage />);
    await flushAsyncUpdates();

    expect(mockList).toHaveBeenCalled();
    expect(mockListSessions).toHaveBeenCalled();
  });

  it('renders an empty state rather than a blank page', async () => {
    const container = render(<MissionControlPage />);
    await flushAsyncUpdates();

    expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
    expect(hasText(container, 'No pending escalations.')).toBe(true);
  });

  it('renders a returned claw in the fleet grid', async () => {
    mockList.mockResolvedValue({ claws: [claw()], total: 1 });

    const container = render(<MissionControlPage />);
    await flushAsyncUpdates();

    expect(hasText(container, 'Nightly researcher')).toBe(true);
  });

  it('surfaces a pending escalation in the right rail', async () => {
    mockList.mockResolvedValue({
      claws: [
        claw({
          session: {
            state: 'escalation_pending',
            pendingEscalation: { type: 'tool_approval', reason: 'shell_exec needs approval' },
          },
        }),
      ],
      total: 1,
    });

    const container = render(<MissionControlPage />);
    await flushAsyncUpdates();

    expect(hasText(container, 'shell_exec needs approval')).toBe(true);
    expect(hasText(container, 'No pending escalations.')).toBe(false);
  });

  it('still renders when the coding-agent sessions call fails', async () => {
    // The page catches this one specifically so an unavailable coding-agent
    // API cannot blank the whole fleet view.
    mockListSessions.mockRejectedValue(new Error('unavailable'));
    mockList.mockResolvedValue({ claws: [claw()], total: 1 });

    const container = render(<MissionControlPage />);
    await flushAsyncUpdates();

    expect(hasText(container, 'Nightly researcher')).toBe(true);
  });

  it('does not crash when the claw list request fails', async () => {
    mockList.mockRejectedValue(new Error('boom'));

    const container = render(<MissionControlPage />);
    await flushAsyncUpdates();

    expect(container.querySelectorAll('*').length).toBeGreaterThan(0);
    expect(mockToast.error).toHaveBeenCalled();
  });

  it('unsubscribes from gateway events on unmount', async () => {
    const unsubscribe = vi.fn();
    mockSubscribe.mockReturnValue(unsubscribe);

    render(<MissionControlPage />);
    await flushAsyncUpdates();

    expect(mockSubscribe, 'page should subscribe to live claw events').toHaveBeenCalled();

    cleanup();
    expect(unsubscribe, 'every subscription must be torn down').toHaveBeenCalled();
  });
});
