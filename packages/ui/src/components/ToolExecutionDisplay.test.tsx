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
  it('returns false for non-object, non-string results', () => {
    expect(isLocalExecution(42)).toBe(false);
    expect(isLocalExecution(true)).toBe(false);
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
  it('returns null for relative path without workspace', () => {
    expect(resolveWorkspaceImageUrl('relative/path.png')).toBeNull();
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
      root,
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

  it('shows pending status icon', () => {
    const r = renderDisplay({
      toolCalls: [{ id: 'tc1', name: 'read_file', arguments: {}, status: 'pending' }],
    });
    expect(r.container.textContent).toContain('Read File');
    r.cleanup();
  });

  it('infers error status from error prop when status is missing', () => {
    const r = renderDisplay({
      toolCalls: [{ id: 'tc1', name: 'read_file', arguments: {}, error: 'Something broke' }],
    });
    r.expand();
    expect(r.container.textContent).toContain('Something broke');
    r.cleanup();
  });

  it('renders image tool result with preview', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'generate_image',
          arguments: {},
          status: 'success',
          result: { output: '/images/foo.png' },
        },
      ],
      workspaceId: 'ws-1',
    });
    r.expand();
    expect(r.container.textContent).toContain('/images/foo.png');
    expect(r.container.querySelector('img')).toBeTruthy();
    r.cleanup();
  });

  it('renders read_file result with file path', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'read_file',
          arguments: {},
          status: 'success',
          result: { path: '/src/main.ts', content: 'console.log("hello")' },
        },
      ],
    });
    r.expand();
    expect(r.container.textContent).toContain('/src/main.ts');
    expect(r.container.textContent).toContain('console.log');
    r.cleanup();
  });

  it('renders directory listing results', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'list_directory',
          arguments: {},
          status: 'success',
          result: {
            files: [
              { name: 'file1.txt', size: 1024, isDirectory: false },
              { name: 'subdir', isDirectory: true },
            ],
          },
        },
      ],
    });
    r.expand();
    expect(r.container.textContent).toContain('file1.txt');
    expect(r.container.textContent).toContain('1 KB');
    expect(r.container.textContent).toContain('subdir');
    r.cleanup();
  });

  it('renders code execution results with stdout/stderr/exitCode', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'execute_python',
          arguments: {},
          status: 'success',
          result: { stdout: 'Hello', stderr: 'Warning', exitCode: 0, result: 42 },
        },
      ],
    });
    r.expand();
    expect(r.container.textContent).toContain('Hello');
    expect(r.container.textContent).toContain('Warning');
    expect(r.container.textContent).toContain('42');
    expect(r.container.textContent).toContain('Exit code: 0');
    r.cleanup();
  });

  it('renders web fetch results with status and URL', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'fetch_web_page',
          arguments: {},
          status: 'success',
          result: { status: 200, url: 'https://example.com', text: 'Page content here' },
        },
      ],
    });
    r.expand();
    expect(r.container.textContent).toContain('200');
    expect(r.container.textContent).toContain('https://example.com');
    expect(r.container.textContent).toContain('Page content here');
    r.cleanup();
  });

  it('renders web fetch 404 status', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'fetch_web_page',
          arguments: {},
          status: 'error',
          result: { status: 404, url: 'https://example.com/notfound', text: 'Not Found' },
        },
      ],
    });
    r.expand();
    expect(r.container.textContent).toContain('404');
    r.cleanup();
  });

  it('renders web fetch with JSON body', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'http_request',
          arguments: {},
          status: 'success',
          result: { status: 200, body: { key: 'value' } },
        },
      ],
    });
    r.expand();
    expect(r.container.textContent).toContain('"key"');
    expect(r.container.textContent).toContain('"value"');
    r.cleanup();
  });

  it('renders default display for plain string result', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'read_file',
          arguments: {},
          status: 'success',
          result: 'plain result string',
        },
      ],
    });
    r.expand();
    expect(r.container.textContent).toContain('plain result string');
    r.cleanup();
  });

  it('renders JSON string as formatted output', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'read_file',
          arguments: {},
          status: 'success',
          result: '{"key": "value", "nested": {"a": 1}}',
        },
      ],
    });
    r.expand();
    expect(r.container.textContent).toContain('"key"');
    r.cleanup();
  });

  it('renders skip for null result when no error and not running', () => {
    const r = renderDisplay({
      toolCalls: [
        {
          id: 'tc1',
          name: 'read_file',
          arguments: {},
          status: 'success',
          result: undefined,
        },
      ],
    });
    r.expand();
    // No error, no result, not running — nothing in the result area
    const resultLabels = Array.from(r.container.querySelectorAll('span')).filter(
      (s) => s.textContent?.trim() === 'Result'
    );
    expect(resultLabels.length).toBe(1);
    r.cleanup();
  });

  it('calls onRerun when re-run button is clicked', () => {
    const onRerun = vi.fn();
    const toolCall = {
      id: 'tc1',
      name: 'read_file',
      arguments: {},
      status: 'success',
      result: { content: 'hello' },
    };
    const r = renderDisplay({
      toolCalls: [toolCall],
      onRerun,
    });
    r.expand();
    const rerunBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Re-run'
    );
    expect(rerunBtn).toBeDefined();
    act(() => rerunBtn!.click());
    expect(onRerun).toHaveBeenCalledWith(expect.objectContaining({ id: 'tc1', name: 'read_file' }));
    r.cleanup();
  });

  it('renders extension and skill categories', () => {
    const r = renderDisplay({
      toolCalls: [
        { id: 'tc1', name: 'ext.my_tool', arguments: {}, status: 'success', result: {} },
        { id: 'tc2', name: 'skill.my_skill', arguments: {}, status: 'success', result: {} },
      ],
    });
    expect(r.container.textContent).toContain('Extension');
    expect(r.container.textContent).toContain('Skill');
    r.cleanup();
  });

  it('renders Other category for unknown tool names', () => {
    const r = renderDisplay({
      toolCalls: [{ id: 'tc1', name: 'custom_tool', arguments: {}, status: 'success', result: {} }],
    });
    expect(r.container.textContent).toContain('Other');
    r.cleanup();
  });

  it('renders Web & API category', () => {
    const r = renderDisplay({
      toolCalls: [
        { id: 'tc1', name: 'http_request', arguments: {}, status: 'success', result: {} },
      ],
    });
    expect(r.container.textContent).toContain('Web & API');
    r.cleanup();
  });
});
