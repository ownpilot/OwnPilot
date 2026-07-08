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

  it('serializes claw nodes with their agent config', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('clawNode', {
          label: 'Research Agent',
          name: 'Market Research',
          mission: 'Research the topic',
          mode: 'single-shot',
          sandbox: 'auto',
          waitForCompletion: true,
          timeoutMs: 600000,
          outputAlias: 'research',
        }),
      ],
      []
    );

    expect(serialized.nodes[0]).toMatchObject({
      type: 'clawNode',
      data: {
        label: 'Research Agent',
        name: 'Market Research',
        mission: 'Research the topic',
        mode: 'single-shot',
        sandbox: 'auto',
        waitForCompletion: true,
        timeoutMs: 600000,
        outputAlias: 'research',
      },
    });
  });

  // ── Additional node types ──

  it('serializes triggerNode with all fields', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('triggerNode', {
          triggerType: 'webhook',
          label: 'Webhook Trigger',
          webhookPath: '/hook/test',
          webhookSecret: 'secret123',
          cron: '',
          eventType: '',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'triggerNode',
      data: {
        triggerType: 'webhook',
        label: 'Webhook Trigger',
        webhookPath: '/hook/test',
        webhookSecret: 'secret123',
      },
    });
    // cron and eventType should not appear (empty strings are filtered)
    expect(serialized.nodes[0]!.data).not.toHaveProperty('cron');
    expect(serialized.nodes[0]!.data).not.toHaveProperty('eventType');
  });

  it('serializes llmNode with all fields', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('llmNode', {
          label: 'Chat',
          provider: 'openai',
          model: 'gpt-4',
          systemPrompt: 'You are helpful',
          userMessage: 'Hello',
          temperature: 0.7,
          maxTokens: 2000,
          apiKey: 'sk-xxx',
          baseUrl: 'https://api.openai.com',
          retryCount: 3,
          timeoutMs: 30000,
          outputAlias: 'response',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'llmNode',
      data: {
        label: 'Chat',
        provider: 'openai',
        model: 'gpt-4',
        systemPrompt: 'You are helpful',
        userMessage: 'Hello',
        temperature: 0.7,
        maxTokens: 2000,
        apiKey: 'sk-xxx',
        baseUrl: 'https://api.openai.com',
        retryCount: 3,
        timeoutMs: 30000,
        outputAlias: 'response',
      },
    });
  });

  it('serializes conditionNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('conditionNode', {
          label: 'Check',
          expression: 'x > 10',
          description: 'Validate condition',
          outputAlias: 'result',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'conditionNode',
      data: {
        label: 'Check',
        expression: 'x > 10',
        description: 'Validate condition',
        outputAlias: 'result',
      },
    });
  });

  it('serializes codeNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('codeNode', {
          label: 'Transform',
          language: 'javascript',
          code: 'return data * 2;',
          description: 'Double the input',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'codeNode',
      data: {
        label: 'Transform',
        language: 'javascript',
        code: 'return data * 2;',
        description: 'Double the input',
      },
    });
  });

  it('serializes transformerNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('transformerNode', {
          label: 'Map',
          expression: 'item * 2',
          description: 'Double each item',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'transformerNode',
      data: { label: 'Map', expression: 'item * 2', description: 'Double each item' },
    });
  });

  it('serializes forEachNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('forEachNode', {
          label: 'Loop',
          arrayExpression: 'items',
          itemVariable: 'elem',
          maxIterations: 100,
          onError: 'continue',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'forEachNode',
      data: {
        label: 'Loop',
        arrayExpression: 'items',
        itemVariable: 'elem',
        maxIterations: 100,
        onError: 'continue',
      },
    });
  });

  it('serializes httpRequestNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('httpRequestNode', {
          label: 'Fetch',
          method: 'POST',
          url: 'https://api.example.com',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          bodyType: 'json',
          auth: 'bearer',
          retryCount: 2,
          timeoutMs: 10000,
          outputAlias: 'api_response',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'httpRequestNode',
      data: {
        label: 'Fetch',
        method: 'POST',
        url: 'https://api.example.com',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        bodyType: 'json',
        auth: 'bearer',
        retryCount: 2,
        timeoutMs: 10000,
        outputAlias: 'api_response',
      },
    });
  });

  it('serializes delayNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('delayNode', {
          label: 'Wait',
          duration: 5,
          unit: 'seconds',
          description: 'Brief pause',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'delayNode',
      data: { label: 'Wait', duration: 5, unit: 'seconds', description: 'Brief pause' },
    });
  });

  it('serializes switchNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('switchNode', {
          label: 'Router',
          expression: 'status',
          cases: [{ label: 'active' }, { label: 'inactive' }],
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'switchNode',
      data: {
        label: 'Router',
        expression: 'status',
        cases: [{ label: 'active' }, { label: 'inactive' }],
      },
    });
  });

  it('serializes errorHandlerNode with defaults', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('errorHandlerNode', {
          description: 'Handle failures',
          continueOnSuccess: true,
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'errorHandlerNode',
      data: { label: 'Error Handler', description: 'Handle failures', continueOnSuccess: true },
    });
  });

  it('serializes subWorkflowNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('subWorkflowNode', {
          label: 'Sub',
          subWorkflowId: 'wf-123',
          subWorkflowName: 'Child Workflow',
          description: 'Invoke child',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'subWorkflowNode',
      data: {
        label: 'Sub',
        subWorkflowId: 'wf-123',
        subWorkflowName: 'Child Workflow',
        description: 'Invoke child',
      },
    });
  });

  it('serializes approvalNode with defaults', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('approvalNode', {
          approvalMessage: 'Approve?',
          timeoutMinutes: 60,
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'approvalNode',
      data: { label: 'Approval Gate', approvalMessage: 'Approve?', timeoutMinutes: 60 },
    });
  });

  it('serializes stickyNoteNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('stickyNoteNode', {
          label: 'Note',
          text: 'Important info',
          color: 'yellow',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'stickyNoteNode',
      data: { label: 'Note', text: 'Important info', color: 'yellow' },
    });
  });

  it('serializes notificationNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('notificationNode', {
          label: 'Alert',
          message: 'Process complete',
          severity: 'success',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'notificationNode',
      data: { label: 'Alert', message: 'Process complete', severity: 'success' },
    });
  });

  it('serializes parallelNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('parallelNode', {
          branchCount: 3,
          branchLabels: ['A', 'B', 'C'],
          description: 'Fan out',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'parallelNode',
      data: {
        label: 'Parallel',
        branchCount: 3,
        branchLabels: ['A', 'B', 'C'],
        description: 'Fan out',
      },
    });
  });

  it('serializes mergeNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('mergeNode', {
          label: 'Gather',
          mode: 'waitAll',
          description: 'Wait for all',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'mergeNode',
      data: { label: 'Gather', mode: 'waitAll', description: 'Wait for all' },
    });
  });

  it('serializes mapNode', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('mapNode', {
          label: 'Map',
          arrayExpression: 'items',
          expression: 'item.name',
          description: 'Extract names',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'mapNode',
      data: {
        label: 'Map',
        arrayExpression: 'items',
        expression: 'item.name',
        description: 'Extract names',
      },
    });
  });

  it('serializes aggregateNode with defaults', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('aggregateNode', {
          label: 'Sum',
          arrayExpression: '{{n1.output}}',
          operation: 'sum',
          field: 'price',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'aggregateNode',
      data: { label: 'Sum', arrayExpression: '{{n1.output}}', operation: 'sum', field: 'price' },
    });
  });

  it('falls back to default toolNode for unknown node types', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('unknownType', {
          toolName: 'custom.tool',
          toolArgs: { x: 1 },
          label: 'Custom',
          description: 'A custom node',
          retryCount: 1,
          timeoutMs: 5000,
          outputAlias: 'out',
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'unknownType',
      data: {
        toolName: 'custom.tool',
        toolArgs: { x: 1 },
        label: 'Custom',
        description: 'A custom node',
        retryCount: 1,
        timeoutMs: 5000,
        outputAlias: 'out',
      },
    });
  });

  it('serializes dataStoreNode with value for non-list operations', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('dataStoreNode', {
          label: 'Store',
          operation: 'set',
          key: 'my_key',
          value: { data: 'hello' },
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'dataStoreNode',
      data: { label: 'Store', operation: 'set', key: 'my_key', value: { data: 'hello' } },
    });
  });

  it('handles empty nodes and edges gracefully', () => {
    const serialized = serializeWorkflowCanvas([], []);
    expect(serialized.nodes).toEqual([]);
    expect(serialized.edges).toEqual([]);
  });

  it('handles webhookResponseNode empty optional fields', () => {
    const serialized = serializeWorkflowCanvas(
      [makeNode('webhookResponseNode', { label: 'Reply' })],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'webhookResponseNode',
      data: { label: 'Reply' },
    });
    // statusCode should not be present since it's undefined
    expect(serialized.nodes[0]!.data).not.toHaveProperty('statusCode');
  });

  it('serializes schemaValidatorNode without strict', () => {
    const serialized = serializeWorkflowCanvas(
      [
        makeNode('schemaValidatorNode', {
          label: 'Validate',
          schema: { type: 'object' },
        }),
      ],
      []
    );
    expect(serialized.nodes[0]).toMatchObject({
      type: 'schemaValidatorNode',
      data: { label: 'Validate', schema: { type: 'object' } },
    });
    expect(serialized.nodes[0]!.data).not.toHaveProperty('strict');
  });
});
