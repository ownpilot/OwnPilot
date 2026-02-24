/**
 * Tests for dag-utils.ts — graph traversal utilities for workflow execution.
 *
 * Covers:
 * - topologicalSort: Kahn's algorithm, parallel levels, cycle detection
 * - getDownstreamNodes: BFS traversal from a node
 * - getDownstreamNodesByHandle: handle-filtered BFS traversal
 * - getForEachBodyNodes: body vs done node partitioning
 */

import { describe, it, expect } from 'vitest';
import type { WorkflowNode, WorkflowEdge } from '../../db/repositories/workflows.js';

import {
  topologicalSort,
  getDownstreamNodes,
  getDownstreamNodesByHandle,
  getForEachBodyNodes,
} from './dag-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, type = 'toolNode'): WorkflowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { toolName: 'test', toolArgs: {}, label: id },
  };
}

function makeEdge(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string
): WorkflowEdge {
  return { id: `${source}-${target}`, source, target, sourceHandle, targetHandle };
}

// ============================================================================
// topologicalSort
// ============================================================================

describe('topologicalSort', () => {
  it('returns empty array for empty nodes', () => {
    expect(topologicalSort([], [])).toEqual([]);
  });

  it('returns single level for a single node', () => {
    const levels = topologicalSort([makeNode('A')], []);
    expect(levels).toEqual([['A']]);
  });

  it('sorts linear chain into sequential levels', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    expect(topologicalSort(nodes, edges)).toEqual([['A'], ['B'], ['C']]);
  });

  it('places parallel nodes on the same level', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeEdge('A', 'C'), makeEdge('B', 'C')];
    const levels = topologicalSort(nodes, edges);
    expect(levels).toHaveLength(2);
    expect(levels[0]).toContain('A');
    expect(levels[0]).toContain('B');
    expect(levels[1]).toEqual(['C']);
  });

  it('handles diamond pattern', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')];
    const edges = [makeEdge('A', 'B'), makeEdge('A', 'C'), makeEdge('B', 'D'), makeEdge('C', 'D')];
    const levels = topologicalSort(nodes, edges);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toEqual(['A']);
    expect(levels[1]).toHaveLength(2);
    expect(levels[2]).toEqual(['D']);
  });

  it('throws on cycle', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C'), makeEdge('C', 'A')];
    expect(() => topologicalSort(nodes, edges)).toThrow('Workflow contains a cycle');
  });

  it('throws on self-loop', () => {
    const nodes = [makeNode('A')];
    const edges = [makeEdge('A', 'A')];
    expect(() => topologicalSort(nodes, edges)).toThrow('Workflow contains a cycle');
  });

  it('ignores edges referencing non-existent nodes', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('X', 'Y')];
    expect(topologicalSort(nodes, edges)).toEqual([['A'], ['B']]);
  });

  it('ignores edges where only source exists', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('A', 'NONEXISTENT')];
    const levels = topologicalSort(nodes, edges);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toContain('A');
    expect(levels[0]).toContain('B');
  });

  it('ignores edges where only target exists', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('NONEXISTENT', 'A')];
    const levels = topologicalSort(nodes, edges);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toHaveLength(2);
  });

  it('handles disconnected components', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')];
    const edges = [makeEdge('A', 'B'), makeEdge('C', 'D')];
    const levels = topologicalSort(nodes, edges);
    expect(levels).toHaveLength(2);
    expect(levels[0]).toContain('A');
    expect(levels[0]).toContain('C');
    expect(levels[1]).toContain('B');
    expect(levels[1]).toContain('D');
  });

  it('handles duplicate edges', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('A', 'B')];
    const levels = topologicalSort(nodes, edges);
    expect(levels).toEqual([['A'], ['B']]);
  });

  it('throws on two-node cycle', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'A')];
    expect(() => topologicalSort(nodes, edges)).toThrow('Workflow contains a cycle');
  });

  it('handles long linear chain', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `n${i}`);
    const nodes = ids.map((id) => makeNode(id));
    const edges = ids.slice(0, -1).map((id, i) => makeEdge(id, ids[i + 1]!));
    const levels = topologicalSort(nodes, edges);
    expect(levels).toHaveLength(10);
    levels.forEach((level, i) => {
      expect(level).toEqual([ids[i]]);
    });
  });

  it('handles wide parallel graph: multiple roots to multiple sinks', () => {
    const nodes = 'ABCDE'.split('').map((id) => makeNode(id));
    const edges = [makeEdge('A', 'D'), makeEdge('B', 'D'), makeEdge('B', 'E'), makeEdge('C', 'E')];
    const levels = topologicalSort(nodes, edges);
    expect(levels).toHaveLength(2);
    expect(levels[0]).toHaveLength(3);
    expect(levels[1]).toHaveLength(2);
  });
});

