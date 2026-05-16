import type { Edge, Node } from '@xyflow/react';

import type { WorkflowEdge, WorkflowNode } from '../../api';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (optionalRecord(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return optionalRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function parseHeaderLines(value: unknown): Record<string, string> | undefined {
  if (optionalRecord(value)) {
    const headers = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
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

function alias(data: Record<string, unknown>): Record<string, string> {
  return typeof data.outputAlias === 'string' && data.outputAlias
    ? { outputAlias: data.outputAlias }
    : {};
}

function pickDefined(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') picked[key] = value;
  }
  return picked;
}

function serializeNode(node: Node): WorkflowNode {
  const data = node.data as Record<string, unknown>;
  const base = { id: node.id, type: node.type || 'toolNode', position: node.position };

  if (node.type === 'triggerNode') {
    return {
      ...base,
      type: 'triggerNode',
      data: {
        triggerType: data.triggerType,
        label: data.label,
        ...pickDefined(data, [
          'cron',
          'timezone',
          'eventType',
          'filters',
          'condition',
          'threshold',
          'checkInterval',
          'webhookPath',
          'webhookSecret',
          'triggerId',
        ]),
      },
    };
  }

  if (node.type === 'llmNode') {
    return {
      ...base,
      type: 'llmNode',
      data: {
        label: data.label,
        provider: data.provider,
        model: data.model,
        systemPrompt: data.systemPrompt,
        userMessage: data.userMessage,
        temperature: data.temperature,
        maxTokens: data.maxTokens,
        ...pickDefined(data, ['apiKey', 'baseUrl', 'retryCount', 'timeoutMs']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'conditionNode') {
    return {
      ...base,
      type: 'conditionNode',
      data: {
        label: data.label,
        expression: data.expression,
        description: data.description,
        ...pickDefined(data, ['retryCount', 'timeoutMs']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'codeNode') {
    return {
      ...base,
      type: 'codeNode',
      data: {
        label: data.label,
        language: data.language,
        code: data.code,
        description: data.description,
        ...pickDefined(data, ['retryCount', 'timeoutMs']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'transformerNode') {
    return {
      ...base,
      type: 'transformerNode',
      data: {
        label: data.label,
        expression: data.expression,
        description: data.description,
        ...pickDefined(data, ['retryCount', 'timeoutMs']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'forEachNode') {
    return {
      ...base,
      type: 'forEachNode',
      data: {
        label: data.label,
        arrayExpression: data.arrayExpression,
        ...pickDefined(data, [
          'itemVariable',
          'maxIterations',
          'onError',
          'description',
          'retryCount',
          'timeoutMs',
        ]),
        ...alias(data),
      },
    };
  }

  if (node.type === 'httpRequestNode') {
    return {
      ...base,
      type: 'httpRequestNode',
      data: {
        label: data.label,
        method: data.method,
        url: data.url,
        ...pickDefined(data, [
          'headers',
          'queryParams',
          'body',
          'bodyType',
          'auth',
          'maxResponseSize',
          'description',
          'retryCount',
          'timeoutMs',
        ]),
        ...alias(data),
      },
    };
  }

  if (node.type === 'delayNode') {
    return {
      ...base,
      type: 'delayNode',
      data: {
        label: data.label,
        duration: data.duration,
        unit: data.unit,
        ...pickDefined(data, ['description']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'switchNode') {
    return {
      ...base,
      type: 'switchNode',
      data: {
        label: data.label,
        expression: data.expression,
        cases: data.cases,
        ...pickDefined(data, ['description', 'retryCount', 'timeoutMs']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'errorHandlerNode') {
    return {
      ...base,
      type: 'errorHandlerNode',
      data: {
        label: data.label ?? 'Error Handler',
        ...pickDefined(data, ['description', 'continueOnSuccess']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'subWorkflowNode') {
    return {
      ...base,
      type: 'subWorkflowNode',
      data: {
        label: data.label ?? 'Sub-Workflow',
        ...pickDefined(data, [
          'description',
          'subWorkflowId',
          'subWorkflowName',
          'inputMapping',
          'maxDepth',
          'retryCount',
          'timeoutMs',
        ]),
        ...alias(data),
      },
    };
  }

  if (node.type === 'approvalNode') {
    return {
      ...base,
      type: 'approvalNode',
      data: {
        label: data.label ?? 'Approval Gate',
        ...pickDefined(data, ['description', 'approvalMessage', 'timeoutMinutes']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'stickyNoteNode') {
    return {
      ...base,
      type: 'stickyNoteNode',
      data: {
        label: data.label ?? 'Note',
        ...pickDefined(data, ['text', 'color']),
      },
    };
  }

  if (node.type === 'notificationNode') {
    return {
      ...base,
      type: 'notificationNode',
      data: {
        label: data.label ?? 'Notification',
        ...pickDefined(data, ['message', 'severity', 'description', 'retryCount', 'timeoutMs']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'parallelNode') {
    return {
      ...base,
      type: 'parallelNode',
      data: {
        label: data.label ?? 'Parallel',
        ...pickDefined(data, ['branchCount', 'branchLabels', 'description']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'mergeNode') {
    return {
      ...base,
      type: 'mergeNode',
      data: {
        label: data.label ?? 'Merge',
        ...pickDefined(data, ['mode', 'description']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'dataStoreNode') {
    const operation = data.operation ?? 'get';
    return {
      ...base,
      type: 'dataStoreNode',
      data: {
        label: data.label ?? 'Data Store',
        operation,
        ...(operation !== 'list' ? { key: data.key ?? '' } : {}),
        ...(data.value !== undefined ? { value: data.value } : {}),
        ...pickDefined(data, ['namespace', 'description']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'schemaValidatorNode') {
    return {
      ...base,
      type: 'schemaValidatorNode',
      data: {
        label: data.label ?? 'Schema Validator',
        schema: parseJsonObject(data.schema) ?? {},
        ...((data.strict ?? data.strictMode)
          ? { strict: Boolean(data.strict ?? data.strictMode) }
          : {}),
        ...pickDefined(data, ['description', 'retryCount', 'timeoutMs']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'filterNode') {
    return {
      ...base,
      type: 'filterNode',
      data: {
        label: data.label ?? 'Filter',
        arrayExpression: data.arrayExpression ?? '',
        condition: data.condition ?? '',
        ...pickDefined(data, ['description', 'retryCount', 'timeoutMs']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'mapNode') {
    return {
      ...base,
      type: 'mapNode',
      data: {
        label: data.label ?? 'Map',
        arrayExpression: data.arrayExpression ?? '',
        expression: data.expression ?? '',
        ...pickDefined(data, ['description', 'retryCount', 'timeoutMs']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'aggregateNode') {
    return {
      ...base,
      type: 'aggregateNode',
      data: {
        label: data.label ?? 'Aggregate',
        arrayExpression: data.arrayExpression ?? '',
        operation: data.operation ?? 'count',
        ...pickDefined(data, ['field', 'description']),
        ...alias(data),
      },
    };
  }

  if (node.type === 'webhookResponseNode') {
    const headers = parseHeaderLines(data.headers);
    return {
      ...base,
      type: 'webhookResponseNode',
      data: {
        label: data.label ?? 'Webhook Response',
        ...(optionalNumber(data.statusCode) != null ? { statusCode: data.statusCode } : {}),
        ...(optionalString(data.body) ? { body: optionalString(data.body) } : {}),
        ...(headers ? { headers } : {}),
        ...(optionalString(data.contentType)
          ? { contentType: optionalString(data.contentType) }
          : {}),
        ...(optionalString(data.description)
          ? { description: optionalString(data.description) }
          : {}),
        ...alias(data),
      },
    };
  }

  return {
    ...base,
    data: {
      toolName: data.toolName,
      toolArgs: data.toolArgs,
      label: data.label,
      description: data.description,
      ...pickDefined(data, ['retryCount', 'timeoutMs']),
      ...alias(data),
    },
  };
}

export function serializeWorkflowCanvas(
  nodes: Node[],
  edges: Edge[]
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  return {
    nodes: nodes.map(serializeNode),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
    })),
  };
}
