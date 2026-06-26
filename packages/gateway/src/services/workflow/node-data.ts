import type { WorkflowNode } from '../../db/repositories/workflows/index.js';

/**
 * Read a generic field off a WorkflowNode's data. WorkflowNodeData is a
 * discriminated union (one variant per node type), and many call sites need
 * to read a field that is not present on every variant (outputAlias, url,
 * method, continueOnSuccess, branchCount, ...). This helper makes the
 * runtime field read type-safe.
 *
 * Trust boundary: node.data comes from the DB (workflow_nodes table), which
 * is validated at save time by the workflow route handler.
 */
export function nodeDataField(node: WorkflowNode, field: string): unknown {
  return nodeDataRecord(node)[field];
}

/**
 * Variant of nodeDataField for call sites that need to read several
 * unrelated fields off node.data in one block.
 */
export function nodeDataRecord(node: WorkflowNode): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node.data));
}
