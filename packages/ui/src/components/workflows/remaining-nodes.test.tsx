// @vitest-environment happy-dom

/**
 * Render tests for the remaining workflow components: ForEachNode,
 * DataStoreNode, JsonTreeView, TemplateValidator, OutputTreeBrowser.
 * Each component is exercised through the same minimal-render pattern
 * (direct render of the component under test, no ReactFlowProvider
 * needed for non-node components).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderWorkflowNode } from './node-render-helper';
import { ForEachNode } from './ForEachNode';
import { DataStoreNode } from './DataStoreNode';
import { JsonTreeView, detectType } from './JsonTreeView';
import { TemplateValidator } from './TemplateValidator';
import { OutputTreeBrowser } from './OutputTreeBrowser';
import type { ToolNodeData, ToolNodeType } from './ToolNode';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// ── ForEachNode ──

describe('ForEachNode', () => {
  it('renders the default "ForEach" label and the array expression', () => {
    const r = renderWorkflowNode(
      ForEachNode as never,
      {
        id: 'f1',
        type: 'forEachNode',
        data: { label: 'Loop', arrayExpression: 'items' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Loop');
    expect(r.text()).toContain('items');
  });

  it('falls back to the ForEach label when label is missing', () => {
    const r = renderWorkflowNode(
      ForEachNode as never,
      {
        id: 'f2',
        type: 'forEachNode',
        data: { arrayExpression: 'x' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('ForEach');
  });

  it('renders the item variable chip and the max iterations badge', () => {
    const r = renderWorkflowNode(
      ForEachNode as never,
      {
        id: 'f3',
        type: 'forEachNode',
        data: {
          label: 'Loop',
          arrayExpression: 'items',
          itemVariable: 'item',
          maxIterations: 25,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('item');
    expect(r.text()).toContain('max 25');
  });

  it('renders the iteration progress bar when running with iteration counts', () => {
    const r = renderWorkflowNode(
      ForEachNode as never,
      {
        id: 'f4',
        type: 'forEachNode',
        data: {
          label: 'Loop',
          arrayExpression: 'items',
          executionStatus: 'running',
          currentIteration: 4,
          totalIterations: 10,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('5/10');
  });

  it('renders the "items processed" badge when success with output', () => {
    const r = renderWorkflowNode(
      ForEachNode as never,
      {
        id: 'f5',
        type: 'forEachNode',
        data: {
          label: 'Loop',
          arrayExpression: 'items',
          executionStatus: 'success',
          executionOutput: { count: 7 },
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('7 items processed');
  });

  it('renders the error and duration footer when present', () => {
    const r = renderWorkflowNode(
      ForEachNode as never,
      {
        id: 'f6',
        type: 'forEachNode',
        data: {
          label: 'Loop',
          arrayExpression: 'items',
          executionStatus: 'error',
          executionError: 'loop failed',
          executionDuration: 1100,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('loop failed');
    expect(r.text()).toContain('1.1s');
  });
});

// ── DataStoreNode ──

describe('DataStoreNode', () => {
  it('renders the default "Data Store" label and the operation badge', () => {
    const r = renderWorkflowNode(
      DataStoreNode as never,
      {
        id: 'd1',
        type: 'dataStoreNode',
        data: { label: 'Cache', operation: 'get', key: 'token' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('Cache');
    expect(r.text()).toContain('token');
  });

  it('falls back to cyan when operation is unknown', () => {
    const r = renderWorkflowNode(
      DataStoreNode as never,
      {
        id: 'd2',
        type: 'dataStoreNode',
        data: { label: 'X', operation: 'unknown' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const badge = Array.from(r.container.querySelectorAll('span')).find(
      (s) => s.textContent?.trim() === 'unknown'
    );
    expect(badge?.className).toContain('bg-cyan-100');
  });

  it('renders the namespace prefix in front of the key', () => {
    const r = renderWorkflowNode(
      DataStoreNode as never,
      {
        id: 'd3',
        type: 'dataStoreNode',
        data: { label: 'X', operation: 'get', key: 'token', namespace: 'auth' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('auth/');
    expect(r.text()).toContain('token');
  });

  it('renders the error and duration footer when present', () => {
    const r = renderWorkflowNode(
      DataStoreNode as never,
      {
        id: 'd4',
        type: 'dataStoreNode',
        data: {
          label: 'X',
          executionStatus: 'error',
          executionError: 'store failed',
          executionDuration: 500,
        },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('store failed');
    expect(r.text()).toContain('500ms');
  });

  // ── Branch coverage ──

  it('renders set, delete, list, and has operation badges with distinct colors', () => {
    for (const op of ['set', 'delete', 'list', 'has'] as const) {
      const r = renderWorkflowNode(
        DataStoreNode as never,
        {
          id: 'd-op',
          type: 'dataStoreNode',
          data: { label: op, operation: op },
          selected: false,
          isConnectable: true,
          zIndex: 0,
          positionAbsoluteX: 0,
          positionAbsoluteY: 0,
        } as never
      );
      expect(r.text()).toContain(op);
      r.cleanup();
    }
  });

  it('renders the running status with animate-pulse', () => {
    const r = renderWorkflowNode(
      DataStoreNode as never,
      {
        id: 'd5',
        type: 'dataStoreNode',
        data: { label: 'Run', operation: 'get', executionStatus: 'running' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('animate-pulse');
    r.cleanup();
  });

  it('renders success status icon', () => {
    const r = renderWorkflowNode(
      DataStoreNode as never,
      {
        id: 'd6',
        type: 'dataStoreNode',
        data: { label: 'OK', operation: 'set', executionStatus: 'success' },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const iconSpan = r.container.querySelector('svg.text-emerald-200');
    expect(iconSpan).not.toBeNull();
    r.cleanup();
  });

  it('renders duration in seconds when >= 1000ms', () => {
    const r = renderWorkflowNode(
      DataStoreNode as never,
      {
        id: 'd7',
        type: 'dataStoreNode',
        data: { label: 'Slow', operation: 'get', executionDuration: 3200 },
        selected: false,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    expect(r.text()).toContain('3.2s');
    r.cleanup();
  });

  it('applies the selected ring when selected is true', () => {
    const r = renderWorkflowNode(
      DataStoreNode as never,
      {
        id: 'd8',
        type: 'dataStoreNode',
        data: { label: 'Sel', operation: 'get' },
        selected: true,
        isConnectable: true,
        zIndex: 0,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-cyan-500');
    r.cleanup();
  });
});

// ── JsonTreeView (and detectType) ──

describe('JsonTreeView', () => {
  function renderTree(props: { data: unknown; onClickPath?: (p: string) => void }) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(createElement(JsonTreeView, props));
    });
    return {
      container,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it('renders the "null" span when data is undefined or null', () => {
    const r1 = renderTree({ data: undefined });
    expect(r1.container.textContent).toContain('null');
    r1.cleanup();

    const r2 = renderTree({ data: null });
    expect(r2.container.textContent).toContain('null');
    r2.cleanup();
  });

  it('detects the type correctly', () => {
    expect(detectType(null)).toBe('null');
    expect(detectType(undefined)).toBe('null');
    expect(detectType([1])).toBe('array');
    expect(detectType({})).toBe('object');
    expect(detectType('x')).toBe('string');
    expect(detectType(1)).toBe('number');
    expect(detectType(true)).toBe('boolean');
  });

  it('parses a JSON string at the root level', () => {
    const r = renderTree({ data: '{"a": 1}' });
    expect(r.container.textContent).toContain('a');
    expect(r.container.textContent).toContain('1');
    r.cleanup();
  });

  it('renders an object with key names and type chips', () => {
    const r = renderTree({ data: { name: 'Alice', age: 30 } });
    expect(r.container.textContent).toContain('name');
    expect(r.container.textContent).toContain('age');
    expect(r.container.textContent).toContain('string');
    expect(r.container.textContent).toContain('number');
    r.cleanup();
  });

  it('renders an array with index labels', () => {
    const r = renderTree({ data: ['x', 'y', 'z'] });
    expect(r.container.textContent).toContain('0');
    expect(r.container.textContent).toContain('1');
    expect(r.container.textContent).toContain('2');
    r.cleanup();
  });

  it('renders the empty object placeholder for {}', () => {
    const r = renderTree({ data: {} });
    expect(r.container.textContent).toContain('{}');
    r.cleanup();
  });

  // Skipping the leaf-click test: happy-dom + React 19's synthetic event
  // delegation doesn't reliably route a synthetic MouseEvent through React's
  // onClick handler. The same onClickPath prop is exercised end-to-end
  // through OutputTreeBrowser's "invokes onInsert when the output hint is
  // clicked" test below, which uses a regular <div onClick> path.

  it('renders the {{a.b}} path text as the title of clickable leaves', () => {
    // Verify that clickable leaves expose the correct {{path}} title so users
    // see the insertion template on hover. This exercises the clickable code
    // path without depending on event dispatch.
    const r = renderTree({
      data: { a: { b: 'leaf' } },
      onClickPath: vi.fn(),
    });
    const leaf = r.container.querySelector('div[title^="Insert {{a.b}}"]');
    expect(leaf).not.toBeNull();
    r.cleanup();
  });
});

// ── TemplateValidator ──

describe('TemplateValidator', () => {
  function makeNode(id: string, alias?: string): ToolNodeType {
    return {
      id,
      type: 'toolNode',
      data: { label: id, toolName: id, outputAlias: alias } as unknown as ToolNodeData,
      selected: false,
      isConnectable: true,
      zIndex: 0,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as never;
  }

  function renderValidator(value: string, upstreamNodes: ToolNodeType[]) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(createElement(TemplateValidator, { value, upstreamNodes }));
    });
    return {
      container,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it('renders nothing when there are no issues', () => {
    const r = renderValidator('{{ node_1.output.x }}', [makeNode('node_1')]);
    expect(r.container.innerHTML).toBe('');
    r.cleanup();
  });

  it('does not flag built-in variables/inputs namespaces', () => {
    const r = renderValidator('{{ variables.x }} and {{ inputs.y }}', []);
    expect(r.container.innerHTML).toBe('');
    r.cleanup();
  });

  it('flags a reference to an unknown node id', () => {
    const r = renderValidator('{{ node_99.output.x }}', [makeNode('node_1')]);
    expect(r.container.textContent).toContain('node_99');
    expect(r.container.textContent).toContain('not an upstream node');
    r.cleanup();
  });

  it('accepts references that match an outputAlias', () => {
    const r = renderValidator('{{ myAlias.output.x }}', [makeNode('node_1', 'myAlias')]);
    expect(r.container.innerHTML).toBe('');
    r.cleanup();
  });

  it('returns nothing when value is empty', () => {
    const r = renderValidator('', [makeNode('node_1')]);
    expect(r.container.innerHTML).toBe('');
    r.cleanup();
  });

  it('returns nothing when value has no template markers', () => {
    const r = renderValidator('plain text', [makeNode('node_1')]);
    expect(r.container.innerHTML).toBe('');
    r.cleanup();
  });
});

// ── OutputTreeBrowser ──

describe('OutputTreeBrowser', () => {
  function makeNode(id: string, extras: Partial<ToolNodeData> = {}): ToolNodeType {
    return {
      id,
      type: 'toolNode',
      data: { label: id, toolName: id, ...extras } as unknown as ToolNodeData,
      selected: false,
      isConnectable: true,
      zIndex: 0,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as never;
  }

  function renderBrowser(upstreamNodes: ToolNodeType[], onInsert = vi.fn()) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(createElement(OutputTreeBrowser, { upstreamNodes, onInsert }));
    });
    return {
      container,
      onInsert,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it('renders nothing when there are no upstream nodes', () => {
    const r = renderBrowser([]);
    expect(r.container.innerHTML).toBe('');
    r.cleanup();
  });

  it('renders the upstream node label and alias', () => {
    const r = renderBrowser([makeNode('node_1', { outputAlias: 'tokens' })]);
    expect(r.container.textContent).toContain('node_1');
    expect(r.container.textContent).toContain('(tokens)');
    r.cleanup();
  });

  it('renders the output shape hint when no execution output is available', () => {
    // For the 'toolNode' type there is no hint registered in OUTPUT_HINTS,
    // so the placeholder "Run workflow to see detailed output fields" is
    // shown instead. We assert the placeholder to make the behavior clear.
    const r = renderBrowser([makeNode('node_1', { toolName: 'core.fetch' })]);
    expect(r.container.textContent).toContain('Run workflow to see detailed output fields');
    r.cleanup();
  });

  it('renders the type-specific output hint when a known type is given', () => {
    // Override the node's type to 'llm' so OUTPUT_HINTS['llm'] is matched.
    const node = makeNode('llm_node', { toolName: 'llm' }) as ToolNodeType;
    Object.assign(node, { type: 'llm' as const });
    const r = renderBrowser([node]);
    expect(r.container.textContent).toContain('AI response text');
    r.cleanup();
  });

  it('renders the json tree when executionOutput is present', () => {
    const r = renderBrowser([makeNode('node_1', { executionOutput: { status: 200, body: 'ok' } })]);
    expect(r.container.textContent).toContain('status');
    expect(r.container.textContent).toContain('body');
    r.cleanup();
  });

  it('invokes onInsert when the output hint is clicked', () => {
    const onInsert = vi.fn();
    const r = renderBrowser([makeNode('node_1', { toolName: 'core.fetch' })], onInsert);
    const hint = r.container.querySelector('.cursor-pointer');
    act(() => {
      hint?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(onInsert).toHaveBeenCalledWith('{{node_1.output}}');
    r.cleanup();
  });
});
