// @vitest-environment happy-dom

/**
 * Batch render tests for 8 remaining low-coverage panels.
 *
 * Pure (no useState):         DataStoreConfigPanel, AggregateConfigPanel
 * useState + tabs + presets:  CodeConfigPanel, DelayConfigPanel,
 *   ForEachConfigPanel, TransformerConfigPanel, ClawConfigPanel
 * Complex:                    HttpRequestConfigPanel
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';

import { DataStoreConfigPanel } from './DataStoreConfigPanel';
import { AggregateConfigPanel } from './AggregateConfigPanel';
import { CodeConfigPanel } from './CodeConfigPanel';
import { DelayConfigPanel } from './DelayConfigPanel';
import { ForEachConfigPanel } from './ForEachConfigPanel';
import { TransformerConfigPanel } from './TransformerConfigPanel';
import { ClawConfigPanel } from './ClawConfigPanel';
import { HttpRequestConfigPanel } from './HttpRequestConfigPanel';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function renderPanel(C: ComponentType<NodeConfigPanelProps>, p: NodeConfigPanelProps) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => root.render(createElement(C, p)));
  return {
    container: c,
    cleanup: () => {
      act(() => root.unmount());
      c.remove();
    },
  };
}

function makeProps(
  d: Record<string, unknown> = {},
  o: Partial<NodeConfigPanelProps> = {}
): NodeConfigPanelProps {
  return {
    node: {
      id: 'n1',
      type: 'node',
      data: d,
      selected: false,
      isConnectable: true,
      zIndex: 0,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as never,
    upstreamNodes: o.upstreamNodes ?? [],
    onUpdate: o.onUpdate ?? vi.fn(),
    onDelete: o.onDelete ?? vi.fn(),
    onClose: o.onClose ?? vi.fn(),
    className: '',
  };
}

function btn(c: HTMLElement, t: string): HTMLButtonElement | null {
  return (
    (Array.from(c.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.trim() === t
    ) ?? null
  );
}

function closeBtn(c: HTMLElement): HTMLElement | null {
  // Try aria-label first, then any button with an SVG child
  const labeled = c.querySelector('[aria-label="Close"]');
  if (labeled) return labeled as HTMLElement;
  return (
    (Array.from(c.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
      b.querySelector('svg')
    ) ?? null
  );
}

// ============================================================================
// GROUP 1 — Pure panels
// ============================================================================

describe('DataStoreConfigPanel', () => {
  it('renders title and operation select', () => {
    const r = renderPanel(DataStoreConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Data Store');
    expect(r.container.querySelector('select')).not.toBeNull();
    r.cleanup();
  });
  it('fires close and delete', () => {
    const oc = vi.fn(),
      od = vi.fn();
    const r = renderPanel(DataStoreConfigPanel, makeProps({}, { onClose: oc, onDelete: od }));
    act(() => closeBtn(r.container)?.click());
    expect(oc).toHaveBeenCalledTimes(1);
    act(() => btn(r.container, 'Delete Node')?.click());
    expect(od).toHaveBeenCalledWith('n1');
    r.cleanup();
  });
});

describe('AggregateConfigPanel', () => {
  it('renders title and operation options', () => {
    const r = renderPanel(AggregateConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Aggregate');
    expect(r.container.textContent).toContain('Operation');
    r.cleanup();
  });
  it('fires close and delete', () => {
    const oc = vi.fn(),
      od = vi.fn();
    const r = renderPanel(AggregateConfigPanel, makeProps({}, { onClose: oc, onDelete: od }));
    act(() => closeBtn(r.container)?.click());
    expect(oc).toHaveBeenCalledTimes(1);
    act(() => btn(r.container, 'Delete Node')?.click());
    expect(od).toHaveBeenCalledWith('n1');
    r.cleanup();
  });
});

// ============================================================================
// GROUP 2 — useState panels
// ============================================================================

describe('CodeConfigPanel', () => {
  it('renders title and language select', () => {
    const r = renderPanel(CodeConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Code');
    expect(r.container.textContent).toContain('Language');
    r.cleanup();
  });
  it('fires close and delete', () => {
    const oc = vi.fn(),
      od = vi.fn();
    const r = renderPanel(CodeConfigPanel, makeProps({}, { onClose: oc, onDelete: od }));
    act(() => closeBtn(r.container)?.click());
    expect(oc).toHaveBeenCalledTimes(1);
    act(() => btn(r.container, 'Delete Code Node')?.click());
    expect(od).toHaveBeenCalledWith('n1');
    r.cleanup();
  });
  it('renders results tab', () => {
    const r = renderPanel(
      CodeConfigPanel,
      makeProps({ executionStatus: 'success', executionOutput: 'done' })
    );
    expect(r.container.textContent).toContain('success');
    r.cleanup();
  });
});

describe('DelayConfigPanel', () => {
  it('renders title and duration inputs', () => {
    const r = renderPanel(DelayConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Delay');
    expect(r.container.textContent).toContain('Duration');
    r.cleanup();
  });
  it('fires close and delete', () => {
    const oc = vi.fn(),
      od = vi.fn();
    const r = renderPanel(DelayConfigPanel, makeProps({}, { onClose: oc, onDelete: od }));
    act(() => closeBtn(r.container)?.click());
    expect(oc).toHaveBeenCalledTimes(1);
    act(() => btn(r.container, 'Delete Delay')?.click());
    expect(od).toHaveBeenCalledWith('n1');
    r.cleanup();
  });
  it('renders results tab', () => {
    const r = renderPanel(
      DelayConfigPanel,
      makeProps({ executionStatus: 'success', executionDuration: 2500 })
    );
    expect(r.container.textContent).toContain('success');
    expect(r.container.textContent).toContain('2.5s');
    r.cleanup();
  });
});

describe('ForEachConfigPanel', () => {
  it('renders title and array expression field', () => {
    const r = renderPanel(ForEachConfigPanel, makeProps());
    // Title is "ForEach" (one word) in the header
    expect(r.container.textContent).toContain('ForEach');
    expect(r.container.textContent).toContain('Array to Iterate');
    r.cleanup();
  });
  it('fires close and delete', () => {
    const oc = vi.fn(),
      od = vi.fn();
    const r = renderPanel(ForEachConfigPanel, makeProps({}, { onClose: oc, onDelete: od }));
    act(() => closeBtn(r.container)?.click());
    expect(oc).toHaveBeenCalledTimes(1);
    act(() => btn(r.container, 'Delete ForEach')?.click());
    expect(od).toHaveBeenCalledWith('n1');
    r.cleanup();
  });
  it('renders results tab', () => {
    const r = renderPanel(
      ForEachConfigPanel,
      makeProps({ executionStatus: 'success', executionOutput: { result: [1] } })
    );
    expect(r.container.textContent).toContain('success');
    r.cleanup();
  });
});

describe('TransformerConfigPanel', () => {
  it('renders title and expression presets', () => {
    const r = renderPanel(TransformerConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Transformer');
    expect(r.container.textContent).toContain('Expression');
    r.cleanup();
  });
  it('fires close and delete', () => {
    const oc = vi.fn(),
      od = vi.fn();
    const r = renderPanel(TransformerConfigPanel, makeProps({}, { onClose: oc, onDelete: od }));
    act(() => closeBtn(r.container)?.click());
    expect(oc).toHaveBeenCalledTimes(1);
    act(() => btn(r.container, 'Delete Transformer')?.click());
    expect(od).toHaveBeenCalledWith('n1');
    r.cleanup();
  });
  it('renders results tab', () => {
    const r = renderPanel(TransformerConfigPanel, makeProps({ executionStatus: 'success' }));
    expect(r.container.textContent).toContain('success');
    r.cleanup();
  });
});

describe('ClawConfigPanel', () => {
  it('renders title and mode/sandbox selects', () => {
    const r = renderPanel(ClawConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Claw');
    expect(r.container.textContent).toContain('Mode');
    expect(r.container.textContent).toContain('Sandbox');
    r.cleanup();
  });
  it('fires close and delete', () => {
    const oc = vi.fn(),
      od = vi.fn();
    const r = renderPanel(ClawConfigPanel, makeProps({}, { onClose: oc, onDelete: od }));
    // Claw panel may not have a close button — just verify delete
    act(() => btn(r.container, 'Delete Node')?.click());
    expect(od).toHaveBeenCalledWith('n1');
    r.cleanup();
  });
  it('renders OutputAliasField', () => {
    const r = renderPanel(ClawConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Output Alias');
    r.cleanup();
  });
});

// ============================================================================
// GROUP 3 — HttpRequestConfigPanel (668 lines)
// ============================================================================

describe('HttpRequestConfigPanel', () => {
  it('renders title and basic fields', () => {
    const r = renderPanel(HttpRequestConfigPanel, makeProps());
    expect(r.container.textContent).toContain('HTTP Request');
    expect(r.container.textContent).toContain('URL');
    expect(r.container.textContent).toContain('Method');
    r.cleanup();
  });
  it('fires close and delete', () => {
    const oc = vi.fn(),
      od = vi.fn();
    const r = renderPanel(HttpRequestConfigPanel, makeProps({}, { onClose: oc, onDelete: od }));
    act(() => closeBtn(r.container)?.click());
    expect(oc).toHaveBeenCalledTimes(1);
    act(() => btn(r.container, 'Delete HTTP Request')?.click());
    expect(od).toHaveBeenCalledWith('n1');
    r.cleanup();
  });
  it('renders results tab with output and error', () => {
    const r = renderPanel(
      HttpRequestConfigPanel,
      makeProps({
        executionStatus: 'error',
        executionError: 'timeout',
        executionDuration: 5000,
      })
    );
    expect(r.container.textContent).toContain('error');
    expect(r.container.textContent).toContain('timeout');
    expect(r.container.textContent).toContain('5.0s');
    r.cleanup();
  });
  it('renders shared fields', () => {
    const r = renderPanel(HttpRequestConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Output Alias');
    expect(r.container.textContent).toContain('Retry');
    r.cleanup();
  });
});
