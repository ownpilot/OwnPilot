// @vitest-environment happy-dom

/**
 * Render tests for the remaining config panels: NotificationConfigPanel,
 * StickyNoteConfigPanel, ApprovalConfigPanel. We exercise the pure
 * render path (label, default values, severity select, color picker,
 * close/delete callbacks, and approval message with upstream nodes).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { NotificationConfigPanel } from './NotificationConfigPanel';
import { StickyNoteConfigPanel } from './StickyNoteConfigPanel';
import { ApprovalConfigPanel } from './ApprovalConfigPanel';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// ── helpers ──

function renderPanel(Component: ComponentType<NodeConfigPanelProps>, props: NodeConfigPanelProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Component, props));
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function makeProps(
  type: string,
  data: Record<string, unknown>,
  overrides: Partial<NodeConfigPanelProps> = {}
): NodeConfigPanelProps {
  return {
    node: {
      id: 'n1',
      type,
      data,
      selected: false,
      isConnectable: true,
      zIndex: 0,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as never,
    upstreamNodes: overrides.upstreamNodes ?? [],
    onUpdate: overrides.onUpdate ?? vi.fn(),
    onDelete: overrides.onDelete ?? vi.fn(),
    onClose: overrides.onClose ?? vi.fn(),
    className: '',
  };
}

const setInputValue = (input: HTMLInputElement | null, value: string) => {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};

// ── NotificationConfigPanel ──

describe('NotificationConfigPanel', () => {
  it('renders the title and the default placeholder fields', () => {
    const r = renderPanel(NotificationConfigPanel, makeProps('notificationNode', {}));
    expect(r.container.textContent).toContain('Notification');
    expect(r.container.querySelector('input[placeholder="Notification"]')).not.toBeNull();
    expect(
      r.container.querySelector('textarea[placeholder*="Notification message"]')
    ).not.toBeNull();
    r.cleanup();
  });

  it('renders the 4 severity options in the select', () => {
    const r = renderPanel(NotificationConfigPanel, makeProps('notificationNode', {}));
    const select = r.container.querySelector('select') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    const options = Array.from(select?.querySelectorAll('option') ?? []).map((o) =>
      o.textContent?.trim()
    );
    expect(options).toEqual(['Info', 'Warning', 'Error', 'Success']);
    expect(select?.value).toBe('info');
    r.cleanup();
  });

  it('uses the configured severity as the select value', () => {
    const r = renderPanel(
      NotificationConfigPanel,
      makeProps('notificationNode', { severity: 'error' })
    );
    const select = r.container.querySelector('select') as HTMLSelectElement | null;
    expect(select?.value).toBe('error');
    r.cleanup();
  });

  it('fires onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    const r = renderPanel(NotificationConfigPanel, makeProps('notificationNode', {}, { onClose }));
    const closeBtn = r.container.querySelector(
      'button[aria-label="Close"]'
    ) as HTMLButtonElement | null;
    act(() => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    r.cleanup();
  });

  it('fires onDelete when the Delete Node button is clicked', () => {
    const onDelete = vi.fn();
    const r = renderPanel(NotificationConfigPanel, makeProps('notificationNode', {}, { onDelete }));
    const deleteBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete Node'
    ) as HTMLButtonElement | null;
    act(() => {
      deleteBtn?.click();
    });
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  it('updates the message via onUpdate when the textarea is typed into', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(NotificationConfigPanel, makeProps('notificationNode', {}, { onUpdate }));
    const textarea = r.container.querySelector(
      'textarea[placeholder*="Notification message"]'
    ) as HTMLTextAreaElement | null;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, 'Hello world');
      textarea?.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ message: 'Hello world' })
    );
    r.cleanup();
  });

  it('renders the OutputTreeBrowser when upstreamNodes are provided', () => {
    const r = renderPanel(
      NotificationConfigPanel,
      makeProps(
        'notificationNode',
        {},
        {
          upstreamNodes: [
            {
              id: 'node_1',
              type: 'toolNode',
              data: { label: 'Up', toolName: 'core.x', executionOutput: { ok: 1 } },
              selected: false,
              isConnectable: true,
              zIndex: 0,
              positionAbsoluteX: 0,
              positionAbsoluteY: 0,
            } as never,
          ],
        }
      )
    );
    expect(r.container.textContent).toContain('Upstream Outputs');
    r.cleanup();
  });

  it('omits the OutputTreeBrowser when there are no upstream nodes', () => {
    const r = renderPanel(NotificationConfigPanel, makeProps('notificationNode', {}));
    expect(r.container.textContent).not.toContain('Upstream Outputs');
    r.cleanup();
  });
});

// ── StickyNoteConfigPanel ──

describe('StickyNoteConfigPanel', () => {
  it('renders the title, default placeholders, and 4 color swatches', () => {
    const r = renderPanel(StickyNoteConfigPanel, makeProps('stickyNoteNode', {}));
    expect(r.container.textContent).toContain('Sticky Note');
    expect(r.container.querySelector('input[placeholder="Note title..."]')).not.toBeNull();
    expect(r.container.querySelector('textarea[placeholder="Write a note..."]')).not.toBeNull();
    // 4 color swatches as buttons with title=Yellow/Blue/Green/Pink
    expect(r.container.querySelector('button[title="Yellow"]')).not.toBeNull();
    expect(r.container.querySelector('button[title="Blue"]')).not.toBeNull();
    expect(r.container.querySelector('button[title="Green"]')).not.toBeNull();
    expect(r.container.querySelector('button[title="Pink"]')).not.toBeNull();
    r.cleanup();
  });

  it('fires onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    const r = renderPanel(StickyNoteConfigPanel, makeProps('stickyNoteNode', {}, { onClose }));
    const closeBtn = r.container.querySelector(
      'button[aria-label="Close"]'
    ) as HTMLButtonElement | null;
    act(() => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    r.cleanup();
  });

  it('fires onDelete when the Delete Note button is clicked', () => {
    const onDelete = vi.fn();
    const r = renderPanel(StickyNoteConfigPanel, makeProps('stickyNoteNode', {}, { onDelete }));
    const deleteBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete Note'
    ) as HTMLButtonElement | null;
    act(() => {
      deleteBtn?.click();
    });
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  it('updates the color via onUpdate when a swatch is clicked', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(StickyNoteConfigPanel, makeProps('stickyNoteNode', {}, { onUpdate }));
    const blueSwatch = r.container.querySelector(
      'button[title="Blue"]'
    ) as HTMLButtonElement | null;
    act(() => {
      blueSwatch?.click();
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ color: 'blue' }));
    r.cleanup();
  });
});

// ── ApprovalConfigPanel ──

describe('ApprovalConfigPanel', () => {
  it('renders the title and the default Label placeholder', () => {
    const r = renderPanel(ApprovalConfigPanel, makeProps('approvalNode', {}));
    expect(r.container.textContent).toContain('Approval Gate');
    // Default label value falls back to 'Approval Gate'
    const labelInput = r.container.querySelector('input') as HTMLInputElement | null;
    expect(labelInput?.value).toBe('Approval Gate');
    r.cleanup();
  });

  it('fires the ESC close button when clicked', () => {
    const onClose = vi.fn();
    const r = renderPanel(ApprovalConfigPanel, makeProps('approvalNode', {}, { onClose }));
    const escBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'ESC'
    ) as HTMLButtonElement | null;
    act(() => {
      escBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    r.cleanup();
  });

  it('updates the label via onUpdate when typed into', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(ApprovalConfigPanel, makeProps('approvalNode', {}, { onUpdate }));
    const labelInput = r.container.querySelector('input') as HTMLInputElement | null;
    act(() => {
      setInputValue(labelInput, 'My approval');
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ label: 'My approval' }));
    r.cleanup();
  });

  it('updates the timeout via onUpdate with a number', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(ApprovalConfigPanel, makeProps('approvalNode', {}, { onUpdate }));
    const numberInput = r.container.querySelector(
      'input[type="number"]'
    ) as HTMLInputElement | null;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(numberInput, '30');
      numberInput?.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ timeoutMinutes: 30 }));
    r.cleanup();
  });

  it('omits the OutputTreeBrowser when there are no upstream nodes', () => {
    const r = renderPanel(ApprovalConfigPanel, makeProps('approvalNode', {}));
    expect(r.container.textContent).not.toContain('Upstream Outputs');
    r.cleanup();
  });

  it('renders the OutputTreeBrowser when upstreamNodes are provided', () => {
    const r = renderPanel(
      ApprovalConfigPanel,
      makeProps(
        'approvalNode',
        {},
        {
          upstreamNodes: [
            {
              id: 'node_1',
              type: 'toolNode',
              data: { label: 'Src', toolName: 'core.x' },
              selected: false,
              isConnectable: true,
              zIndex: 0,
              positionAbsoluteX: 0,
              positionAbsoluteY: 0,
            } as never,
          ],
        }
      )
    );
    expect(r.container.textContent).toContain('Upstream Outputs');
    r.cleanup();
  });

  it('renders the execution result block when executionStatus is set', () => {
    const r = renderPanel(
      ApprovalConfigPanel,
      makeProps('approvalNode', { executionStatus: 'success' })
    );
    expect(r.container.textContent).toContain('SUCCESS');
    r.cleanup();
  });

  it('renders the awaiting approval state when executionStatus is running', () => {
    const r = renderPanel(
      ApprovalConfigPanel,
      makeProps('approvalNode', { executionStatus: 'running' })
    );
    expect(r.container.textContent).toContain('AWAITING APPROVAL');
    r.cleanup();
  });

  it('renders the executionError message when present', () => {
    const r = renderPanel(
      ApprovalConfigPanel,
      makeProps('approvalNode', {
        executionStatus: 'error',
        executionError: 'approval failed',
      })
    );
    expect(r.container.textContent).toContain('approval failed');
    r.cleanup();
  });
});
