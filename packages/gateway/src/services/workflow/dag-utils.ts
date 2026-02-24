/**
 * DAG utilities — Topological sort and graph traversal for workflow execution.
 */

import type { WorkflowNode, WorkflowEdge } from '../../db/repositories/workflows.js';

/**
 * Topological sort using Kahn's algorithm.
 * Returns an array of "levels" — each level contains node IDs that can run in parallel.
 * Throws if a cycle is detected.
 */
export function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[][] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const levels: string[][] = [];
  let queue = [...nodeIds].filter((id) => inDegree.get(id) === 0);
  let processed = 0;

  while (queue.length > 0) {
    levels.push([...queue]);
    processed += queue.length;

    const nextQueue: string[] = [];
    for (const nodeId of queue) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          nextQueue.push(neighbor);
        }
      }
    }
    queue = nextQueue;
  }

  if (processed < nodeIds.size) {
    throw new Error('Workflow contains a cycle — cannot execute');
  }

  return levels;
}

/**
 * Get all downstream node IDs reachable from a given node.
 */
export function getDownstreamNodes(nodeId: string, edges: WorkflowEdge[]): Set<string> {
  const downstream = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const edge of edges) {
      if (edge.source === current && !downstream.has(edge.target)) {
        downstream.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return downstream;
}

/**
 * Get all downstream node IDs reachable from a specific output handle of a node.
 * Used for conditional branching — to skip nodes on the not-taken branch.
 */
export function getDownstreamNodesByHandle(
  nodeId: string,
  handle: string,
  edges: WorkflowEdge[]
): Set<string> {
  const downstream = new Set<string>();
  const queue = edges
    .filter((e) => e.source === nodeId && e.sourceHandle === handle)
    .map((e) => e.target);

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (downstream.has(current)) continue;
    downstream.add(current);
    for (const edge of edges) {
      if (edge.source === current && !downstream.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }
  return downstream;
}

/**
 * Get body-only and done-only nodes for a ForEach node.
 * Body = nodes reachable from "each" handle but NOT from "done" handle.
 * Done = nodes reachable from "done" handle.
 */
export function getForEachBodyNodes(
  nodeId: string,
  edges: WorkflowEdge[]
): { bodyNodes: Set<string>; doneNodes: Set<string> } {
  const eachDownstream = getDownstreamNodesByHandle(nodeId, 'each', edges);
  const doneDownstream = getDownstreamNodesByHandle(nodeId, 'done', edges);

  const bodyNodes = new Set<string>();
  for (const id of eachDownstream) {
    if (!doneDownstream.has(id)) bodyNodes.add(id);
  }

  return { bodyNodes, doneNodes: doneDownstream };
}
