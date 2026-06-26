import { describe, expect, it } from 'vitest';
import type { WorkflowNode, NodeResult } from '../../db/repositories/workflows/index.js';
import {
  ApprovalPauseError,
  dryRunResult,
  executeWithRetryAndTimeout,
  nodeDataField,
  nodeDataRecord,
} from './workflow-dispatch.js';

function makeNode(data: Record<string, unknown> = {}): WorkflowNode {
  return {
    id: 'node-1',
    type: 'toolNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'Tool',
      toolName: 'demo_tool',
      toolArgs: {},
      ...data,
    },
  };
}

describe('workflow dispatch helpers', () => {
  it('reads dynamic node data fields through typed helpers', () => {
    const node = makeNode({ outputAlias: 'summary', retryCount: 2 });

    expect(nodeDataField(node, 'outputAlias')).toBe('summary');
    expect(nodeDataRecord(node).retryCount).toBe(2);
  });

  it('builds dry-run results without executing side effects', () => {
    const node = makeNode();
    const resolvedArgs = { query: 'hello' };

    const result = dryRunResult(node, resolvedArgs);

    expect(result).toMatchObject({
      nodeId: node.id,
      status: 'success',
      output: { dryRun: true, type: 'toolNode', resolvedArgs },
      resolvedArgs,
      durationMs: 0,
    });
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
  });

  it('marks successful execution with zero retry attempts', async () => {
    const node = makeNode();
    const expected: NodeResult = { nodeId: node.id, status: 'success', output: 'ok' };

    const result = await executeWithRetryAndTimeout(
      node,
      async () => expected,
      new AbortController().signal
    );

    expect(result).toBe(expected);
    expect(result.retryAttempts).toBe(0);
  });

  it('converts executor exceptions into node error results', async () => {
    const node = makeNode();

    const result = await executeWithRetryAndTimeout(
      node,
      async () => {
        throw new Error('tool exploded');
      },
      new AbortController().signal
    );

    expect(result).toMatchObject({
      nodeId: node.id,
      status: 'error',
      error: 'tool exploded',
      retryAttempts: 0,
    });
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
  });

  it('carries approval id on approval pause errors', () => {
    const error = new ApprovalPauseError('approval-1');

    expect(error.name).toBe('ApprovalPauseError');
    expect(error.message).toBe('Workflow paused for approval');
    expect(error.approvalId).toBe('approval-1');
  });
});
