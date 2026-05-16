/**
 * Workflow Executors — Control Flow
 *
 * Nodes that route execution based on data:
 *  - executeConditionNode — boolean branch on a JS expression
 *  - executeSwitchNode    — match expression result against named cases
 *  - executeMergeNode     — collect upstream outputs (waitAll | firstCompleted)
 */

import type {
  WorkflowNode,
  ConditionNodeData,
  SwitchNodeData,
  NodeResult,
} from '../../../db/repositories/workflows.js';
import { getErrorMessage } from '../../../routes/helpers.js';
import { resolveTemplates } from '../template-resolver.js';
import { log, safeVmEval } from './utils.js';

/**
 * Execute a condition node: evaluate a JS expression, return which branch to take.
 */
export function executeConditionNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as ConditionNodeData;

    const resolvedExpr = resolveTemplates({ _expr: data.expression }, nodeOutputs, variables)
      ._expr as string;

    const evalContext: Record<string, unknown> = { ...variables };
    let lastOutput: unknown = undefined;
    for (const [nid, result] of Object.entries(nodeOutputs)) {
      evalContext[nid] = result.output;
      lastOutput = result.output;
    }
    evalContext.data = lastOutput;

    const vmTimeout = (node.data as ConditionNodeData).timeoutMs ?? 5000;
    const result = safeVmEval(resolvedExpr, evalContext, vmTimeout);
    const branch = Boolean(result);
    const durationMs = Date.now() - startTime;

    log.info('Condition evaluated', {
      nodeId: node.id,
      result: branch ? 'true' : 'false',
      durationMs,
    });

    return {
      nodeId: node.id,
      status: 'success',
      output: branch,
      branchTaken: branch ? 'true' : 'false',
      durationMs,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Condition evaluation failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a Switch node: evaluate expression, match against cases.
 */
export function executeSwitchNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as SwitchNodeData;

    const resolvedExpr = resolveTemplates({ _expr: data.expression }, nodeOutputs, variables)
      ._expr as string;

    const evalContext: Record<string, unknown> = { ...variables };
    let lastOutput: unknown = undefined;
    for (const [nid, result] of Object.entries(nodeOutputs)) {
      evalContext[nid] = result.output;
      lastOutput = result.output;
    }
    evalContext.data = lastOutput;

    const vmTimeout = data.timeoutMs ?? 5000;
    const result = safeVmEval(resolvedExpr, evalContext, vmTimeout);
    const resultStr = String(result);

    const matchedCase = data.cases.find((c) => c.value === resultStr);
    const branchTaken = matchedCase ? matchedCase.label : 'default';

    log.info('Switch evaluated', { nodeId: node.id, matchedCase: branchTaken, value: resultStr });

    return {
      nodeId: node.id,
      status: 'success',
      output: result,
      branchTaken,
      resolvedArgs: {
        expression: resolvedExpr,
        evaluatedValue: resultStr,
        matchedCase: branchTaken,
      },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Switch evaluation failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a Merge node: collect all incoming node outputs into a single array/object.
 */
export function executeMergeNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  _variables: Record<string, unknown>,
  incomingNodeIds: string[]
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as unknown as Record<string, unknown>;
    const mode = (data.mode as string) || 'waitAll';

    const collected: Record<string, unknown> = {};
    for (const nid of incomingNodeIds) {
      const result = nodeOutputs[nid];
      if (result) {
        collected[nid] = result.output;
      }
    }

    let output: Record<string, unknown>;
    if (mode === 'firstCompleted') {
      let firstNodeId: string | undefined;
      let firstOutput: unknown;
      for (const nid of incomingNodeIds) {
        const val = collected[nid];
        if (val !== null && val !== undefined) {
          firstNodeId = nid;
          firstOutput = val;
          break;
        }
      }
      if (firstNodeId !== undefined) {
        output = {
          mode,
          results: { [firstNodeId]: firstOutput },
          count: 1,
          selectedNode: firstNodeId,
        };
      } else {
        output = { mode, results: {}, count: 0 };
      }
    } else {
      output = { mode, results: collected, count: Object.keys(collected).length };
    }

    log.info('Merge completed', {
      nodeId: node.id,
      mode,
      inputCount: Object.keys(collected).length,
    });

    return {
      nodeId: node.id,
      status: 'success',
      output,
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Merge node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}
