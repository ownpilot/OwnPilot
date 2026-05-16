/**
 * Workflow Executors — Data
 *
 * Nodes that read, transform, or aggregate data without external calls:
 *  - executeDataStoreNode         — namespace-scoped get/set/delete/list/has
 *  - executeSchemaValidatorNode   — validate upstream data against a JSON schema
 *  - executeFilterNode            — array filter via per-element expression
 *  - executeMapNode               — array map via per-element expression
 *  - executeAggregateNode         — count/sum/avg/min/max/groupBy/flatten/unique
 *
 * Also exports `clearDataStore` for tests / namespace cleanup.
 */

import type {
  WorkflowNode,
  DataStoreNodeData,
  SchemaValidatorNodeData,
  FilterNodeData,
  MapNodeData,
  AggregateNodeData,
  NodeResult,
} from '../../../db/repositories/workflows.js';
import { getErrorMessage } from '../../../routes/helpers.js';
import { resolveTemplates } from '../template-resolver.js';
import { log, safeVmEval, MAX_ARRAY_EVAL_SIZE } from './utils.js';

// ============================================================================
// In-memory data store for DataStore nodes (namespace -> key -> value)
// ============================================================================

const MAX_DATASTORE_ENTRIES = 10_000;
const workflowDataStore = new Map<string, Map<string, unknown>>();

function evictOldest(): void {
  // Map iteration order is insertion order — first key is the oldest namespace
  const firstKey = workflowDataStore.keys().next().value;
  if (firstKey !== undefined) {
    workflowDataStore.delete(firstKey);
    log.info('DataStore evicted oldest namespace due to size limit', { namespace: firstKey });
  }
}

function getDataStoreSize(): number {
  let total = 0;
  for (const store of workflowDataStore.values()) {
    total += store.size;
  }
  return total;
}

/**
 * Clear the data store. If a namespace is provided, only that namespace is
 * cleared; otherwise the entire store is wiped.
 */
export function clearDataStore(namespace?: string): void {
  if (namespace) {
    workflowDataStore.delete(namespace);
  } else {
    workflowDataStore.clear();
  }
}

/**
 * Execute a DataStore node: get/set/delete/list/has on a namespace-scoped in-memory Map.
 */
