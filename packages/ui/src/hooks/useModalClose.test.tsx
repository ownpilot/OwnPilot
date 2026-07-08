// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type MouseEvent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useModalClose } from './useModalClose';

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

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('useModalClose', () => {
  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    renderHook(() => useModalClose(onClose));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores non-Escape key presses', () => {
    const onClose = vi.fn();
    renderHook(() => useModalClose(onClose));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes the keydown listener on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useModalClose(onClose));

    unmount();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the backdrop itself is clicked', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useModalClose(onClose));
    const backdrop = document.createElement('div');

    result.current.onBackdropClick({
      target: backdrop,
      currentTarget: backdrop,
    } as unknown as MouseEvent);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks from children inside the backdrop', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useModalClose(onClose));
    const backdrop = document.createElement('div');
    const child = document.createElement('button');
    backdrop.appendChild(child);

    result.current.onBackdropClick({
      target: child,
      currentTarget: backdrop,
    } as unknown as MouseEvent);

    expect(onClose).not.toHaveBeenCalled();
  });
});
