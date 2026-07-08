// @vitest-environment happy-dom
/**
 * useSidebarChat tests
 *
 * Uses a minimal renderHook implementation built on react-dom/client
 * since @testing-library/react is not a project dependency.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SidebarChatProvider, useSidebarChat } from './useSidebarChat';

// Mock crypto.randomUUID
const randomUUID = vi.fn(() => 'mock-uuid-001');
vi.stubGlobal('crypto', { randomUUID });

// Mock SSE parser
vi.mock('../utils/sse-parser', () => ({
  parseSSELine: vi.fn(),
}));

// ---- Minimal renderHook ----

function renderHook<T>(
  useHook: () => T,
  options?: { wrapper?: React.FC<{ children: ReactNode }> }
) {
  const result = { current: null as unknown as T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  function TestComponent() {
    result.current = useHook();
    return null;
  }

  const element = options?.wrapper
    ? createElement(options.wrapper, { children: createElement(TestComponent) } as {
        children: ReactNode;
      })
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
const wrapper: React.FC<{ children: ReactNode }> = ({ children }) =>
  createElement(MemoryRouter, null, createElement(SidebarChatProvider, null, children));

// ---- Tests ----

describe('useSidebarChat', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  // ── Initial state ──

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

  test('initial state: streamingContent empty', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    expect(result.current.streamingContent).toBe('');

    unmount();
  });

  // ── Input ──

  test('setInput: updates input value', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    act(() => {
      result.current.setInput('hello world');
    });

    expect(result.current.input).toBe('hello world');

    unmount();
  });

  // ── Context ──

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

    act(() => {
      result.current.setContext('/path-a', 'workspace');
    });

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
    act(() => {
      result.current.setContext('/path', 'workspace');
    });

    expect(result.current.contextPath).toBe('/path');
    expect(result.current.contextType).toBe('workspace');

    unmount();
  });

  test('setContext: aborts in-flight stream when changing', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    // Start by setting context to make it active, then change
    act(() => {
      result.current.setContext('/old', 'workspace');
      result.current.setContext('/new', 'workspace');
    });

    expect(result.current.contextPath).toBe('/new');
    expect(result.current.isStreaming).toBe(false);

    unmount();
  });

  // ── Clear messages / Cancel stream ──

  test('clearMessages: empties message array and conversationId', () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    act(() => {
      result.current.setContext('/path', 'test');
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.conversationId).toBeNull();

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

  // ── Provider / Model ──

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

  test('initial provider/model: falls back to empty string on localStorage error', () => {
    // Simulate a localStorage error by corrupting the getItem
    const origGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('storage error');
    });

    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    expect(result.current.provider).toBe('');
    expect(result.current.model).toBe('');

    Storage.prototype.getItem = origGetItem;
    unmount();
  });

  // ── sendMessage ──

  test('sendMessage: returns early for empty content', async () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    // Ensure fetch is not called
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);

    fetchSpy.mockRestore();
    unmount();
  });

  test('sendMessage: sends fetch request with correct headers and body', async () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { response: 'Hello!' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0]!;
    expect(call[0]).toContain('/api/v1/chat');
    expect(call[1]!.method).toBe('POST');
    const body = JSON.parse(call[1]!.body as string);
    expect(body.message).toBe('Hi');
    expect(body.stream).toBe(true);

    fetchSpy.mockRestore();
    unmount();
  });

  test('sendMessage: handles JSON response and adds assistant message', async () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { response: 'Hello there!' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.messages).toHaveLength(2); // user + assistant
    expect(result.current.messages[0]!.role).toBe('user');
    expect(result.current.messages[0]!.content).toBe('Hi');
    expect(result.current.messages[1]!.role).toBe('assistant');
    expect(result.current.messages[1]!.content).toBe('Hello there!');
    expect(result.current.isStreaming).toBe(false);

    fetchSpy.mockRestore();
    unmount();
  });

  test('sendMessage: sets isStreaming true during request', async () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });
    let resolvePromise: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolvePromise = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchPromise);

    const sendPromise = result.current.sendMessage('Hi');

    // isStreaming should be true after the first microtick
    await act(async () => {
      resolvePromise!(
        new Response(JSON.stringify({ data: { response: 'OK' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    await act(async () => {
      await sendPromise;
    });

    expect(result.current.isStreaming).toBe(false);

    fetchSpy.mockRestore();
    unmount();
  });

  test('sendMessage: handles HTTP error status', async () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Bad request' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.messages).toHaveLength(2); // user + error
    expect(result.current.messages[1]!.isError).toBe(true);
    expect(result.current.messages[1]!.content).toContain('Bad request');
    expect(result.current.isStreaming).toBe(false);

    fetchSpy.mockRestore();
    unmount();
  });

  test('sendMessage: handles network error', async () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.messages).toHaveLength(2); // user + error
    expect(result.current.messages[1]!.isError).toBe(true);
    expect(result.current.messages[1]!.content).toContain('Network failure');

    fetchSpy.mockRestore();
    unmount();
  });

  test('sendMessage: adds X-Runtime header for bridge providers', async () => {
    localStorage.setItem(
      'ownpilot-provider-names',
      JSON.stringify({ 'prov-1': 'bridge-opencode' })
    );
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    act(() => {
      result.current.setProvider('prov-1');
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { response: 'OK' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    const headers = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['X-Runtime']).toBe('opencode');

    fetchSpy.mockRestore();
    unmount();
  });

  test('sendMessage: adds X-Project-Dir header when contextPath set', async () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });

    act(() => {
      result.current.setContext('/my/project', 'workspace');
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { response: 'OK' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    const headers = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['X-Project-Dir']).toBe('/my/project');

    fetchSpy.mockRestore();
    unmount();
  });

  // ── AbortError ──

  test('sendMessage: AbortError is silently caught', async () => {
    const { result, unmount } = renderHook(() => useSidebarChat(), { wrapper });
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    // AbortError should not add an error message
    expect(result.current.messages).toHaveLength(1); // only user message
    expect(result.current.isStreaming).toBe(false);

    fetchSpy.mockRestore();
    unmount();
  });

  // ── Throws outside provider ──

  test('throws when used outside provider', () => {
    expect(() => renderHook(() => useSidebarChat())).toThrow(
      'useSidebarChat must be used within a SidebarChatProvider'
    );
  });
});
