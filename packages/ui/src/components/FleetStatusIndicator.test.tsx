// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ClawConfig } from '../api';
import {
  summarizeFleetAttention,
  listFleetAttention,
  FleetStatusIndicator,
} from './FleetStatusIndicator';

// --- Mocks for the component (pure function tests don't need these) ---

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({
    children,
    to,
    onClick,
  }: {
    children: React.ReactNode;
    to: string;
    onClick?: () => void;
  }) => createElement('a', { href: to, onClick, 'data-testid': 'claws-link' }, children),
}));

vi.mock('../hooks/useWebSocket', () => ({
  useGateway: () => ({
    subscribe: () => () => {},
  }),
}));

const mockList = vi.fn();
vi.mock('../api', () => ({
  clawsApi: {
    list: (...args: unknown[]) => mockList(...args),
  },
}));

vi.mock('./icons', () => ({
  Zap: ({ className }: { className?: string }) =>
    createElement('svg', { 'data-testid': 'zap-icon', className }),
}));

function makeClaw(
  id: string,
  overrides: Partial<ClawConfig['session']> = {} as Partial<ClawConfig['session']>
): ClawConfig {
  const base = {
    state: 'running',
    cyclesCompleted: 1,
    totalToolCalls: 0,
    totalCostUsd: 0,
    lastCycleAt: null,
    lastCycleDurationMs: null,
    lastCycleError: null,
    startedAt: 't',
    stoppedAt: null,
    artifacts: [],
    pendingEscalation: null,
    tasks: [],
    consecutiveErrors: 0,
    recentFailures: [],
    planHistory: [],
  };
  return {
    id,
    userId: 'u',
    name: id,
    mission: 'm',
    mode: 'continuous',
    allowedTools: [],
    limits: {
      maxTurnsPerCycle: 10,
      maxToolCallsPerCycle: 30,
      maxCyclesPerHour: 60,
      cycleTimeoutMs: 60_000,
    },
    autoStart: false,
    depth: 0,
    sandbox: 'auto',
    createdBy: 'user',
    createdAt: 't',
    updatedAt: 't',
    session: { ...base, ...(overrides as object) } as ClawConfig['session'],
  };
}