// ============================================================================
// getDownstreamNodes
// ============================================================================

describe('getDownstreamNodes', () => {
  it('returns empty set when node has no outgoing edges', () => {
    const edges = [makeEdge('A', 'B')];
    const downstream = getDownstreamNodes('B', edges);
    expect(downstream.size).toBe(0);
  });

  it('returns empty set when there are no edges at all', () => {
    const downstream = getDownstreamNodes('A', []);
    expect(downstream.size).toBe(0);
  });

  it('returns direct child for single edge', () => {
    const edges = [makeEdge('A', 'B')];
    const downstream = getDownstreamNodes('A', edges);
    expect(downstream).toEqual(new Set(['B']));
  });

  it('returns all transitive downstream nodes', () => {
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C'), makeEdge('C', 'D')];
    const downstream = getDownstreamNodes('A', edges);
    expect(downstream).toEqual(new Set(['B', 'C', 'D']));
  });

  it('returns all downstream in branching graph', () => {
    // A -> B, A -> C, B -> D, C -> D
    const edges = [makeEdge('A', 'B'), makeEdge('A', 'C'), makeEdge('B', 'D'), makeEdge('C', 'D')];
    const downstream = getDownstreamNodes('A', edges);
    expect(downstream).toEqual(new Set(['B', 'C', 'D']));
  });

  it('does not include the starting node itself', () => {
    const edges = [makeEdge('A', 'B')];
    const downstream = getDownstreamNodes('A', edges);
    expect(downstream.has('A')).toBe(false);
  });

  it('handles diamond with no duplicates', () => {
    // A -> B, A -> C, B -> D, C -> D
    const edges = [makeEdge('A', 'B'), makeEdge('A', 'C'), makeEdge('B', 'D'), makeEdge('C', 'D')];
    const downstream = getDownstreamNodes('A', edges);
    // D should only appear once
    expect([...downstream].filter((id) => id === 'D')).toHaveLength(1);
  });

  it('returns downstream from a mid-graph node', () => {
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C'), makeEdge('C', 'D')];
    const downstream = getDownstreamNodes('B', edges);
    expect(downstream).toEqual(new Set(['C', 'D']));
    expect(downstream.has('A')).toBe(false);
  });

  it('returns empty set for unknown node', () => {
    const edges = [makeEdge('A', 'B')];
    const downstream = getDownstreamNodes('Z', edges);
    expect(downstream.size).toBe(0);
  });

  it('handles multiple children', () => {
    const edges = [makeEdge('A', 'B'), makeEdge('A', 'C'), makeEdge('A', 'D')];
    const downstream = getDownstreamNodes('A', edges);
    expect(downstream).toEqual(new Set(['B', 'C', 'D']));
  });
});

// ============================================================================
// getDownstreamNodesByHandle
// ============================================================================

describe('getDownstreamNodesByHandle', () => {
  it('returns empty set when no edges match the handle', () => {
    const edges = [makeEdge('A', 'B', 'true'), makeEdge('A', 'C', 'false')];
    const downstream = getDownstreamNodesByHandle('A', 'other', edges);
    expect(downstream.size).toBe(0);
  });

  it('returns nodes downstream of the "true" handle only', () => {
    const edges = [
      makeEdge('cond', 'trueNode', 'true'),
      makeEdge('cond', 'falseNode', 'false'),
      makeEdge('trueNode', 'afterTrue'),
    ];
    const downstream = getDownstreamNodesByHandle('cond', 'true', edges);
    expect(downstream).toEqual(new Set(['trueNode', 'afterTrue']));
    expect(downstream.has('falseNode')).toBe(false);
  });

  it('returns nodes downstream of the "false" handle only', () => {
    const edges = [
      makeEdge('cond', 'trueNode', 'true'),
      makeEdge('cond', 'falseNode', 'false'),
      makeEdge('falseNode', 'afterFalse'),
    ];
    const downstream = getDownstreamNodesByHandle('cond', 'false', edges);
    expect(downstream).toEqual(new Set(['falseNode', 'afterFalse']));
    expect(downstream.has('trueNode')).toBe(false);
  });

  it('returns empty set when node has no outgoing edges', () => {
    const edges = [makeEdge('A', 'B', 'true')];
    const downstream = getDownstreamNodesByHandle('B', 'true', edges);
    expect(downstream.size).toBe(0);
  });

  it('returns empty set for unknown node', () => {
    const edges = [makeEdge('A', 'B', 'true')];
    const downstream = getDownstreamNodesByHandle('Z', 'true', edges);
    expect(downstream.size).toBe(0);
  });

  it('follows transitive edges from handle descendants', () => {
    // cond -> trueChild (via 'true' handle)
    // trueChild -> grandChild (no handle)
    // grandChild -> greatGrandChild (no handle)
    const edges = [
      makeEdge('cond', 'trueChild', 'true'),
      makeEdge('trueChild', 'grandChild'),
      makeEdge('grandChild', 'greatGrandChild'),
    ];
    const downstream = getDownstreamNodesByHandle('cond', 'true', edges);
    expect(downstream).toEqual(new Set(['trueChild', 'grandChild', 'greatGrandChild']));
  });

  it('handles edges without sourceHandle (undefined handle)', () => {
    const edges = [makeEdge('A', 'B'), makeEdge('A', 'C', 'true')];
    const downstream = getDownstreamNodesByHandle('A', 'true', edges);
    expect(downstream).toEqual(new Set(['C']));
    expect(downstream.has('B')).toBe(false);
  });

  it('does not revisit already visited nodes (avoids infinite loop on shared descendants)', () => {
    // cond -> A (true), cond -> B (false)
    // A -> C, B -> C (C is shared but we only start from one handle)
    const edges = [
      makeEdge('cond', 'A', 'true'),
      makeEdge('cond', 'B', 'false'),
      makeEdge('A', 'C'),
      makeEdge('B', 'C'),
    ];
    const downstream = getDownstreamNodesByHandle('cond', 'true', edges);
    expect(downstream).toEqual(new Set(['A', 'C']));
  });
});

