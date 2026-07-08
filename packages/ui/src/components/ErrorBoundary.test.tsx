// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('./icons', () => ({
  AlertTriangle: ({ className }: { className?: string }) =>
    createElement('svg', { 'data-testid': 'alert-triangle-icon', className }),
  RefreshCw: ({ className }: { className?: string }) =>
    createElement('svg', { 'data-testid': 'refresh-icon', className }),
  Home: ({ className }: { className?: string }) =>
    createElement('svg', { 'data-testid': 'home-icon', className }),
}));

// Throw-y child to trigger error boundary
function ExplodingChild({ shouldThrow = false }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test crash!');
  }
  return createElement('div', { 'data-testid': 'child' }, 'All good');
}

let root: Root | null = null;

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children normally when no error occurs', () => {
    const container = render(
      createElement(ErrorBoundary, null, createElement('div', { 'data-testid': 'child' }, 'Hello'))
    );
    expect(container.querySelector('[data-testid="child"]')?.textContent).toBe('Hello');
    expect(container.textContent).not.toContain('Something went wrong');
  });

  it('catches errors and shows default fallback UI', () => {
    // Suppress console.error from React's error logging
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const container = render(
      createElement(ErrorBoundary, null, createElement(ExplodingChild, { shouldThrow: true }))
    );

    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).toContain('An unexpected error occurred');

    consoleSpy.mockRestore();
  });

  it('shows the error message in the fallback', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function ChildWithMessage(): React.ReactNode {
      throw new Error('Something broke!');
    }

    const container = render(createElement(ErrorBoundary, null, createElement(ChildWithMessage)));

    expect(container.textContent).toContain('Something broke!');

    consoleSpy.mockRestore();
  });

  it('shows stack trace details when errorInfo is present', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function ThrowChild(): React.ReactNode {
      throw new Error('Stack test');
    }

    const container = render(createElement(ErrorBoundary, null, createElement(ThrowChild)));

    // Click the "Stack trace" summary to reveal the details
    const summary = container.querySelector('summary');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toBe('Stack trace');

    consoleSpy.mockRestore();
  });

  it('renders custom fallback when fallback prop is provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const customFallback = createElement(
      'div',
      { 'data-testid': 'custom-fallback' },
      'Custom error UI'
    );

    const container = render(
      createElement(ErrorBoundary, {
        fallback: customFallback,
        children: createElement(ExplodingChild, { shouldThrow: true }),
      })
    );

    expect(container.querySelector('[data-testid="custom-fallback"]')).not.toBeNull();
    expect(container.textContent).toContain('Custom error UI');
    // Should NOT show the default fallback
    expect(container.textContent).not.toContain('Something went wrong');

    consoleSpy.mockRestore();
  });

  it('calls window.location.reload when Reload Page button is clicked', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reloadFn = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadFn },
      writable: true,
      configurable: true,
    });

    const container = render(
      createElement(ErrorBoundary, null, createElement(ExplodingChild, { shouldThrow: true }))
    );

    // Find the Reload Page button
    const buttons = container.querySelectorAll('button');
    const reloadButton = Array.from(buttons).find((b) => b.textContent?.includes('Reload'));
    expect(reloadButton).not.toBeNull();

    act(() => {
      reloadButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(reloadFn).toHaveBeenCalledOnce();

    consoleSpy.mockRestore();
  });

  it('sets window.location.href when Go Home button is clicked', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let hrefValue = '/current';
    const locationDescriptor = {
      get href() {
        return hrefValue;
      },
      set href(v: string) {
        hrefValue = v;
      },
      reload: vi.fn(),
    };
    Object.defineProperty(window, 'location', {
      value: locationDescriptor,
      writable: true,
      configurable: true,
    });

    const container = render(
      createElement(ErrorBoundary, null, createElement(ExplodingChild, { shouldThrow: true }))
    );

    const buttons = container.querySelectorAll('button');
    const goHomeBtn = Array.from(buttons).find((b) => b.textContent?.includes('Go Home'));
    expect(goHomeBtn).not.toBeNull();

    act(() => {
      goHomeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(hrefValue).toBe('/');

    consoleSpy.mockRestore();
  });

  it('console.error is called with the caught error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      createElement(ErrorBoundary, null, createElement(ExplodingChild, { shouldThrow: true }))
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      'ErrorBoundary caught an error:',
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) })
    );

    consoleSpy.mockRestore();
  });

  it('handleReset clears the error state allowing children to recover', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // State-based child that stops throwing after reset
    let hasBeenReset = false;

    function ResettableChild() {
      if (!hasBeenReset) {
        throw new Error('Initial crash');
      }
      return createElement('div', { 'data-testid': 'recovered' }, 'Recovered!');
    }

    const errorBoundaryRef = { current: null as ErrorBoundary | null };

    const container = render(
      createElement(
        ErrorBoundary,
        {
          ref: (el: ErrorBoundary | null) => {
            errorBoundaryRef.current = el;
          },
        } as React.ComponentProps<typeof ErrorBoundary> & {
          ref: (el: ErrorBoundary | null) => void;
        },
        createElement(ResettableChild)
      )
    );

    // After throw, should show error UI
    expect(container.textContent).toContain('Something went wrong');

    // Signal that next render should succeed, then reset the error boundary
    hasBeenReset = true;
    act(() => {
      errorBoundaryRef.current?.handleReset();
    });

    // After reset, the child renders successfully (no error)
    const recovered = container.querySelector('[data-testid="recovered"]');
    expect(recovered).not.toBeNull();
    expect(recovered?.textContent).toBe('Recovered!');
    // Error UI should be gone
    expect(container.textContent).not.toContain('Something went wrong');

    consoleSpy.mockRestore();
  });
});