describe('summarizeFleetAttention', () => {
  it('returns all zeros for an empty fleet', () => {
    expect(summarizeFleetAttention([])).toEqual({
      escalation: 0,
      reflection: 0,
      stalled: 0,
      failed: 0,
      total: 0,
    });
  });

  it('treats escalation_pending as the highest priority — never double-counted', () => {
    const claw = makeClaw('c1', {
      state: 'escalation_pending',
      // Would otherwise count for reflection too — must not.
      consecutiveErrors: 5,
    });
    const b = summarizeFleetAttention([claw]);
    expect(b.escalation).toBe(1);
    expect(b.reflection).toBe(0);
    expect(b.total).toBe(1);
  });

  it('counts reflection when consecutiveErrors >= threshold and not escalating', () => {
    const claw = makeClaw('c1', { state: 'running', consecutiveErrors: 2 });
    const b = summarizeFleetAttention([claw]);
    expect(b.reflection).toBe(1);
    expect(b.total).toBe(1);
  });

  it('counts failed terminal state', () => {
    const b = summarizeFleetAttention([makeClaw('c1', { state: 'failed' })]);
    expect(b.failed).toBe(1);
    expect(b.total).toBe(1);
  });

  it('counts stalled when focus task cyclesInProgress crosses threshold', () => {
    const claw = makeClaw('c1', {
      state: 'running',
      tasks: [
        {
          id: 't1',
          title: 'stuck thing',
          status: 'in_progress',
          cyclesInProgress: 5,
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    });
    const b = summarizeFleetAttention([claw]);
    expect(b.stalled).toBe(1);
    expect(b.total).toBe(1);
  });

  it('ignores healthy running and idle claws', () => {
    const fleet = [
      makeClaw('healthy-1', { state: 'running', consecutiveErrors: 0 }),
      makeClaw('healthy-2', { state: 'waiting', consecutiveErrors: 0 }),
      makeClaw('idle-1', { state: 'stopped', consecutiveErrors: 0 }),
    ];
    expect(summarizeFleetAttention(fleet).total).toBe(0);
  });

  it('aggregates a mixed fleet correctly', () => {
    const fleet = [
      makeClaw('e1', { state: 'escalation_pending' }),
      makeClaw('e2', { state: 'escalation_pending' }),
      makeClaw('r1', { state: 'running', consecutiveErrors: 3 }),
      makeClaw('f1', { state: 'failed' }),
      makeClaw('s1', {
        state: 'running',
        tasks: [
          {
            id: 't',
            title: 'x',
            status: 'in_progress',
            cyclesInProgress: 7,
            createdAt: 't',
            updatedAt: 't',
          },
        ],
      }),
      makeClaw('ok', { state: 'running' }),
    ];
    const b = summarizeFleetAttention(fleet);
    expect(b).toEqual({ escalation: 2, reflection: 1, stalled: 1, failed: 1, total: 5 });
  });

  it('handles claws with no session safely', () => {
    const claw = { ...makeClaw('c1'), session: null };
    const b = summarizeFleetAttention([claw]);
    expect(b.total).toBe(0);
  });
});

describe('listFleetAttention', () => {
  it('returns an entry per attention claw, sorted escalation → reflection → stalled → failed', () => {
    const fleet = [
      // Intentionally out of priority order in the input.
      makeClaw('f1', { state: 'failed', lastCycleError: 'boom' }),
      makeClaw('s1', {
        state: 'running',
        tasks: [
          {
            id: 't',
            title: 'long stuck thing',
            status: 'in_progress',
            cyclesInProgress: 7,
            createdAt: 't',
            updatedAt: 't',
          },
        ],
      }),
      makeClaw('r1', { state: 'running', consecutiveErrors: 3 }),
      makeClaw('e1', {
        state: 'escalation_pending',
        pendingEscalation: {
          id: 'esc-1',
          type: 'approval',
          reason: 'deploy needs sign-off',
          requestedAt: 't',
        },
      }),
      makeClaw('ok', { state: 'running' }),
    ];
    const out = listFleetAttention(fleet);
    expect(out.map((e) => e.reason)).toEqual(['escalation', 'reflection', 'stalled', 'failed']);
    expect(out.map((e) => e.claw.id)).toEqual(['e1', 'r1', 's1', 'f1']);
  });

  it('escalation entry detail prefers pendingEscalation.reason', () => {
    const fleet = [
      makeClaw('e1', {
        state: 'escalation_pending',
        pendingEscalation: {
          id: 'esc',
          type: 'approval',
          reason: 'needs production approval from on-call',
          requestedAt: 't',
        },
      }),
    ];
    expect(listFleetAttention(fleet)[0]?.detail).toContain('production approval');
  });

  it('reflection entry surfaces the error count', () => {
    const fleet = [makeClaw('r1', { state: 'running', consecutiveErrors: 4 })];
    expect(listFleetAttention(fleet)[0]?.detail).toBe('4 consecutive errors');
  });

  it('stalled entry surfaces the task title and cycles count', () => {
    const fleet = [
      makeClaw('s1', {
        state: 'running',
        tasks: [
          {
            id: 't',
            title: 'fix the flaky auth test',
            status: 'in_progress',
            cyclesInProgress: 8,
            createdAt: 't',
            updatedAt: 't',
          },
        ],
      }),
    ];
    const detail = listFleetAttention(fleet)[0]?.detail ?? '';
    expect(detail).toContain('8c');
    expect(detail).toContain('fix the flaky auth test');
  });

  it('returns empty for a healthy fleet', () => {
    expect(listFleetAttention([makeClaw('ok', { state: 'running' })])).toEqual([]);
  });
});

// =============================================================================
// Component integration tests
// =============================================================================

function claw(id: string, overrides: Partial<ClawConfig['session']> = {}): ClawConfig {
  return makeClaw(id, overrides);
}

let root: Root | null = null;

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = '';
  mockNavigate.mockReset();
  mockList.mockReset();
});

