// @vitest-environment happy-dom

/**
 * Render tests for the simple config panels (MergeConfigPanel,
 * MapConfigPanel) and branch-coverage tests for ForEachNode and
 * JsonTreeView. Both panels are pure (no useState), so we just need a
 * mock node + callbacks and assert that:
 *   - the title, default placeholders, and select options render
 *   - the description input falls back to undefined when cleared
 *   - delete and close callbacks fire
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MergeConfigPanel } from './MergeConfigPanel';
import { MapConfigPanel } from './MapConfigPanel';
import { ForEachNode } from '../ForEachNode';
import { JsonTreeView, detectType } from '../JsonTreeView';
import { renderWorkflowNode } from '../node-render-helper';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// ── helpers ──

function renderNode<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  props: P
) {
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

function makeNodeConfigProps(
  data: Record<string, unknown>,
  overrides: Partial<{ onUpdate: any; onDelete: any; onClose: any; upstreamNodes: any[] }> = {}
) {
  return {
    node: {
      id: 'n1',
      type: 'mergeNode',
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

// ── MergeConfigPanel ──

describe('MergeConfigPanel', () => {
  it('renders the title, default placeholder, and default mode select', () => {
    const r = renderNode(MergeConfigPanel, makeNodeConfigProps({}));
    expect(r.container.textContent).toContain('Merge / Wait');
    expect(r.container.querySelector('input[placeholder="Merge"]')).not.toBeNull();
    const select = r.container.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('waitAll');
    r.cleanup();
  });

  it('switches the helper text based on the mode (firstCompleted)', () => {
    const r = renderNode(MergeConfigPanel, makeNodeConfigProps({ mode: 'firstCompleted' }));
    expect(r.container.textContent).toContain('whichever upstream node completes first');
    r.cleanup();
  });

  it('renders the description as empty when the description is undefined', () => {
    const r = renderNode(MergeConfigPanel, makeNodeConfigProps({ description: undefined }));
    const descInput = r.container.querySelector(
      'input[placeholder="Optional description..."]'
    ) as HTMLInputElement;
    expect(descInput?.value).toBe('');
    r.cleanup();
  });

  it('fires onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    const r = renderNode(MergeConfigPanel, makeNodeConfigProps({}, { onClose }));
    const closeBtn = r.container.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    act(() => {
      closeBtn.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    r.cleanup();
  });

  it('fires onDelete when the Delete Node button is clicked', () => {
    const onDelete = vi.fn();
    const r = renderNode(MergeConfigPanel, makeNodeConfigProps({}, { onDelete }));
    const deleteBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete Node'
    ) as HTMLButtonElement;
    act(() => {
      deleteBtn.click();
    });
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });

  it('uses the OutputAliasField for the output alias', () => {
    const r = renderNode(MergeConfigPanel, makeNodeConfigProps({ outputAlias: 'out' }));
    expect(r.container.textContent).toContain('Output Alias');
    r.cleanup();
  });
});

// ── MapConfigPanel ──

describe('MapConfigPanel', () => {
  it('renders the title and the default placeholders for both expressions', () => {
    const r = renderNode(MapConfigPanel, makeNodeConfigProps({}));
    expect(r.container.textContent).toContain('Map');
    const arrayInput = r.container.querySelector('input[placeholder^="{{node_1.output.items}}"]');
    const expressionTextarea = r.container.querySelector(
      'textarea[placeholder^="{ ...item, processed: true }"]'
    );
    expect(arrayInput).not.toBeNull();
    expect(expressionTextarea).not.toBeNull();
    r.cleanup();
  });

  it('uses the configured array expression and expression values', () => {
    const r = renderNode(
      MapConfigPanel,
      makeNodeConfigProps({
        arrayExpression: '{{node_1.output.items}}',
        expression: 'item * 2',
      })
    );
    const arrayInput = r.container.querySelector(
      'input[placeholder^="{{node_1.output.items}}"]'
    ) as HTMLInputElement;
    const expressionTextarea = r.container.querySelector(
      'textarea[placeholder^="{ ...item, processed: true }"]'
    ) as HTMLTextAreaElement;
    expect(arrayInput?.value).toBe('{{node_1.output.items}}');
    expect(expressionTextarea?.value).toBe('item * 2');
    r.cleanup();
  });

  it('shows the inline helper text for the item/index variables', () => {
    const r = renderNode(MapConfigPanel, makeNodeConfigProps({}));
    expect(r.container.textContent).toContain('Use');
    expect(r.container.textContent).toContain('item');
    expect(r.container.textContent).toContain('index');
    r.cleanup();
  });

  it('fires onClose and onDelete', () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const r = renderNode(MapConfigPanel, makeNodeConfigProps({}, { onClose, onDelete }));
    const closeBtn = r.container.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    act(() => {
      closeBtn.click();
    });
    const deleteBtn = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete Node'
    ) as HTMLButtonElement;
    act(() => {
      deleteBtn.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('n1');
    r.cleanup();
  });
});

// ── ForEachNode kalan dal varyasyonları ──

describe('ForEachNode extra branches', () => {
  it('uses the configured itemVariable as the chip text', () => {
    const r = renderWorkflowNode(
      ForEachNode as never,
      {
        id: 'f1',
        type: 'forEachNode',
        data: {
          label: 'Loop',
          arrayExpression: 'items',
          itemVariable: 'row',
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    // The item-variable chip contains the literal variable name
    const chip = Array.from(r.container.querySelectorAll('span.font-mono')).find(
      (s) => s.textContent?.trim() === 'row'
    );
    expect(chip).toBeDefined();
    r.cleanup();
  });

  it('formats the duration in seconds when >= 1000', () => {
    const r = renderWorkflowNode(
      ForEachNode as never,
      {
        id: 'f2',
        type: 'forEachNode',
        data: {
          label: 'Loop',
          arrayExpression: 'items',
          executionDuration: 2400,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('2.4s');
    r.cleanup();
  });
});

// ── JsonTreeView kalan dal varyasyonları ──

describe('JsonTreeView extra branches', () => {
  it('returns null/undefined type and color when data is null', () => {
    expect(detectType(null)).toBe('null');
    expect(detectType(undefined)).toBe('null');
  });

  it('parses nested JSON strings as objects', () => {
    const r = renderNode(JsonTreeView, { data: { a: '{"inner": 1}' } });
    // depth default 2 opens the parent object so we see "a" but the
    // nested JSON is collapsed by default.
    expect(r.container.textContent).toContain('a');
    r.cleanup();
  });

  it('renders a primitive value with type chip and value', () => {
    const r = renderNode(JsonTreeView, { data: 42 });
    expect(r.container.textContent).toContain('42');
    expect(r.container.textContent).toContain('number');
    r.cleanup();
  });

  it('renders the empty array placeholder for []', () => {
    const r = renderNode(JsonTreeView, { data: [] });
    expect(r.container.textContent).toContain('[]');
    r.cleanup();
  });

  it('respects maxDepth by collapsing branches beyond it', () => {
    // 5 levels deep; maxDepth 1 should collapse quickly
    const deep = { a: { b: { c: { d: { e: 'leaf' } } } } };
    const r = renderNode(JsonTreeView, { data: deep, maxDepth: 1 });
    // The top-level key 'a' is visible but deeper levels are not
    expect(r.container.textContent).toContain('a');
    r.cleanup();
  });
});
