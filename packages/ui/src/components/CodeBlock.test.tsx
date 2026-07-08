// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// prism-react-renderer uses a render-prop pattern — mock Highlight to call
// its children with simple synthetic tokens so we can test the UI wrapper.
vi.mock('prism-react-renderer', () => ({
  Highlight: ({
    children,
    code,
  }: {
    children: (props: Record<string, unknown>) => ReactNode;
    code: string;
  }) => {
    const lines = code.split('\n');
    const tokens = lines.map((line) =>
      line
        .split(/(\s+)/)
        .filter(Boolean)
        .map((content: string) => ({
          content,
          types: ['string'],
          empty: false,
        }))
    );

    return children({
      className: 'prism-code language-js',
      style: {},
      tokens,
      getLineProps: ({ line: _line, key }: { line: unknown; key: number }) => ({
        className: 'token-line',
        key,
      }),
      getTokenProps: ({ token, key }: { token: { content: string }; key: number }) => ({
        className: 'token string',
        key,
        children: token.content,
      }),
    });
  },
  themes: { vsDark: {} },
}));

import { CodeBlock } from './CodeBlock';

vi.mock('./icons', () => ({
  Copy: ({ className }: { className?: string }) =>
    createElement('svg', { 'data-testid': 'copy-icon', className }),
  Check: ({ className }: { className?: string }) =>
    createElement('svg', { 'data-testid': 'check-icon', className }),
  Play: ({ className }: { className?: string }) =>
    createElement('svg', { 'data-testid': 'play-icon', className }),
  Download: ({ className }: { className?: string }) =>
    createElement('svg', { 'data-testid': 'download-icon', className }),
}));

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
});

