// @vitest-environment happy-dom

/**
 * ToolExecutionDisplay tests.
 *
 * Pure functions: resolveWorkspaceImageUrl, isLocalExecution
 * Component: ToolExecutionDisplay render + expand/collapse
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ToolExecutionDisplay,
  isLocalExecution,
  resolveWorkspaceImageUrl,
} from './ToolExecutionDisplay';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// ── Exported pure functions ──

describe('isLocalExecution', () => {
  it('returns false for null/undefined', () => {
    expect(isLocalExecution(null)).toBe(false);
    expect(isLocalExecution(undefined)).toBe(false);
  });
  it('returns true when sandboxed is false', () => {
    expect(isLocalExecution({ sandboxed: false })).toBe(true);
    expect(isLocalExecution({ sandboxed: true })).toBe(false);
  });
  it('parses JSON string results', () => {
    expect(isLocalExecution('{"sandboxed":false}')).toBe(true);
    expect(isLocalExecution('plain text')).toBe(false);
  });
});

describe('resolveWorkspaceImageUrl', () => {
  it('returns null for empty path', () => {
    expect(resolveWorkspaceImageUrl(undefined)).toBeNull();
    expect(resolveWorkspaceImageUrl('')).toBeNull();
  });
  it('passes through http URLs', () => {
    expect(resolveWorkspaceImageUrl('https://example.com/img.png')).toBe(
      'https://example.com/img.png'
    );
  });
  it('resolves workspace-relative paths', () => {
    const result = resolveWorkspaceImageUrl('file.png', 'ws-1');
    expect(result).toContain('/api/v1/file-workspaces/ws-1/file/');
  });
  it('blocks unsafe paths', () => {
    expect(resolveWorkspaceImageUrl('data:image/svg+xml,<svg onload=alert(1)>', 'ws-1')).toBeNull();
  });
});

// ── ToolExecutionDisplay ──

describe('ToolExecutionDisplay', () => {
  function renderDisplay(props: Record<string, unknown> = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const defaultCalls = [
      {
        id: 'tc1',
        name: 'read_file',
        arguments: { path: '/test.txt' },
        status: 'success',
        result: { content: 'hello' },
      },
    ];
    act(() =>
      root.render(
        createElement(
          ToolExecutionDisplay as never,
          {
            toolCalls: props.toolCalls ?? defaultCalls,
            ...props,
          } as never
        )
      )
    );
    const expand = () => {
      act(() => (container.querySelector('button') as HTMLButtonElement)?.click());
    };
    return {
      container,
      expand,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it('renders formatted tool names', () => {
    const r = renderDisplay();
    expect(r.container.textContent).toContain('Read File');
    r.cleanup();
  });

  it('renders multiple tool calls', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'read_file',
          arguments: {},
          status: 'success',
          result: { content: 'a' },
        },
        {
          id: 'tc2',
          name: 'write_file',
          arguments: {},
          status: 'success',
          result: { content: 'b' },
        },
      ],
    });
    expect(r.container.textContent).toContain('Read File');
    expect(r.container.textContent).toContain('Write File');
    r.cleanup();
  });

  it('shows category badges', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'execute_python',
          arguments: {},
          status: 'success',
          result: { stdout: 'ok' },
        },
      ],
    });
    expect(r.container.textContent).toContain('Code Execution');
    r.cleanup();
  });

  it('shows duration when present', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'search_web',
          arguments: {},
          status: 'success',
          duration: 1234,
          result: {},
        },
      ],
    });
    expect(r.container.textContent).toContain('1234ms');
    r.cleanup();
  });

  it('shows LOCAL badge for unsandboxed results', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'execute_python',
          arguments: {},
          status: 'success',
          result: { sandboxed: false },
        },
      ],
    });
    expect(r.container.textContent).toContain('LOCAL');
    r.cleanup();
  });

  it('shows error when expanded and onRerun button', () => {
    const onRerun = vi.fn();
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'http_request',
          arguments: {},
          status: 'error',
          error: 'Connection refused',
        },
      ],
      onRerun,
    });
    // Error is hidden when collapsed — expand to see it
    r.expand();
    expect(r.container.textContent).toContain('Connection refused');
    expect(r.container.textContent).toContain('Re-run');
    r.cleanup();
  });

  it('toggles argument view on click', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'read_file',
          arguments: { path: '/secret.txt' },
          status: 'success',
          result: {},
        },
      ],
    });
    // Arguments not visible initially (collapsed)
    r.expand();
    expect(r.container.textContent).toContain('Arguments');
    // Arguments JSON is collapsed by default — click to show
    const argBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Arguments'
    );
    act(() => argBtn?.click());
    expect(r.container.textContent).toContain('/secret.txt');
    r.cleanup();
  });

  it('shows executing spinner for running status', () => {
    const r = renderDisplay({
      toolCalls: [{ id: 'tc1', name: 'search_web', arguments: {}, status: 'running' }],
    });
    r.expand();
    expect(r.container.textContent).toContain('Executing');
    r.cleanup();
  });

  it('renders search result items', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'search_web',
          arguments: {},
          status: 'success',
          result: {
            results: [
              { title: 'Test Result', url: 'https://example.com', snippet: 'A test result' },
            ],
          },
        },
      ],
    });
    r.expand();
    expect(r.container.textContent).toContain('Test Result');
    expect(r.container.textContent).toContain('A test result');
    r.cleanup();
  });
});
