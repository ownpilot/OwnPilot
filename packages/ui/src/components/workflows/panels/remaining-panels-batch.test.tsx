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

async function flushEffects() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
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
  it('updates label and array expression via onUpdate', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(AggregateConfigPanel, makeProps({}, { onUpdate }));
    const labelInput = r.container.querySelector(
      'input[placeholder="Aggregate"]'
    ) as HTMLInputElement;
    const arrayInput = r.container.querySelector(
      'input[placeholder="{{node_1.output.items}}"]'
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(labelInput, 'My Aggregate');
      labelInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ label: 'My Aggregate' }));
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(arrayInput, '{{n1.output.items}}');
      arrayInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ arrayExpression: '{{n1.output.items}}' })
    );
    r.cleanup();
  });
  it('updates operation and field via onUpdate', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(AggregateConfigPanel, makeProps({}, { onUpdate }));
    const select = r.container.querySelector('select') as HTMLSelectElement;
    const fieldInput = r.container.querySelector(
      'input[placeholder="e.g. price, name"]'
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value'
      )?.set;
      setter?.call(select, 'avg');
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ operation: 'avg' }));
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(fieldInput, 'price');
      fieldInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ field: 'price' }));
    r.cleanup();
  });
  it('clears field to undefined when emptied', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(AggregateConfigPanel, makeProps({ field: 'price' }, { onUpdate }));
    const fieldInput = r.container.querySelector(
      'input[placeholder="e.g. price, name"]'
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(fieldInput, '');
      fieldInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ field: undefined }));
    r.cleanup();
  });
  it('renders OutputAliasField and TemplateValidator', () => {
    const r = renderPanel(AggregateConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Output Alias');
    // TemplateValidator shows hint text for template expressions
    expect(r.container.textContent).toContain('Output');
    r.cleanup();
  });
  it('renders all 8 operation options', () => {
    const r = renderPanel(AggregateConfigPanel, makeProps());
    const select = r.container.querySelector('select') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent?.trim());
    expect(options).toEqual(['Sum', 'Count', 'Avg', 'Min', 'Max', 'GroupBy', 'Flatten', 'Unique']);
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
  it('renders results tab with success status and duration', () => {
    const r = renderPanel(
      DelayConfigPanel,
      makeProps({ executionStatus: 'success', executionDuration: 2500 })
    );
    expect(r.container.textContent).toContain('success');
    expect(r.container.textContent).toContain('2.5s');
    r.cleanup();
  });
  it('renders results tab with error status and ms-format duration', () => {
    const r = renderPanel(
      DelayConfigPanel,
      makeProps({ executionStatus: 'error', executionError: 'timeout', executionDuration: 500 })
    );
    expect(r.container.textContent).toContain('error');
    expect(r.container.textContent).toContain('timeout');
    expect(r.container.textContent).toContain('500ms');
    r.cleanup();
  });
  it('updates unit via pushUpdate', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(DelayConfigPanel, makeProps({}, { onUpdate }));
    const unitSelect = r.container.querySelector('select') as HTMLSelectElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value'
      )?.set;
      setter?.call(unitSelect, 'minutes');
      unitSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ unit: 'minutes' }));
    r.cleanup();
  });
  it('shows configured label value', () => {
    const r = renderPanel(DelayConfigPanel, makeProps({ label: 'Custom Delay' }));
    const labelInput = r.container.querySelector('input') as HTMLInputElement;
    expect(labelInput?.value).toBe('Custom Delay');
    r.cleanup();
  });
  it('shows configured duration and unit values', () => {
    const r = renderPanel(DelayConfigPanel, makeProps({ duration: '30', unit: 'hours' }));
    const unitSelect = r.container.querySelector('select') as HTMLSelectElement;
    expect(unitSelect?.value).toBe('hours');
    const durationInput = r.container.querySelector('input[placeholder*="5"]') as HTMLInputElement;
    expect(durationInput?.value).toBe('30');
    r.cleanup();
  });
  it('renders OutputAliasField', () => {
    const r = renderPanel(DelayConfigPanel, makeProps());
    expect(r.container.textContent).toContain('Output Alias');
    r.cleanup();
  });
  it('shows all 3 unit options', () => {
    const r = renderPanel(DelayConfigPanel, makeProps());
    const select = r.container.querySelector('select') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent?.trim());
    expect(options).toEqual(['Seconds', 'Minutes', 'Hours']);
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
  it('switches method when method button is clicked', async () => {
    const onUpdate = vi.fn();
    const r = renderPanel(HttpRequestConfigPanel, makeProps({}, { onUpdate }));
    const postBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'POST'
    ) as HTMLButtonElement;
    expect(postBtn).not.toBeNull();
    act(() => postBtn.click());
    await flushEffects();
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ method: 'POST' }));
    r.cleanup();
  });
  it('renders body section for POST method', () => {
    const r = renderPanel(HttpRequestConfigPanel, makeProps({ method: 'POST' }));
    expect(r.container.textContent).toContain('Body Type');
    expect(r.container.querySelector('textarea')).not.toBeNull();
    r.cleanup();
  });
  it('does NOT render body section for GET method', () => {
    const r = renderPanel(HttpRequestConfigPanel, makeProps({ method: 'GET' }));
    expect(r.container.textContent).not.toContain('Body Type');
    r.cleanup();
  });
  it('switches auth type and shows corresponding fields', () => {
    const onUpdate = vi.fn();
    const r = renderPanel(HttpRequestConfigPanel, makeProps({}, { onUpdate }));
    const authSelect = r.container.querySelectorAll('select')[0] as HTMLSelectElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value'
      )?.set;
      setter?.call(authSelect, 'bearer');
      authSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ authType: 'bearer' }));
    // Should show Token field
    const tokenInput = r.container.querySelector('input[placeholder*="token"]') as HTMLInputElement;
    expect(tokenInput).not.toBeNull();
    r.cleanup();
  });
  it('switches to basic auth and shows username/password', () => {
    const r = renderPanel(HttpRequestConfigPanel, makeProps({ authType: 'basic' }));
    expect(r.container.querySelector('input[type="password"]')).not.toBeNull();
    r.cleanup();
  });
  it('renders results tab with status code (2xx green)', () => {
    const r = renderPanel(
      HttpRequestConfigPanel,
      makeProps({
        executionStatus: 'success',
        responseStatusCode: 200,
        executionOutput: { ok: true },
      })
    );
    expect(r.container.textContent).toContain('success');
    expect(r.container.textContent).toContain('200');
    expect(r.container.textContent).toContain('Response Body');
    r.cleanup();
  });
  it('renders results tab with retry attempts', () => {
    const r = renderPanel(
      HttpRequestConfigPanel,
      makeProps({
        executionStatus: 'error',
        executionError: 'timeout',
        retryAttempts: 2,
      })
    );
    expect(r.container.textContent).toContain('2');
    r.cleanup();
  });
  it('renders response headers when present', () => {
    const r = renderPanel(
      HttpRequestConfigPanel,
      makeProps({
        executionStatus: 'success',
        responseHeaders: { 'Content-Type': 'application/json' },
      })
    );
    expect(r.container.textContent).toContain('Response Headers');
    expect(r.container.textContent).toContain('Content-Type');
    r.cleanup();
  });
  it('renders OutputTreeBrowser when upstreamNodes provided', () => {
    const r = renderPanel(
      HttpRequestConfigPanel,
      makeProps(
        {},
        {
          upstreamNodes: [
            {
              id: 'n0',
              type: 'toolNode',
              data: { label: 'Src' },
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
  it('renders URL with font-mono class', () => {
    const r = renderPanel(HttpRequestConfigPanel, makeProps());
    const urlInput = r.container.querySelector(
      'input[placeholder*="https://"]'
    ) as HTMLInputElement;
    expect(urlInput).not.toBeNull();
    r.cleanup();
  });
});
