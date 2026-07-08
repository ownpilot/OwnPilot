// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useIsMobile } from './useMediaQuery';

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
        container.remove();
      }),
  };
}

function installMatchMediaMock(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const addEventListener = vi.fn(
    (_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }
  );
  const removeEventListener = vi.fn(
    (_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }
  );

  const matchMedia = vi.fn((query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener,
    removeEventListener,
  }));

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: matchMedia,
  });

  return {
    addEventListener,
    removeEventListener,
    matchMedia,
    emit(nextMatches: boolean) {
      matches = nextMatches;
      const event = { matches: nextMatches, media: '(min-width: 768px)' } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('useIsMobile', () => {
  it('returns false when the md breakpoint media query matches', () => {
    installMatchMediaMock(true);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it('returns true when the md breakpoint media query does not match', () => {
    installMatchMediaMock(false);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it('updates when matchMedia emits a change event', () => {
    const media = installMatchMediaMock(false);
    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);

    act(() => {
      media.emit(true);
    });

    expect(result.current).toBe(false);
  });

  it('removes the change listener on unmount', () => {
    const media = installMatchMediaMock(false);
    const { unmount } = renderHook(() => useIsMobile());

    unmount();

    expect(media.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
