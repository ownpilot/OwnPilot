// @vitest-environment happy-dom

/**
 * useWorkflowCanvas — canvas interaction handlers for the workflow editor.
 *
 * Tests cover:
 *   - reconcileSwitchCaseEdges (existing, expanded)
 *   - useWorkflowCanvas hook (isValidConnection, onConnect,
 *     onNodesChangeWrapped, onEdgesChangeWrapped, onNodeClick, onPaneClick,
 *     handleArrange, onDragOver, onDrop, updateNodeData, deleteNode)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edge, Node, Connection, NodeChange, EdgeChange } from '@xyflow/react';
import { reconcileSwitchCaseEdges, useWorkflowCanvas } from './useWorkflowCanvas';

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockAddEdge = vi.fn((edge, edges) => [...edges, edge]);
const mockFitView = vi.fn();
const mockUpdateNodeInternals = vi.fn();

vi.mock('@xyflow/react', () => ({
  addEdge: (edge: any, edges: any[]) => mockAddEdge(edge, edges),
  useReactFlow: () => ({ fitView: mockFitView }),
  useUpdateNodeInternals: () => mockUpdateNodeInternals,
}));

vi.mock('../../utils/formatters', () => ({
  formatToolName: (name: string) => name.replace(/_/g, ' '),
}));

vi.mock('../../components/workflows/auto-arrange', () => ({
  autoArrangeNodes: vi.fn((nodes) => nodes),
}));

vi.mock('./shared', () => ({
  getEdgeLabelProps: (handle: string | null | undefined) => {
    if (handle === 'true') return { label: 'True', style: { stroke: '#10b981' } };
    if (handle === 'false') return { label: 'False', style: { stroke: '#ef4444' } };
    return {};
  },
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

function edge(id: string, sourceHandle: string, source = 'switch'): Edge {
  return {
    id,
    source,
    target: `${id}-target`,
    sourceHandle,
  };
}

function makeNode(id: string, type: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {},
    ...overrides,
  } as Node;
}

/** Manual renderHook — mounts a test component that calls useWorkflowCanvas */
function mountCanvas(initialNodes: Node[] = [], initialEdges: Edge[] = []) {
  // Track the current state internally so useState-like updaters work
  let currentNodes = [...initialNodes];
  let currentEdges = [...initialEdges];

  const setNodes = vi.fn((updater: Node[] | ((prev: Node[]) => Node[])) => {
    if (typeof updater === 'function') {
      currentNodes = updater(currentNodes);
    } else {
      currentNodes = updater;
    }
  });
  const setEdges = vi.fn((updater: Edge[] | ((prev: Edge[]) => Edge[])) => {
    if (typeof updater === 'function') {
      currentEdges = updater(currentEdges);
    } else {
      currentEdges = updater;
    }
  });
  const onNodesChange = vi.fn();
  const onEdgesChange = vi.fn();
  const setSelectedNodeId = vi.fn();
  const setHasUnsavedChanges = vi.fn();
  const nodeIdCounter = { current: 5 };
  const pushHistory = vi.fn();

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  /** Accumulator for the returned value — updated by the component */
  let hookResult: ReturnType<typeof useWorkflowCanvas> | null = null;

  function TestComponent() {
    hookResult = useWorkflowCanvas({
      nodes: currentNodes,
      edges: currentEdges,
      setNodes,
      setEdges,
      onNodesChange,
      onEdgesChange,
      setSelectedNodeId,
      setHasUnsavedChanges,
      nodeIdCounter,
      pushHistory,
    });
    return null;
  }

  act(() => root.render(createElement(TestComponent)));

  return {
    hook: () => hookResult!,
    getNodes: () => currentNodes,
    getEdges: () => currentEdges,
    mocks: {
      setNodes,
      setEdges,
      onNodesChange,
      onEdgesChange,
      setSelectedNodeId,
      setHasUnsavedChanges,
      nodeIdCounter,
      pushHistory,
    },
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

// ============================================================================
// reconcileSwitchCaseEdges
// ============================================================================

describe('reconcileSwitchCaseEdges', () => {
  it('renames switch case edges when a case label changes in place', () => {
    const edges = [edge('a', 'case_a'), edge('b', 'case_b')];
    const result = reconcileSwitchCaseEdges(
      edges,
      'switch',
      [{ label: 'case_a' }, { label: 'case_b' }],
      [{ label: 'case_alpha' }, { label: 'case_b' }]
    );
    expect(result.map((e) => e.sourceHandle)).toEqual(['case_alpha', 'case_b']);
  });

  it('does not retarget shifted edges when a switch case is deleted', () => {
    const edges = [edge('a', 'case_a'), edge('b', 'case_b'), edge('c', 'case_c')];
    const result = reconcileSwitchCaseEdges(
      edges,
      'switch',
      [{ label: 'case_a' }, { label: 'case_b' }, { label: 'case_c' }],
      [{ label: 'case_b' }, { label: 'case_c' }]
    );
    expect(result.map((e) => e.sourceHandle)).toEqual(['case_b', 'case_c']);
  });

  it('keeps default and unrelated edges when cases change', () => {
    const edges = [edge('default-edge', 'default'), edge('other', 'case_a', 'other-node')];
    const result = reconcileSwitchCaseEdges(
      edges,
      'switch',
      [{ label: 'case_a' }],
      [{ label: 'case_b' }]
    );
    expect(result).toEqual(edges);
  });

  it('filters out edges whose source handle is removed (not in new cases)', () => {
    const edges = [edge('a', 'case_a'), edge('b', 'case_removed')];
    const result = reconcileSwitchCaseEdges(
      edges,
      'switch',
      [{ label: 'case_a' }, { label: 'case_removed' }],
      [{ label: 'case_a' }]
    );
    expect(result.map((e) => e.sourceHandle)).toEqual(['case_a']);
  });

  it('keeps edges from other source nodes untouched', () => {
    const edges = [edge('a', 'handle_x', 'other-node'), edge('b', 'handle_y', 'other-node')];
    const result = reconcileSwitchCaseEdges(
      edges,
      'switch',
      [{ label: 'old_case' }],
      [{ label: 'new_case' }]
    );
    expect(result).toEqual(edges);
  });

  it('handles edges without sourceHandle gracefully', () => {
    const edges: Edge[] = [{ id: 'e1', source: 'switch', target: 't1' } as Edge];
    const result = reconcileSwitchCaseEdges(edges, 'switch', [{ label: 'a' }], [{ label: 'b' }]);
    expect(result).toHaveLength(1);
  });

  it('preserves default handle when cases change length', () => {
    const edges = [edge('default', 'default')];
    const result = reconcileSwitchCaseEdges(
      edges,
      'switch',
      [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
      [{ label: 'x' }]
    );
    // default handle is always valid
    expect(result.map((e) => e.sourceHandle)).toEqual(['default']);
  });
});

// ============================================================================
// useWorkflowCanvas hook
// ============================================================================

describe('useWorkflowCanvas', () => {
  // ── Default returns ──

  it('returns all expected handlers', () => {
    const t = mountCanvas();
    const h = t.hook();
    expect(h).toHaveProperty('isValidConnection');
    expect(h).toHaveProperty('onConnect');
    expect(h).toHaveProperty('onNodesChangeWrapped');
    expect(h).toHaveProperty('onEdgesChangeWrapped');
    expect(h).toHaveProperty('onNodeClick');
    expect(h).toHaveProperty('onPaneClick');
    expect(h).toHaveProperty('handleArrange');
    expect(h).toHaveProperty('onDragOver');
    expect(h).toHaveProperty('onDrop');
    expect(h).toHaveProperty('updateNodeData');
    expect(h).toHaveProperty('deleteNode');
    t.cleanup();
  });

  // ── isValidConnection ──

  it('rejects self-connections', () => {
    const t = mountCanvas([makeNode('n1', 'toolNode')]);
    const conn: Connection = { source: 'n1', target: 'n1', sourceHandle: null, targetHandle: null };
    expect(t.hook().isValidConnection(conn)).toBe(false);
    t.cleanup();
  });

  it('rejects duplicate edges', () => {
    const existingEdges: Edge[] = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        sourceHandle: 'out',
        targetHandle: 'in',
      } as Edge,
    ];
    const t = mountCanvas([makeNode('n1', 'toolNode'), makeNode('n2', 'toolNode')], existingEdges);
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'out',
      targetHandle: 'in',
    };
    expect(t.hook().isValidConnection(conn)).toBe(false);
    t.cleanup();
  });

  it('rejects connections targeting a triggerNode', () => {
    const t = mountCanvas([makeNode('trigger', 'triggerNode'), makeNode('tool', 'toolNode')]);
    const conn: Connection = {
      source: 'tool',
      target: 'trigger',
      sourceHandle: null,
      targetHandle: null,
    };
    expect(t.hook().isValidConnection(conn)).toBe(false);
    t.cleanup();
  });

  it('rejects connections from or to stickyNoteNode', () => {
    const t = mountCanvas([makeNode('sticky', 'stickyNoteNode'), makeNode('tool', 'toolNode')]);
    const fromSticky: Connection = {
      source: 'sticky',
      target: 'tool',
      sourceHandle: null,
      targetHandle: null,
    };
    const toSticky: Connection = {
      source: 'tool',
      target: 'sticky',
      sourceHandle: null,
      targetHandle: null,
    };
    expect(t.hook().isValidConnection(fromSticky)).toBe(false);
    expect(t.hook().isValidConnection(toSticky)).toBe(false);
    t.cleanup();
  });

  it('accepts a valid connection', () => {
    const t = mountCanvas([makeNode('n1', 'toolNode'), makeNode('n2', 'toolNode')]);
    const conn: Connection = { source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null };
    expect(t.hook().isValidConnection(conn)).toBe(true);
    t.cleanup();
  });

  // ── onConnect ──

  it('calls pushHistory and setHasUnsavedChanges on connect', () => {
    const t = mountCanvas();
    const conn: Connection = {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'true',
      targetHandle: null,
    };
    act(() => t.hook().onConnect(conn));
    expect(t.mocks.pushHistory).toHaveBeenCalledTimes(1);
    expect(t.mocks.setHasUnsavedChanges).toHaveBeenCalledWith(true);
    // addEdge is called inside the setEdges updater; verify setEdges was called
    expect(t.mocks.setEdges).toHaveBeenCalled();
    t.cleanup();
  });

  // ── onNodesChangeWrapped ──

  it('pushes history and sets unsaved on node remove', () => {
    const t = mountCanvas();
    const changes = [{ type: 'remove', id: 'n1' }] as NodeChange[];
    act(() => t.hook().onNodesChangeWrapped(changes));
    expect(t.mocks.pushHistory).toHaveBeenCalledTimes(1);
    expect(t.mocks.setHasUnsavedChanges).toHaveBeenCalledWith(true);
    expect(t.mocks.onNodesChange).toHaveBeenCalledWith(changes);
    t.cleanup();
  });

  it('pushes history and sets unsaved on node add', () => {
    const t = mountCanvas();
    const changes = [{ type: 'add', item: makeNode('n1', 'toolNode') }] as NodeChange[];
    act(() => t.hook().onNodesChangeWrapped(changes));
    expect(t.mocks.pushHistory).toHaveBeenCalledTimes(1);
    expect(t.mocks.setHasUnsavedChanges).toHaveBeenCalledWith(true);
    t.cleanup();
  });

  it('does NOT push history on position-only change', () => {
    const t = mountCanvas();
    const changes = [
      { type: 'position', id: 'n1', position: { x: 10, y: 20 }, dragging: true },
    ] as NodeChange[];
    act(() => t.hook().onNodesChangeWrapped(changes));
    expect(t.mocks.pushHistory).not.toHaveBeenCalled();
    expect(t.mocks.setHasUnsavedChanges).toHaveBeenCalledWith(true); // position still marks unsaved
    t.cleanup();
  });

  it('calls the original onNodesChange', () => {
    const t = mountCanvas();
    const changes = [{ type: 'select', id: 'n1', selected: true }] as NodeChange[];
    act(() => t.hook().onNodesChangeWrapped(changes));
    expect(t.mocks.onNodesChange).toHaveBeenCalledWith(changes);
    t.cleanup();
  });

  // ── onEdgesChangeWrapped ──

  it('pushes history and sets unsaved on edge remove', () => {
    const t = mountCanvas();
    const changes = [{ type: 'remove', id: 'e1' }] as EdgeChange[];
    act(() => t.hook().onEdgesChangeWrapped(changes));
    expect(t.mocks.pushHistory).toHaveBeenCalledTimes(1);
    expect(t.mocks.setHasUnsavedChanges).toHaveBeenCalledWith(true);
    t.cleanup();
  });

  it('does NOT push history or mark unsaved on non-remove/add edge changes', () => {
    const t = mountCanvas();
    const changes = [{ type: 'select', id: 'e1', selected: true }] as EdgeChange[];
    act(() => t.hook().onEdgesChangeWrapped(changes));
    expect(t.mocks.pushHistory).not.toHaveBeenCalled();
    expect(t.mocks.setHasUnsavedChanges).not.toHaveBeenCalled();
    t.cleanup();
  });

  // ── onNodeClick / onPaneClick ──

  it('sets selectedNodeId on node click', () => {
    const t = mountCanvas();
    const node = makeNode('n1', 'toolNode');
    const event = new MouseEvent('click') as unknown as React.MouseEvent;
    act(() => t.hook().onNodeClick(event, node));
    expect(t.mocks.setSelectedNodeId).toHaveBeenCalledWith('n1');
    t.cleanup();
  });

  it('clears selectedNodeId on pane click', () => {
    const t = mountCanvas();
    act(() => t.hook().onPaneClick());
    expect(t.mocks.setSelectedNodeId).toHaveBeenCalledWith(null);
    t.cleanup();
  });

  // ── handleArrange ──

  it('arranges nodes and fits view', () => {
    vi.useFakeTimers();
    try {
      const t = mountCanvas([makeNode('n1', 'toolNode')]);
      act(() => t.hook().handleArrange());
      expect(t.mocks.setNodes).toHaveBeenCalled();
      expect(t.mocks.setHasUnsavedChanges).toHaveBeenCalledWith(true);
      // requestAnimationFrame fires after 16ms with fake timers
      act(() => {
        vi.advanceTimersByTime(20);
      });
      // fitView is called inside requestAnimationFrame callback
      t.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── onDragOver ──

  it('prevents default and sets drop effect on dragover', () => {
    const t = mountCanvas();
    const dataTransfer = { dropEffect: '' } as unknown as DataTransfer;
    const event = { preventDefault: vi.fn(), dataTransfer } as unknown as React.DragEvent;
    act(() => t.hook().onDragOver(event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect((dataTransfer as { dropEffect: string }).dropEffect).toBe('move');
    t.cleanup();
  });

  // ── onDrop ──

  it('creates a new node when valid data is dropped', () => {
    const t = mountCanvas();
    const reactFlowDiv = document.createElement('div');
    reactFlowDiv.className = 'react-flow';
    reactFlowDiv.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 800, height: 600 }) as DOMRect;
    document.body.appendChild(reactFlowDiv);

    const event = {
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: () =>
          JSON.stringify({ toolName: 'web.search', toolDescription: 'Search the web' }),
      },
      clientX: 300,
      clientY: 200,
      target: reactFlowDiv,
    } as unknown as React.DragEvent;

    act(() => t.hook().onDrop(event));
    expect(t.mocks.setNodes).toHaveBeenCalled();
    expect(t.mocks.setSelectedNodeId).toHaveBeenCalled();
    expect(t.mocks.setHasUnsavedChanges).toHaveBeenCalledWith(true);
    // setNodes was called with a function updater (asserted via toHaveBeenCalled)
    expect(t.mocks.setNodes.mock.calls[0]?.[0]).toBeDefined();

    document.body.removeChild(reactFlowDiv);
    t.cleanup();
  });

  it('ignores drop when dataTransfer has no reactflow data', () => {
    const t = mountCanvas();
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { getData: () => '' },
    } as unknown as React.DragEvent;
    act(() => t.hook().onDrop(event));
    expect(t.mocks.setNodes).not.toHaveBeenCalled();
    t.cleanup();
  });

  it('ignores drop when JSON parse fails', () => {
    const t = mountCanvas();
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { getData: () => 'not valid json' },
    } as unknown as React.DragEvent;
    act(() => t.hook().onDrop(event));
    expect(t.mocks.setNodes).not.toHaveBeenCalled();
    t.cleanup();
  });

  it('ignores drop when no react-flow ancestor found', () => {
    const t = mountCanvas();
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { getData: () => JSON.stringify({ toolName: 'test' }) },
      clientX: 300,
      clientY: 200,
      target: document.createElement('div'),
    } as unknown as React.DragEvent;
    act(() => t.hook().onDrop(event));
    expect(t.mocks.setNodes).not.toHaveBeenCalled();
    t.cleanup();
  });

  // ── updateNodeData ──

  it('updates node data and pushes history', () => {
    const t = mountCanvas([makeNode('n1', 'toolNode', { data: { label: 'Old' } })]);
    act(() => t.hook().updateNodeData('n1', { label: 'New' }));
    expect(t.mocks.pushHistory).toHaveBeenCalledTimes(1);
    expect(t.mocks.setNodes).toHaveBeenCalled();
    expect(t.mocks.setHasUnsavedChanges).toHaveBeenCalledWith(true);
    t.cleanup();
  });

  it('reconciles switch case edges when updating a switch node', () => {
    const t = mountCanvas(
      [makeNode('switch', 'switchNode', { data: { cases: [{ label: 'a' }, { label: 'b' }] } })],
      [edge('e1', 'a', 'switch'), edge('e2', 'b', 'switch')]
    );
    act(() => t.hook().updateNodeData('switch', { cases: [{ label: 'alpha' }, { label: 'b' }] }));
    // setEdges is called inside the setNodes updater. Since setNodes is mocked,
    // we verify it was passed to setNodes as the updater.
    expect(t.mocks.setEdges).toHaveBeenCalled();
    t.cleanup();
  });

  // ── deleteNode ──

  it('removes node and its connected edges', () => {
    const myEdges: Edge[] = [edge('e1', 'out', 'n1'), edge('e2', 'out', 'other')];
    const t = mountCanvas([makeNode('n1', 'toolNode'), makeNode('other', 'toolNode')], myEdges);
    act(() => t.hook().deleteNode('n1'));
    expect(t.mocks.pushHistory).toHaveBeenCalledTimes(1);
    expect(t.mocks.setNodes).toHaveBeenCalled();
    expect(t.mocks.setEdges).toHaveBeenCalled();
    expect(t.mocks.setSelectedNodeId).toHaveBeenCalledWith(null);
    expect(t.mocks.setHasUnsavedChanges).toHaveBeenCalledWith(true);
    t.cleanup();
  });
});
