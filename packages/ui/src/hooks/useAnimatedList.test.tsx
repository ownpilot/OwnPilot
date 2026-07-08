// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAnimatedList } from './useAnimatedList';

interface Item {
  id: string;
  label: string;
}

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

describe('useAnimatedList', () => {
  it('does not animate initial items by default', () => {
    const { result } = renderHook(({ items }) => useAnimatedList(items), {
      items: [{ id: 'a', label: 'A' }],
    });

    expect(result.current.animatedItems).toEqual([
      { item: { id: 'a', label: 'A' }, animClass: '' },
    ]);
  });

  it('can animate initial items when requested', () => {
    const { result } = renderHook(({ items }) => useAnimatedList(items, { animateInitial: true }), {
      items: [{ id: 'a', label: 'A' }],
    });

    expect(result.current.animatedItems[0]?.animClass).toBe('animate-list-in');
  });

  it('marks newly added items with the entry animation class', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: Item[] }) => useAnimatedList(items),
      {
        items: [{ id: 'a', label: 'A' }],
      }
    );

    rerender({
      items: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });

    expect(result.current.animatedItems.map(({ item, animClass }) => [item.id, animClass])).toEqual(
      [
        ['a', ''],
        ['b', 'animate-list-in'],
      ]
    );
  });

  it('marks deleting items as exiting, waits, then invokes deleteFn', async () => {
    vi.useFakeTimers();
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(({ items }: { items: Item[] }) => useAnimatedList(items), {
      items: [{ id: 'a', label: 'A' }],
    });

    let deletion!: Promise<void>;
    act(() => {
      deletion = result.current.handleDelete('a', deleteFn);
    });

    expect(result.current.animatedItems[0]?.animClass).toBe('animate-list-out');
    expect(deleteFn).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(280);
      await deletion;
    });

    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(result.current.animatedItems[0]?.animClass).toBe('');
  });
});
