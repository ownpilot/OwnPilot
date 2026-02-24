import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 100;
const HORIZONTAL_GAP = 60;
const VERTICAL_GAP = 80;
const GRID_SIZE = 16;

/** Snap a value to the nearest grid increment. */
function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/**
 * Compute an automatic top-to-bottom DAG layout for the given nodes and edges
 * using the dagre graph layout algorithm.
 *
 * Returns a new array of nodes with updated positions — inputs are never mutated.
 */
export function autoArrangeNodes(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return [];

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    nodesep: HORIZONTAL_GAP,
    ranksep: VERTICAL_GAP,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    // dagre returns center coordinates — convert to top-left for ReactFlow
    return {
      ...node,
      position: {
        x: snapToGrid(pos.x - NODE_WIDTH / 2),
        y: snapToGrid(pos.y - NODE_HEIGHT / 2),
      },
    };
  });
}
