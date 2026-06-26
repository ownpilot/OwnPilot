import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '../../db/repositories/workflows/index.js';
import { nodeDataField, nodeDataRecord } from './node-data.js';

describe('workflow node data helpers', () => {
  it('reads generic fields from node data through the shared trust boundary', () => {
    const node = {
      id: 'node-1',
      data: {
        outputAlias: 'summary',
        retryCount: 2,
      },
    } as WorkflowNode;

    expect(nodeDataField(node, 'outputAlias')).toBe('summary');
    expect(nodeDataRecord(node).retryCount).toBe(2);
  });
});
