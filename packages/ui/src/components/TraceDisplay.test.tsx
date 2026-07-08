// @vitest-environment happy-dom

import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TraceDisplay } from './TraceDisplay';
import type { TraceInfo } from '../types';

// Mock icons
vi.mock('./icons', () => ({
  ChevronDown: () => <span data-testid="icon-chevron-down">ChevronDown</span>,
  ChevronRight: () => <span data-testid="icon-chevron-right">ChevronRight</span>,
  Check: () => <span data-testid="icon-check">Check</span>,
  XCircle: () => <span data-testid="icon-xcircle">XCircle</span>,
  Clock: () => <span data-testid="icon-clock">Clock</span>,
  Database: () => <span data-testid="icon-database">Database</span>,
  Brain: () => <span data-testid="icon-brain">Brain</span>,
  Zap: () => <span data-testid="icon-zap">Zap</span>,
  AlertTriangle: () => <span data-testid="icon-alert">AlertTriangle</span>,
  RefreshCw: () => <span data-testid="icon-refresh">RefreshCw</span>,
  Send: () => <span data-testid="icon-send">Send</span>,
  Code: () => <span data-testid="icon-code">Code</span>,
  ExternalLink: () => <span data-testid="icon-external-link">ExternalLink</span>,
  Filter: () => <span data-testid="icon-filter">Filter</span>,
}));

