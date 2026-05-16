import type { Edge, Node } from '@xyflow/react';

export interface WorkflowDefinition {
  name: string;
  nodes: Record<string, unknown>[];
  edges: Array<{ source: string; target: string; sourceHandle?: string; targetHandle?: string }>;
  variables?: Record<string, unknown>;
}

function pickDefined(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      picked[key] = source[key];
    }
  }
  return picked;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeSchema(value: unknown): unknown {
  return parseJsonObject(value) ?? (typeof value === 'string' && value.trim() ? value : {});
}

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
  if (isRecord(value)) {
    const headers = Object.fromEntries(
      Object.entries(value)
        .filter(([key, headerValue]) => key && typeof headerValue === 'string')
        .map(([key, headerValue]) => [key, headerValue as string])
    );
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  if (typeof value !== 'string' || !value.trim()) return undefined;
  const headers: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(':');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const headerValue = trimmed.slice(separator + 1).trim();
    if (key) headers[key] = headerValue;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function positionOf(node: Node): { x: number; y: number } {
  return { x: Math.round(node.position.x), y: Math.round(node.position.y) };
}

function serializeNode(node: Node): Record<string, unknown> {
  const data = node.data as Record<string, unknown>;
  const base = {
    id: node.id,
    position: positionOf(node),
  };

  if (node.type === 'triggerNode') {
    return {
      ...base,
      type: 'trigger',
      triggerType: data.triggerType ?? 'manual',
      label: data.label ?? 'Trigger',
      ...pickDefined(data, [
        'cron',
        'timezone',
        'eventType',
        'filters',
        'condition',
        'threshold',
        'checkInterval',
        'webhookPath',
        'triggerId',
      ]),
    };
  }

  if (node.type === 'llmNode') {
    return {
      ...base,
      type: 'llm',
      label: data.label ?? 'LLM',
      provider: data.provider,
      model: data.model,
      ...pickDefined(data, [
        'systemPrompt',
        'userMessage',
        'temperature',
        'maxTokens',
        'responseFormat',
        'conversationMessages',
      ]),
    };
  }

  if (node.type === 'conditionNode') {
    return {
      ...base,
      type: 'condition',
      label: data.label ?? 'Condition',
      expression: data.expression ?? '',
      ...pickDefined(data, ['description']),
    };
  }

  if (node.type === 'codeNode') {
    return {
      ...base,
      type: 'code',
      label: data.label ?? 'Code',
      language: data.language ?? 'javascript',
      code: data.code ?? '',
      ...pickDefined(data, ['description']),
    };
  }

  if (node.type === 'transformerNode') {
    return {
      ...base,
      type: 'transformer',
      label: data.label ?? 'Transform',
      expression: data.expression ?? '',
      ...pickDefined(data, ['description']),
    };
  }

  if (node.type === 'forEachNode') {
    return {
      ...base,
      type: 'forEach',
      label: data.label ?? 'ForEach',
      arrayExpression: data.arrayExpression ?? '',
      ...pickDefined(data, ['itemVariable', 'maxIterations', 'onError', 'description']),
    };
  }

  if (node.type === 'httpRequestNode') {
    return {
      ...base,
      type: 'httpRequest',
      label: data.label ?? 'HTTP Request',
      method: data.method ?? 'GET',
      url: data.url ?? '',
      ...pickDefined(data, ['headers', 'queryParams', 'body', 'bodyType', 'auth', 'description']),
    };
  }

  if (node.type === 'delayNode') {
    return {
      ...base,
      type: 'delay',
      label: data.label ?? 'Delay',
      duration: data.duration ?? '5',
      unit: data.unit ?? 'seconds',
      ...pickDefined(data, ['description']),
    };
  }

  if (node.type === 'switchNode') {
    return {
      ...base,
      type: 'switch',
      label: data.label ?? 'Switch',
      expression: data.expression ?? '',
      cases: data.cases ?? [{ label: 'case_1', value: '' }],
      ...pickDefined(data, ['description']),
    };
  }

  if (node.type === 'errorHandlerNode') {
    return {
      ...base,
      type: 'errorHandler',
      label: data.label ?? 'Error Handler',
      ...pickDefined(data, ['description', 'continueOnSuccess']),
    };
  }

  if (node.type === 'subWorkflowNode') {
    return {
      ...base,
      type: 'subWorkflow',
      label: data.label ?? 'Sub-Workflow',
      ...pickDefined(data, [
        'subWorkflowId',
        'subWorkflowName',
        'inputMapping',
        'maxDepth',
        'description',
      ]),
    };
  }

  if (node.type === 'approvalNode') {
    return {
      ...base,
      type: 'approval',
      label: data.label ?? 'Approval Gate',
      ...pickDefined(data, ['approvalMessage', 'timeoutMinutes', 'description']),
    };
  }

  if (node.type === 'stickyNoteNode') {
    return {
      ...base,
      type: 'stickyNote',
      label: data.label ?? 'Note',
      ...pickDefined(data, ['text', 'color']),
    };
  }

  if (node.type === 'notificationNode') {
    return {
      ...base,
      type: 'notification',
      label: data.label ?? 'Notification',
      ...pickDefined(data, ['message', 'severity', 'description']),
    };
  }

  if (node.type === 'parallelNode') {
    return {
      ...base,
      type: 'parallel',
      label: data.label ?? 'Parallel',
      branchCount: data.branchCount ?? 2,
      ...pickDefined(data, ['branchLabels', 'description']),
    };
  }

  if (node.type === 'mergeNode') {
    return {
      ...base,
      type: 'merge',
      label: data.label ?? 'Merge',
      ...pickDefined(data, ['mode', 'description']),
    };
  }

  if (node.type === 'dataStoreNode') {
    return {
      ...base,
      type: 'dataStore',
      label: data.label ?? 'Data Store',
      operation: data.operation ?? 'get',
      key: data.key ?? '',
      ...pickDefined(data, ['value', 'namespace', 'description']),
    };
  }

  if (node.type === 'schemaValidatorNode') {
    return {
      ...base,
      type: 'schemaValidator',
      label: data.label ?? 'Schema Validator',
      schema: normalizeSchema(data.schema),
      ...pickDefined(data, ['strict', 'description']),
    };
  }

  if (node.type === 'filterNode') {
    return {
      ...base,
      type: 'filter',
      label: data.label ?? 'Filter',
      arrayExpression: data.arrayExpression ?? '',
      condition: data.condition ?? '',
      ...pickDefined(data, ['description']),
    };
  }

  if (node.type === 'mapNode') {
    return {
      ...base,
      type: 'map',
      label: data.label ?? 'Map',
      arrayExpression: data.arrayExpression ?? '',
      expression: data.expression ?? '',
      ...pickDefined(data, ['description']),
    };
  }

  if (node.type === 'aggregateNode') {
    return {
      ...base,
      type: 'aggregate',
      label: data.label ?? 'Aggregate',
      arrayExpression: data.arrayExpression ?? '',
      operation: data.operation ?? 'count',
      ...pickDefined(data, ['field', 'description']),
    };
  }

  if (node.type === 'webhookResponseNode') {
    const headers = normalizeHeaders(data.headers);
    return {
      ...base,
      type: 'webhookResponse',
      label: data.label ?? 'Webhook Response',
      ...pickDefined(data, ['statusCode', 'body', 'contentType', 'description']),
      ...(headers ? { headers } : {}),
    };
  }

  return {
    ...base,
    tool: data.toolName,
    label: data.label,
    ...pickDefined(data, ['description']),
    ...(isRecord(data.toolArgs) && Object.keys(data.toolArgs).length > 0
      ? { args: data.toolArgs }
      : {}),
  };
}

export function buildWorkflowDefinition(
  name: string,
  nodes: Node[],
  edges: Edge[] = [],
  variables?: Record<string, unknown>
): WorkflowDefinition {
  return {
    name,
    nodes: nodes.map((node) => {
      const serialized = serializeNode(node);
      const outputAlias = (node.data as Record<string, unknown>).outputAlias;
      return typeof outputAlias === 'string' && outputAlias
        ? { ...serialized, outputAlias }
        : serialized;
    }),
    edges: edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    })),
    ...(variables && Object.keys(variables).length > 0 ? { variables } : {}),
  };
}
