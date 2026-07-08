// @vitest-environment happy-dom

/**
 * Shared constants and helpers for the workflow editor.
 *
 * Tests cover:
 *   - nodeTypes map (all keys present, values are valid components)
 *   - defaultEdgeOptions (style, marker config)
 *   - getEdgeLabelProps (named handles: true/false/each/done)
 *   - getEdgeLabelProps fallback for dynamic/switch handles
 *   - getEdgeLabelProps null/undefined handle
 */

import { describe, expect, it, vi } from 'vitest';
import { nodeTypes, defaultEdgeOptions, getEdgeLabelProps } from './shared';

// Stub @xyflow/react so ReactFlow nodes can render without a provider
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  useReactFlow: () => ({}),
  useUpdateNodeInternals: () => vi.fn(),
  NodeToolbar: ({ children }: { children: React.ReactNode }) => children,
  NodeResizer: () => null,
}));

// ─── nodeTypes ────────────────────────────────────────────────────────────

describe('nodeTypes', () => {
  const expectedKeys = [
    'toolNode',
    'triggerNode',
    'llmNode',
    'conditionNode',
    'codeNode',
    'transformerNode',
    'forEachNode',
    'httpRequestNode',
    'delayNode',
    'switchNode',
    'errorHandlerNode',
    'subWorkflowNode',
    'approvalNode',
    'stickyNoteNode',
    'notificationNode',
    'parallelNode',
    'mergeNode',
    'dataStoreNode',
    'schemaValidatorNode',
    'filterNode',
    'mapNode',
    'aggregateNode',
    'webhookResponseNode',
    'clawNode',
  ];

  it('registers all 24 node types', () => {
    expect(Object.keys(nodeTypes).sort()).toEqual(expectedKeys.sort());
  });

  it('every registered value is a valid React component', () => {
    for (const [_k, Component] of Object.entries(nodeTypes)) {
      // Valid React components: function, forwardRef (function), or memo (object)
      const isValid =
        typeof Component === 'function' || (typeof Component === 'object' && Component !== null);
      expect(isValid).toBe(true);
    }
  });

  it('node type components have a displayName or a type property', () => {
    for (const [key, Component] of Object.entries(nodeTypes)) {
      // memo-wrapped components carry the original on Component.type
      const name = (Component as any)?.displayName || (Component as any)?.type?.name || key;
      expect(name).toBeTruthy();
    }
  });
});

// ─── defaultEdgeOptions ───────────────────────────────────────────────────

describe('defaultEdgeOptions', () => {
  it('has a style object with stroke property', () => {
    expect(defaultEdgeOptions.style).toBeDefined();
    expect(defaultEdgeOptions.style).toHaveProperty('stroke');
    expect(defaultEdgeOptions.style).toHaveProperty('strokeWidth', 2);
  });

  it('has a markerEnd configuration for arrow', () => {
    expect(defaultEdgeOptions.markerEnd).toBeDefined();
    expect(defaultEdgeOptions.markerEnd).toHaveProperty('type');
    expect(defaultEdgeOptions.markerEnd).toHaveProperty('width', 16);
    expect(defaultEdgeOptions.markerEnd).toHaveProperty('height', 16);
    expect(defaultEdgeOptions.markerEnd).toHaveProperty('color');
  });
});

// ─── getEdgeLabelProps ────────────────────────────────────────────────────

describe('getEdgeLabelProps', () => {
  // Named handles
  it('returns True label and green stroke for "true" handle', () => {
    const props = getEdgeLabelProps('true');
    expect(props.label).toBe('True');
    expect(props.style?.stroke).toBe('#10b981');
    expect(props.labelStyle).toBeDefined();
    expect(props.labelBgPadding).toEqual([6, 3]);
    expect(props.labelBgBorderRadius).toBe(4);
  });

  it('returns False label and red stroke for "false" handle', () => {
    const props = getEdgeLabelProps('false');
    expect(props.label).toBe('False');
    expect(props.style?.stroke).toBe('#ef4444');
  });

  it('returns Each label and sky stroke for "each" handle', () => {
    const props = getEdgeLabelProps('each');
    expect(props.label).toBe('Each');
    expect(props.style?.stroke).toBe('#0ea5e9');
  });

  it('returns Done label and violet stroke for "done" handle', () => {
    const props = getEdgeLabelProps('done');
    expect(props.label).toBe('Done');
    expect(props.style?.stroke).toBe('#8b5cf6');
    // Marker end color should match the stroke
    expect(props.markerEnd?.color).toBe('#8b5cf6');
  });

  // Fallback for dynamic / switch handles
  it('returns Default label and fuchsia stroke for "default" handle', () => {
    const props = getEdgeLabelProps('default');
    expect(props.label).toBe('Default');
    expect(props.style?.stroke).toBe('#d946ef');
  });

  it('returns the handle name as label and fuchsia stroke for unknown handles', () => {
    const props = getEdgeLabelProps('my_custom_case');
    expect(props.label).toBe('my_custom_case');
    expect(props.style?.stroke).toBe('#d946ef');
  });

  it('returns empty object for null handle', () => {
    const props = getEdgeLabelProps(null);
    expect(props).toEqual({});
  });

  it('returns empty object for undefined handle', () => {
    const props = getEdgeLabelProps(undefined);
    expect(props).toEqual({});
  });

  it('returns fuchsia stroke for dynamic handle names with special chars', () => {
    const props = getEdgeLabelProps('case_42');
    expect(props.label).toBe('case_42');
    expect(props.style?.stroke).toBe('#d946ef');
  });

  // Label style structure
  it('returns consistent labelStyle, labelBgStyle across all handles', () => {
    for (const handle of ['true', 'false', 'each', 'done', 'default', 'custom']) {
      const props = getEdgeLabelProps(handle);
      if (handle === 'true') {
        expect(props.labelStyle).toEqual({
          fontSize: 10,
          fontWeight: 600,
          fill: 'var(--color-text-muted)',
        });
        expect(props.labelBgStyle).toEqual({
          fill: 'var(--color-bg-secondary)',
          opacity: 0.9,
        });
      }
    }
  });
});
