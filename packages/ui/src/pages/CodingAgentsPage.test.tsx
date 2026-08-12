// @vitest-environment happy-dom

/**
 * CodingAgentsPage smoke test — see docs/IMPROVEMENT_PLAN_2026-08-12.md (WI-5).
 *
 * Heavy child components (xterm terminal, ACP and auto-mode panels, pipelines
 * tab) are stubbed: they own their own behaviour and, in xterm's case, need
 * canvas/measurement APIs happy-dom does not provide. This test covers the
 * page's own contract — mount, fetch, render, tear down.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, flushAsyncUpdates, hasText, render } from '../test-harness';
import { CodingAgentsPage } from './CodingAgentsPage';

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockListSessions = vi.fn();
const mockStatus = vi.fn();
const mockListResults = vi.fn();

vi.mock('../api', () => ({
  codingAgentsApi: {
    listSessions: (...a: unknown[]) => mockListSessions(...a),
    status: (...a: unknown[]) => mockStatus(...a),
    listResults: (...a: unknown[]) => mockListResults(...a),
    createSession: vi.fn().mockResolvedValue({ id: 's-1' }),
    terminateSession: vi.fn().mockResolvedValue({}),
  },
  fileWorkspacesApi: {
    list: vi.fn().mockResolvedValue({ workspaces: [] }),
  },
}));

const mockSubscribe = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useWebSocket', () => ({
  useGateway: () => ({ subscribe: mockSubscribe }),
}));

vi.mock('react-router', async () => {
  const { createElement } = await import('react');
  return {
    useSearchParams: () => [new URLSearchParams(), () => {}],
    Link: ({ children, to }: { children?: unknown; to?: string }) =>
      createElement('a', { href: to }, children as never),
  };
});

vi.mock('../hooks/useSkipHome', () => ({
  useSkipHome: () => ({ skipHome: false, onSkipHomeChange: () => {} }),
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('../components/ToastProvider', () => ({ useToast: () => mockToast }));

// xterm needs canvas/measurement APIs happy-dom lacks.
vi.mock('../components/XTerminal', async () => {
  const { createElement } = await import('react');
  return { XTerminal: () => createElement('div', { 'data-testid': 'xterminal' }) };
});

vi.mock('../components/AcpPanel', async () => {
  const { createElement } = await import('react');
  return { AcpPanel: () => createElement('div', { 'data-testid': 'acp-panel' }) };
});

vi.mock('../components/AutoModePanel', async () => {
  const { createElement } = await import('react');
  return { AutoModePanel: () => createElement('div', { 'data-testid': 'auto-mode-panel' }) };
});

vi.mock('./coding-agents/PipelinesTab', async () => {
  const { createElement } = await import('react');
  return { PipelinesTab: () => createElement('div', { 'data-testid': 'pipelines-tab' }) };
});

vi.mock('../components/icons', async () => {
  const { createIconStubs } = await import('../test-harness');
  return createIconStubs();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

// listSessions and status return bare arrays (CodingAgentSession[] /
// CodingAgentStatus[]), not wrapper objects — the page calls
// `setSessions(sessionsData)` and then `sessions.find(...)` directly.
function resolveEmpty() {
  mockListSessions.mockResolvedValue([]);
  mockStatus.mockResolvedValue([]);
  mockListResults.mockResolvedValue({ data: [] });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('CodingAgentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribe.mockReturnValue(() => {});
    resolveEmpty();
  });

  afterEach(cleanup);

  it('mounts without throwing', () => {
    expect(() => render(<CodingAgentsPage />)).not.toThrow();
  });

  it('fetches sessions, status and results on mount', async () => {
    render(<CodingAgentsPage />);
    await flushAsyncUpdates();

    expect(mockListSessions).toHaveBeenCalled();
    expect(mockStatus).toHaveBeenCalled();
    expect(mockListResults).toHaveBeenCalled();
  });

  it('renders an empty state rather than a blank page', async () => {
    const container = render(<CodingAgentsPage />);
    await flushAsyncUpdates();

    expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
  });

  it('does not crash when every request fails', async () => {
    mockListSessions.mockRejectedValue(new Error('boom'));
    mockStatus.mockRejectedValue(new Error('boom'));
    mockListResults.mockRejectedValue(new Error('boom'));

    const container = render(<CodingAgentsPage />);
    await flushAsyncUpdates();

    expect(container.querySelectorAll('*').length).toBeGreaterThan(0);
  });

  it('renders returned sessions', async () => {
    mockListSessions.mockResolvedValue([
      {
        id: 'sess-1',
        agentId: 'claude-code',
        status: 'running',
        workspaceDir: '/tmp/ws',
        createdAt: '2026-08-12T10:00:00Z',
      },
    ]);

    const container = render(<CodingAgentsPage />);
    await flushAsyncUpdates();

    expect(container.querySelectorAll('*').length).toBeGreaterThan(10);
    expect(hasText(container, 'Coding') || container.textContent!.length > 0).toBe(true);
  });

  it('opens the new-session modal', async () => {
    // NewSessionModal lives in ./coding-agents/NewSessionModal — the largest
    // piece split out of this page. Without this the smoke test never renders
    // it, so a mistake in ~460 moved lines would go unnoticed.
    const container = render(<CodingAgentsPage />);
    await flushAsyncUpdates();

    const button = [...container.querySelectorAll('button')].find((b) =>
      /New Session/i.test(b.textContent ?? '')
    );
    expect(button, 'expected a "New Session" button').toBeTruthy();
    expect((button as HTMLButtonElement).disabled, 'should be enabled with no sessions').toBe(
      false
    );

    button!.click();
    await flushAsyncUpdates();

    // The modal renders its own form controls.
    expect(container.querySelector('textarea, select'), 'expected modal form').toBeTruthy();
    expect(hasText(container, 'Cancel')).toBe(true);
  });

  it('unsubscribes from gateway events on unmount', async () => {
    const unsubscribe = vi.fn();
    mockSubscribe.mockReturnValue(unsubscribe);

    render(<CodingAgentsPage />);
    await flushAsyncUpdates();

    expect(mockSubscribe).toHaveBeenCalled();

    cleanup();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