describe('CodeBlock', () => {
  it('renders code content', () => {
    const container = render(createElement(CodeBlock, { code: 'const x = 1;' }));
    expect(container.textContent).toContain('const x = 1;');
  });

  it('renders the language label', () => {
    const container = render(
      createElement(CodeBlock, { code: 'print("hello")', language: 'python' })
    );
    expect(container.textContent).toContain('python');
  });

  it('renders filename when provided', () => {
    const container = render(
      createElement(CodeBlock, { code: 'hello', language: 'text', filename: 'greeting.txt' })
    );
    expect(container.textContent).toContain('greeting.txt');
  });

  it('shows line numbers by default', () => {
    const container = render(
      createElement(CodeBlock, { code: 'line1\nline2\nline3', language: 'text' })
    );
    // Line numbers are rendered as span elements with text like "1", "2", "3"
    const spans = container.querySelectorAll('span');
    const lineNumbers = Array.from(spans)
      .filter((s) => s.textContent?.trim().match(/^\d+$/))
      .map((s) => s.textContent?.trim());
    expect(lineNumbers).toContain('1');
    expect(lineNumbers).toContain('2');
    expect(lineNumbers).toContain('3');
  });

  it('hides line numbers when showLineNumbers is false', () => {
    const container = render(
      createElement(CodeBlock, {
        code: 'line1\nline2',
        language: 'text',
        showLineNumbers: false,
      })
    );
    // Line numbers appear inside spans with a fixed width class; when hidden
    // the span should not be rendered at all.
    const lineNumberSpans = container.querySelectorAll('span');
    const numbersFound = Array.from(lineNumberSpans).filter(
      (s) => s.textContent?.trim().match(/^\d+$/) && s.className.includes('w-10')
    );
    expect(numbersFound.length).toBe(0);
  });

  it('copy button copies to clipboard and shows Check icon', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const container = render(createElement(CodeBlock, { code: 'copy me', language: 'text' }));

    // Click copy button (the third action button — after execute and download)
    const copyBtn = container.querySelector('button[title="Copy code"]');
    expect(copyBtn).not.toBeNull();

    await act(async () => {
      copyBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('copy me');

    // After copy, the button title changes to "Copied!" and shows Check icon
    expect(container.querySelector('[title="Copied!"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="check-icon"]')).not.toBeNull();
  });

  it('copy button reverts to Copy icon after 2 seconds', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const container = render(createElement(CodeBlock, { code: 'copy me', language: 'text' }));

    const copyBtn = container.querySelector('button[title="Copy code"]');
    await act(async () => {
      copyBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    // Should show Check icon immediately
    expect(container.querySelector('[data-testid="check-icon"]')).not.toBeNull();

    // Advance past 2 second timeout
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Should show Copy icon again
    expect(container.querySelector('[data-testid="copy-icon"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="check-icon"]')).toBeNull();

    vi.useRealTimers();
  });

  it('handles clipboard API error silently', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard blocked'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const container = render(createElement(CodeBlock, { code: 'test', language: 'text' }));

    const copyBtn = container.querySelector('button[title="Copy code"]');
    await act(async () => {
      copyBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    // Should still show Copy icon (no Check) since the copy failed silently
    expect(container.querySelector('[data-testid="copy-icon"]')).not.toBeNull();
    // Should NOT have switched to Copied! title
    expect(container.querySelector('[title="Copied!"]')).toBeNull();
  });

  it('shows execute button when onExecute is provided', () => {
    const onExecute = vi.fn();
    const container = render(
      createElement(CodeBlock, { code: 'test', language: 'text', onExecute })
    );
    const execBtn = container.querySelector('button[title="Execute code"]');
    expect(execBtn).not.toBeNull();
  });

  it('execute button calls onExecute on click', () => {
    const onExecute = vi.fn();
    const container = render(
      createElement(CodeBlock, { code: 'test', language: 'text', onExecute })
    );
    const execBtn = container.querySelector('button[title="Execute code"]')!;
    act(() => {
      execBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onExecute).toHaveBeenCalledOnce();
  });

  it('execute button is disabled when isExecuting', () => {
    const container = render(
      createElement(CodeBlock, {
        code: 'test',
        language: 'text',
        onExecute: vi.fn(),
        isExecuting: true,
      })
    );
    const execBtn = container.querySelector('button[title="Execute code"]') as HTMLButtonElement;
    expect(execBtn.disabled).toBe(true);
  });

  it('renders download button', () => {
    const container = render(createElement(CodeBlock, { code: 'test', language: 'text' }));
    const downloadBtn = container.querySelector('button[title="Download"]');
    expect(downloadBtn).not.toBeNull();
  });

  it('download button creates and clicks an anchor element', () => {
    // Mock createElement and anchor click
    const clickFn = vi.fn();
    const revokeFn = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = revokeFn;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const anchor = document.createElement('a');
    vi.spyOn(anchor, 'click').mockImplementation(clickFn);
    const createElementOrig = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') return anchor;
      return createElementOrig(tag);
    });

    const container = render(
      createElement(CodeBlock, { code: 'download me', language: 'javascript' })
    );
    const downloadBtn = container.querySelector('button[title="Download"]')!;
    act(() => {
      downloadBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(createObjectURL).toHaveBeenCalled();
    expect(anchor.download).toBeTruthy();
    expect(clickFn).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();

    createElementSpy.mockRestore();
  });

  it('applies custom maxHeight', () => {
    const container = render(
      createElement(CodeBlock, { code: 'test', language: 'text', maxHeight: '200px' })
    );
    const overflowDiv = container.querySelector('[style]');
    expect(overflowDiv?.innerHTML).toBeTruthy();
    // The maxHeight is applied to the overflow container
    expect(overflowDiv?.getAttribute('style')).toContain('200px');
  });

  it('uses default language plaintext when not provided', () => {
    const container = render(createElement(CodeBlock, { code: 'test' }));
    expect(container.textContent).toContain('plaintext');
  });

  it('maps shorthand language names to Prism identifiers', () => {
    const container = render(createElement(CodeBlock, { code: 'echo hi', language: 'sh' }));
    expect(container.textContent).toContain('sh');
  });

  it('renders copy button with default title', () => {
    const container = render(createElement(CodeBlock, { code: 'test', language: 'text' }));
    const btn = container.querySelector('button[title="Copy code"]');
    expect(btn).not.toBeNull();
  });

  it('download uses fallback extension for unknown languages', () => {
    // getExtension('unknown') → 'txt' via the fallback in the `||` chain
    const clickFn = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:mock-ext');

    const origCreateElement = document.createElement.bind(document);
    const anchor = origCreateElement('a');
    vi.spyOn(anchor, 'click').mockImplementation(clickFn);
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => (tag === 'a' ? anchor : origCreateElement(tag)));

    render(createElement(CodeBlock, { code: 'test', language: 'unknown_ext' }));

    const downloadBtn = document.querySelector('button[title="Download"]')!;
    act(() => {
      downloadBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(anchor.download).toBe('code.txt');
    createElementSpy.mockRestore();
  });

  it('download uses filename when provided', () => {
    const clickFn = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:mock-file');

    const origCreateElement = document.createElement.bind(document);
    const anchor = origCreateElement('a');
    vi.spyOn(anchor, 'click').mockImplementation(clickFn);
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => (tag === 'a' ? anchor : origCreateElement(tag)));

    render(
      createElement(CodeBlock, {
        code: 'test',
        language: 'js',
        filename: 'script.js',
      })
    );

    const downloadBtn = document.querySelector('button[title="Download"]')!;
    act(() => {
      downloadBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(anchor.download).toBe('script.js');
    createElementSpy.mockRestore();
  });
});
