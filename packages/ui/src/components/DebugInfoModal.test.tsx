// @vitest-environment happy-dom

import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DebugInfoModal } from './DebugInfoModal';
import type { TraceInfo } from '../types';

// Mock icons to avoid SVG/icon import issues
vi.mock('./icons', () => ({
  X: () => <span data-testid="icon-x">X</span>,
  Clock: () => <span data-testid="icon-clock">Clock</span>,
  Wrench: () => <span data-testid="icon-wrench">Wrench</span>,
  Brain: () => <span data-testid="icon-brain">Brain</span>,
  Send: () => <span data-testid="icon-send">Send</span>,
  Code: () => <span data-testid="icon-code">Code</span>,
  AlertTriangle: () => <span data-testid="icon-alert">AlertTriangle</span>,
  RefreshCw: () => <span data-testid="icon-refresh">RefreshCw</span>,
  XCircle: () => <span data-testid="icon-xcircle">XCircle</span>,
  Check: () => <span data-testid="icon-check">Check</span>,
  Database: () => <span data-testid="icon-database">Database</span>,
  Zap: () => <span data-testid="icon-zap">Zap</span>,
  ChevronDown: () => <span data-testid="icon-chevron-down">ChevronDown</span>,
  ChevronRight: () => <span data-testid="icon-chevron-right">ChevronRight</span>,
  Copy: () => <span data-testid="icon-copy">Copy</span>,
}));

vi.mock('../utils/ignore-error', () => ({
  ignoreError: vi.fn(),
}));

let root: Root | null = null;

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    flushSync(() => root?.render(element));
  });
  return container;
}

function minimalTrace(overrides: Partial<TraceInfo> = {}): TraceInfo {
  return {
    duration: 1500,
    toolCalls: [],
    modelCalls: [],
    autonomyChecks: [],
    dbOperations: { reads: 0, writes: 0 },
    memoryOps: { adds: 0, recalls: 0 },
    triggersFired: [],
    errors: [],
    events: [],
    ...overrides,
  };
}

