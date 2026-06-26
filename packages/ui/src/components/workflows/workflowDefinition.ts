import type { Edge, Node } from '@xyflow/react';
import { formatToolName } from '../../utils/formatters';

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

function isWorkflowDefinitionEdge(value: unknown): value is WorkflowDefinition['edges'][number] {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    typeof value.target === 'string' &&
    (value.sourceHandle === undefined || typeof value.sourceHandle === 'string') &&
    (value.targetHandle === undefined || typeof value.targetHandle === 'string')
  );
}

export function parseWorkflowDefinition(value: Record<string, unknown>): WorkflowDefinition | null {
  if (!Array.isArray(value.nodes)) return null;

  return {
    name: typeof value.name === 'string' ? value.name : '',
    nodes: value.nodes.filter(isRecord),
    edges: Array.isArray(value.edges) ? value.edges.filter(isWorkflowDefinitionEdge) : [],
    ...(isRecord(value.variables) ? { variables: value.variables } : {}),
  };
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
    const operation = data.operation ?? 'get';
    return {
      ...base,
      type: 'dataStore',
      label: data.label ?? 'Data Store',
      operation,
      ...(operation !== 'list' ? { key: data.key ?? '' } : {}),
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

  if (node.type === 'clawNode') {
    return {
      ...base,
      type: 'claw',
      label: data.label ?? 'Claw Agent',
      name: data.name ?? '',
      mission: data.mission ?? '',
      ...pickDefined(data, [
        'mode',
        'sandbox',
        'waitForCompletion',
        'timeoutMs',
        'provider',
        'model',
        'codingAgentProvider',
        'skills',
        'description',
      ]),
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

// ============================================================================
// Node conversion (AI JSON → ReactFlow nodes)
// ============================================================================

/** Definition (short) node types the converter understands. Keep in sync with the cases below. */
const KNOWN_DEFINITION_TYPES = new Set([
  'trigger',
  'llm',
  'condition',
  'code',
  'transformer',
  'forEach',
  'httpRequest',
  'delay',
  'switch',
  'errorHandler',
  'subWorkflow',
  'approval',
  'stickyNote',
  'notification',
  'parallel',
  'merge',
  'dataStore',
  'schemaValidator',
  'filter',
  'map',
  'aggregate',
  'webhookResponse',
  'claw',
]);

/**
 * Convert AI-generated workflow definition into ReactFlow nodes and edges.
 * This is the reverse of `buildWorkflowDefinition` in WorkflowSourceModal.
 *
 * Nodes with an unrecognized `type` (and no `tool` field) are skipped and
 * reported via `skippedNodes` instead of being silently converted into
 * broken tool nodes.
 */
export function convertDefinitionToReactFlow(
  definition: WorkflowDefinition,
  availableToolNames?: string[]
): { nodes: Node[]; edges: Edge[]; skippedNodes: string[] } {
  // Build lookup for resolving AI-generated tool names that may be missing dots
  const resolveToolName = buildToolNameResolver(availableToolNames);

  // Deduplicate trigger nodes — only keep the first one (should be node_1).
  // AI sometimes generates multiple triggers when editing workflows.
  let seenTrigger = false;
  const skippedNodes: string[] = [];
  const dedupedNodes = definition.nodes.filter((def) => {
    if (def.type === 'trigger') {
      if (seenTrigger) return false; // Drop duplicate trigger
      seenTrigger = true;
      return true;
    }
    // A node is convertible if its type is known, or it is a tool node
    // (tool nodes carry a `tool` field and usually no `type` field).
    const hasKnownType = typeof def.type === 'string' && KNOWN_DEFINITION_TYPES.has(def.type);
    if (!hasKnownType && def.tool == null) {
      skippedNodes.push(`${(def.id as string) ?? '?'} (${(def.type as string) ?? 'no type'})`);
      return false;
    }
    return true;
  });

  // Remove edges that reference dropped trigger/unknown nodes
  const keptNodeIds = new Set(dedupedNodes.map((n) => n.id as string));
  const dedupedEdges = definition.edges.filter(
    (e) => keptNodeIds.has(e.source) && keptNodeIds.has(e.target)
  );

  // Compute max existing node ID for deterministic sequential fallback IDs
  let maxIdNum = 0;
  for (const def of dedupedNodes) {
    const existingId = def.id as string;
    if (existingId) {
      const num = parseInt(existingId.replace('node_', ''), 10);
      if (!isNaN(num) && num > maxIdNum) maxIdNum = num;
    }
  }

  const nodes: Node[] = dedupedNodes.map((def) => {
    const id = (def.id as string) || `node_${++maxIdNum}`;
    const position = (def.position as { x: number; y: number }) || { x: 300, y: 100 };

    if (def.type === 'trigger') {
      return {
        id,
        type: 'triggerNode',
        position,
        data: {
          triggerType: def.triggerType ?? 'manual',
          label: def.label ?? 'Trigger',
          ...(def.cron != null ? { cron: def.cron } : {}),
          ...(def.eventType != null ? { eventType: def.eventType } : {}),
          ...(def.condition != null ? { condition: def.condition } : {}),
          ...(def.threshold != null ? { threshold: def.threshold } : {}),
          ...(def.webhookPath != null ? { webhookPath: def.webhookPath } : {}),
        },
      };
    }

    if (def.type === 'llm') {
      // Map 'default' provider/model to '' so LlmConfigPanel auto-selects user's configured defaults
      const llmProvider = (def.provider as string) ?? '';
      const llmModel = (def.model as string) ?? '';
      return {
        id,
        type: 'llmNode',
        position,
        data: {
          label: def.label ?? 'LLM',
          provider: llmProvider === 'default' ? '' : llmProvider,
          model: llmModel === 'default' ? '' : llmModel,
          ...(def.systemPrompt != null ? { systemPrompt: def.systemPrompt } : {}),
          userMessage: (def.userMessage as string) ?? '',
          ...(def.temperature != null ? { temperature: def.temperature } : {}),
          ...(def.maxTokens != null ? { maxTokens: def.maxTokens } : {}),
          ...(def.responseFormat != null ? { responseFormat: def.responseFormat } : {}),
          ...(def.conversationMessages != null
            ? { conversationMessages: def.conversationMessages }
            : {}),
        },
      };
    }

    if (def.type === 'condition') {
      return {
        id,
        type: 'conditionNode',
        position,
        data: {
          label: def.label ?? 'Condition',
          expression: def.expression ?? '',
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'code') {
      return {
        id,
        type: 'codeNode',
        position,
        data: {
          label: def.label ?? 'Code',
          language: def.language ?? 'javascript',
          code: def.code ?? '',
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'transformer') {
      return {
        id,
        type: 'transformerNode',
        position,
        data: {
          label: def.label ?? 'Transform',
          expression: def.expression ?? '',
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'forEach') {
      return {
        id,
        type: 'forEachNode',
        position,
        data: {
          label: def.label ?? 'ForEach',
          arrayExpression: def.arrayExpression ?? '',
          ...(def.itemVariable != null ? { itemVariable: def.itemVariable } : {}),
          ...(def.maxIterations != null ? { maxIterations: def.maxIterations } : {}),
          ...(def.onError != null ? { onError: def.onError } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'httpRequest') {
      return {
        id,
        type: 'httpRequestNode',
        position,
        data: {
          label: def.label ?? 'HTTP Request',
          method: def.method ?? 'GET',
          url: (def.url as string) ?? '',
          ...(def.headers != null ? { headers: def.headers } : {}),
          ...(def.queryParams != null ? { queryParams: def.queryParams } : {}),
          ...(def.body != null ? { body: def.body } : {}),
          ...(def.bodyType != null ? { bodyType: def.bodyType } : {}),
          ...(def.auth != null ? { auth: def.auth } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'delay') {
      return {
        id,
        type: 'delayNode',
        position,
        data: {
          label: def.label ?? 'Delay',
          duration: (def.duration as string) ?? '5',
          unit: (def.unit as string) ?? 'seconds',
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'switch') {
      return {
        id,
        type: 'switchNode',
        position,
        data: {
          label: def.label ?? 'Switch',
          expression: def.expression ?? '',
          cases: (def.cases as Array<{ label: string; value: string }>) ?? [
            { label: 'case_1', value: '' },
          ],
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'errorHandler') {
      return {
        id,
        type: 'errorHandlerNode',
        position,
        data: {
          label: def.label ?? 'Error Handler',
          ...(def.description != null ? { description: def.description } : {}),
          ...(def.continueOnSuccess != null ? { continueOnSuccess: def.continueOnSuccess } : {}),
        },
      };
    }

    if (def.type === 'subWorkflow') {
      return {
        id,
        type: 'subWorkflowNode',
        position,
        data: {
          label: def.label ?? 'Sub-Workflow',
          ...(def.subWorkflowId != null ? { subWorkflowId: def.subWorkflowId } : {}),
          ...(def.subWorkflowName != null ? { subWorkflowName: def.subWorkflowName } : {}),
          ...(def.inputMapping != null ? { inputMapping: def.inputMapping } : {}),
          ...(def.maxDepth != null ? { maxDepth: def.maxDepth } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'approval') {
      return {
        id,
        type: 'approvalNode',
        position,
        data: {
          label: def.label ?? 'Approval Gate',
          ...(def.approvalMessage != null ? { approvalMessage: def.approvalMessage } : {}),
          ...(def.timeoutMinutes != null ? { timeoutMinutes: def.timeoutMinutes } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'stickyNote') {
      return {
        id,
        type: 'stickyNoteNode',
        position,
        data: {
          label: def.label ?? 'Note',
          ...(def.text != null ? { text: def.text } : {}),
          ...(def.color != null ? { color: def.color } : {}),
        },
      };
    }

    if (def.type === 'notification') {
      return {
        id,
        type: 'notificationNode',
        position,
        data: {
          label: def.label ?? 'Notification',
          ...(def.message != null ? { message: def.message } : {}),
          ...(def.severity != null ? { severity: def.severity } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'parallel') {
      return {
        id,
        type: 'parallelNode',
        position,
        data: {
          label: def.label ?? 'Parallel',
          branchCount: (def.branchCount as number) ?? 2,
          ...(def.branchLabels != null ? { branchLabels: def.branchLabels } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'merge') {
      return {
        id,
        type: 'mergeNode',
        position,
        data: {
          label: def.label ?? 'Merge',
          ...(def.mode != null ? { mode: def.mode } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'dataStore') {
      return {
        id,
        type: 'dataStoreNode',
        position,
        data: {
          label: def.label ?? 'Data Store',
          operation: (def.operation as string) ?? 'set',
          key: (def.key as string) ?? '',
          ...(def.value != null ? { value: def.value } : {}),
          ...(def.namespace != null ? { namespace: def.namespace } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'schemaValidator') {
      return {
        id,
        type: 'schemaValidatorNode',
        position,
        data: {
          label: def.label ?? 'Schema Validator',
          schema: def.schema ?? {},
          ...(def.strict != null ? { strict: def.strict } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'filter') {
      return {
        id,
        type: 'filterNode',
        position,
        data: {
          label: def.label ?? 'Filter',
          arrayExpression: (def.arrayExpression as string) ?? '',
          condition: (def.condition as string) ?? '',
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'map') {
      return {
        id,
        type: 'mapNode',
        position,
        data: {
          label: def.label ?? 'Map',
          arrayExpression: (def.arrayExpression as string) ?? '',
          expression: (def.expression as string) ?? '',
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'aggregate') {
      return {
        id,
        type: 'aggregateNode',
        position,
        data: {
          label: def.label ?? 'Aggregate',
          arrayExpression: (def.arrayExpression as string) ?? '',
          operation: (def.operation as string) ?? 'count',
          ...(def.field != null ? { field: def.field } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'webhookResponse') {
      return {
        id,
        type: 'webhookResponseNode',
        position,
        data: {
          label: def.label ?? 'Webhook Response',
          ...(def.statusCode != null ? { statusCode: def.statusCode } : {}),
          ...(def.body != null ? { body: def.body } : {}),
          ...(def.headers != null ? { headers: def.headers } : {}),
          ...(def.contentType != null ? { contentType: def.contentType } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'claw') {
      return {
        id,
        type: 'clawNode',
        position,
        data: {
          label: def.label ?? 'Claw Agent',
          name: (def.name as string) ?? '',
          mission: (def.mission as string) ?? '',
          ...(def.mode != null ? { mode: def.mode } : {}),
          ...(def.sandbox != null ? { sandbox: def.sandbox } : {}),
          ...(def.waitForCompletion != null ? { waitForCompletion: def.waitForCompletion } : {}),
          ...(def.timeoutMs != null ? { timeoutMs: def.timeoutMs } : {}),
          ...(def.provider != null ? { provider: def.provider } : {}),
          ...(def.model != null ? { model: def.model } : {}),
          ...(def.codingAgentProvider != null
            ? { codingAgentProvider: def.codingAgentProvider }
            : {}),
          ...(def.skills != null ? { skills: def.skills } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    // Default: tool node (no type field, has "tool" field)
    const rawToolName = (def.tool as string) || 'unknown_tool';
    const toolName = resolveToolName(rawToolName);
    return {
      id,
      type: 'toolNode',
      position,
      data: {
        toolName,
        toolArgs: (def.args as Record<string, unknown>) ?? {},
        label: (def.label as string) || formatToolName(toolName),
        ...(def.description != null ? { description: def.description } : {}),
      },
    };
  });

  const rfEdges: Edge[] = dedupedEdges.map((e, i) => ({
    id: `edge_${e.source}_${e.target}_${i}`,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
  }));

  return { nodes, edges: rfEdges, skippedNodes };
}

/**
 * Build a tool name resolver that fixes AI-generated names with missing dots.
 * e.g. "mcpgithublist_repositories" → "mcp.github.list_repositories"
 */
function buildToolNameResolver(availableToolNames?: string[]): (name: string) => string {
  if (!availableToolNames || availableToolNames.length === 0) {
    return (name) => name;
  }

  // Build a lookup: normalized (dots removed, lowercased) → original name
  const normalizedMap = new Map<string, string>();
  for (const toolName of availableToolNames) {
    const normalized = toolName.replace(/\./g, '').toLowerCase();
    normalizedMap.set(normalized, toolName);
  }

  // Also index by base name (last segment after dot) for partial matches
  const baseNameMap = new Map<string, string>();
  for (const toolName of availableToolNames) {
    const dot = toolName.lastIndexOf('.');
    const baseName = dot >= 0 ? toolName.substring(dot + 1) : toolName;
    // Only use base name if unambiguous (no duplicates)
    if (baseNameMap.has(baseName)) {
      baseNameMap.set(baseName, ''); // Mark as ambiguous
    } else {
      baseNameMap.set(baseName, toolName);
    }
  }

  return (name: string): string => {
    // Exact match — name is already correct
    if (availableToolNames.includes(name)) return name;

    // Try normalized match (removes dots and lowercases)
    const normalized = name.replace(/\./g, '').toLowerCase();
    const match = normalizedMap.get(normalized);
    if (match) return match;

    // Try base name match (e.g. "list_repositories" → "mcp.github.list_repositories")
    const baseMatch = baseNameMap.get(name);
    if (baseMatch) return baseMatch;

    // No resolution found — return as-is
    return name;
  };
}
