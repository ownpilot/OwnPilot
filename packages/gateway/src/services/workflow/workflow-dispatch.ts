/**
 * Workflow Dispatch — Node type dispatch and execution helpers
 *
 * Extracted from workflow-service.ts: the giant switch-on-node-type that
 * maps each workflow node to its executor function, plus the retry/timeout
 * wrapper and shared helpers.
 *
 * The dispatch function takes callbacks for:
 * - retryFn: executeWithRetryAndTimeout (for wrapping executor calls)
 * - subWorkflowExecutor: executeWorkflow (for subWorkflowNode recursion)
 * - subWorkflowCancel: cancelExecution (for sub-workflow abort cleanup)
 *
 * DispatchNodeContext and DispatchCallbacks are defined in workflow-context.ts
 * and re-exported here for backward compatibility.
 */

import type {
  WorkflowNode,
  NodeResult,
  LlmNodeData,
  CodeNodeData,
  ToolNodeData,
} from '../../db/repositories/workflows/index.js';
import { createWorkflowsRepository } from '../../db/repositories/workflows/index.js';
import { createWorkflowApprovalsRepository } from '../../db/repositories/workflows/approvals.js';
import { sleep, withTimeout } from '@ownpilot/core/types';
import type { DispatchNodeContext, DispatchCallbacks } from './workflow-context.js';
import { getErrorMessage } from '../../utils/common.js';
import { getLog } from '../log.js';
import { resolveTemplates } from './template-resolver.js';
import { WORKFLOW_NODE_TYPES } from './node-types.js';
import type { WorkflowProgressEvent } from './types.js';
import { nodeDataField, nodeDataRecord } from './node-data.js';
import {
  executeNode,
  executeLlmNode,
  executeConditionNode,
  executeCodeNode,
  executeTransformerNode,
  executeHttpRequestNode,
  executeDelayNode,
  executeSwitchNode,
  executeNotificationNode,
  executeMergeNode,
  executeDataStoreNode,
  executeSchemaValidatorNode,
  executeFilterNode,
  executeMapNode,
  executeAggregateNode,
  executeWebhookResponseNode,
  executeClawNode,
} from './node-executors.js';

const log = getLog('WorkflowService');

// ============================================================================
// Type-safe node data helpers
// ============================================================================

export { nodeDataField, nodeDataRecord } from './node-data.js';

// ============================================================================
// Dry-run helper
// ============================================================================

/** Creates a dry-run node result: resolvedArgs are shown but no side-effects occur. */
export function dryRunResult(
  node: WorkflowNode,
  resolvedArgs: Record<string, unknown>
): NodeResult {
  return {
    nodeId: node.id,
    status: 'success',
    output: { dryRun: true, type: node.type, resolvedArgs },
    resolvedArgs,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 0,
  };
}

// ============================================================================
// Approval pause error (signals workflow paused for approval, not a failure)
// ============================================================================

export class ApprovalPauseError extends Error {
  approvalId: string;
  constructor(approvalId: string) {
    super('Workflow paused for approval');
    this.name = 'ApprovalPauseError';
    this.approvalId = approvalId;
  }
}

// ============================================================================
// Retry & timeout wrapper
// ============================================================================

/**
 * Execute a node function with configurable retry count and timeout.
 * Checks abortSignal between retry attempts so cancelled workflows stop retrying promptly.
 * VM-based nodes (condition, transformer, switch) skip the timeout since
 * they run synchronously in-process.
 */