// ============================================================================
// getForEachBodyNodes
// ============================================================================

describe('getForEachBodyNodes', () => {
  it('returns empty sets when forEach has no outgoing edges', () => {
    const { bodyNodes, doneNodes } = getForEachBodyNodes('fe', []);
    expect(bodyNodes.size).toBe(0);
    expect(doneNodes.size).toBe(0);
  });

  it('separates body nodes (each handle) from done nodes (done handle)', () => {
    const edges = [
      makeEdge('fe', 'bodyA', 'each'),
      makeEdge('fe', 'doneA', 'done'),
      makeEdge('bodyA', 'bodyB'),
    ];
    const { bodyNodes, doneNodes } = getForEachBodyNodes('fe', edges);
    expect(bodyNodes).toEqual(new Set(['bodyA', 'bodyB']));
    expect(doneNodes).toEqual(new Set(['doneA']));
  });

  it('excludes shared nodes from bodyNodes (nodes reachable from both handles)', () => {
    // forEach -> bodyNode (each), forEach -> doneNode (done)
    // bodyNode -> shared, doneNode -> shared
    const edges = [
      makeEdge('fe', 'bodyNode', 'each'),
      makeEdge('fe', 'doneNode', 'done'),
      makeEdge('bodyNode', 'shared'),
      makeEdge('doneNode', 'shared'),
    ];
    const { bodyNodes, doneNodes } = getForEachBodyNodes('fe', edges);
    // 'shared' is reachable from both, so it's in doneNodes (and excluded from bodyNodes)
    expect(bodyNodes).toEqual(new Set(['bodyNode']));
    expect(doneNodes).toEqual(new Set(['doneNode', 'shared']));
  });

  it('handles forEach with only each handle edges', () => {
    const edges = [makeEdge('fe', 'bodyA', 'each'), makeEdge('bodyA', 'bodyB')];
    const { bodyNodes, doneNodes } = getForEachBodyNodes('fe', edges);
    expect(bodyNodes).toEqual(new Set(['bodyA', 'bodyB']));
    expect(doneNodes.size).toBe(0);
  });

  it('handles forEach with only done handle edges', () => {
    const edges = [makeEdge('fe', 'doneA', 'done'), makeEdge('doneA', 'doneB')];
    const { bodyNodes, doneNodes } = getForEachBodyNodes('fe', edges);
    expect(bodyNodes.size).toBe(0);
    expect(doneNodes).toEqual(new Set(['doneA', 'doneB']));
  });

  it('handles deep chain from each handle', () => {
    const edges = [
      makeEdge('fe', 'b1', 'each'),
      makeEdge('b1', 'b2'),
      makeEdge('b2', 'b3'),
      makeEdge('b3', 'b4'),
    ];
    const { bodyNodes, doneNodes } = getForEachBodyNodes('fe', edges);
    expect(bodyNodes).toEqual(new Set(['b1', 'b2', 'b3', 'b4']));
    expect(doneNodes.size).toBe(0);
  });
});