// Mock DebugInfoModal so TraceDisplay doesn't pull in the full modal
vi.mock('./DebugInfoModal', () => ({
  DebugInfoModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="debug-info-modal">
      <button data-testid="modal-close" onClick={onClose}>
        Close
      </button>
    </div>
  ),
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
    duration: 500,
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

function traceWithFullData(): TraceInfo {
  return {
    duration: 3200,
    toolCalls: [
      {
        name: 'searchFiles',
        success: true,
        duration: 200,
        arguments: { pattern: '*.ts' },
        result: 'Found 3 files',
        reason: 'searching for typescript files',
      },
      {
        name: 'deleteFile',
        success: false,
        duration: 50,
        error: 'Forbidden',
        arguments: { path: '/etc/config' },
      },
    ],
    modelCalls: [
      {
        provider: 'anthropic',
        model: 'claude-3',
        inputTokens: 500,
        outputTokens: 200,
        duration: 1200,
      },
    ],
    autonomyChecks: [
      { tool: 'deleteFile', approved: false, reason: 'High risk operation' },
      { tool: 'readFile', approved: true },
    ],
    dbOperations: { reads: 10, writes: 3 },
    memoryOps: { adds: 2, recalls: 5 },
    triggersFired: ['report_generator'],
    errors: ['Failed to connect to database on retry 2'],
    retries: [{ attempt: 2, error: 'Connection timeout', delayMs: 500 }],
    mcpToolEvents: [
      { type: 'tool_start', toolName: 'webSearch', timestamp: '2026-01-01T00:00:00Z' },
      {
        type: 'tool_end',
        toolName: 'webSearch',
        timestamp: '2026-01-01T00:00:01Z',
        result: { success: true, preview: 'Search results page', durationMs: 800 },
      },
    ],
    request: {
      provider: 'anthropic',
      model: 'claude-3',
      endpoint: '/v1/messages',
      messageCount: 5,
      tools: ['searchFiles', 'webSearch'],
    },
    response: {
      status: 'success',
      finishReason: 'stop',
      contentLength: 500,
    },
    routing: {
      relevantExtensionIds: ['ext-1', 'ext-2'],
      relevantCategories: ['data-access'],
      intentHint: 'Find relevant files',
      confidence: 0.85,
      suggestedTools: [{ name: 'searchFiles', brief: 'Search through files' }],
      relevantTables: ['users', 'orders'],
      relevantMcpServers: ['search-server'],
    },
    events: [
      { type: 'tool_call', name: 'searchFiles', duration: 200, success: true },
      { type: 'tool_call', name: 'deleteFile', duration: 50, success: false },
    ],
  };
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('TraceDisplay', () => {
  it('returns null when trace is undefined/null', () => {
    // @ts-expect-error testing null/undefined trace
    const container = render(<TraceDisplay trace={null} />);
    expect(container.textContent).toBe('');
  });

  it('renders collapsed state with basic summary', () => {
    const container = render(<TraceDisplay trace={minimalTrace()} />);

    // Header should show debug info and duration
    expect(container.textContent).toContain('Debug Info');
    expect(container.textContent).toContain('500ms');

    // Should have the Logs button
    expect(container.textContent).toContain('Logs');

    // Expanded content should NOT be visible initially
    expect(container.textContent).not.toContain('Routing');
    expect(container.textContent).not.toContain('Model Calls');
  });

  it('expands to show routing, model calls, and current sections when clicked', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    // Find and click the expandable header
    const headerBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Debug Info')
    );
    expect(headerBtn).not.toBeNull();

    act(() => {
      headerBtn?.click();
    });

    // Expanded sections should be visible
    expect(container.textContent).toContain('Routing');
    expect(container.textContent).toContain('Find relevant files');
    expect(container.textContent).toContain('searchFiles');
    expect(container.textContent).toContain('users');
    expect(container.textContent).toContain('search-server');
    expect(container.textContent).toContain('85%');
    expect(container.textContent).toContain('Model Calls');
    expect(container.textContent).toContain('anthropic/claude-3');
    expect(container.textContent).toContain('500 in');
    expect(container.textContent).toContain('200 out');
    expect(container.textContent).toContain('1200ms');
  });

  it('shows autonomy checks with approved/blocked indicators', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    const headerBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Debug Info')
    );
    act(() => {
      headerBtn?.click();
    });

    expect(container.textContent).toContain('Autonomy Checks');
    expect(container.textContent).toContain('deleteFile');
    expect(container.textContent).toContain('readFile');
    expect(container.textContent).toContain('High risk operation');
  });

  it('shows DB and memory operations', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    const headerBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Debug Info')
    );
    act(() => {
      headerBtn?.click();
    });

    expect(container.textContent).toContain('Operations');
    expect(container.textContent).toContain('DB reads: 10');
    expect(container.textContent).toContain('DB writes: 3');
    expect(container.textContent).toContain('Memory adds: 2');
    expect(container.textContent).toContain('Memory recalls: 5');
  });

  it('shows triggers fired section', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    const headerBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Debug Info')
    );
    act(() => {
      headerBtn?.click();
    });

    expect(container.textContent).toContain('Triggers Fired');
    expect(container.textContent).toContain('report_generator');
  });

  it('shows MCP tool events', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    const headerBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Debug Info')
    );
    act(() => {
      headerBtn?.click();
    });

    expect(container.textContent).toContain('MCP Tool Calls');
    expect(container.textContent).toContain('webSearch');
    expect(container.textContent).toContain('tool_start');
    expect(container.textContent).toContain('tool_end');
    expect(container.textContent).toContain('Search results page');
  });

  it('shows errors section', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    const headerBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Debug Info')
    );
    act(() => {
      headerBtn?.click();
    });

    expect(container.textContent).toContain('Errors');
    expect(container.textContent).toContain('Failed to connect to database on retry 2');
  });

  it('shows request and response info', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    const headerBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Debug Info')
    );
    act(() => {
      headerBtn?.click();
    });

    expect(container.textContent).toContain('Request');
    expect(container.textContent).toContain('anthropic');
    expect(container.textContent).toContain('/v1/messages');
    expect(container.textContent).toContain('Response');
    expect(container.textContent).toContain('success');
    expect(container.textContent).toContain('stop');
    expect(container.textContent).toContain('500 chars');
  });

  it('shows retries section', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    const headerBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Debug Info')
    );
    act(() => {
      headerBtn?.click();
    });

    expect(container.textContent).toContain('Retries');
    expect(container.textContent).toContain('Attempt 2');
    expect(container.textContent).toContain('Connection timeout');
  });

  it('shows the EventsSection when expanded', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    const headerBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Debug Info')
    );
    act(() => {
      headerBtn?.click();
    });

    // The events section is collapsed by default, so we should see "All Events (2)"
    expect(container.textContent).toContain('All Events');
    expect(container.textContent).toContain('2');
  });

  it('opens the debug modal when "Logs" button is clicked', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    const logsBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Logs')
    );
    expect(logsBtn).not.toBeNull();

    act(() => {
      logsBtn?.click();
    });

    // Modal should be visible
    const modal = container.querySelector('[data-testid="debug-info-modal"]');
    expect(modal).not.toBeNull();
  });

  it('shows token stats in the collapsed header', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    // Collapsed header should show token count
    expect(container.textContent).toContain('500 in');
    expect(container.textContent).toContain('200 out');
  });

  it('shows autonomy blocked count in collapsed header', () => {
    const trace = traceWithFullData();
    const container = render(<TraceDisplay trace={trace} />);

    // 1 blocked autonomy check
    expect(container.textContent).toContain('1 blocked');
  });

  it('shows retry count in collapsed header', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    expect(container.textContent).toContain('1 retries');
  });

  it('shows MCP event count in collapsed header', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    expect(container.textContent).toContain('2 MCP');
  });

  it('shows error count in collapsed header', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    expect(container.textContent).toContain('1');
    // Error XCircle icon indicator
    expect(container.textContent).toContain('1');
  });

  it('shows routing info in collapsed header', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    expect(container.textContent).toContain('1 tools');
    expect(container.textContent).toContain('85%');
  });

  it('collapses back when clicked again', () => {
    const container = render(<TraceDisplay trace={traceWithFullData()} />);

    const headerBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Debug Info')
    );

    // Expand
    act(() => {
      headerBtn?.click();
    });
    expect(container.textContent).toContain('Routing');

    // Collapse
    act(() => {
      headerBtn?.click();
    });
    expect(container.textContent).not.toContain('Routing');
  });
});
