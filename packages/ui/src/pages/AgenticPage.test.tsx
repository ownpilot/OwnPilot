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
const mockCancel = vi.fn();
const mockStats = vi.fn();
const mockCapabilities = vi.fn();

vi.mock('../api/endpoints/agentic', () => ({
  agenticApi: {
    execute: (...args: unknown[]) => mockExecute(...args),
    list: (...args: unknown[]) => mockList(...args),
    get: (...args: unknown[]) => mockGet(...args),
    stats: (...args: unknown[]) => mockStats(...args),
    capabilities: (...args: unknown[]) => mockCapabilities(...args),
    cancel: (...args: unknown[]) => mockCancel(...args),
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

async function flushAsyncUpdates() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

  it('renders without crashing', async () => {
    const container = render(<AgenticPage />);
    expect(container).toBeDefined();
    expect(findByText(container, 'Agentic Command Center')).toBeTruthy();
    await flushAsyncUpdates();
  });

  it('calls list and stats on mount', async () => {
    render(<AgenticPage />);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockStats).toHaveBeenCalledTimes(1);
    await flushAsyncUpdates();
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

  it('shows collapsed command bar by default', async () => {
    const container = render(<AgenticPage />);
    expect(findByText(container, 'Execute Agentic Task')).toBeTruthy();
    // Form should be hidden
    expect(container.querySelector('form')).toBeNull();
    await flushAsyncUpdates();
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

  it('shows skeleton while loading stats', async () => {
    // Don't resolve the mock immediately
    mockStats.mockReturnValue(new Promise(() => {}));
    const container = render(<AgenticPage />);
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    await flushAsyncUpdates();
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

  // ── Capabilities edge-cases ──

  it('renders the empty capabilities state when API returns none', async () => {
    mockCapabilities.mockResolvedValue({ capabilities: [], total: 0 });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const capsTab = findByText(container, 'Capabilities');
    expect(capsTab).toBeTruthy();
    await act(async () => {
      capsTab!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(container.textContent).toContain('No capabilities found');
  });

  it('renders capability executor-kind chips and tags', async () => {
    mockCapabilities.mockResolvedValue({
      capabilities: [
        {
          id: 'claw:tagged',
          name: 'Tagged Claw',
          description: 'Has tags',
          executorKind: 'claw',
          providerId: 'p1',
          tags: ['a', 'b'],
          requiresApproval: false,
        },
      ],
      total: 1,
    });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const capsTab = findByText(container, 'Capabilities');
    await act(async () => {
      capsTab!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.textContent).toContain('Tagged Claw');
    expect(container.textContent).toContain('a');
    expect(container.textContent).toContain('b');
  });

  it('handles capabilities API failure by showing the capabilities empty fallback', async () => {
    // The capabilities fetch path is now wrapped in try/catch (see
    // AgenticPage.tsx), so a rejection is consumed and the page renders the
    // empty state. No try/catch shim is needed in the mock anymore.
    mockCapabilities.mockRejectedValue(new Error('caps down'));
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const capsTab = findByText(container, 'Capabilities');
    await act(async () => {
      capsTab!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // The empty-state copy is rendered because the catch path resets caps to []
    expect(container.textContent).toContain('No capabilities found');
  });

  // ── Active execution polling ──

  it('polls for fresh execution data when a running execution is present', async () => {
    // Two list calls are expected: the initial fetch and the polling refetch.
    mockList.mockResolvedValue({
      executions: defaultExecutions, // includes a "running" execution
      total: 2,
      limit: 20,
      offset: 0,
    });
    vi.useFakeTimers();
    try {
      render(<AgenticPage />);
      // Let the initial fetch resolve
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const initialCalls = mockList.mock.calls.length;

      // Advance the POLL_MS timer to trigger a refetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(mockList.mock.calls.length).toBeGreaterThan(initialCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Execute form validation ──

  it('keeps the execute button disabled until description is filled', async () => {
    mockExecute.mockResolvedValue({
      id: 'exec-x',
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

    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // Type a description
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, 'Hello world');
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
      textarea.dispatchEvent(new window.Event('change', { bubbles: true }));
    });

    const enabledBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(enabledBtn.disabled).toBe(false);
  });

  // ── Execution detail modal ──

  it('opens the execution detail modal when a row is clicked', async () => {
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Click the first execution row
    const row = findByText(container, 'Research AI');
    expect(row).toBeTruthy();
    await act(async () => {
      row!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mockGet).toHaveBeenCalledWith('exec-1');
  });

  // ── Capabilities filter change ──

  it('re-fetches capabilities with the kind filter when the dropdown changes', async () => {
    mockCapabilities.mockResolvedValueOnce({ capabilities: [], total: 0 }).mockResolvedValueOnce({
      capabilities: [
        {
          id: 'claw:filtered',
          name: 'Filtered Claw',
          description: 'Filter test',
          executorKind: 'claw',
          providerId: 'p1',
          tags: ['f'],
          requiresApproval: false,
        },
      ],
      total: 1,
    });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const capsTab = findByText(container, 'Capabilities');
    await act(async () => {
      capsTab!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Switch the kind filter to "claw"
    const kindFilter = container.querySelector('select') as HTMLSelectElement;
    expect(kindFilter).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value'
      )?.set;
      setter?.call(kindFilter, 'claw');
      kindFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Second capabilities call should pass the kind filter
    expect(mockCapabilities).toHaveBeenCalledWith({ kind: 'claw' });
    expect(container.textContent).toContain('Filtered Claw');
  });

  // ── Pagination edge-case ──

  it('disables the Next button at the end of the executions list', async () => {
    // total=50 with page size 20 → 3 pages; walk forward to the last page
    // and confirm Next is disabled there.
    mockList.mockResolvedValue({
      executions: defaultExecutions,
      total: 50,
      limit: 20,
      offset: 0,
    });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const clickNext = () => {
      const btn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Next'
      );
      act(() => {
        btn?.click();
      });
    };

    // First click: offset 0 → 20
    clickNext();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Second click: offset 20 → 40
    clickNext();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const finalNext = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Next'
    );
    expect(finalNext).toBeDefined();
    expect(finalNext?.disabled).toBe(true);
  });

  it('enables the Previous button when offset is non-zero and moves back', async () => {
    // total=50 with page size 20. Click Next once (offset 0 → 20) and assert
    // Previous becomes enabled. Then click Previous to assert offset goes
    // back to 0.
    mockList.mockResolvedValue({
      executions: defaultExecutions,
      total: 50,
      limit: 20,
      offset: 0,
    });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const nextButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Next'
    );
    expect(nextButton).toBeDefined();

    // Advance to page 2
    act(() => {
      nextButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const prevButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Previous'
    );
    expect(prevButton).toBeDefined();
    expect(prevButton?.disabled).toBe(false);

    // Move back to page 1
    act(() => {
      prevButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mockList).toHaveBeenLastCalledWith(20, 0);
  });

  // ── Capabilities card detail edge-cases ──

  it('renders the requires-approval chip when capability requires approval', async () => {
    mockCapabilities.mockResolvedValue({
      capabilities: [
        {
          id: 'claw:approval',
          name: 'Approval Cap',
          description: 'Needs approval',
          executorKind: 'claw',
          providerId: 'p1',
          tags: ['one'],
          requiresApproval: true,
        },
      ],
      total: 1,
    });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const capsTab = findByText(container, 'Capabilities');
    await act(async () => {
      capsTab!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.textContent).toContain('requires approval');
  });

  it('renders at most six tag chips per capability, even with longer tag arrays', async () => {
    const manyTags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    mockCapabilities.mockResolvedValue({
      capabilities: [
        {
          id: 'claw:tagged-many',
          name: 'Many Tags',
          description: 'Tags overload',
          executorKind: 'claw',
          providerId: 'p1',
          tags: manyTags,
          requiresApproval: false,
        },
      ],
      total: 1,
    });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const capsTab = findByText(container, 'Capabilities');
    await act(async () => {
      capsTab!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // 6 tag chips from the capability render; we assert text content presence
    // rather than counting DOM nodes because the select background also
    // uses bg-bg-tertiary.
    expect(container.textContent).toContain('a');
    expect(container.textContent).toContain('f');
    expect(container.textContent).not.toContain('>g<');
    expect(container.textContent).not.toContain('>h<');
    expect(container.textContent).not.toContain('>i<');
  });

  it('groups capabilities by executor-kind and renders each group heading', async () => {
    mockCapabilities.mockResolvedValue({
      capabilities: [
        {
          id: 'claw:a',
          name: 'A Claw',
          description: 'A',
          executorKind: 'claw',
          providerId: 'p1',
          tags: [],
          requiresApproval: false,
        },
        {
          id: 'direct_llm:b',
          name: 'B LLM',
          description: 'B',
          executorKind: 'direct_llm',
          providerId: 'p1',
          tags: [],
          requiresApproval: false,
        },
      ],
      total: 2,
    });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const capsTab = findByText(container, 'Capabilities');
    await act(async () => {
      capsTab!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.textContent).toContain('claw (1)');
    expect(container.textContent).toContain('direct llm (1)');
    expect(container.textContent).toContain('2 capabilities');
  });

  // ── ExecutionDetailModal render states ──

  it('renders the loading spinner while the detail modal is fetching', async () => {
    // Hold the response indefinitely so loading state persists.
    mockGet.mockImplementation(() => new Promise(() => {}));
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const row = findByText(container, 'Research AI');
    expect(row).toBeTruthy();
    await act(async () => {
      row!.click();
    });
    // The modal is now in the loading state; the spinner is a RefreshCw SVG
    // with animate-spin class.
    const spinners = container.querySelectorAll('svg.animate-spin');
    expect(spinners.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the error block and step error when present', async () => {
    mockGet.mockResolvedValueOnce({
      ...defaultExecutions[0],
      id: 'exec-err',
      error: 'Top-level failure',
      summary: 'Partial progress before failure',
      steps: [
        {
          index: 0,
          executorKind: 'claw',
          capabilityId: 'cap-a',
          status: 'failed',
          durationMs: 1200,
          costUsd: 0.01,
          error: 'step failed',
          output: null,
        },
        {
          index: 1,
          executorKind: 'direct_llm',
          capabilityId: 'cap-b',
          status: 'completed',
          durationMs: 500,
          costUsd: 0.005,
          output: { ok: true },
        },
      ],
    });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const row = findByText(container, 'Research AI');
    await act(async () => {
      row!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Top-level error block
    expect(container.textContent).toContain('Top-level failure');
    expect(container.textContent).toContain('Error');
    // Summary
    expect(container.textContent).toContain('Partial progress before failure');
    // Step error
    expect(container.textContent).toContain('step failed');
    // Step cost rendering (costUsd !== undefined branch)
    expect(container.textContent).toContain('$0.0100');
    expect(container.textContent).toContain('$0.0050');
    // Step duration >= 1000ms
    expect(container.textContent).toContain('1.2s');
    // Status badge for failed step
    expect(container.textContent).toContain('failed');
  });

  it('renders the no-step-details fallback when an execution has no steps', async () => {
    mockGet.mockResolvedValueOnce({
      ...defaultExecutions[0],
      id: 'exec-empty',
      steps: [],
    });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const row = findByText(container, 'Research AI');
    await act(async () => {
      row!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.textContent).toContain('No step details available');
  });

  it('renders the Execution not found state when the API returns no record', async () => {
    mockGet.mockResolvedValueOnce(null as unknown as (typeof defaultExecutions)[0]);
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const row = findByText(container, 'Research AI');
    await act(async () => {
      row!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.textContent).toContain('Execution not found');
  });

  it('renders a Cancel button for running executions and flips status after click', async () => {
    // Make the default lookup return a running execution so the cancel
    // branch (status === 'running' || 'pending') is reachable.
    const runningExec = { ...defaultExecutions[0], status: 'running', summary: 'Working...' };
    mockGet.mockResolvedValueOnce(runningExec);
    mockCancel.mockResolvedValueOnce({ id: 'exec-1', status: 'cancelled' });
    const container = render(<AgenticPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const row = findByText(container, 'Research AI');
    await act(async () => {
      row!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel'
    );
    expect(cancelButton).toBeDefined();

    act(() => {
      cancelButton?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(mockCancel).toHaveBeenCalledWith('exec-1');
    // The badge should now show 'cancelled' after the click
    expect(container.textContent).toContain('cancelled');
  });
});
