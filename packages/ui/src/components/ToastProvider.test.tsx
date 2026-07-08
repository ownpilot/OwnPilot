// @vitest-environment happy-dom

import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './ToastProvider';

// Mock icons
vi.mock('./icons', () => ({
  Check: () => <span data-testid="icon-check">Check</span>,
  X: () => <span data-testid="icon-x">X</span>,
  AlertCircle: () => <span data-testid="icon-alert-circle">AlertCircle</span>,
  AlertTriangle: () => <span data-testid="icon-alert-triangle">AlertTriangle</span>,
  Info: () => <span data-testid="icon-info">Info</span>,
}));

let root: Root | null = null;

// Test component with buttons to trigger each toast type
function ToastTester() {
  const toast = useToast();
  return (
    <div>
      <button data-testid="btn-success" onClick={() => toast.success('Saved!')}>
        Success
      </button>
      <button data-testid="btn-error" onClick={() => toast.error('Failed!', 'Error')}>
        Error
      </button>
      <button data-testid="btn-warning" onClick={() => toast.warning('Caution')}>
        Warning
      </button>
      <button data-testid="btn-info" onClick={() => toast.info('Heads up', 'Info')}>
        Info
      </button>
    </div>
  );
}

function ToastHistoryTester() {
  const toast = useToast();
  const { history, unreadCount, markAsRead, markAllAsRead, clearHistory, removeFromHistory } =
    toast;
  return (
    <div>
      <button data-testid="btn-success" onClick={() => toast.success('Saved!')}>
        Success
      </button>
      <button data-testid="btn-error" onClick={() => toast.error('Failed!', 'Error')}>
        Error
      </button>
      <span data-testid="unread-count">{unreadCount}</span>
      <ul data-testid="history-list">
        {history.map((item) => (
          <li key={item.id} data-testid={`history-${item.id}`}>
            {item.message} - {item.read ? 'read' : 'unread'}
          </li>
        ))}
      </ul>
      <button data-testid="mark-read" onClick={() => history[0] && markAsRead(history[0].id)}>
        Mark Read
      </button>
      <button data-testid="mark-all-read" onClick={markAllAsRead}>
        Mark All Read
      </button>
      <button data-testid="clear-history" onClick={clearHistory}>
        Clear
      </button>
      <button
        data-testid="remove-item"
        onClick={() => history[0] && removeFromHistory(history[0].id)}
      >
        Remove Item
      </button>
    </div>
  );
}

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    flushSync(() => root?.render(element));
  });
  return container;
}

function clickButton(testId: string) {
  const btn = document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement;
  if (btn) {
    act(() => {
      btn.click();
    });
  }
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

beforeEach(() => {
  let counter = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `test-uuid-${++counter}` as `${string}-${string}-${string}-${string}-${string}`
  );
});

