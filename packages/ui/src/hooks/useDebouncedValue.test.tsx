// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDebouncedValue } from './useDebouncedValue';

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
    rerender: (props: P) => {
      currentProps = props;
      act(() => {
        root.render(createElement(TestComponent, { hookProps: currentProps }));
      });
    },
    unmount: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('useDebouncedValue', () => {
  it('returns the initial value immediately', () => {
    const { result } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      value: 'initial',
    });

    expect(result.current).toBe('initial');
  });

  it('updates only after the debounce delay', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      value: 'initial',
    });

    rerender({ value: 'next' });
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('next');
  });

  it('clears stale timers when value changes before the delay', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      value: 'one',
    });

    rerender({ value: 'two' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 'three' });
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe('one');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('three');
  });

  it('does not update after unmount', () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 100), {
      value: 'one',
    });

    rerender({ value: 'two' });
    unmount();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe('one');
  });
});
