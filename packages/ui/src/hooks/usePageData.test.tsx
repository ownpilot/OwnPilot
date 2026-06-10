// @vitest-environment happy-dom
/**
 * usePageData tests — loading/error lifecycle, stale-response protection,
 * refetch (loud + silent), enabled gating, and setData patching.
 *
 * Uses the same minimal renderHook on react-dom/client as useWebSocket.test.tsx
 * (no @testing-library/react dependency).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { usePageData, type UsePageDataOptions } from './usePageData';
import { usePagination } from './usePagination';
import type { DependencyList } from 'react';

// ---- Minimal renderHook ----

function renderHook<P, T>(useHook: (props: P) => T, initialProps: P) {
  const result = { current: null as unknown as T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  let currentProps = initialProps;

  function TestComponent({ hookProps }: { hookProps: P }) {
    result.current = useHook(hookProps);
    return null as unknown as ReactNode;
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(TestComponent, { hookProps: currentProps }));
  });

  return {
    result,
    rerender: (props?: P) => {
      if (props !== undefined) currentProps = props;
      act(() => {
        root.render(createElement(TestComponent, { hookProps: currentProps }));
      });
    },
    unmount: () =>
      act(() => {
        root.unmount();
        if (container.parentNode) container.parentNode.removeChild(container);
      }),
  };
}

/** Deferred promise helper so tests control exactly when a fetch settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => act(async () => {});

afterEach(() => {
  document.body.replaceChildren();
});

// ---- usePageData ----

describe('usePageData', () => {
  it('starts loading, then exposes data', async () => {
    const d = deferred<string>();
    const { result } = renderHook(() => usePageData(() => d.promise), undefined);

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    d.resolve('hello');
    await flush();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBe('hello');
  });

  it('exposes the thrown error message', async () => {
    const { result } = renderHook(
      () => usePageData<string>(() => Promise.reject(new Error('boom'))),
      undefined
    );
    await flush();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('boom');
    expect(result.current.data).toBeNull();
  });

  it('prefers the fixed errorMessage option over the thrown message', async () => {
    const { result } = renderHook(
      () =>
        usePageData<string>(() => Promise.reject(new Error('raw failure')), [], {
          errorMessage: 'Failed to fetch cost data',
        }),
      undefined
    );
    await flush();

    expect(result.current.error).toBe('Failed to fetch cost data');
  });

  it('refetches when a dependency changes and ignores the stale response', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let call = 0;
    const fetcher = vi.fn(() => (++call === 1 ? first.promise : second.promise));

    const { result, rerender } = renderHook(
      ({ dep }: { dep: number }) => usePageData(fetcher, [dep] as DependencyList),
      { dep: 1 }
    );
    expect(fetcher).toHaveBeenCalledTimes(1);

    rerender({ dep: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Second request resolves first; first (stale) resolves after — its
    // result must NOT overwrite the newer one.
    second.resolve('new');
    await flush();
    first.resolve('old');
    await flush();

    expect(result.current.data).toBe('new');
    expect(result.current.isLoading).toBe(false);
  });

  it('refetch() reloads; silent refetch skips the loading flip', async () => {
    let value = 'a';
    const fetcher = vi.fn(async () => value);
    const { result } = renderHook(() => usePageData(fetcher), undefined);
    await flush();
    expect(result.current.data).toBe('a');

    value = 'b';
    await act(async () => {
      await result.current.refetch({ silent: true });
    });
    expect(result.current.data).toBe('b');

    // Loud refetch flips isLoading while in flight.
    const d = deferred<string>();
    fetcher.mockReturnValueOnce(d.promise);
    act(() => {
      void result.current.refetch();
    });
    expect(result.current.isLoading).toBe(true);
    d.resolve('c');
    await flush();
    expect(result.current.data).toBe('c');
    expect(result.current.isLoading).toBe(false);
  });

  it('does not fetch when enabled is false', async () => {
    const fetcher = vi.fn(async () => 'x');
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePageData(fetcher, [], { enabled } as UsePageDataOptions),
      { enabled: false }
    );
    await flush();

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);

    rerender({ enabled: true });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe('x');
  });

  it('ignores responses that land after unmount', async () => {
    const d = deferred<string>();
    const { result, unmount } = renderHook(() => usePageData(() => d.promise), undefined);
    unmount();
    d.resolve('late');
    await act(async () => {});
    // No state update after unmount — data stays null on the captured result.
    expect(result.current.data).toBeNull();
  });

  it('setData patches the cache imperatively', async () => {
    const { result } = renderHook(() => usePageData(async () => ({ count: 1 })), undefined);
    await flush();
    expect(result.current.data).toEqual({ count: 1 });

    act(() => {
      result.current.setData((prev) => (prev ? { count: prev.count + 1 } : prev));
    });
    expect(result.current.data).toEqual({ count: 2 });
  });
});

// ---- usePagination ----

describe('usePagination', () => {
  it('computes offset and params from page/pageSize', () => {
    const { result } = renderHook(() => usePagination(25), undefined);

    expect(result.current.page).toBe(0);
    expect(result.current.pageSize).toBe(25);
    expect(result.current.offset).toBe(0);
    expect(result.current.params).toEqual({ limit: 25, offset: 0 });

    act(() => result.current.setPage(3));
    expect(result.current.offset).toBe(75);
    expect(result.current.params).toEqual({ limit: 25, offset: 75 });
  });

  it('resetPage jumps back to the first page', () => {
    const { result } = renderHook(() => usePagination(), undefined);

    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);

    act(() => result.current.resetPage());
    expect(result.current.page).toBe(0);
    expect(result.current.offset).toBe(0);
  });

  it('defaults to a page size of 50', () => {
    const { result } = renderHook(() => usePagination(), undefined);
    expect(result.current.params).toEqual({ limit: 50, offset: 0 });
  });
});
