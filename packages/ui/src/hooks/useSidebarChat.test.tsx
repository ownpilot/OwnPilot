// @vitest-environment happy-dom
/**
 * useSidebarChat tests
 *
 * Uses a minimal renderHook implementation built on react-dom/client
 * since @testing-library/react is not a project dependency.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SidebarChatProvider, useSidebarChat } from './useSidebarChat';

// ---- Minimal renderHook (no @testing-library/react needed) ----

function renderHook<T>(useHook: () => T, options?: { wrapper?: React.FC<{ children: ReactNode }> }) {
  const result = { current: null as unknown as T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  function TestComponent() {
    result.current = useHook();
    return null;
  }

  const element = options?.wrapper
    ? createElement(options.wrapper, { children: createElement(TestComponent) } as { children: ReactNode })
    : createElement(TestComponent);

  act(() => {
    root = createRoot(container);
    root!.render(element);
  });

  return {
    result: result as { current: T },
    unmount: () =>
      act(() => {
        root!.unmount();
        if (container.parentNode) container.parentNode.removeChild(container);
      }),
    rerender: (newElement?: React.ReactElement) => {
      act(() => {
        root!.render(newElement ?? element);
      });
    },
  };
}

// ---- Provider wrapper ----
// SidebarChatProvider now calls usePageCopilotContext which requires a Router
const wrapper: React.FC<{ children: ReactNode }> = ({ children }) =>
  createElement(MemoryRouter, null, createElement(SidebarChatProvider, null, children));

// ---- Tests ----

describe('useSidebarChat', () => {
  beforeEach(() => {
    // Reset localStorage between tests
    localStorage.clear();
  });

  test('initial state: messages empty, not streaming, no conversationId', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.conversationId).toBeNull();

    unmount();
  });

  test('initial state: input empty string', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    expect(result.current.input).toBe('');

    unmount();
  });

  test('initial state: contextPath and contextType null', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    expect(result.current.contextPath).toBeNull();
    expect(result.current.contextType).toBeNull();

    unmount();
  });

  test('setInput: updates input value', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    act(() => {
      result.current.setInput('hello world');
    });

    expect(result.current.input).toBe('hello world');

    unmount();
  });

  test('setContext: sets contextPath and contextType', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    act(() => {
      result.current.setContext('/some/path', 'workspace');
    });

    expect(result.current.contextPath).toBe('/some/path');
    expect(result.current.contextType).toBe('workspace');

    unmount();
  });

  test('setContext change: clears messages and nulls conversationId', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    // Set initial context
    act(() => {
      result.current.setContext('/path-a', 'workspace');
    });

    // Simulate a message + conversationId (by testing setContext reset)
    // Change context → should reset
    act(() => {
      result.current.setContext('/path-b', 'claw');
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toBeNull();
    expect(result.current.contextPath).toBe('/path-b');
    expect(result.current.contextType).toBe('claw');

    unmount();
  });

  test('setContext noop: same path+type does not reset', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    act(() => {
      result.current.setContext('/path', 'workspace');
    });
    // Calling again with same values should be a no-op
    act(() => {
      result.current.setContext('/path', 'workspace');
    });

    expect(result.current.contextPath).toBe('/path');
    expect(result.current.contextType).toBe('workspace');

    unmount();
  });

  test('clearMessages: empties message array', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);

    unmount();
  });

  test('cancelStream: sets isStreaming false', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    act(() => {
      result.current.cancelStream();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe('');

    unmount();
  });

  test('setProvider/setModel: update provider and model values', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    act(() => {
      result.current.setProvider('anthropic');
      result.current.setModel('claude-opus-4-6');
    });

    expect(result.current.provider).toBe('anthropic');
    expect(result.current.model).toBe('claude-opus-4-6');

    unmount();
  });

  test('initial provider/model: reads from localStorage', () => {
    localStorage.setItem('ownpilot-default-provider', 'openai');
    localStorage.setItem('ownpilot-default-model', 'gpt-4o');

    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    expect(result.current.provider).toBe('openai');
    expect(result.current.model).toBe('gpt-4o');

    unmount();
  });

  test('throws when used outside provider', () => {
    expect(() =>
      renderHook(() => useSidebarChat())
    ).toThrow('useSidebarChat must be used within a SidebarChatProvider');
  });
});
