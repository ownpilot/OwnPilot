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

describe('autoArrangeNodes node size estimation', () => {
  it('calculates large node sizes for llmNode with all fields', () => {
    const node = makeNode('llm', 0, 0, {
      systemPrompt: 'prompt',
      userMessage: 'msg',
      temperature: 0.7,
      responseFormat: 'json',
    });
    node.type = 'llmNode';
    const result = autoArrangeNodes([node], []);
    expect(result[0]!.position.x).toBeGreaterThanOrEqual(0);
  });

  it('calculates httpRequestNode with url and auth', () => {
    const node = makeNode('http', 0, 0, { url: 'https://api.test', auth: { bearer: 'x' } });
    node.type = 'httpRequestNode';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });

  it('calculates codeNode with multi-line code', () => {
    const node = makeNode('code', 0, 0, { code: 'a\nb\nc\nd\ne' });
    node.type = 'codeNode';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });

  it('calculates switchNode with many cases', () => {
    const node = makeNode('sw', 0, 0, { cases: ['a', 'b', 'c', 'd', 'e', 'f'] });
    node.type = 'switchNode';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });

  it('calculates subWorkflowNode with input mapping', () => {
    const node = makeNode('sub', 0, 0, { inputMapping: { a: 'x', b: 'y', c: 'z' } });
    node.type = 'subWorkflowNode';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });

  it('calculates schemaValidatorNode with schema properties', () => {
    const node = makeNode('sv', 0, 0, { schema: { properties: { a: {}, b: {}, c: {} } } });
    node.type = 'schemaValidatorNode';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });

  it('calculates toolNode with args and description', () => {
    const node = makeNode('tool', 0, 0, { toolArgs: { url: 'x' }, description: 'desc' });
    node.type = 'toolNode';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });

  it('calculates parallelNode with branch count', () => {
    const node = makeNode('par', 0, 0, { branchCount: 4 });
    node.type = 'parallelNode';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });

  it('calculates stickyNoteNode with multi-line text', () => {
    const node = makeNode('note', 0, 0, { text: 'a\nb\nc\nd\ne\nf' });
    node.type = 'stickyNoteNode';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });

  it('calculates notificationNode without message', () => {
    const node = makeNode('notif', 0, 0, {});
    node.type = 'notificationNode';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });

  it('calculates default node size for unknown type', () => {
    const node = makeNode('unk', 0, 0, {});
    node.type = 'unknownNodeType';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });

  it('calculates subWorkflowNode without input mapping', () => {
    const node = makeNode('sub', 0, 0, {});
    node.type = 'subWorkflowNode';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });

  it('calculates schemaValidatorNode without schema', () => {
    const node = makeNode('sv', 0, 0, {});
    node.type = 'schemaValidatorNode';
    const result = autoArrangeNodes([node], []);
    expect(Number.isFinite(result[0]!.position.x)).toBe(true);
  });
});
