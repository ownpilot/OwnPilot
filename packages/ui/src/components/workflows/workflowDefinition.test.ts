import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';

import { buildWorkflowDefinition } from './workflowDefinition';

function makeNode(type: string, data: Record<string, unknown>, id = type): Node {
  return {
    id,
    type,
    position: { x: 10.4, y: 20.6 },
    data,
  };
}

function getExportedNode(definition: ReturnType<typeof buildWorkflowDefinition>, type: string) {
  const node = definition.nodes.find((item) => item.type === type);
  expect(node).toBeTruthy();
  return node!;
}

describe('buildWorkflowDefinition', () => {
  it('exports advanced workflow nodes as portable definitions', () => {
    const nodes: Node[] = [
      makeNode(
        'schemaValidatorNode',
        {
          label: 'Validate',
          schema: '{"type":"object","required":["id"]}',
          strict: true,
          outputAlias: 'validated',
        },
        'validate'
      ),
      makeNode(
        'filterNode',
        {
          label: 'Filter',
          arrayExpression: '{{validated.items}}',
          condition: 'item.active',
        },
        'filter'
      ),
      makeNode(
        'mapNode',
        {
          label: 'Map',
          arrayExpression: '{{filter.output}}',
          expression: '({ id: item.id })',
        },
        'map'
      ),
      makeNode(
        'aggregateNode',
        {
          label: 'Count',
          arrayExpression: '{{map.output}}',
          operation: 'count',
        },
        'aggregate'
      ),
      makeNode(
        'dataStoreNode',
        {
          label: 'Store',
          operation: 'set',
          key: 'latest',
          value: '{{aggregate.output}}',
        },
        'store'
      ),
      makeNode(
        'webhookResponseNode',
        {
          label: 'Reply',
          statusCode: 202,
          body: '{"ok":true}',
          headers: 'Content-Type: application/json\r\nX-Trace: abc',
        },
        'reply'
      ),
    ];
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'validate',
        target: 'filter',
        sourceHandle: 'success',
        targetHandle: 'input',
      },
    ];

    const definition = buildWorkflowDefinition('Portable', nodes, edges, { apiToken: 'token_ref' });

    expect(getExportedNode(definition, 'schemaValidator')).toMatchObject({
      id: 'validate',
      label: 'Validate',
      schema: { type: 'object', required: ['id'] },
      strict: true,
      outputAlias: 'validated',
      position: { x: 10, y: 21 },
    });
    expect(getExportedNode(definition, 'filter')).toMatchObject({
      arrayExpression: '{{validated.items}}',
      condition: 'item.active',
    });
    expect(getExportedNode(definition, 'map')).toMatchObject({
      arrayExpression: '{{filter.output}}',
      expression: '({ id: item.id })',
    });
    expect(getExportedNode(definition, 'aggregate')).toMatchObject({
      arrayExpression: '{{map.output}}',
      operation: 'count',
    });
    expect(getExportedNode(definition, 'dataStore')).toMatchObject({
      operation: 'set',
      key: 'latest',
      value: '{{aggregate.output}}',
    });
    expect(getExportedNode(definition, 'webhookResponse')).toMatchObject({
      statusCode: 202,
      body: '{"ok":true}',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace': 'abc',
      },
    });
    expect(definition.edges).toEqual([
      { source: 'validate', target: 'filter', sourceHandle: 'success', targetHandle: 'input' },
    ]);
    expect(definition.variables).toEqual({ apiToken: 'token_ref' });
  });

  it('keeps regular tool nodes in tool format', () => {
    const definition = buildWorkflowDefinition('Tools', [
      makeNode('toolNode', {
        label: 'Search',
        toolName: 'web.search',
        toolArgs: { q: 'ownpilot' },
      }),
    ]);

    expect(definition.nodes[0]).toMatchObject({
      tool: 'web.search',
      label: 'Search',
      args: { q: 'ownpilot' },
    });
  });
});
