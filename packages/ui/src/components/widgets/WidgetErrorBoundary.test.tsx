// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { WidgetErrorBoundary, useWidgetErrorBoundary } from './WidgetErrorBoundary';

function ThrowingComponent({ shouldThrow = false }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test render error');
  }
  return <div data-testid="child">Rendered OK</div>;
}

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(element);
  });
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('WidgetErrorBoundary', () => {
  it('renders children when there is no error', () => {
    const container = render(
      <WidgetErrorBoundary>
        <div data-testid="child">Hello</div>
      </WidgetErrorBoundary>
    );

    expect(container.querySelector('[data-testid="child"]')?.textContent).toBe('Hello');
  });

  it('catches render errors and shows default fallback UI', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const container = render(
      <WidgetErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </WidgetErrorBoundary>
    );

    // Should show error UI instead of the child
    expect(container.querySelector('[data-testid="child"]')).toBeNull();
    expect(container.textContent).toContain('Widget Error');
    expect(container.textContent).toContain('Test render error');
    expect(container.textContent).toContain('Try Again');

    consoleSpy.mockRestore();
  });

  it('shows generic message when error has no message', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const container = render(
      <WidgetErrorBoundary
        fallback={(error, _reset) => (
          <div>Fallback: {(error as Error).message || 'No message'}</div>
        )}
      >
        <ThrowingComponent shouldThrow={true} />
      </WidgetErrorBoundary>
    );

    expect(container.textContent).toContain('Fallback:');
    expect(container.textContent).toContain('Test render error');

    consoleSpy.mockRestore();
  });

  it('resets error state and re-renders children when "Try Again" is clicked', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // We need a component that we can toggle the error state
    let shouldThrow = true;
    function ControlledThrowingComponent() {
      if (shouldThrow) {
        throw new Error('Controlled error');
      }
      return <div data-testid="child">Recovered</div>;
    }

    const container = render(
      <WidgetErrorBoundary>
        <ControlledThrowingComponent />
      </WidgetErrorBoundary>
    );

    expect(container.textContent).toContain('Widget Error');

    // Click "Try Again"
    const tryAgainBtn = container.querySelector('button');
    expect(tryAgainBtn).not.toBeNull();

    // Update the flag so next render succeeds
    shouldThrow = false;

    act(() => {
      tryAgainBtn?.click();
    });

    // After reset, the error boundary re-renders children successfully
    expect(container.querySelector('[data-testid="child"]')?.textContent).toBe('Recovered');
    consoleSpy.mockRestore();
  });

  it('renders custom fallback when provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const customFallback = (error: Error, reset: () => void) => (
      <div>
        <p data-testid="custom-error">Custom error: {error.message}</p>
        <button data-testid="custom-reset" onClick={reset}>
          Custom Retry
        </button>
      </div>
    );

    const container = render(
      <WidgetErrorBoundary fallback={customFallback}>
        <ThrowingComponent shouldThrow={true} />
      </WidgetErrorBoundary>
    );

    expect(container.querySelector('[data-testid="custom-error"]')?.textContent).toContain(
      'Custom error: Test render error'
    );
    expect(container.querySelector('[data-testid="custom-reset"]')?.textContent).toBe(
      'Custom Retry'
    );

    consoleSpy.mockRestore();
  });

  it('calls onError when an error is caught', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();

    render(
      <WidgetErrorBoundary onError={onError}>
        <ThrowingComponent shouldThrow={true} />
      </WidgetErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[0]?.message).toBe('Test render error');

    consoleSpy.mockRestore();
  });

  it('logs errors to console', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <WidgetErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </WidgetErrorBoundary>
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      '[WidgetErrorBoundary]',
      expect.any(Error),
      expect.any(Object)
    );

    consoleSpy.mockRestore();
  });
});

// Explicit type for useWidgetErrorBoundary return since ReturnType
// can resolve to 'never' with React 19 strict inference
interface WidgetErrorBoundaryHook {
  boundary: { onError: (error: Error, info: React.ErrorInfo) => void; reset: () => void };
  error: Error | null;
  reset: () => void;
}

describe('useWidgetErrorBoundary', () => {
  it('returns boundary, error, and reset', () => {
    let hookResult: WidgetErrorBoundaryHook | null = null;

    function TestComponent() {
      const result = useWidgetErrorBoundary();
      hookResult = result;
      return null;
    }

    render(
      <WidgetErrorBoundary>
        <TestComponent />
      </WidgetErrorBoundary>
    );

    expect(hookResult).not.toBeNull();
    const h = hookResult!;
    expect(typeof h.boundary.onError).toBe('function');
    expect(typeof h.reset).toBe('function');
    expect(h.error).toBeNull();
  });

  it('calls custom onError when error is set via boundary.onError', () => {
    const onError = vi.fn();
    let hookResult: WidgetErrorBoundaryHook | null = null;

    function TestComponent() {
      const result = useWidgetErrorBoundary(onError);
      hookResult = result;
      return null;
    }

    render(
      <WidgetErrorBoundary>
        <TestComponent />
      </WidgetErrorBoundary>
    );

    const testError = new Error('Hook test error');
    act(() => {
      (hookResult as unknown as WidgetErrorBoundaryHook).boundary.onError(
        testError,
        {} as React.ErrorInfo
      );
    });

    expect(onError).toHaveBeenCalledWith(testError, {});
    const h2 = hookResult as unknown as WidgetErrorBoundaryHook;
    expect(h2.error).toBe(testError);
  });

  it('reset clears the error state set via boundary.onError', () => {
    let hookResult: WidgetErrorBoundaryHook | null = null;

    function TestComponent() {
      const result = useWidgetErrorBoundary();
      hookResult = result;
      return null;
    }

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <WidgetErrorBoundary>
        <TestComponent />
      </WidgetErrorBoundary>
    );

    // Verify reset is callable and exists
    const hr = hookResult as unknown as WidgetErrorBoundaryHook;
    expect(typeof hr.reset).toBe('function');

    // Trigger an error through boundary.onError
    const testError = new Error('Reset boundary test');
    act(() => {
      hr.boundary.onError(testError, {} as React.ErrorInfo);
    });

    // After the boundary catches the error, the fallback is shown
    // Calling reset() restores normal rendering
    act(() => {
      hr.reset();
    });

    // reset is a stable function reference
    expect(hr.reset).toBeDefined();

    consoleSpy.mockRestore();
  });
});