function traceWithData(): TraceInfo {
  return {
    duration: 2500,
    toolCalls: [
      {
        name: 'readFile',
        success: true,
        duration: 120,
        arguments: { path: '/tmp/test.txt' },
        result: 'file content',
      },
      {
        name: 'writeFile',
        success: false,
        duration: 50,
        error: 'Permission denied',
        arguments: { path: '/tmp/write.txt' },
      },
    ],
    modelCalls: [
      { provider: 'openai', model: 'gpt-4', inputTokens: 150, outputTokens: 50, duration: 800 },
    ],
    autonomyChecks: [
      { tool: 'deleteFile', approved: false, reason: 'File is protected' },
      { tool: 'readFile', approved: true },
    ],
    dbOperations: { reads: 5, writes: 2 },
    memoryOps: { adds: 3, recalls: 1 },
    triggersFired: ['morning_briefing'],
    errors: ['Rate limit exceeded on retry 3'],
    events: [{ type: 'tool_call', name: 'readFile', duration: 120, success: true }],
    retries: [{ attempt: 2, error: 'Timeout', delayMs: 1000 }],
    request: {
      provider: 'openai',
      model: 'gpt-4',
      endpoint: '/v1/chat/completions',
      messageCount: 3,
      tools: ['readFile'],
    },
    response: {
      status: 'success',
      finishReason: 'stop',
      contentLength: 150,
    },
  };
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('DebugInfoModal', () => {
  it('renders with minimal trace data', () => {
    const onClose = vi.fn();
    const container = render(<DebugInfoModal trace={minimalTrace()} onClose={onClose} />);

    expect(container.textContent).toContain('Debug Logs');
    expect(container.textContent).toContain('1500ms total');
    // Overview tab should be visible by default
    expect(container.textContent).toContain('Total Duration');
    expect(container.textContent).toContain('Total Tokens');
    expect(container.textContent).toContain('Tool Calls');
    expect(container.textContent).toContain('Model Calls');
    // Tab labels
    expect(container.textContent).toContain('Overview');
    expect(container.textContent).toContain('Tool Calls');
    expect(container.textContent).toContain('Model Calls');
    expect(container.textContent).toContain('Events');
    expect(container.textContent).toContain('Request / Response');
    expect(container.textContent).toContain('Raw JSON');
  });

  it('renders full trace data with stats and conditional sections', () => {
    const container = render(<DebugInfoModal trace={traceWithData()} onClose={vi.fn()} />);

    // Overview tab stats
    expect(container.textContent).toContain('2500ms');
    expect(container.textContent).toContain('200');
    expect(container.textContent).toContain('150 in');
    expect(container.textContent).toContain('50 out');
    // Tool calls: 1 success / 2 total
    expect(container.textContent).toContain('1/2');
    // Model calls count
    expect(container.textContent).toContain('1');
    // DB operations
    expect(container.textContent).toContain('7');
    // Memory ops
    expect(container.textContent).toContain('4');
    // Triggers fired
    expect(container.textContent).toContain('morning_briefing');
    // Errors
    expect(container.textContent).toContain('Rate limit exceeded');
    // Retries
    expect(container.textContent).toContain('Attempt 2');
    // Autonomy checks
    expect(container.textContent).toContain('deleteFile');
  });

  it('renders overview with zero stats for empty arrays', () => {
    const container = render(<DebugInfoModal trace={minimalTrace()} onClose={vi.fn()} />);

    expect(container.textContent).toContain('0/0');
    expect(container.textContent).toContain('All succeeded');
  });

  it('calls onClose when clicking the close button', () => {
    const onClose = vi.fn();
    const container = render(<DebugInfoModal trace={minimalTrace()} onClose={onClose} />);

    const closeBtn = container.querySelector('button[aria-label="Close"]') as HTMLElement;
    expect(closeBtn).not.toBeNull();

    act(() => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when pressing Escape', () => {
    const onClose = vi.fn();
    render(<DebugInfoModal trace={minimalTrace()} onClose={onClose} />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking the backdrop overlay', () => {
    const onClose = vi.fn();
    const container = render(<DebugInfoModal trace={minimalTrace()} onClose={onClose} />);

    // The outer overlay div is the backdrop
    const backdrop = container.firstElementChild as HTMLElement;
    expect(backdrop).not.toBeNull();

    // Simulate clicking the backdrop itself
    act(() => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking inside the modal content', () => {
    const onClose = vi.fn();
    const container = render(<DebugInfoModal trace={minimalTrace()} onClose={onClose} />);

    // Click the modal content container (the inner div)
    const innerModal = container.querySelector('.w-\\[95vw\\]') as HTMLElement;
    if (innerModal) {
      act(() => {
        innerModal.click();
      });
      expect(onClose).not.toHaveBeenCalled();
    }
  });

  it('renders Copy All button and triggers clipboard copy', () => {
    vi.useFakeTimers();
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const container = render(<DebugInfoModal trace={minimalTrace()} onClose={vi.fn()} />);

    const copyBtn = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('Copy All') || btn.textContent?.includes('Copied!')
    );
    expect(copyBtn).not.toBeNull();

    act(() => {
      copyBtn?.click();
    });

    expect(writeText).toHaveBeenCalled();
    // After click, button text should be "Copied!"
    expect(container.textContent).toContain('Copied!');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.textContent).toContain('Copy All');
  });

  it('switches between tabs', () => {
    const container = render(<DebugInfoModal trace={traceWithData()} onClose={vi.fn()} />);

    // Find the "Tool Calls" tab button and click it
    const tabButtons = container.querySelectorAll('button');
    const toolCallsTab = Array.from(tabButtons).find((btn) =>
      btn.textContent?.includes('Tool Calls')
    );
    expect(toolCallsTab).not.toBeNull();

    act(() => {
      toolCallsTab?.click();
    });

    // Should show tool calls content
    expect(container.textContent).toContain('readFile');
    expect(container.textContent).toContain('writeFile');

    // Switch to "Request / Response" tab
    const requestTab = Array.from(tabButtons).find((btn) =>
      btn.textContent?.includes('Request / Response')
    );
    act(() => {
      requestTab?.click();
    });
    expect(container.textContent).toContain('/v1/chat/completions');
    expect(container.textContent).toContain('gpt-4');

    // Switch to "Raw JSON" tab
    const rawTab = Array.from(tabButtons).find((btn) => btn.textContent?.includes('Raw JSON'));
    act(() => {
      rawTab?.click();
    });
    expect(container.textContent).toContain('2500');
  });

  it('shows empty state messages for tabs with no data', () => {
    const container = render(<DebugInfoModal trace={minimalTrace()} onClose={vi.fn()} />);

    const tabButtons = container.querySelectorAll('button');

    // Tool Calls tab with empty data
    const toolCallsTab = Array.from(tabButtons).find((btn) =>
      btn.textContent?.includes('Tool Calls')
    );
    act(() => {
      toolCallsTab?.click();
    });
    expect(container.textContent).toContain('No tool calls in this trace.');

    // Model Calls tab with empty data
    const modelCallsTab = Array.from(tabButtons).find((btn) =>
      btn.textContent?.includes('Model Calls')
    );
    act(() => {
      modelCallsTab?.click();
    });
    expect(container.textContent).toContain('No model calls in this trace.');

    // Events tab with empty data
    const eventsTab = Array.from(tabButtons).find((btn) => btn.textContent?.includes('Events'));
    act(() => {
      eventsTab?.click();
    });
    expect(container.textContent).toContain('No events in this trace.');
  });
});
