import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';

import {
  buildWorkflowDefinition,
  parseWorkflowDefinition,
  convertDefinitionToReactFlow,
} from './workflowDefinition';

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

  it('omits key from portable dataStore list definitions', () => {
    const definition = buildWorkflowDefinition('List Keys', [
      makeNode('dataStoreNode', {
        label: 'List Keys',
        operation: 'list',
        namespace: 'reports',
      }),
    ]);

    expect(definition.nodes[0]).toMatchObject({
      type: 'dataStore',
      label: 'List Keys',
      operation: 'list',
      namespace: 'reports',
    });
    expect(definition.nodes[0]).not.toHaveProperty('key');
  });

  it('exports claw nodes as portable claw definitions', () => {
    const definition = buildWorkflowDefinition('Claw Flow', [
      makeNode('clawNode', {
        label: 'Research Agent',
        name: 'Market Research',
        mission: 'Research {{node_1.output.topic}}',
        mode: 'single-shot',
        sandbox: 'auto',
        waitForCompletion: true,
        timeoutMs: 600000,
      }),
    ]);

    expect(definition.nodes[0]).toMatchObject({
      type: 'claw',
      label: 'Research Agent',
      name: 'Market Research',
      mission: 'Research {{node_1.output.topic}}',
      mode: 'single-shot',
      sandbox: 'auto',
      waitForCompletion: true,
      timeoutMs: 600000,
    });
  });

  it('exports notification node with severity and message', () => {
    const definition = buildWorkflowDefinition('Notify', [
      makeNode('notificationNode', {
        label: 'Alert',
        message: 'Process completed',
        severity: 'error',
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'notification',
      label: 'Alert',
      message: 'Process completed',
      severity: 'error',
    });
  });

  it('exports approval node with approval message and timeout', () => {
    const definition = buildWorkflowDefinition('Approve', [
      makeNode('approvalNode', {
        label: 'Gate',
        approvalMessage: 'Approve?',
        timeoutMinutes: 60,
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'approval',
      label: 'Gate',
      approvalMessage: 'Approve?',
      timeoutMinutes: 60,
    });
  });

  it('exports sticky note with text and color', () => {
    const definition = buildWorkflowDefinition('Note', [
      makeNode('stickyNoteNode', {
        label: 'Reminder',
        text: 'Remember to check',
        color: 'yellow',
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'stickyNote',
      label: 'Reminder',
      text: 'Remember to check',
      color: 'yellow',
    });
  });

  it('exports switch node with cases and expression', () => {
    const definition = buildWorkflowDefinition('Switch', [
      makeNode('switchNode', {
        label: 'Route',
        expression: 'value',
        cases: [
          { label: 'a', value: '1' },
          { label: 'b', value: '2' },
        ],
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'switch',
      expression: 'value',
      cases: [
        { label: 'a', value: '1' },
        { label: 'b', value: '2' },
      ],
    });
  });

  it('exports forEach node with max iterations', () => {
    const definition = buildWorkflowDefinition('Loop', [
      makeNode('forEachNode', {
        label: 'Each',
        arrayExpression: 'items',
        itemVariable: 'item',
        maxIterations: 10,
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'forEach',
      arrayExpression: 'items',
      itemVariable: 'item',
      maxIterations: 10,
    });
  });

  it('exports transformer node with expression', () => {
    const definition = buildWorkflowDefinition('Transform', [
      makeNode('transformerNode', {
        label: 'XForm',
        expression: 'x * 2',
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'transformer',
      expression: 'x * 2',
    });
  });

  it('omits variables when empty', () => {
    const definition = buildWorkflowDefinition('Empty', [], [], {});
    expect(definition.variables).toBeUndefined();
  });

  it('omits outputAlias when empty string', () => {
    const definition = buildWorkflowDefinition('NoAlias', [
      makeNode('toolNode', {
        label: 'Tool',
        toolName: 'core.test',
        outputAlias: '',
      }),
    ]);
    expect(definition.nodes[0]).not.toHaveProperty('outputAlias');
  });

  it('uses dataStore list mode without key', () => {
    const definition = buildWorkflowDefinition('List', [
      makeNode('dataStoreNode', {
        operation: 'list',
        namespace: 'logs',
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'dataStore',
      operation: 'list',
      namespace: 'logs',
    });
    expect(definition.nodes[0]).not.toHaveProperty('key');
  });

  it('uses dataStore set mode with key and value', () => {
    const definition = buildWorkflowDefinition('Set', [
      makeNode('dataStoreNode', {
        operation: 'set',
        key: 'mykey',
        value: 'myval',
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'dataStore',
      operation: 'set',
      key: 'mykey',
      value: 'myval',
    });
  });

  it('exports merge node with firstCompleted mode', () => {
    const definition = buildWorkflowDefinition('Merge', [
      makeNode('mergeNode', {
        label: 'First Win',
        mode: 'firstCompleted',
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'merge',
      label: 'First Win',
      mode: 'firstCompleted',
    });
  });

  it('exports filter node with array expression and condition', () => {
    const definition = buildWorkflowDefinition('Filter', [
      makeNode('filterNode', {
        label: 'Filter Active',
        arrayExpression: 'users',
        condition: 'user.active',
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'filter',
      arrayExpression: 'users',
      condition: 'user.active',
    });
  });

  it('exports parallel node with custom branch count', () => {
    const definition = buildWorkflowDefinition('Parallel', [
      makeNode('parallelNode', {
        label: 'Fan Out',
        branchCount: 4,
        branchLabels: ['A', 'B', 'C', 'D'],
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'parallel',
      label: 'Fan Out',
      branchCount: 4,
      branchLabels: ['A', 'B', 'C', 'D'],
    });
  });

  it('exports errorHandler with continueOnSuccess flag', () => {
    const definition = buildWorkflowDefinition('Handler', [
      makeNode('errorHandlerNode', {
        label: 'Handle',
        continueOnSuccess: true,
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'errorHandler',
      label: 'Handle',
      continueOnSuccess: true,
    });
  });

  it('exports aggregate node with operation and field', () => {
    const definition = buildWorkflowDefinition('Agg', [
      makeNode('aggregateNode', {
        label: 'Sum',
        arrayExpression: 'items',
        operation: 'sum',
        field: 'amount',
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'aggregate',
      arrayExpression: 'items',
      operation: 'sum',
      field: 'amount',
    });
  });

  it('exports delay node with custom duration and description', () => {
    const definition = buildWorkflowDefinition('Delay', [
      makeNode('delayNode', {
        label: 'Wait',
        duration: '10',
        unit: 'minutes',
        description: 'Pause for 10 minutes',
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'delay',
      label: 'Wait',
      duration: '10',
      unit: 'minutes',
      description: 'Pause for 10 minutes',
    });
  });

  it('exports httpRequestNode with full payload and auth config', () => {
    const definition = buildWorkflowDefinition('HTTP', [
      makeNode('httpRequestNode', {
        label: 'API Call',
        method: 'POST',
        url: 'https://api.test/data',
        body: '{"key":"val"}',
        bodyType: 'json',
        auth: { type: 'bearer' },
        headers: { 'X-Custom': 'abc' },
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'httpRequest',
      method: 'POST',
      url: 'https://api.test/data',
      auth: { type: 'bearer' },
      headers: { 'X-Custom': 'abc' },
    });
  });

  it('exports condition node with expression and description', () => {
    const definition = buildWorkflowDefinition('Cond', [
      makeNode('conditionNode', {
        label: 'Check',
        expression: 'x > 5',
        description: 'If x is greater than 5',
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'condition',
      expression: 'x > 5',
      description: 'If x is greater than 5',
    });
  });

  it('exports code node with language and code', () => {
    const definition = buildWorkflowDefinition('Code', [
      makeNode('codeNode', {
        label: 'Execute',
        language: 'python',
        code: 'print("hello")',
      }),
    ]);
    expect(definition.nodes[0]).toMatchObject({
      type: 'code',
      label: 'Execute',
      language: 'python',
      code: 'print("hello")',
    });
  });

  it('buildWorkflowDefinition flattens node id and position to integers', () => {
    const definition = buildWorkflowDefinition('Pos', [
      makeNode('conditionNode', { label: 'C', expression: 'x > 0' }),
    ]);
    const node = definition.nodes[0]!;
    expect(typeof (node.position as any).x).toBe('number');
    expect((node.position as any).x).toBe(10);
  });
});

// ── parseWorkflowDefinition ──

describe('parseWorkflowDefinition', () => {
  it('returns null when nodes is not an array', () => {
    expect(parseWorkflowDefinition({ name: 'test', nodes: 'not-array' })).toBeNull();
  });

  it('parses a valid definition with name, nodes, edges, and variables', () => {
    const result = parseWorkflowDefinition({
      name: 'My Flow',
      nodes: [{ id: 'n1', type: 'trigger' }],
      edges: [{ source: 'n1', target: 'n2' }],
      variables: { key: 'val' },
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe('My Flow');
    expect(result!.nodes).toHaveLength(1);
    expect(result!.edges).toHaveLength(1);
    expect(result!.variables).toEqual({ key: 'val' });
  });

  it('returns empty name when name is not a string', () => {
    const result = parseWorkflowDefinition({ name: 123, nodes: [{ id: 'n1' }] });
    expect(result!.name).toBe('');
  });

  it('filters out non-record nodes', () => {
    const result = parseWorkflowDefinition({
      name: 'Test',
      nodes: [{ id: 'n1' }, 'string-node', 42, null],
    });
    expect(result!.nodes).toHaveLength(1);
  });

  it('handles missing edges gracefully', () => {
    const result = parseWorkflowDefinition({ name: 'Test', nodes: [{ id: 'n1' }] });
    expect(result!.edges).toEqual([]);
  });

  it('omits variables when variables is not a record', () => {
    const r1 = parseWorkflowDefinition({ name: 'Test', nodes: [], variables: 'string' });
    expect(r1!.variables).toBeUndefined();
    const r2 = parseWorkflowDefinition({ name: 'Test', nodes: [], variables: null });
    expect(r2!.variables).toBeUndefined();
  });

  it('handles sourceHandle and targetHandle on edges', () => {
    const result = parseWorkflowDefinition({
      name: 'Test',
      nodes: [{ id: 'n1' }, { id: 'n2' }],
      edges: [{ source: 'n1', target: 'n2', sourceHandle: 'success', targetHandle: 'input' }],
    });
    expect(result!.edges[0]!.sourceHandle).toBe('success');
    expect(result!.edges[0]!.targetHandle).toBe('input');
  });
});

// ── convertDefinitionToReactFlow ──

describe('convertDefinitionToReactFlow', () => {
  it('converts a trigger definition to a triggerNode', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [{ id: 'n1', type: 'trigger', triggerType: 'manual' }],
      edges: [],
    });
    expect(result.nodes[0]!.type).toBe('triggerNode');
    expect(result.skippedNodes).toEqual([]);
  });

  it('converts an llm type to an llmNode', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [{ id: 'n1', type: 'llm', label: 'Test LLM', provider: 'openai', model: 'gpt-4' }],
      edges: [],
    });
    expect(result.nodes[0]!.type).toBe('llmNode');
  });

  it('maps "default" provider/model to empty string', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [{ id: 'n1', type: 'llm', provider: 'default', model: 'default' }],
      edges: [],
    });
    expect((result.nodes[0]!.data as any).provider).toBe('');
    expect((result.nodes[0]!.data as any).model).toBe('');
  });

  it('deduplicates trigger nodes — keeps first, drops second', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'trigger', triggerType: 'manual' },
        { id: 'n2', type: 'trigger', triggerType: 'schedule' },
      ],
      edges: [],
    });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.id).toBe('n1');
  });

  it('reports skipped nodes for unknown types without tool field', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'unknownType' },
        { id: 'n2', type: 'trigger', triggerType: 'manual' },
      ],
      edges: [{ source: 'n1', target: 'n2' }],
    });
    expect(result.nodes).toHaveLength(1);
    expect(result.skippedNodes).toHaveLength(1);
    expect(result.skippedNodes[0]).toContain('n1');
  });

  it('assigns a fallback id when def.id is missing', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [{ type: 'trigger', triggerType: 'manual' }],
      edges: [],
    });
    expect(result.nodes[0]!.id).toBe('node_1');
  });

  it('removes edges that reference skipped/dropped trigger nodes', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'trigger', triggerType: 'manual' },
        { id: 'n2', type: 'trigger', triggerType: 'schedule' }, // dropped
        { id: 'n3', type: 'llm' },
      ],
      edges: [
        { source: 'n1', target: 'n3' },
        { source: 'n2', target: 'n3' }, // references dropped trigger
      ],
    });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.source).toBe('n1');
  });

  it('converts condition, code, transformer, and forEach types', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'condition', expression: 'x > 0' },
        { id: 'n2', type: 'code', language: 'python', code: 'print(1)' },
        { id: 'n3', type: 'transformer', expression: 'x * 2' },
        { id: 'n4', type: 'forEach', arrayExpression: 'items', itemVariable: 'item' },
      ],
      edges: [],
    });
    expect(result.nodes[0]!.type).toBe('conditionNode');
    expect(result.nodes[1]!.type).toBe('codeNode');
    expect(result.nodes[2]!.type).toBe('transformerNode');
    expect(result.nodes[3]!.type).toBe('forEachNode');
  });

  it('converts httpRequest, delay, switch, errorHandler types', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'httpRequest', method: 'GET', url: 'https://test' },
        { id: 'n2', type: 'delay', duration: '30', unit: 'seconds' },
        { id: 'n3', type: 'switch', expression: 'x', cases: [{ label: 'a', value: '1' }] },
        { id: 'n4', type: 'errorHandler', continueOnSuccess: true },
      ],
      edges: [],
    });
    expect(result.nodes[0]!.type).toBe('httpRequestNode');
    expect(result.nodes[1]!.type).toBe('delayNode');
    expect(result.nodes[2]!.type).toBe('switchNode');
    expect(result.nodes[3]!.type).toBe('errorHandlerNode');
  });

  it('converts subWorkflow, approval, stickyNote, notification types', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'subWorkflow', subWorkflowId: 'wf_123', subWorkflowName: 'Child' },
        { id: 'n2', type: 'approval', approvalMessage: 'OK?' },
        { id: 'n3', type: 'stickyNote', text: 'Hello', color: 'yellow' },
        { id: 'n4', type: 'notification', message: 'Done', severity: 'success' },
      ],
      edges: [],
    });
    expect(result.nodes[0]!.type).toBe('subWorkflowNode');
    expect(result.nodes[1]!.type).toBe('approvalNode');
    expect(result.nodes[2]!.type).toBe('stickyNoteNode');
    expect(result.nodes[3]!.type).toBe('notificationNode');
  });

  it('converts parallel, merge, dataStore, schemaValidator types', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'parallel', branchCount: 3 },
        { id: 'n2', type: 'merge', mode: 'firstCompleted' },
        { id: 'n3', type: 'dataStore', operation: 'get', key: 'token' },
        { id: 'n4', type: 'schemaValidator', schema: { type: 'object' } },
      ],
      edges: [],
    });
    expect(result.nodes[0]!.type).toBe('parallelNode');
    expect(result.nodes[1]!.type).toBe('mergeNode');
    expect(result.nodes[2]!.type).toBe('dataStoreNode');
    expect(result.nodes[3]!.type).toBe('schemaValidatorNode');
  });

  it('converts filter, map, aggregate, webhookResponse, claw types', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'filter', arrayExpression: 'items', condition: 'x > 0' },
        { id: 'n2', type: 'map', arrayExpression: 'items', expression: 'x * 2' },
        { id: 'n3', type: 'aggregate', arrayExpression: 'items', operation: 'sum' },
        { id: 'n4', type: 'webhookResponse', statusCode: 200, body: 'ok' },
        { id: 'n5', type: 'claw', name: 'AgentX', mission: 'do stuff' },
      ],
      edges: [],
    });
    expect(result.nodes[0]!.type).toBe('filterNode');
    expect(result.nodes[1]!.type).toBe('mapNode');
    expect(result.nodes[2]!.type).toBe('aggregateNode');
    expect(result.nodes[3]!.type).toBe('webhookResponseNode');
    expect(result.nodes[4]!.type).toBe('clawNode');
  });

  it('converts tool nodes with tool name resolution', () => {
    const result = convertDefinitionToReactFlow(
      {
        name: 'Test',
        nodes: [{ id: 'n1', tool: 'mcp.github.list_issues', args: { repo: 'ownpilot' } }],
        edges: [],
      },
      ['mcp.github.list_issues']
    );
    expect(result.nodes[0]!.type).toBe('toolNode');
    expect((result.nodes[0]!.data as any).toolName).toBe('mcp.github.list_issues');
    expect((result.nodes[0]!.data as any).toolArgs).toEqual({ repo: 'ownpilot' });
  });

  it('handles tool name resolution with missing dots', () => {
    const result = convertDefinitionToReactFlow(
      {
        name: 'Test',
        nodes: [{ id: 'n1', tool: 'mcpgithublist_issues' }],
        edges: [],
      },
      ['mcp.github.list_issues']
    );
    expect((result.nodes[0]!.data as any).toolName).toBe('mcp.github.list_issues');
  });

  it('creates edges with unique ids', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'trigger', triggerType: 'manual' },
        { id: 'n2', type: 'llm' },
      ],
      edges: [{ source: 'n1', target: 'n2' }],
    });
    expect(result.edges[0]!.id).toBe('edge_n1_n2_0');
    expect(result.edges[0]!.source).toBe('n1');
    expect(result.edges[0]!.target).toBe('n2');
  });

  it('creates edges with sourceHandle and targetHandle', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [
        { id: 'n1', type: 'trigger', triggerType: 'manual' },
        { id: 'n2', type: 'llm' },
      ],
      edges: [{ source: 'n1', target: 'n2', sourceHandle: 'success', targetHandle: 'input' }],
    });
    expect(result.edges[0]!.sourceHandle).toBe('success');
    expect(result.edges[0]!.targetHandle).toBe('input');
  });

  it('handles empty nodes array gracefully', () => {
    const result = convertDefinitionToReactFlow({ name: 'Empty', nodes: [], edges: [] });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.skippedNodes).toEqual([]);
  });

  it('uses fallback position when node position is missing', () => {
    const result = convertDefinitionToReactFlow({
      name: 'Test',
      nodes: [{ type: 'trigger', triggerType: 'manual' }],
      edges: [],
    });
    expect(result.nodes[0]!.position).toEqual({ x: 300, y: 100 });
  });
});
