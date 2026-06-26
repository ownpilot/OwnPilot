// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { STORAGE_KEYS } from '../constants/storage-keys';
import {
  DEFAULT_LAYOUT_CONFIG,
  LAYOUT_CONFIG_VERSION,
  type LayoutConfig,
} from '../types/layout-config';
import { LayoutConfigProvider, useLayoutConfig } from './useLayoutConfig';

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
    ? createElement(options.wrapper, { children: createElement(TestComponent) })
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
  };
}

const wrapper: React.FC<{ children: ReactNode }> = ({ children }) =>
  createElement(LayoutConfigProvider, null, children);

describe('useLayoutConfig', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates partial v10 storage config into a complete current config', () => {
    localStorage.setItem(
      STORAGE_KEYS.LAYOUT_CONFIG,
      JSON.stringify({
        version: 10,
        sidebar: {
          width: 'wide',
          sections: [{ id: '/dashboard', order: 0 }],
        },
      })
    );

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config.version).toBe(LAYOUT_CONFIG_VERSION);
    expect(result.current.config.header).toEqual(DEFAULT_LAYOUT_CONFIG.header);
    expect(result.current.config.customGroups).toEqual([]);
    expect(result.current.config.sidebar.width).toBe('wide');
    expect(result.current.config.sidebar.sections.map((section) => section.id)).toEqual([
      '/dashboard',
      '/agentic',
      'agentic-executions',
    ]);

    const persisted = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.LAYOUT_CONFIG) ?? '{}'
    ) as LayoutConfig;
    expect(persisted.version).toBe(LAYOUT_CONFIG_VERSION);
    expect(persisted.header).toEqual(DEFAULT_LAYOUT_CONFIG.header);

    unmount();
  });

  it('falls back to defaults for malformed storage JSON', () => {
    localStorage.setItem(STORAGE_KEYS.LAYOUT_CONFIG, '{not-json');

    const { result, unmount } = renderHook(() => useLayoutConfig(), { wrapper });

    expect(result.current.config).toEqual(DEFAULT_LAYOUT_CONFIG);

    unmount();
  });
});
