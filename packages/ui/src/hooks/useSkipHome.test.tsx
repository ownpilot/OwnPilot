// @vitest-environment happy-dom

/**
 * useSkipHome tests.
 *
 * Covers: localStorage read/write, URL navigation on mount,
 * onNavigate callback, error handling, and one-shot navigation guard.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useSkipHome } from './useSkipHome';

const mockNavigate = vi.hoisted(() => vi.fn());
const mockSetSearchParams = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), mockSetSearchParams],
}));

function renderHook(pageName: string, defaultTab?: string, onNavigate?: (tab: string) => void) {
  const resultRef: {
    current: ReturnType<typeof useSkipHome> | null;
  } = { current: null };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  function TestComponent() {
    const result = useSkipHome({ pageName, defaultTab, onNavigate });
    resultRef.current = result;
    return null;
  }

  act(() => root.render(createElement(TestComponent)));

  return {
    resultRef,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  mockNavigate.mockReset();
  mockSetSearchParams.mockReset();
});

describe('useSkipHome', () => {
  it('returns skipHome=false when localStorage is empty', () => {
    const t = renderHook('test');
    expect(t.resultRef.current!.skipHome).toBe(false);
    t.cleanup();
  });

  it('reads skipHome=true from localStorage', () => {
    localStorage.setItem('ownpilot:test:skipHome', 'true');
    const t = renderHook('test');
    expect(t.resultRef.current!.skipHome).toBe(true);
    t.cleanup();
  });

  it('reads skipHome=false from localStorage', () => {
    localStorage.setItem('ownpilot:test:skipHome', 'false');
    const t = renderHook('test');
    expect(t.resultRef.current!.skipHome).toBe(false);
    t.cleanup();
  });

  it('writes to localStorage on onSkipHomeChange', () => {
    const t = renderHook('test');
    act(() => t.resultRef.current!.onSkipHomeChange(true));
    expect(localStorage.getItem('ownpilot:test:skipHome')).toBe('true');

    act(() => t.resultRef.current!.onSkipHomeChange(false));
    expect(localStorage.getItem('ownpilot:test:skipHome')).toBe('false');
    t.cleanup();
  });

  it('updates skipHome state on onSkipHomeChange', () => {
    const t = renderHook('test');
    expect(t.resultRef.current!.skipHome).toBe(false);

    act(() => t.resultRef.current!.onSkipHomeChange(true));
    expect(t.resultRef.current!.skipHome).toBe(true);
    t.cleanup();
  });

  it('navigates to defaultTab on mount when skipHome is true (URL-based)', () => {
    localStorage.setItem('ownpilot:test:skipHome', 'true');
    renderHook('test', 'overview');
    expect(mockNavigate).toHaveBeenCalledWith({ search: 'tab=overview' }, { replace: true });
  });

  it('does not navigate when skipHome is false', () => {
    renderHook('test', 'overview');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('calls onNavigate instead of navigate when provided', () => {
    const onNavigate = vi.fn();
    localStorage.setItem('ownpilot:test:skipHome', 'true');
    renderHook('test', 'agents', onNavigate);
    expect(onNavigate).toHaveBeenCalledWith('agents');
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does nothing when skipHome is true but defaultTab is undefined', () => {
    localStorage.setItem('ownpilot:test:skipHome', 'true');
    renderHook('test');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('only navigates once (didSkipHomeRef guard)', () => {
    localStorage.setItem('ownpilot:test:skipHome', 'true');
    const t = renderHook('test', 'overview');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    t.cleanup();
  });

  it('handles localStorage getItem error gracefully', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const t = renderHook('test');
    expect(t.resultRef.current!.skipHome).toBe(false);
    t.cleanup();
  });

  it('handles localStorage setItem error gracefully', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });
    const t = renderHook('test');
    expect(() => {
      act(() => t.resultRef.current!.onSkipHomeChange(true));
    }).not.toThrow();
    expect(t.resultRef.current!.skipHome).toBe(true);
    t.cleanup();
  });
});
