import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { autoArrangeNodes } from './auto-arrange';

function makeNode(id: string, x = 0, y = 0, data: Record<string, unknown> = {}): Node {
  return { id, type: 'toolNode', position: { x, y }, data: { label: id, ...data } };
}

function makeEdge(source: string, target: string): Edge {
  return { id: `${source}->${target}`, source, target };
}

describe('autoArrangeNodes', () => {
  it('returns empty array for empty input', () => {
    expect(autoArrangeNodes([], [])).toEqual([]);
  });

  it('returns valid position for a single node', () => {
    const nodes = [makeNode('a')];
    const result = autoArrangeNodes(nodes, []);

    expect(result).toHaveLength(1);
    expect(result[0]!.position.x).toBeGreaterThanOrEqual(0);
    expect(result[0]!.position.y).toBeGreaterThanOrEqual(0);
  });

  it('snaps all positions to 16px grid', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const result = autoArrangeNodes(nodes, edges);

    for (const node of result) {
      expect(node.position.x % 16).toBe(0);
      expect(node.position.y % 16).toBe(0);
    }
  });

  it('arranges linear chain top-to-bottom', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const result = autoArrangeNodes(nodes, edges);

    const [a, b, c] = result as [Node, Node, Node];
    expect(a.position.y).toBeLessThan(b.position.y);
    expect(b.position.y).toBeLessThan(c.position.y);
  });

  it('places branch children side by side below parent', () => {
    // a -> b (true), a -> c (false)
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'b'), makeEdge('a', 'c')];
    const result = autoArrangeNodes(nodes, edges);

    const a = result.find((n) => n.id === 'a')!;
    const b = result.find((n) => n.id === 'b')!;
    const c = result.find((n) => n.id === 'c')!;

    // Both children below parent
    expect(b.position.y).toBeGreaterThan(a.position.y);
    expect(c.position.y).toBeGreaterThan(a.position.y);

    // Children at same rank (same y)
    expect(b.position.y).toBe(c.position.y);

    // Children at different x positions
    expect(b.position.x).not.toBe(c.position.x);
  });

  it('handles diamond (converging) pattern correctly', () => {
    // a -> b, a -> c, b -> d, c -> d
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
    const edges = [makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('b', 'd'), makeEdge('c', 'd')];
    const result = autoArrangeNodes(nodes, edges);

    const a = result.find((n) => n.id === 'a')!;
    const b = result.find((n) => n.id === 'b')!;
    const d = result.find((n) => n.id === 'd')!;

    expect(a.position.y).toBeLessThan(b.position.y);
    expect(b.position.y).toBeLessThan(d.position.y);
  });

  it('assigns valid positions to disconnected subgraphs', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('x'), makeNode('y')];
    const edges = [makeEdge('a', 'b'), makeEdge('x', 'y')];
    const result = autoArrangeNodes(nodes, edges);

    expect(result).toHaveLength(4);
    for (const node of result) {
      expect(typeof node.position.x).toBe('number');
      expect(typeof node.position.y).toBe('number');
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
  });

  it('preserves node data and type without mutation', () => {
    const original = makeNode('a', 100, 200, { toolName: 'my_tool', custom: true });
    const originalCopy = { ...original, position: { ...original.position } };
    const result = autoArrangeNodes([original], []);

    // Data and type preserved
    expect(result[0]!.data).toEqual(original.data);
    expect(result[0]!.type).toBe('toolNode');
    expect(result[0]!.id).toBe('a');

    // Original not mutated
    expect(original.position).toEqual(originalCopy.position);
  });
});
