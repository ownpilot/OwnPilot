import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';

import { serializeWorkflowCanvas } from './workflowPersistence';

function makeNode(type: string, data: Record<string, unknown>, id = type): Node {
  return {
    id,
    type,
    position: { x: 10, y: 20 },
    data,
  };
}

describe('serializeWorkflowCanvas', () => {
  it('normalizes advanced node data before save', () => {
    const nodes: Node[] = [
      makeNode(
        'schemaValidatorNode',
        {
          label: 'Validate',
          schema: '{"type":"object"}',
          strictMode: true,
          outputAlias: 'validated',
        },
        'validate'
      ),
      makeNode(
        'webhookResponseNode',
        {
          label: 'Reply',
          statusCode: 201,
          body: '{"ok":true}',
          headers: 'Content-Type: application/json\nX-Trace: abc',
        },
        'reply'
      ),
      makeNode(
        'filterNode',
        {
          label: 'Filter',
          arrayExpression: '{{validate.output.items}}',
          condition: 'item.active',
          retryCount: 2,
        },
        'filter'
      ),
    ];
    const edges: Edge[] = [
      {
        id: 'edge_validate_reply',
        source: 'validate',
        target: 'reply',
        sourceHandle: 'success',
        targetHandle: 'input',
      },
    ];

    const serialized = serializeWorkflowCanvas(nodes, edges);

    expect(serialized.nodes[0]).toMatchObject({
      id: 'validate',
      type: 'schemaValidatorNode',
      data: {
        label: 'Validate',
        schema: { type: 'object' },
        strict: true,
        outputAlias: 'validated',
      },
    });
    expect(serialized.nodes[1]).toMatchObject({
      id: 'reply',
      type: 'webhookResponseNode',
      data: {
        statusCode: 201,
        body: '{"ok":true}',
        headers: {
          'Content-Type': 'application/json',
          'X-Trace': 'abc',
        },
      },
    });
    expect(serialized.nodes[2]).toMatchObject({
      type: 'filterNode',
      data: {
        arrayExpression: '{{validate.output.items}}',
        condition: 'item.active',
        retryCount: 2,
      },
    });
    expect(serialized.edges).toEqual([
      {
        id: 'edge_validate_reply',
        source: 'validate',
        target: 'reply',
        sourceHandle: 'success',
        targetHandle: 'input',
      },
    ]);
  });

  it('keeps tool node data in persisted workflow format', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('toolNode', {
          label: 'Search',
          toolName: 'web.search',
          toolArgs: { q: 'ownpilot' },
          outputAlias: 'results',
        }),
      ],
      []
    );

    expect(serialized.nodes[0]).toMatchObject({
      type: 'toolNode',
      data: {
        label: 'Search',
        toolName: 'web.search',
        toolArgs: { q: 'ownpilot' },
        outputAlias: 'results',
      },
    });
  });

  it('omits key for dataStore list operations', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('dataStoreNode', {
          label: 'List Keys',
          operation: 'list',
          namespace: 'reports',
        }),
      ],
      []
    );

    expect(serialized.nodes[0]).toMatchObject({
      type: 'dataStoreNode',
      data: {
        label: 'List Keys',
        operation: 'list',
        namespace: 'reports',
      },
    });
    expect(serialized.nodes[0]!.data).not.toHaveProperty('key');
  });
});
