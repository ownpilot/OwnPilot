// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { useGroupCollapseState } from './useGroupCollapseState';

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
  localStorage.clear();
  document.body.replaceChildren();
});

describe('useGroupCollapseState', () => {
  it('defaults unknown groups to open', () => {
    const { result } = renderHook(() => useGroupCollapseState());

    expect(result.current.isOpen('agents')).toBe(true);
  });

  it('hydrates persisted collapse state from localStorage', () => {
    localStorage.setItem(STORAGE_KEYS.GROUP_COLLAPSE, JSON.stringify({ agents: false }));

    const { result } = renderHook(() => useGroupCollapseState());

    expect(result.current.isOpen('agents')).toBe(false);
    expect(result.current.isOpen('tools')).toBe(true);
  });

  it('ignores malformed or non-object persisted state', () => {
    localStorage.setItem(STORAGE_KEYS.GROUP_COLLAPSE, '[');
    let rendered = renderHook(() => useGroupCollapseState());
    expect(rendered.result.current.isOpen('agents')).toBe(true);
    rendered.unmount();

    localStorage.setItem(STORAGE_KEYS.GROUP_COLLAPSE, JSON.stringify(['agents']));
    rendered = renderHook(() => useGroupCollapseState());
    expect(rendered.result.current.isOpen('agents')).toBe(true);
  });

  it('toggles a group and persists the next state', () => {
    const { result } = renderHook(() => useGroupCollapseState());

    act(() => {
      result.current.toggle('agents');
    });

    expect(result.current.isOpen('agents')).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.GROUP_COLLAPSE) ?? '{}')).toEqual({
      agents: false,
    });

    act(() => {
      result.current.toggle('agents');
    });

    expect(result.current.isOpen('agents')).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.GROUP_COLLAPSE) ?? '{}')).toEqual({
      agents: true,
    });
  });

  it('still updates React state when localStorage persistence fails', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const { result } = renderHook(() => useGroupCollapseState());

    act(() => {
      result.current.toggle('agents');
    });

    expect(setItem).toHaveBeenCalled();
    expect(result.current.isOpen('agents')).toBe(false);
  });
});
