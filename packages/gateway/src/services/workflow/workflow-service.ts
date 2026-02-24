/**
 * Workflow Service — DAG Execution Engine
 *
 * Executes visual workflows as Directed Acyclic Graphs.
 * Uses topological sort for execution order, parallel execution within levels,
 * and template resolution for data passing between nodes.
 */

import {
  createWorkflowsRepository,
  type WorkflowNode,
  type LlmNodeData,
  type CodeNodeData,
  type ToolNodeData,
  type NodeResult,
  type WorkflowLog,
  type WorkflowLogStatus,
} from '../../db/repositories/workflows.js';
import {
  getServiceRegistry,
  Services,
  type IWorkflowService,
  type IToolService,
  sleep,
  withTimeout,
} from '@ownpilot/core';
import { getErrorMessage } from '../../routes/helpers.js';
import { getLog } from '../log.js';
import { topologicalSort, getDownstreamNodes, getDownstreamNodesByHandle, getForEachBodyNodes } from './dag-utils.js';
import { resolveTemplates } from './template-resolver.js';
import {
  executeNode,
  executeLlmNode,
  executeConditionNode,
  executeCodeNode,
  executeTransformerNode,
} from './node-executors.js';
import { executeForEachNode } from './foreach-executor.js';
import type { WorkflowProgressEvent } from './types.js';

const _log = getLog('WorkflowService');

export class WorkflowService implements IWorkflowService {
  private activeExecutions = new Map<string, AbortController>();

  private getToolService(): IToolService {
    return getServiceRegistry().get(Services.Tool);
  }