describe('FleetStatusIndicator component', () => {
  it('renders nothing when total=0 (no attention items)', async () => {
    mockList.mockResolvedValue({ claws: [], total: 0, limit: 50, offset: 0 });

    const container = render(createElement(FleetStatusIndicator));

    // The component calls clawsApi.list() in useEffect and returns null
    // when total=0. After the async fetch resolves, it should be null.
    // Flush the effect
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="fleet-status-indicator"]')).toBeNull();
    // The component should render no content when hidden (returns null)
    expect(container.textContent).toBe('');
  });

  it('renders the Zap icon and count when there are attention items', async () => {
    mockList.mockResolvedValue({
      claws: [claw('c1', { state: 'escalation_pending' })],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    const indicator = document.querySelector('[data-testid="fleet-status-indicator"]');
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain('1');
    expect(document.querySelector('[data-testid="zap-icon"]')).not.toBeNull();
  });

  it('opens dropdown on click', async () => {
    mockList.mockResolvedValue({
      claws: [claw('c1', { state: 'escalation_pending' })],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    const indicator = document.querySelector(
      '[data-testid="fleet-status-indicator"]'
    ) as HTMLButtonElement;
    expect(indicator).not.toBeNull();

    // Click to open
    act(() => {
      indicator.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const dropdown = document.querySelector('[data-testid="fleet-status-dropdown"]');
    expect(dropdown).not.toBeNull();
    expect(dropdown?.textContent).toContain('Needs attention');
  });

  it('closes dropdown on Escape key', async () => {
    mockList.mockResolvedValue({
      claws: [claw('c1', { state: 'escalation_pending' })],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    const indicator = document.querySelector(
      '[data-testid="fleet-status-indicator"]'
    ) as HTMLButtonElement;

    // Open
    act(() => {
      indicator.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="fleet-status-dropdown"]')).not.toBeNull();

    // Close with Escape
    act(() => {
      indicator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[data-testid="fleet-status-dropdown"]')).toBeNull();
  });

  it('closes dropdown on outside click', async () => {
    mockList.mockResolvedValue({
      claws: [claw('c1', { state: 'escalation_pending' })],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    const indicator = document.querySelector(
      '[data-testid="fleet-status-indicator"]'
    ) as HTMLButtonElement;

    // Open
    act(() => {
      indicator.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="fleet-status-dropdown"]')).not.toBeNull();

    // Click outside
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="fleet-status-dropdown"]')).toBeNull();
  });

  it('navigates to claw plan tab when entry is clicked', async () => {
    mockList.mockResolvedValue({
      claws: [claw('claw-abc', { state: 'escalation_pending' })],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    // Open dropdown
    const indicator = document.querySelector(
      '[data-testid="fleet-status-indicator"]'
    ) as HTMLButtonElement;
    act(() => {
      indicator.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Find the entry button (not the "Open Claws page" link)
    const entryBtns = document.querySelectorAll('[data-testid="fleet-status-dropdown"] button');
    expect(entryBtns.length).toBeGreaterThan(0);

    act(() => {
      entryBtns[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockNavigate).toHaveBeenCalledWith('/claws?claw=claw-abc&tab=plan');
  });

  it('shows "Open Claws page" link in the dropdown', async () => {
    mockList.mockResolvedValue({
      claws: [claw('c1', { state: 'escalation_pending' })],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    const indicator = document.querySelector(
      '[data-testid="fleet-status-indicator"]'
    ) as HTMLButtonElement;
    act(() => {
      indicator.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const link = document.querySelector('[data-testid="claws-link"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/claws');
  });

  it('sets aria-expanded on the button to reflect dropdown state', async () => {
    mockList.mockResolvedValue({
      claws: [claw('c1', { state: 'escalation_pending' })],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    const indicator = document.querySelector(
      '[data-testid="fleet-status-indicator"]'
    ) as HTMLButtonElement;

    // Initially closed
    expect(indicator?.getAttribute('aria-expanded')).toBe('false');

    // Open
    act(() => {
      indicator.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(indicator?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows tooltip with breakdown message', async () => {
    mockList.mockResolvedValue({
      claws: [
        claw('c1', { state: 'escalation_pending' }),
        claw('c2', { state: 'running', consecutiveErrors: 3 }),
      ],
      total: 2,
      limit: 50,
      offset: 0,
    });

    render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    const indicator = document.querySelector('[data-testid="fleet-status-indicator"]');

    // title attribute shows breakdown
    expect(indicator?.getAttribute('title')).toContain('1 escalation');
    expect(indicator?.getAttribute('title')).toContain('1 reflecting');
  });

  it('handles API error gracefully (returns null)', async () => {
    mockList.mockRejectedValue(new Error('Network error'));

    const container = render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    // Should silently show nothing (default state: total=0 → null)
    expect(container.querySelector('[data-testid="fleet-status-indicator"]')).toBeNull();
  });

  it('uses warn tone when only failed items present', async () => {
    mockList.mockResolvedValue({
      claws: [claw('c1', { state: 'failed' })],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    const indicator = document.querySelector('[data-testid="fleet-status-indicator"]');

    // Only failed items → warn tone → amber classes
    expect(indicator?.className).toContain('bg-amber');
    // No escalation/stall → not urgent → no red class
    expect(indicator?.className).not.toContain('bg-red');
  });

  it('uses urgent tone when escalation, reflection, or stall present', async () => {
    mockList.mockResolvedValue({
      claws: [claw('c1', { state: 'escalation_pending' })],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    const indicator = document.querySelector('[data-testid="fleet-status-indicator"]');
    expect(indicator?.className).toContain('bg-red');
  });

  it('renders without error when WebSocket subscriptions are active', async () => {
    mockList.mockResolvedValue({ claws: [], total: 0, limit: 50, offset: 0 });

    const container = render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    // Component renders with WebSocket subscriptions without throwing
    expect(container.textContent).toBe('');
  });

  it('closes the dropdown when "Open Claws page" link is clicked', async () => {
    mockList.mockResolvedValue({
      claws: [claw('c1', { state: 'escalation_pending' })],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(createElement(FleetStatusIndicator));

    await act(async () => {
      await Promise.resolve();
    });

    // Open the dropdown
    const indicator = document.querySelector(
      '[data-testid="fleet-status-indicator"]'
    ) as HTMLButtonElement;
    act(() => {
      indicator.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="fleet-status-dropdown"]')).not.toBeNull();

    // Click the "Open Claws page" link
    const link = document.querySelector('[data-testid="claws-link"]');
    act(() => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Dropdown should close
    expect(document.querySelector('[data-testid="fleet-status-dropdown"]')).toBeNull();
  });
});