export function executeDataStoreNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as DataStoreNodeData;
    const resolved = resolveTemplates(
      { _key: data.key, _value: data.value, _ns: data.namespace ?? 'default' },
      nodeOutputs,
      variables
    );
    const ns = resolved._ns as string;
    const key = resolved._key as string;

    if (!workflowDataStore.has(ns)) {
      workflowDataStore.set(ns, new Map());
    }
    const store = workflowDataStore.get(ns)!;

    let output: unknown;
    switch (data.operation) {
      case 'get':
        output = store.get(key) ?? null;
        break;
      case 'set': {
        const prev = store.get(key) ?? null;
        store.set(key, resolved._value);
        while (getDataStoreSize() > MAX_DATASTORE_ENTRIES) {
          evictOldest();
        }
        output = { previousValue: prev };
        break;
      }
      case 'delete':
        output = { existed: store.delete(key) };
        break;
      case 'list':
        output = [...store.keys()];
        break;
      case 'has':
        output = store.has(key);
        break;
    }

    log.info('DataStore operation completed', {
      nodeId: node.id,
      operation: data.operation,
      ns,
      key,
    });
    return {
      nodeId: node.id,
      status: 'success',
      output,
      resolvedArgs: { operation: data.operation, namespace: ns, key },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'DataStore node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a SchemaValidator node: validate upstream data against a JSON schema.
 */
export function executeSchemaValidatorNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  _variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as SchemaValidatorNodeData;
    const schema = data.schema;
    const validationErrors: string[] = [];

    let inputData: unknown = undefined;
    for (const result of Object.values(nodeOutputs)) {
      inputData = result.output;
    }

    if (schema.type === 'object' && typeof inputData === 'object' && inputData !== null) {
      const obj = inputData as Record<string, unknown>;
      const required = (schema.required as string[]) ?? [];
      for (const field of required) {
        if (!(field in obj)) validationErrors.push(`Missing required field: "${field}"`);
      }
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in obj && propSchema.type && typeof obj[key] !== propSchema.type) {
          validationErrors.push(
            `Field "${key}" expected type "${propSchema.type}", got "${typeof obj[key]}"`
          );
        }
      }
    } else if (schema.type && typeof inputData !== schema.type) {
      validationErrors.push(`Expected type "${schema.type as string}", got "${typeof inputData}"`);
    }

    const valid = validationErrors.length === 0;
    log.info('Schema validation completed', {
      nodeId: node.id,
      valid,
      errorCount: validationErrors.length,
    });

    if (!valid && data.strict) {
      return {
        nodeId: node.id,
        status: 'error',
        output: { valid, errors: validationErrors },
        error: `Validation failed: ${validationErrors.join('; ')}`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    return {
      nodeId: node.id,
      status: 'success',
      output: { valid, errors: validationErrors },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Schema validation failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a Filter node: filter an array by a condition expression.
 */
export function executeFilterNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as FilterNodeData;

    const resolved = resolveTemplates({ _arr: data.arrayExpression }, nodeOutputs, variables);
    const arr = resolved._arr;
    if (!Array.isArray(arr)) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `arrayExpression did not resolve to an array (got ${typeof arr})`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    const vmTimeout = data.timeoutMs ?? 5000;
    if (arr.length > MAX_ARRAY_EVAL_SIZE) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `Array too large for per-element evaluation (${arr.length} > ${MAX_ARRAY_EVAL_SIZE})`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
    const filtered = arr.filter((item, index) => {
      const ctx = { item, index, ...variables };
      return safeVmEval(data.condition, ctx, vmTimeout);
    });

    log.info('Filter completed', {
      nodeId: node.id,
      inputCount: arr.length,
      outputCount: filtered.length,
    });
    return {
      nodeId: node.id,
      status: 'success',
      output: filtered,
      resolvedArgs: { condition: data.condition, inputCount: arr.length },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Filter node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a Map node: transform each element of an array via an expression.
 */
export function executeMapNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as MapNodeData;

    const resolved = resolveTemplates({ _arr: data.arrayExpression }, nodeOutputs, variables);
    const arr = resolved._arr;
    if (!Array.isArray(arr)) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `arrayExpression did not resolve to an array (got ${typeof arr})`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    const vmTimeout = data.timeoutMs ?? 5000;
    if (arr.length > MAX_ARRAY_EVAL_SIZE) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `Array too large for per-element evaluation (${arr.length} > ${MAX_ARRAY_EVAL_SIZE})`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
    const mapped = arr.map((item, index) => {
      const ctx = { item, index, ...variables };
      return safeVmEval(data.expression, ctx, vmTimeout);
    });

    log.info('Map completed', { nodeId: node.id, count: arr.length });
    return {
      nodeId: node.id,
      status: 'success',
      output: mapped,
      resolvedArgs: { expression: data.expression, inputCount: arr.length },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Map node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute an Aggregate node: perform aggregate operations on an array.
 */
export function executeAggregateNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as AggregateNodeData;

    const resolved = resolveTemplates({ _arr: data.arrayExpression }, nodeOutputs, variables);
    const arr = resolved._arr;
    if (!Array.isArray(arr)) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `arrayExpression did not resolve to an array (got ${typeof arr})`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    let output: unknown;
    const getVal = (item: unknown): number => {
      if (data.field && typeof item === 'object' && item !== null) {
        return Number((item as Record<string, unknown>)[data.field]);
      }
      return Number(item);
    };

    switch (data.operation) {
      case 'count':
        output = arr.length;
        break;
      case 'sum':
        output = arr.reduce((acc, item) => acc + getVal(item), 0);
        break;
      case 'avg':
        output = arr.length > 0 ? arr.reduce((acc, item) => acc + getVal(item), 0) / arr.length : 0;
        break;
      case 'min':
        output = arr.length > 0 ? Math.min(...arr.map(getVal)) : null;
        break;
      case 'max':
        output = arr.length > 0 ? Math.max(...arr.map(getVal)) : null;
        break;
      case 'groupBy': {
        const groups: Record<string, unknown[]> = {};
        for (const item of arr) {
          const key =
            data.field && typeof item === 'object' && item !== null
              ? String((item as Record<string, unknown>)[data.field])
              : String(item);
          if (!groups[key]) groups[key] = [];
          groups[key].push(item);
        }
        output = groups;
        break;
      }
      case 'flatten':
        output = arr.flat();
        break;
      case 'unique':
        if (data.field) {
          const seen = new Set<unknown>();
          output = arr.filter((item) => {
            const val =
              typeof item === 'object' && item !== null
                ? (item as Record<string, unknown>)[data.field!]
                : item;
            if (seen.has(val)) return false;
            seen.add(val);
            return true;
          });
        } else {
          output = [...new Set(arr)];
        }
        break;
    }

    log.info('Aggregate completed', {
      nodeId: node.id,
      operation: data.operation,
      inputCount: arr.length,
    });
    return {
      nodeId: node.id,
      status: 'success',
      output,
      resolvedArgs: { operation: data.operation, field: data.field, inputCount: arr.length },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Aggregate node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}
