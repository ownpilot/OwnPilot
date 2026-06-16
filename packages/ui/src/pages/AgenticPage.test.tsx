// @vitest-environment happy-dom

/**
 * AgenticPage Tests
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgenticPage } from '../pages/AgenticPage';

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockList = vi.fn();
const mockGet = vi.fn();
const mockStats = vi.fn();
const mockCapabilities = vi.fn();

vi.mock('../api/endpoints/agentic', () => ({
  agenticApi: {
    execute: (...args: unknown[]) => mockExecute(...args),
    list: (...args: unknown[]) => mockList(...args),
    get: (...args: unknown[]) => mockGet(...args),
    stats: (...args: unknown[]) => mockStats(...args),
    capabilities: (...args: unknown[]) => mockCapabilities(...args),
  },
}));

vi.mock('../api/endpoints/providers', () => ({
  providersApi: {
    list: () => Promise.resolve({ providers: [] }),
    models: () => Promise.resolve({ models: [] }),
  },
}));

vi.mock('../hooks/useWebSocket', () => ({
  useGateway: () => ({ subscribe: () => () => {} }),
}));

// Mock icons (they're SVG components — just return null to keep tests fast)
vi.mock('../components/icons', () => {
  function makeIcon(name: string) {
    return function Icon({ className }: { className?: string }) {
      return <svg data-testid={`icon-${name}`} className={className} />;
    };
  }
  const icons = [
    'Play',
    'Square',
    'AlertCircle',
    'Clock',
    'DollarSign',
    'RefreshCw',
    'Brain',
    'ListChecks',
    'Target',
    'Zap',
    'X',
    'ChevronDown',
    'ChevronRight',
    'Terminal',
    'Send',
    'Code',
    'Wrench',
    'Cpu',
    'Loader2',
    'CheckCircle2',
    'HelpCircle',
  ];
  const result: Record<string, ReturnType<typeof makeIcon>> = {};
  for (const name of icons) result[name] = makeIcon(name);
  return result;
});

// ─── Helpers ───────────────────────────────────────────────────────────────

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

function cleanup() {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = '';
}

function findByText(container: HTMLElement, text: string): HTMLElement | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent?.includes(text)) return node.parentElement;
  }
  return null;
}

// ─── Default Data ──────────────────────────────────────────────────────────

const defaultStats = {
  totalExecutions: 42,
  activeExecutions: 3,
  totalCostUsd: 0.15,
  successRate: 0.857,
  byExecutorKind: { claw: 30, direct_llm: 12 },
};

const defaultExecutions = [
  {
    id: 'exec-1',
    taskName: 'Research AI',
    status: 'completed',
    summary: 'Completed 1/1 steps',
    totalCostUsd: 0.005,
    totalDurationMs: 150,
    stepCount: 1,
    completedSteps: 1,
    startedAt: '2026-06-15T10:00:00Z',
    completedAt: '2026-06-15T10:01:00Z',
    steps: [
      { index: 1, executorKind: 'claw', capabilityId: 'c1', status: 'completed', durationMs: 150 },
    ],
  },
  {
    id: 'exec-2',
    taskName: 'Fix login bug',
    status: 'running',
    summary: 'In progress',
    totalCostUsd: 0.01,
    totalDurationMs: 3000,
    stepCount: 2,
    completedSteps: 1,
    startedAt: '2026-06-15T10:05:00Z',
    completedAt: null,
    steps: [
      { index: 1, executorKind: 'claw', capabilityId: 'c1', status: 'completed', durationMs: 100 },
      {
        index: 2,
        executorKind: 'coding_agent',
        capabilityId: 'c2',
        status: 'running',
        durationMs: 2900,
      },
    ],
  },
];

const defaultCapabilities = {
  capabilities: [
    {
      id: 'claw:test',
      name: 'Test Claw',
      description: 'A claw',
      executorKind: 'claw',
      providerId: 'p1',
      tags: ['a'],
      requiresApproval: false,
    },
    {
      id: 'llm:test',
      name: 'Test LLM',
      description: 'An LLM',
      executorKind: 'direct_llm',
      providerId: 'p2',
      tags: ['b'],
      requiresApproval: false,
    },
  ],
  total: 2,
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('AgenticPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({ executions: defaultExecutions, total: 2, limit: 20, offset: 0 });
    mockStats.mockResolvedValue(defaultStats);
    mockGet.mockResolvedValue(defaultExecutions[0]);
    mockCapabilities.mockResolvedValue(defaultCapabilities);
  });

  afterEach(() => {
    cleanup();
  });

  // ── Render & Loading ──

  it('renders without crashing', () => {
    const container = render(<AgenticPage />);
    expect(container).toBeDefined();
    expect(findByText(container, 'Agentic Command Center')).toBeTruthy();
  });

  it('calls list and stats on mount', () => {
    render(<AgenticPage />);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockStats).toHaveBeenCalledTimes(1);
  });

  it('renders stats cards after loading', async () => {
    const container = render(<AgenticPage />);
    // Wait for stats to render
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(findByText(container, '42')).toBeTruthy();
    expect(findByText(container, '3')).toBeTruthy();
    expect(findByText(container, '$0.1500')).toBeTruthy();
    expect(findByText(container, '85.7%')).toBeTruthy();
  });

  // ── Executions Table ──

  it('renders execution rows after loading', async () => {
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(findByText(container, 'Research AI')).toBeTruthy();
    expect(findByText(container, 'Fix login bug')).toBeTruthy();
    expect(findByText(container, 'completed')).toBeTruthy();
    expect(findByText(container, 'running')).toBeTruthy();
  });

  it('shows progress and cost for each execution', async () => {
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    // Check cost values appear somewhere in the DOM (they're inside nested elements)
    expect(container.textContent).toContain('1/1 steps');
    expect(container.textContent).toContain('$0.0050');
    expect(container.textContent).toContain('$0.0100');
  });

  it('shows empty state when no executions', async () => {
    mockList.mockResolvedValue({ executions: [], total: 0, limit: 20, offset: 0 });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(findByText(container, 'No executions yet')).toBeTruthy();
  });

  // ── Command Bar ──

  it('shows collapsed command bar by default', () => {
    const container = render(<AgenticPage />);
    expect(findByText(container, 'Execute Agentic Task')).toBeTruthy();
    // Form should be hidden
    expect(container.querySelector('form')).toBeNull();
  });

  it('expands command bar on click', async () => {
    const container = render(<AgenticPage />);
    const header = findByText(container, 'Execute Agentic Task');
    expect(header).toBeTruthy();

    await act(async () => {
      header!.click();
    });

    // Form should now be visible
    expect(container.querySelector('form')).toBeTruthy();
    expect(findByText(container, 'Task Description *')).toBeTruthy();
  });

  it('shows form fields and execute button when expanded', async () => {
    mockExecute.mockResolvedValue({
      id: 'exec-3',
      status: 'completed',
      summary: 'Done',
      totalCostUsd: 0,
      totalDurationMs: 50,
      steps: [],
    });

    const container = render(<AgenticPage />);
    const header = findByText(container, 'Execute Agentic Task');
    await act(async () => {
      header!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Form should have textarea, priority select, trigger select, and submit button
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(container.querySelector('select')).toBeTruthy();
    const submitBtn = container.querySelector('button[type="submit"]')! as HTMLButtonElement;
    expect(submitBtn).toBeTruthy();
    expect(submitBtn.textContent).toContain('Execute');
    // Button should be disabled when description is empty
    expect(submitBtn.disabled).toBe(true);
  });

  it('disables execute button when description is empty', async () => {
    const container = render(<AgenticPage />);
    const header = findByText(container, 'Execute Agentic Task');
    await act(async () => {
      header!.click();
    });

    const submitBtn = container.querySelector('button[type="submit"]')! as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  // ── Capabilities Tab ──

  it('switches to capabilities tab and loads data', async () => {
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Find and click Capabilities tab
    const capsTab = findByText(container, 'Capabilities');
    expect(capsTab).toBeTruthy();
    await act(async () => {
      capsTab!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockCapabilities).toHaveBeenCalled();
    expect(findByText(container, 'Test Claw')).toBeTruthy();
    expect(findByText(container, 'Test LLM')).toBeTruthy();
  });

  // ── Stats bar shows skeleton before data loads ──

  it('shows skeleton while loading stats', () => {
    // Don't resolve the mock immediately
    mockStats.mockReturnValue(new Promise(() => {}));
    const container = render(<AgenticPage />);
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  // ── Error handling doesn't crash ──

  it('handles API failure gracefully', async () => {
    mockList.mockRejectedValue(new Error('Network error'));
    mockStats.mockRejectedValue(new Error('Network error'));
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Should still show the page without crashing
    expect(findByText(container, 'Agentic Command Center')).toBeTruthy();
  });
});
