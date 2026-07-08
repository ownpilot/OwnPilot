// @vitest-environment happy-dom
/**
 * ConfirmDialog tests — context-based dialog system.
 *
 * Tests: DialogProvider renders children, useDialog throws without provider,
 * confirm/alert open and resolve/cancel, Escape/Enter key handlers,
 * variant classes (danger/default), backdrop click closes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DialogProvider, useDialog } from './ConfirmDialog';

// ---- Helpers ----

function render(ui: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(ui);
  });
  return container;
}

/** Minimal renderHook that wraps the hook inside DialogProvider */
function renderHookWithProvider<T>(useHook: () => T) {
  const result = { current: null as unknown as T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  function TestComponent() {
    result.current = useHook();
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(DialogProvider, null, createElement(TestComponent)));
  });

  return {
    result,
    unmount: () =>
      act(() => {
        root.unmount();
        if (container.parentNode) container.parentNode.removeChild(container);
      }),
    rerender: () =>
      act(() => {
        root.render(createElement(DialogProvider, null, createElement(TestComponent)));
      }),
  };
}

function flush() {
  return act(async () => {});
}

afterEach(() => {
  document.body.replaceChildren();
});

// ---- Tests ----

describe('DialogProvider', () => {
  it('renders children', () => {
    const container = render(
      createElement(DialogProvider, null, createElement('div', { 'data-testid': 'child' }, 'Hello'))
    );
    expect(container.querySelector('[data-testid="child"]')?.textContent).toBe('Hello');
  });

  it('provides confirm and alert via useDialog', () => {
    const { result } = renderHookWithProvider(() => useDialog());
    expect(result.current).toHaveProperty('confirm');
    expect(result.current).toHaveProperty('alert');
    expect(typeof result.current.confirm).toBe('function');
    expect(typeof result.current.alert).toBe('function');
  });
});

describe('useDialog', () => {
  it('throws without DialogProvider', () => {
    // renderHook without provider — expect an error
    const container = document.createElement('div');
    document.body.appendChild(container);

    expect(() => {
      function BadComponent() {
        useDialog();
        return null;
      }
      act(() => {
        createRoot(container).render(createElement(BadComponent));
      });
    }).toThrow('useDialog must be used within <DialogProvider>');

    document.body.removeChild(container);
  });
});

describe('confirm()', () => {
  it('opens a confirm dialog with the given message', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    result.current.confirm('Delete this?');

    await flush();

    // Dialog should be visible
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Delete this?');
    // Default title for confirm
    expect(dialog?.textContent).toContain('Confirm');
    // Has Cancel and Confirm buttons
    const buttons = dialog?.querySelectorAll('button');
    expect(buttons).toHaveLength(2);

    unmount();
  });

  it('resolves true when confirm button is clicked', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    const promise = result.current.confirm('Proceed?');

    await flush();

    const confirmBtn = document.querySelector('[role="dialog"] button:last-child');
    expect(confirmBtn).not.toBeNull();
    expect(confirmBtn?.textContent).toBe('Confirm');

    act(() => {
      (confirmBtn as HTMLButtonElement).click();
    });

    const resolved = await promise;
    expect(resolved).toBe(true);

    // Dialog should be closed
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    unmount();
  });

  it('resolves false when cancel button is clicked', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    const promise = result.current.confirm('Proceed?');

    await flush();

    const cancelBtn = document.querySelector('[role="dialog"] button:first-child');
    expect(cancelBtn).not.toBeNull();
    expect(cancelBtn?.textContent).toBe('Cancel');

    act(() => {
      (cancelBtn as HTMLButtonElement).click();
    });

    const resolved = await promise;
    expect(resolved).toBe(false);

    unmount();
  });

  it('supports custom confirm text', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    result.current.confirm({ message: 'Sure?', confirmText: 'Yes, do it' });

    await flush();

    const confirmBtn = document.querySelector('[role="dialog"] button:last-child');
    expect(confirmBtn?.textContent).toBe('Yes, do it');

    unmount();
  });
});

describe('alert()', () => {
  it('opens an alert dialog with the given message', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    result.current.alert('Item saved');

    await flush();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Item saved');
    // Alert title defaults to 'Notice'
    expect(dialog?.textContent).toContain('Notice');
    // Alert has only one button (OK)
    const buttons = dialog?.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons?.[0]?.textContent).toBe('OK');

    unmount();
  });

  it('resolves when OK is clicked', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    let resolved = false;
    result.current.alert('Done').then(() => {
      resolved = true;
    });

    await flush();

    const okBtn = document.querySelector('[role="dialog"] button');
    act(() => {
      (okBtn as HTMLButtonElement).click();
    });

    await flush();
    expect(resolved).toBe(true);

    unmount();
  });
});

describe('keyboard handlers', () => {
  it('closes with false on Escape key', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    const promise = result.current.confirm('Cancel me?');

    await flush();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const resolved = await promise;
    expect(resolved).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    unmount();
  });

  it('closes with true on Enter key (confirm)', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    const promise = result.current.confirm('Accept?');

    await flush();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });

    const resolved = await promise;
    expect(resolved).toBe(true);

    unmount();
  });

  it('closes with true on Enter key (alert)', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    let resolved = false;
    result.current.alert('Okay').then(() => {
      resolved = true;
    });

    await flush();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });

    await flush();
    expect(resolved).toBe(true);

    unmount();
  });

  it('removes event listeners on unmount', () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    result.current.confirm('test');

    unmount();

    // Dispatching after unmount should not throw
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
});

describe('variant classes', () => {
  it('renders default variant with Confirm title and Confirm button text', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    result.current.confirm('Default variant');

    await flush();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Confirm');
    const btn = dialog?.querySelector('button:last-child');
    expect(btn?.textContent).toBe('Confirm');

    unmount();
  });

  it('renders danger variant with Delete button text', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    result.current.confirm({ message: 'Danger!', variant: 'danger' });

    await flush();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Confirm');
    const btn = dialog?.querySelector('button:last-child');
    expect(btn?.textContent).toBe('Delete');

    unmount();
  });

  it('renders custom title when provided', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    result.current.confirm({ message: 'Custom', title: 'My Title' });

    await flush();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('My Title');

    unmount();
  });
});

describe('backdrop click', () => {
  it('closes dialog when backdrop is clicked', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    const promise = result.current.confirm('Click backdrop');

    await flush();

    // The backdrop is the outermost div in the overlay
    const backdrop = document.querySelector('[role="dialog"]');
    expect(backdrop).not.toBeNull();

    // Click the backdrop itself (not a child)
    act(() => {
      backdrop!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const resolved = await promise;
    expect(resolved).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    unmount();
  });

  it('does not close when clicking inside the dialog panel', async () => {
    const { result, unmount } = renderHookWithProvider(() => useDialog());

    result.current.confirm('Inside click');

    await flush();

    // Find the inner panel (max-w-md div inside the dialog)
    const panel = document.querySelector('.max-w-md');
    expect(panel).not.toBeNull();

    // Click inside the panel — should NOT close
    act(() => {
      panel!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Dialog should still be open
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    unmount();
  });
});