  /**
   * Execute a workflow by ID. Calls onProgress for each node start/complete.
   */
  async executeWorkflow(
    workflowId: string,
    userId: string,
    onProgress?: (event: WorkflowProgressEvent) => void
  ): Promise<WorkflowLog> {
    const repo = createWorkflowsRepository(userId);
    const workflow = await repo.get(workflowId);
    if (!workflow) throw new Error('Workflow not found');
    if (workflow.nodes.length === 0) throw new Error('Workflow has no nodes');

    // Check for active execution
    if (this.activeExecutions.has(workflowId)) {
      throw new Error('Workflow is already running');
    }

    const abortController = new AbortController();
    this.activeExecutions.set(workflowId, abortController);

    const wfLog = await repo.createLog(workflowId, workflow.name);
    const startTime = Date.now();

    try {
      // Filter out trigger nodes (they define when the workflow starts, not what it does)
      const executableNodes = workflow.nodes.filter((n) => n.type !== 'triggerNode');

      // Topological sort
      const levels = topologicalSort(executableNodes, workflow.edges);
      const nodeMap = new Map(executableNodes.map((n) => [n.id, n]));
      const nodeOutputs: Record<string, NodeResult> = {};

      // Pre-compute ForEach body nodes — these are handled internally by executeForEachNode
      const forEachBodyNodeSet = new Set<string>();
      for (const node of executableNodes) {
        if (node.type === 'forEachNode') {
          const { bodyNodes } = getForEachBodyNodes(node.id, workflow.edges);
          for (const id of bodyNodes) forEachBodyNodeSet.add(id);
        }
      }

      const toolService = this.getToolService();

      // Execute level by level
      for (const level of levels) {
        if (abortController.signal.aborted) {
          throw new Error('Workflow execution cancelled');
        }

        const results = await Promise.allSettled(
          level.map(async (nodeId) => {
            const node = nodeMap.get(nodeId);
            if (!node) throw new Error(`Node ${nodeId} not found`);

            // Skip if already marked (e.g., downstream of a failed node)
            if (nodeOutputs[nodeId]?.status === 'skipped') {
              return nodeOutputs[nodeId];
            }

            // Skip ForEach body nodes — they're executed inside executeForEachNode
            if (forEachBodyNodeSet.has(nodeId) && !nodeOutputs[nodeId]) {
              const skipped: NodeResult = {
                nodeId,
                status: 'skipped',
                completedAt: new Date().toISOString(),
              };
              nodeOutputs[nodeId] = skipped;
              return skipped;
            }

            if (node.type === 'forEachNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'forEach' });
              return await this.executeWithRetryAndTimeout(
                node,
                () =>
                  executeForEachNode(
                    node,
                    nodeOutputs,
                    workflow.variables,
                    workflow.edges,
                    nodeMap,
                    userId,
                    abortController.signal,
                    toolService,
                    onProgress,
                    repo,
                    wfLog.id
                  ),
                onProgress
              );
            }

            if (node.type === 'llmNode') {
              onProgress?.({
                type: 'node_start',
                nodeId,
                toolName: `llm:${(node.data as LlmNodeData).provider}`,
              });
              return await this.executeWithRetryAndTimeout(
                node,
                () => executeLlmNode(node, nodeOutputs, workflow.variables),
                onProgress
              );
            }

            if (node.type === 'conditionNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'condition' });
              return await this.executeWithRetryAndTimeout(
                node,
                async () => executeConditionNode(node, nodeOutputs, workflow.variables),
                onProgress
              );
            }

            if (node.type === 'codeNode') {
              const cd = node.data as CodeNodeData;
              onProgress?.({ type: 'node_start', nodeId, toolName: `code:${cd.language}` });
              return await this.executeWithRetryAndTimeout(
                node,
                () => executeCodeNode(node, nodeOutputs, workflow.variables, userId, toolService),
                onProgress
              );
            }

            if (node.type === 'transformerNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'transformer' });
              return await this.executeWithRetryAndTimeout(
                node,
                async () => executeTransformerNode(node, nodeOutputs, workflow.variables),
                onProgress
              );
            }

            const toolData = node.data as ToolNodeData;
            onProgress?.({ type: 'node_start', nodeId, toolName: toolData.toolName });

            return await this.executeWithRetryAndTimeout(
              node,
              () => executeNode(node, nodeOutputs, workflow.variables, userId, toolService),
              onProgress
            );
          })
        );

        // Process results
        for (let i = 0; i < level.length; i++) {
          const nodeId = level[i]!;
          const settled = results[i]!;

          if (settled.status === 'fulfilled') {
            nodeOutputs[nodeId] = settled.value;
          } else {
            nodeOutputs[nodeId] = {
              nodeId,
              status: 'error',
              error: getErrorMessage(settled.reason, 'Unexpected error'),
              completedAt: new Date().toISOString(),
            };
          }

          const nodeResult = nodeOutputs[nodeId]!;

          // Emit progress
          if (nodeResult.status === 'error') {
            onProgress?.({
              type: 'node_error',
              nodeId,
              error: nodeResult.error,
            });

            // Skip all downstream nodes
            const downstream = getDownstreamNodes(nodeId, workflow.edges);
            for (const downId of downstream) {
              if (!nodeOutputs[downId]) {
                nodeOutputs[downId] = {
                  nodeId: downId,
                  status: 'skipped',
                  completedAt: new Date().toISOString(),
                };
              }
            }
          } else {
            onProgress?.({
              type: 'node_complete',
              nodeId,
              status: nodeResult.status,
              output: nodeResult.output,
              resolvedArgs: nodeResult.resolvedArgs,
              branchTaken: nodeResult.branchTaken,
              durationMs: nodeResult.durationMs,
            });

            // Condition branching: skip nodes on the not-taken branch
            const node = nodeMap.get(nodeId);
            if (node?.type === 'conditionNode' && nodeResult.branchTaken) {
              const skippedHandle = nodeResult.branchTaken === 'true' ? 'false' : 'true';
              const skippedNodes = getDownstreamNodesByHandle(
                nodeId,
                skippedHandle,
                workflow.edges
              );
              for (const skipId of skippedNodes) {
                if (!nodeOutputs[skipId]) {
                  nodeOutputs[skipId] = {
                    nodeId: skipId,
                    status: 'skipped',
                    completedAt: new Date().toISOString(),
                  };
                  onProgress?.({ type: 'node_complete', nodeId: skipId, status: 'skipped' });
                }
              }
            }
          }

          // Update log incrementally
          await repo.updateLog(wfLog.id, { nodeResults: nodeOutputs });
        }
      }

      // Finalize
      const hasErrors = Object.values(nodeOutputs).some((r) => r.status === 'error');
      const finalStatus: WorkflowLogStatus = hasErrors ? 'failed' : 'completed';
      const totalDuration = Date.now() - startTime;

      await repo.updateLog(wfLog.id, {
        status: finalStatus,
        nodeResults: nodeOutputs,
        completedAt: new Date().toISOString(),
        durationMs: totalDuration,
      });
      await repo.markRun(workflowId);

      onProgress?.({
        type: 'done',
        logId: wfLog.id,
        logStatus: finalStatus,
        durationMs: totalDuration,
      });

      const finalLog = await repo.getLog(wfLog.id);
      return finalLog ?? wfLog;
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const errorMsg = getErrorMessage(error, 'Workflow execution failed');

      await repo.updateLog(wfLog.id, {
        status: 'failed',
        error: errorMsg,
        completedAt: new Date().toISOString(),
        durationMs: totalDuration,
      });

      onProgress?.({ type: 'error', error: errorMsg });

      const finalLog = await repo.getLog(wfLog.id);
      return finalLog ?? wfLog;
    } finally {
      this.activeExecutions.delete(workflowId);
    }
  }

  /**
   * Cancel a running workflow execution.
   */
  cancelExecution(workflowId: string): boolean {
    const controller = this.activeExecutions.get(workflowId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * Check if a workflow is currently executing.
   */
  isRunning(workflowId: string): boolean {
    return this.activeExecutions.has(workflowId);
  }

  /**
   * Wrap a node execution with optional retry and timeout.
   * Retries with exponential backoff on error. Timeout wraps async execution.
   * For condition/transformer nodes (sync vm), timeout is handled via vm options — skip outer timeout.
   */
  private async executeWithRetryAndTimeout(
    node: WorkflowNode,
    executeFn: () => Promise<NodeResult>,
    onProgress?: (event: WorkflowProgressEvent) => void
  ): Promise<NodeResult> {
    const data = node.data as unknown as Record<string, unknown>;
    const retryCount = typeof data.retryCount === 'number' ? data.retryCount : 0;
    const timeoutMs = typeof data.timeoutMs === 'number' ? data.timeoutMs : 0;
    const isVmNode = node.type === 'conditionNode' || node.type === 'transformerNode';

    let lastResult!: NodeResult;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
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
}

// ============================================================================
// Singleton
// ============================================================================

let _workflowService: WorkflowService | null = null;

export function getWorkflowService(): WorkflowService {
  if (!_workflowService) {
    _workflowService = new WorkflowService();
  }
  return _workflowService;
}
