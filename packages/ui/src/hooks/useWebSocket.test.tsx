// @vitest-environment happy-dom
/**
 * useWebSocket tests — reconnection lifecycle.
 *
 * Focus: an INTENTIONAL close (disconnect / unmount / logout) must NOT trigger
 * the auto-reconnect, while a genuine dropped connection MUST. Uses a minimal
 * renderHook built on react-dom/client (no @testing-library/react dependency)
 * and a controllable fake WebSocket.
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

  send() {}
  // close() does NOT auto-fire onclose — tests drive that explicitly to model
  // both intentional and dropped closes deterministically.
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
}

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
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useWebSocket reconnect lifecycle', () => {
  test('a genuine dropped connection reconnects', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnectDelay: 1000 }));
    // Mount auto-connects → one socket.
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => FakeWebSocket.instances[0]!.simulateOpen());
    expect(result.current.status).toBe('connected');

    // Server drops the connection (not via disconnect()).
    act(() => FakeWebSocket.instances[0]!.simulateClose());
    expect(result.current.status).toBe('disconnected');

    // Backoff fires → a second socket is created.
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(2);

    unmount();
  });

  test('an intentional disconnect() does NOT reconnect', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ reconnectDelay: 1000 }));
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => FakeWebSocket.instances[0]!.simulateOpen());

    // Intentional close.
    act(() => result.current.disconnect());

    // The socket's close event still fires afterwards — it must be ignored.
    act(() => FakeWebSocket.instances[0]!.simulateClose());
    act(() => vi.advanceTimersByTime(60_000));

    // No new socket was created.
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(result.current.status).toBe('disconnected');

    unmount();
  });

  test('unmount does not spawn a zombie reconnecting socket', () => {
    const { unmount } = renderHook(() => useWebSocket({ reconnectDelay: 1000 }));
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => FakeWebSocket.instances[0]!.simulateOpen());

    // Unmount triggers disconnect() in the effect cleanup.
    unmount();

    // A late close event from the torn-down socket must not reconnect.
    act(() => FakeWebSocket.instances[0]!.simulateClose());
    act(() => vi.advanceTimersByTime(60_000));

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
