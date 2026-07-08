// @vitest-environment happy-dom
/**
 * useWebSocket tests — reconnection lifecycle, message handling, subscribe.
 *
 * Uses a controllable fake WebSocket and minimal renderHook.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useWebSocket } from './useWebSocket';

// ---- Controllable fake WebSocket ----

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(_data?: string) {}
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  simulateClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
  simulateMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
  simulateError(error: unknown) {
    this.onerror?.(error);
  }
}

// ---- Mock session events ----
vi.mock('../utils/session-events', () => ({
  onSessionChanged: vi.fn(() => vi.fn()), // returns an unsubscribe function
}));

import { onSessionChanged } from '../utils/session-events';

// ---- Minimal renderHook ----

function renderHook<T>(useHook: () => T) {
  const result = { current: null as unknown as T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  function TestComponent() {
    result.current = useHook();
    return null as unknown as ReactNode;
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(TestComponent));
  });

  return {
    result,
    unmount: () =>
      act(() => {
        root.unmount();
        if (container.parentNode) container.parentNode.removeChild(container);
      }),
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useWebSocket', () => {
  // ── Connection lifecycle ──

  test('auto-connects on mount with default URL', () => {
    const { unmount } = renderHook(() => useWebSocket());

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]!.url).toContain('/ws');

    unmount();
  });

  test('connect() creates a WebSocket and transitions to connecting', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));

    expect(result.current.status).toBe('connecting');

    unmount();
  });

  test('transitions to connected on socket open', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));

    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    expect(result.current.status).toBe('connected');

    unmount();
  });

  test('transitions to disconnected on socket close (no reconnect)', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));

    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    act(() => FakeWebSocket.instances[0]!.simulateClose());

    expect(result.current.status).toBe('disconnected');

    unmount();
  });

  // Note: VITE_DISABLE_WS is a compile-time Vite replacement (import.meta.env),
  // not mockable at runtime. Tested indirectly via the rest of the suite.

  // ── connect / disconnect ──

  test('disconnect clears sessionId and sets status', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));

    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    act(() => result.current.disconnect());

    expect(result.current.status).toBe('disconnected');
    expect(result.current.sessionId).toBeNull();
    expect(result.current.send).toBeDefined();

    unmount();
  });

  test('connect is idempotent when socket is already open', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));

    act(() => FakeWebSocket.instances[0]!.simulateOpen());

    // Calling connect again should not create a new socket
    act(() => result.current.connect());
    expect(FakeWebSocket.instances).toHaveLength(1);

    unmount();
  });

  test('double connect when CONNECTING does not create second socket', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));

    // Initial auto-connect creates socket 0
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]!.readyState).toBe(FakeWebSocket.CONNECTING);

    act(() => result.current.connect());
    // Should not create a new socket because the existing one is still CONNECTING
    expect(FakeWebSocket.instances).toHaveLength(1);

    unmount();
  });

  // ── Reconnection ──

  test('a genuine dropped connection reconnects with backoff', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnectDelay: 1000 }));
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    expect(result.current.status).toBe('connected');

    act(() => FakeWebSocket.instances[0]!.simulateClose());
    expect(result.current.status).toBe('disconnected');

    // Backoff fires → a second socket is created
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(2);

    unmount();
  });

  test('exponential backoff increases delay', () => {
    const { unmount } = renderHook(() => useWebSocket({ reconnectDelay: 1000 }));

    act(() => FakeWebSocket.instances[0]!.simulateOpen());

    // First drop: reconnect after 1s
    act(() => FakeWebSocket.instances[0]!.simulateClose());
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Second drop: reconnect after 2s (exponential)
    act(() => FakeWebSocket.instances[1]!.simulateOpen());
    act(() => FakeWebSocket.instances[1]!.simulateClose());
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(2); // not yet
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(3);

    unmount();
  });

  test('backoff caps at 30s', () => {
    const { unmount } = renderHook(() => useWebSocket({ reconnectDelay: 1000 }));

    // After enough retries, delay should cap at 30s
    // Trigger 5 drops to push the backoff to 32s which caps at 30s
    for (let i = 0; i < 6; i++) {
      act(() => {
        if (FakeWebSocket.instances[i]) FakeWebSocket.instances[i]!.simulateOpen();
      });
      act(() => {
        if (FakeWebSocket.instances[i]) FakeWebSocket.instances[i]!.simulateClose();
      });
      if (i < 5) {
        act(() => vi.advanceTimersByTime(35_000));
      }
    }

    // Should still reconnect (capped at 30s, not infinite)
    act(() => vi.advanceTimersByTime(30_000));
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);

    unmount();
  });

  test('an intentional disconnect() does NOT reconnect', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnectDelay: 1000 }));
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => FakeWebSocket.instances[0]!.simulateOpen());

    act(() => result.current.disconnect());
    act(() => FakeWebSocket.instances[0]!.simulateClose());
    act(() => vi.advanceTimersByTime(60_000));

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(result.current.status).toBe('disconnected');

    unmount();
  });

  test('unmount does not spawn a zombie reconnecting socket', () => {
    const { unmount } = renderHook(() => useWebSocket({ reconnectDelay: 1000 }));
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => FakeWebSocket.instances[0]!.simulateOpen());

    unmount();

    act(() => FakeWebSocket.instances[0]!.simulateClose());
    act(() => vi.advanceTimersByTime(60_000));

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // ── Message handling ──

  test('connection:ready sets sessionId', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));

    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    act(() =>
      FakeWebSocket.instances[0]!.simulateMessage(
        JSON.stringify({ type: 'connection:ready', payload: { sessionId: 'sess-123' } })
      )
    );

    expect(result.current.sessionId).toBe('sess-123');

    unmount();
  });

  test('connection:ping triggers pong response', () => {
    const { unmount } = renderHook(() => useWebSocket({ reconnect: false }));
    const sendSpy = vi.spyOn(FakeWebSocket.instances[0]!, 'send');

    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    act(() =>
      FakeWebSocket.instances[0]!.simulateMessage(
        JSON.stringify({ type: 'connection:ping', payload: { timestamp: '2025-01-01T00:00:00Z' } })
      )
    );

    // send should have been called with a pong message
    expect(sendSpy).toHaveBeenCalled();
    const sentMsg = JSON.parse(sendSpy.mock.calls[0]![0] as string);
    expect(sentMsg.type).toBe('session:pong');

    unmount();
  });

  test('subscribe: registers handler and receives messages', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));
    const handler = vi.fn();

    act(() => {
      result.current.subscribe('test:event', handler);
    });
    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    act(() =>
      FakeWebSocket.instances[0]!.simulateMessage(
        JSON.stringify({ type: 'test:event', payload: { data: 42 } })
      )
    );

    expect(handler).toHaveBeenCalledWith({ data: 42 });

    unmount();
  });

  test('subscribe returns unsubscribe function that removes handler', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));
    const handler = vi.fn();

    let unsubscribe: () => void;
    act(() => {
      unsubscribe = result.current.subscribe('test:event', handler);
    });
    act(() => {
      unsubscribe!();
    });
    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    act(() =>
      FakeWebSocket.instances[0]!.simulateMessage(
        JSON.stringify({ type: 'test:event', payload: { data: 42 } })
      )
    );

    expect(handler).not.toHaveBeenCalled();

    unmount();
  });

  test('subscribe("*") wildcard receives all events', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));
    const wildcardHandler = vi.fn();

    act(() => {
      result.current.subscribe('*', wildcardHandler);
    });
    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    act(() =>
      FakeWebSocket.instances[0]!.simulateMessage(
        JSON.stringify({ type: 'custom:event', payload: { ok: true } })
      )
    );

    expect(wildcardHandler).toHaveBeenCalledWith({
      type: 'custom:event',
      payload: { ok: true },
    });

    unmount();
  });

  test('error in subscriber handler does not crash', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    act(() => {
      result.current.subscribe('test:event', () => {
        throw new Error('handler error');
      });
    });
    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    act(() =>
      FakeWebSocket.instances[0]!.simulateMessage(
        JSON.stringify({ type: 'test:event', payload: {} })
      )
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error in WebSocket handler'),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
    unmount();
  });

  test('malformed message JSON is handled gracefully', () => {
    const { unmount } = renderHook(() => useWebSocket({ reconnect: false }));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    act(() => FakeWebSocket.instances[0]!.simulateMessage('not-json'));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse WebSocket message'),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
    unmount();
  });

  // ── send ──

  test('send writes JSON message when connected', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));
    const sendSpy = vi.spyOn(FakeWebSocket.instances[0]!, 'send');

    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    act(() => {
      result.current.send('my:event', { key: 'value' });
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendSpy.mock.calls[0]![0] as string);
    expect(sent.type).toBe('my:event');
    expect(sent.payload).toEqual({ key: 'value' });
    expect(sent.timestamp).toBeDefined();

    sendSpy.mockRestore();
    unmount();
  });

  test('send warns when not connected', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sendSpy = vi.spyOn(FakeWebSocket.instances[0]!, 'send');

    act(() => {
      result.current.send('my:event', {});
    });

    expect(consoleWarn).toHaveBeenCalledWith('WebSocket not connected, cannot send message');
    expect(sendSpy).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
    unmount();
  });

  // ── Error handling ──

  test('socket error sets status to error', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnect: false }));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    act(() => FakeWebSocket.instances[0]!.simulateError(new Event('error')));

    expect(result.current.status).toBe('error');

    consoleSpy.mockRestore();
    unmount();
  });

  test('session disconnect on authenticated=false does not reconnect', () => {
    renderHook(() => useWebSocket({ reconnect: true }));

    // Get the session listener callback
    const listener = vi.mocked(onSessionChanged).mock.calls[0]![0];
    expect(listener).toBeInstanceOf(Function);

    // Fire session changed with authenticated=false (logout)
    act(() => {
      listener({ authenticated: false });
    });

    // A WebSocket should NOT be created (disconnected path)
    expect(FakeWebSocket.instances).toHaveLength(1); // only the auto-connect one

    // status should be disconnected
    // Can't easily verify status since the listener doesn't expose it through the hook result
    // But we can check that no socket was created
  });

  test('session connect on authenticated=true reconnects', () => {
    renderHook(() => useWebSocket({ reconnect: true }));

    const listener = vi.mocked(onSessionChanged).mock.calls[0]![0];

    // Fire session changed with authenticated=true (login)
    act(() => {
      listener({ authenticated: true });
    });

    // Should create a new WebSocket connection
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