export async function executeWithRetryAndTimeout(
  node: WorkflowNode,
  executeFn: () => Promise<NodeResult>,
  abortSignal: AbortSignal,
  onProgress?: (event: WorkflowProgressEvent) => void
): Promise<NodeResult> {
  const data = nodeDataRecord(node);
  const retryCount = typeof data.retryCount === 'number' ? data.retryCount : 0;
  const timeoutMs = typeof data.timeoutMs === 'number' ? data.timeoutMs : 0;
  const isVmNode =
    node.type === 'conditionNode' || node.type === 'transformerNode' || node.type === 'switchNode';

  let lastResult!: NodeResult;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    // Respect cancellation between retry attempts
    if (abortSignal.aborted) {
      throw new Error('Workflow execution cancelled');
    }

    if (attempt > 0) {
      const delay = Math.min(100 * Math.pow(2, attempt - 1), 5000);
      onProgress?.({ type: 'node_retry', nodeId: node.id, retryAttempt: attempt });
      await sleep(delay);
    }

    const attemptStart = Date.now();
    try {
      if (timeoutMs > 0 && !isVmNode) {
        lastResult = await withTimeout(executeFn(), timeoutMs);
      } else {
        lastResult = await executeFn();
      }
    } catch (error) {
      lastResult = {
        nodeId: node.id,
        status: 'error',
        error: getErrorMessage(error, 'Node execution failed'),
        durationMs: Date.now() - attemptStart,
        startedAt: new Date(attemptStart).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    if (lastResult.status !== 'error') {
      lastResult.retryAttempts = attempt;
      return lastResult;
    }
  }

  lastResult.retryAttempts = retryCount;
  return lastResult;
}

// ============================================================================
// Dispatch context and callbacks
// (Moved to workflow-context.ts as part of Phase 2 extraction)
// Re-export here for backward compatibility
// ============================================================================

export type { DispatchNodeContext, DispatchCallbacks } from './workflow-context.js';

// ============================================================================
// Node dispatch (the giant switch)
// ============================================================================

export async function dispatchNode(
  ctx: DispatchNodeContext,
  cb: DispatchCallbacks
): Promise<NodeResult> {
  const {
    node,
    nodeId,
    nodeOutputs,
    workflow,
    nodeMap: _nodeMap,
    userId,
    toolService,
    abortSignal,
    onProgress,
    dryRun,
    repo,
    logId,
    workflowId,
    depth,
  } = ctx;
  void _nodeMap;

  // ── llmNode ──
  if (node.type === 'llmNode') {
    onProgress?.({
      type: 'node_start',
      nodeId,
      toolName: `llm:${(node.data as LlmNodeData).provider}`,
    });
    if (dryRun) {
      const args = resolveTemplates(
        { userMessage: (node.data as LlmNodeData).userMessage },
        nodeOutputs,
        workflow.variables
      );
      return dryRunResult(node, args);
    }
    return await cb.retryFn(
      node,
      () => executeLlmNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── conditionNode ──
  if (node.type === 'conditionNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'condition' });
    return await cb.retryFn(
      node,
      async () => executeConditionNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── codeNode ──
  if (node.type === 'codeNode') {
    const cd = node.data as CodeNodeData;
    onProgress?.({ type: 'node_start', nodeId, toolName: `code:${cd.language}` });
    return await cb.retryFn(
      node,
      () => executeCodeNode(node, nodeOutputs, workflow.variables, userId, toolService),
      abortSignal,
      onProgress
    );
  }

  // ── transformerNode ──
  if (node.type === 'transformerNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'transformer' });
    return await cb.retryFn(
      node,
      async () => executeTransformerNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── httpRequestNode ──
  if (node.type === 'httpRequestNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'httpRequest' });
    if (dryRun) {
      const args = resolveTemplates(
        {
          url: nodeDataField(node, 'url'),
          method: nodeDataField(node, 'method'),
        },
        nodeOutputs,
        workflow.variables
      );
      return dryRunResult(node, args);
    }
    return await cb.retryFn(
      node,
      () => executeHttpRequestNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── delayNode ──
  if (node.type === 'delayNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'delay' });
    if (dryRun) {
      return dryRunResult(node, {
        duration: nodeDataField(node, 'duration'),
        unit: nodeDataField(node, 'unit'),
      });
    }
    return await cb.retryFn(
      node,
      () => executeDelayNode(node, nodeOutputs, workflow.variables, abortSignal),
      abortSignal,
      onProgress
    );
  }

  // ── switchNode ──
  if (node.type === 'switchNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'switch' });
    return await cb.retryFn(
      node,
      async () => executeSwitchNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── notificationNode ──
  if (node.type === 'notificationNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'notification' });
    if (dryRun) {
      const args = resolveTemplates(
        { message: nodeDataField(node, 'message') },
        nodeOutputs,
        workflow.variables
      );
      return dryRunResult(node, {
        ...args,
        severity: nodeDataField(node, 'severity'),
      });
    }
    return await cb.retryFn(
      node,
      async () => executeNotificationNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── parallelNode ──
  if (node.type === 'parallelNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'parallel' });
    const parallelStart = Date.now();
    const branchCount = (nodeDataField(node, 'branchCount') as number) || 2;

    if (dryRun) return dryRunResult(node, { branchCount });

    try {
      const branchResults: Record<string, unknown> = {};
      const allTargetNodeIds: string[] = [];
      const branchPromises = Array.from({ length: branchCount }, async (_, i) => {
        const handle = `branch-${i}`;
        const directTargets = workflow.edges
          .filter((e) => e.source === nodeId && e.sourceHandle === handle)
          .map((e) => e.target);
        allTargetNodeIds.push(...directTargets);
        branchResults[handle] = { targets: directTargets };
      });
      await Promise.all(branchPromises);

      log.info('Parallel branching', { nodeId, branchCount, targets: allTargetNodeIds });
      const result: NodeResult = {
        nodeId,
        status: 'success',
        output: { branches: branchResults, branchCount },
        durationMs: Date.now() - parallelStart,
        startedAt: new Date(parallelStart).toISOString(),
        completedAt: new Date().toISOString(),
      };
      nodeOutputs[nodeId] = result;
      onProgress?.({
        type: 'node_complete',
        nodeId,
        status: 'success',
        output: result.output,
        durationMs: result.durationMs,
      });
      return result;
    } catch (error) {
      return {
        nodeId,
        status: 'error' as const,
        error: getErrorMessage(error, 'Parallel execution failed'),
        startedAt: new Date(parallelStart).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - parallelStart,
      };
    }
  }

  // ── mergeNode ──
  if (node.type === 'mergeNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'merge' });
    const incomingNodeIds = workflow.edges.filter((e) => e.target === nodeId).map((e) => e.source);
    return await cb.retryFn(
      node,
      async () => executeMergeNode(node, nodeOutputs, workflow.variables, incomingNodeIds),
      abortSignal,
      onProgress
    );
  }

  // ── dataStoreNode ──
  if (node.type === 'dataStoreNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'dataStore' });
    return await cb.retryFn(
      node,
      async () => executeDataStoreNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── schemaValidatorNode ──
  if (node.type === 'schemaValidatorNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'schemaValidator' });
    return await cb.retryFn(
      node,
      async () => executeSchemaValidatorNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── filterNode ──
  if (node.type === 'filterNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'filter' });
    return await cb.retryFn(
      node,
      async () => executeFilterNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── mapNode ──
  if (node.type === 'mapNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'map' });
    return await cb.retryFn(
      node,
      async () => executeMapNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── aggregateNode ──
  if (node.type === 'aggregateNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'aggregate' });
    return await cb.retryFn(
      node,
      async () => executeAggregateNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── webhookResponseNode ──
  if (node.type === 'webhookResponseNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'webhookResponse' });
    return await cb.retryFn(
      node,
      async () => executeWebhookResponseNode(node, nodeOutputs, workflow.variables),
      abortSignal,
      onProgress
    );
  }

  // ── clawNode ──
  if (node.type === 'clawNode') {
    onProgress?.({ type: 'node_start', nodeId, toolName: 'claw' });
    if (dryRun) {
      const args = resolveTemplates(
        {
          name: nodeDataField(node, 'name'),
          mission: nodeDataField(node, 'mission'),
        },
        nodeOutputs,
        workflow.variables
      );
      return dryRunResult(node, {
        ...args,
        mode: nodeDataField(node, 'mode'),
        sandbox: nodeDataField(node, 'sandbox'),
      });
    }
    return await cb.retryFn(
      node,
      () => executeClawNode(node, nodeOutputs, workflow.variables, userId, abortSignal),
      abortSignal,
      onProgress
    );
  }

  // ── stickyNoteNode ──
  if (node.type === 'stickyNoteNode') {
    return {
      nodeId,
      status: 'skipped' as const,
      output: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
  }

  // ── approvalNode ──
  if (node.type === 'approvalNode') {
    const apData = nodeDataRecord(node);
    onProgress?.({ type: 'node_start', nodeId, toolName: 'approval' });

    if (dryRun) {
      return dryRunResult(node, {
        approvalMessage: apData.approvalMessage,
        timeoutMinutes: apData.timeoutMinutes,
      });
    }

    const approvalRepo = createWorkflowApprovalsRepository(userId);
    const timeoutMin =
      typeof apData.timeoutMinutes === 'number' ? apData.timeoutMinutes : undefined;
    const approval = await approvalRepo.create({
      workflowLogId: logId,
      workflowId,
      nodeId,
      context: {
        approvalMessage: apData.approvalMessage,
        nodeLabel: apData.label,
        completedNodes: Object.keys(nodeOutputs).length,
      },
      message: (apData.approvalMessage as string) ?? undefined,
      expiresAt: timeoutMin ? new Date(Date.now() + timeoutMin * 60000) : undefined,
    });

    const approvalResult: NodeResult = {
      nodeId,
      status: 'running',
      output: { approvalId: approval.id, status: 'awaiting_approval' },
      startedAt: new Date().toISOString(),
    };
    nodeOutputs[nodeId] = approvalResult;

    await repo.updateLog(logId, { status: 'awaiting_approval', nodeResults: nodeOutputs });
    onProgress?.({
      type: 'node_complete',
      nodeId,
      status: 'running',
      output: approvalResult.output,
    });
    onProgress?.({ type: 'done', logId, logStatus: 'awaiting_approval' });

    throw new ApprovalPauseError(approval.id);
  }

  // ── subWorkflowNode ──
  if (node.type === 'subWorkflowNode') {
    const swData = nodeDataRecord(node);
    const subWorkflowId = swData.subWorkflowId as string | undefined;
    onProgress?.({
      type: 'node_start',
      nodeId,
      toolName: `subWorkflow:${swData.subWorkflowName ?? subWorkflowId ?? 'unknown'}`,
    });

    if (!subWorkflowId) {
      return {
        nodeId,
        status: 'error' as const,
        error: 'Sub-workflow node has no target workflow configured',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
      };
    }

    const nodeMaxDepth = typeof swData.maxDepth === 'number' ? swData.maxDepth : 5;
    if (depth >= nodeMaxDepth) {
      return {
        nodeId,
        status: 'error' as const,
        error: `Max sub-workflow depth ${nodeMaxDepth} exceeded (current depth: ${depth})`,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
      };
    }

    if (dryRun) {
      const inputMapping = (swData.inputMapping ?? {}) as Record<string, string>;
      const resolvedMapping = resolveTemplates(inputMapping, nodeOutputs, workflow.variables);
      return dryRunResult(node, {
        subWorkflowId,
        inputMapping: resolvedMapping,
        depth: depth + 1,
      });
    }

    return await cb.retryFn(
      node,
      async () => {
        // Check abort signal at sub-workflow start
        if (abortSignal.aborted) {
          throw new Error('Workflow execution cancelled');
        }
        const startTime = Date.now();
        const inputMapping = (swData.inputMapping ?? {}) as Record<string, string>;
        const subVars = resolveTemplates(inputMapping, nodeOutputs, workflow.variables) as Record<
          string,
          unknown
        >;

        const subRepo = createWorkflowsRepository(userId);
        const subWorkflow = await subRepo.get(subWorkflowId);
        if (!subWorkflow) {
          return {
            nodeId,
            status: 'error' as const,
            error: `Sub-workflow ${subWorkflowId} not found`,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
          };
        }
        if (subWorkflow.userId && subWorkflow.userId !== userId) {
          return {
            nodeId,
            status: 'error' as const,
            error: `Sub-workflow ${subWorkflowId} belongs to a different user`,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
          };
        }
        if (abortSignal.aborted) {
          return {
            nodeId,
            status: 'error' as const,
            error: 'Workflow execution cancelled',
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
          };
        }

        const mergedVars = { ...subWorkflow.variables, ...subVars };
        const origVars = subWorkflow.variables;
        subWorkflow.variables = mergedVars;

        const onParentAbort = () => {
          cb.subWorkflowCancel(subWorkflowId);
        };
        abortSignal.addEventListener('abort', onParentAbort, { once: true });

        let subLog;
        try {
          subLog = await cb.subWorkflowExecutor(subWorkflowId, userId, undefined, {
            dryRun,
            depth: depth + 1,
          });
        } finally {
          abortSignal.removeEventListener('abort', onParentAbort);
        }

        subWorkflow.variables = origVars;

        const subResults = subLog.nodeResults;
        const successResults = Object.values(subResults).filter(
          (r) => r.status === 'success' && r.output !== undefined
        );
        const lastOutput =
          successResults.length > 0 ? successResults[successResults.length - 1]!.output : null;

        return {
          nodeId,
          status: subLog.status === 'completed' ? ('success' as const) : ('error' as const),
          output: lastOutput,
          resolvedArgs: subVars,
          error: subLog.status === 'failed' ? (subLog.error ?? 'Sub-workflow failed') : undefined,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      },
      abortSignal,
      onProgress
    );
  }

  // ── Unknown node type guard ──
  if (node.type && !WORKFLOW_NODE_TYPES.has(node.type)) {
    const now = new Date().toISOString();
    return {
      nodeId,
      status: 'error',
      error: `Unknown node type "${node.type}"`,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
    };
  }

  // ── Default: toolNode ──
  const toolData = node.data as ToolNodeData;
  onProgress?.({ type: 'node_start', nodeId, toolName: toolData.toolName });
  if (dryRun) {
    const args = resolveTemplates(toolData.toolArgs ?? {}, nodeOutputs, workflow.variables);
    return dryRunResult(node, args);
  }
  return await cb.retryFn(
    node,
    () => executeNode(node, nodeOutputs, workflow.variables, userId, toolService),
    abortSignal,
    onProgress
  );
}