describe('ToastProvider', () => {
  it('renders children without any toasts initially', () => {
    const container = render(
      <ToastProvider>
        <div data-testid="child">Hello</div>
      </ToastProvider>
    );

    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
    expect(document.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it('renders a success toast when useToast().success is called', () => {
    render(
      <ToastProvider>
        <ToastTester />
      </ToastProvider>
    );

    clickButton('btn-success');

    const toasts = document.querySelectorAll('[role="alert"]');
    expect(toasts.length).toBe(1);
    expect(toasts[0]?.textContent).toContain('Saved!');
  });

  it('renders a toast with a title', () => {
    render(
      <ToastProvider>
        <ToastTester />
      </ToastProvider>
    );

    clickButton('btn-error');

    const toastEl = document.querySelector('[role="alert"]');
    expect(toastEl?.textContent).toContain('Failed!');
    expect(toastEl?.textContent).toContain('Error');
  });

  it('renders each toast type: success, error, warning, info', () => {
    render(
      <ToastProvider>
        <ToastTester />
      </ToastProvider>
    );

    clickButton('btn-success');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Saved!');

    act(() => {
      (document.querySelector('button[aria-label="Dismiss"]') as HTMLElement)?.click();
    });
    clickButton('btn-error');
    const alerts = document.querySelectorAll('[role="alert"]');
    const hasFailed = Array.from(alerts).some((el) => el.textContent?.includes('Failed!'));
    expect(hasFailed).toBe(true);

    act(() => {
      (document.querySelector('button[aria-label="Dismiss"]') as HTMLElement)?.click();
    });
    clickButton('btn-warning');
    const alerts2 = document.querySelectorAll('[role="alert"]');
    const hasWarning = Array.from(alerts2).some((el) => el.textContent?.includes('Caution'));
    expect(hasWarning).toBe(true);

    act(() => {
      (document.querySelector('button[aria-label="Dismiss"]') as HTMLElement)?.click();
    });
    clickButton('btn-info');
    const alerts3 = document.querySelectorAll('[role="alert"]');
    const hasInfo = Array.from(alerts3).some((el) => el.textContent?.includes('Heads up'));
    expect(hasInfo).toBe(true);
    const hasInfoTitle = Array.from(alerts3).some((el) => el.textContent?.includes('Info'));
    expect(hasInfoTitle).toBe(true);
  });

  it('dismisses a toast when the dismiss button is clicked', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastTester />
      </ToastProvider>
    );

    clickButton('btn-success');

    expect(document.querySelectorAll('[role="alert"]').length).toBe(1);

    const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();

    act(() => {
      dismissBtn.click();
    });

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(document.querySelectorAll('[role="alert"]').length).toBe(0);
  });

  it('auto-dismisses success toasts after default duration', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastTester />
      </ToastProvider>
    );

    clickButton('btn-success');
    expect(document.querySelectorAll('[role="alert"]').length).toBe(1);

    act(() => {
      vi.advanceTimersByTime(3400);
    });

    expect(document.querySelectorAll('[role="alert"]').length).toBe(0);
  });

  it('caps visible toasts at 5', () => {
    render(
      <ToastProvider>
        <ToastTester />
      </ToastProvider>
    );

    clickButton('btn-info');
    clickButton('btn-info');
    clickButton('btn-info');
    clickButton('btn-info');
    clickButton('btn-info');
    clickButton('btn-info');

    const toasts = document.querySelectorAll('[role="alert"]');
    expect(toasts.length).toBeLessThanOrEqual(5);
  });

  it('throws when useToast is used outside ToastProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function BadComponent() {
      useToast();
      return null;
    }

    expect(() => {
      render(<BadComponent />);
    }).toThrow('useToast must be used within <ToastProvider>');

    consoleSpy.mockRestore();
  });

  it('supports custom duration via addToast', () => {
    vi.useFakeTimers();

    function CustomToastTester() {
      const toast = useToast();
      return (
        <button
          data-testid="btn-custom"
          onClick={() => toast.addToast({ type: 'info', message: 'Custom', duration: 100 })}
        >
          Custom
        </button>
      );
    }

    render(
      <ToastProvider>
        <CustomToastTester />
      </ToastProvider>
    );

    clickButton('btn-custom');
    expect(document.querySelectorAll('[role="alert"]').length).toBe(1);

    act(() => {
      vi.advanceTimersByTime(450);
    });

    expect(document.querySelectorAll('[role="alert"]').length).toBe(0);
  });

  it('deduplicates toasts with the same message', () => {
    render(
      <ToastProvider>
        <ToastTester />
      </ToastProvider>
    );

    clickButton('btn-success');
    clickButton('btn-success');
    clickButton('btn-success');

    // Should only have 1 toast since they all say "Saved!"
    expect(document.querySelectorAll('[role="alert"]').length).toBe(1);
  });

  it('adds dismissed toasts to notification history', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHistoryTester />
      </ToastProvider>
    );

    clickButton('btn-success');
    expect(document.querySelectorAll('[role="alert"]').length).toBe(1);

    // Dismiss the toast
    act(() => {
      (document.querySelector('button[aria-label="Dismiss"]') as HTMLElement)?.click();
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    // Toast should now be in history (history count > 0)
    const historyList = document.querySelector('[data-testid="history-list"]');
    expect(historyList?.textContent).toContain('Saved!');
  });

  it('tracks unread count from notification history', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHistoryTester />
      </ToastProvider>
    );

    // Add two toasts and dismiss them
    clickButton('btn-success');
    act(() => {
      (document.querySelector('button[aria-label="Dismiss"]') as HTMLElement)?.click();
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    clickButton('btn-error');
    act(() => {
      (document.querySelector('button[aria-label="Dismiss"]') as HTMLElement)?.click();
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    // Both should be unread
    const unreadSpan = document.querySelector('[data-testid="unread-count"]');
    expect(unreadSpan?.textContent).toBe('2');
  });

  it('markAsRead marks a single history item as read', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHistoryTester />
      </ToastProvider>
    );

    clickButton('btn-success');
    act(() => {
      (document.querySelector('button[aria-label="Dismiss"]') as HTMLElement)?.click();
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    // Mark as read
    clickButton('mark-read');

    const unreadSpan = document.querySelector('[data-testid="unread-count"]');
    expect(unreadSpan?.textContent).toBe('0');
  });

  it('markAllAsRead marks all history items as read', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHistoryTester />
      </ToastProvider>
    );

    clickButton('btn-success');
    act(() => {
      (document.querySelector('button[aria-label="Dismiss"]') as HTMLElement)?.click();
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    clickButton('btn-error');
    act(() => {
      (document.querySelector('button[aria-label="Dismiss"]') as HTMLElement)?.click();
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    clickButton('mark-all-read');

    const unreadSpan = document.querySelector('[data-testid="unread-count"]');
    expect(unreadSpan?.textContent).toBe('0');
  });

  it('clearHistory removes all history items', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHistoryTester />
      </ToastProvider>
    );

    clickButton('btn-success');
    act(() => {
      (document.querySelector('button[aria-label="Dismiss"]') as HTMLElement)?.click();
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    clickButton('clear-history');

    const historyList = document.querySelector('[data-testid="history-list"]');
    expect(historyList?.childElementCount).toBe(0);
  });

  it('removeFromHistory removes a single history item', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHistoryTester />
      </ToastProvider>
    );

    clickButton('btn-success');
    act(() => {
      (document.querySelector('button[aria-label="Dismiss"]') as HTMLElement)?.click();
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    clickButton('remove-item');

    const historyList = document.querySelector('[data-testid="history-list"]');
    expect(historyList?.childElementCount).toBe(0);
  });

  it('handles localStorage errors gracefully on load', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage blocked');
    });

    expect(() => {
      render(
        <ToastProvider>
          <div>ok</div>
        </ToastProvider>
      );
    }).not.toThrow();
  });

  it('handles localStorage errors gracefully on save', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage full');
    });

    expect(() => {
      render(
        <ToastProvider>
          <div>ok</div>
        </ToastProvider>
      );
    }).not.toThrow();
  });

  it('prevents double-removal of same toast', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastTester />
      </ToastProvider>
    );

    clickButton('btn-success');

    const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement;

    // Click dismiss twice quickly
    act(() => {
      dismissBtn.click();
    });
    act(() => {
      dismissBtn.click();
    }); // Second click should be no-op

    // Should still complete removal once
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(document.querySelectorAll('[role="alert"]').length).toBe(0);
  });
});
