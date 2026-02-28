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
  type SwitchNodeData,
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
import { createWorkflowApprovalsRepository } from '../../db/repositories/workflow-approvals.js';
import { getErrorMessage } from '../../routes/helpers.js';
import { getLog } from '../log.js';
import {
  topologicalSort,
  getDownstreamNodes,
  getDownstreamNodesByHandle,
  getForEachBodyNodes,
} from './dag-utils.js';
import { resolveTemplates } from './template-resolver.js';
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
    onProgress?: (event: WorkflowProgressEvent) => void,
    options?: { dryRun?: boolean; depth?: number; inputs?: Record<string, unknown> }
  ): Promise<WorkflowLog> {
    const dryRun = options?.dryRun ?? false;
    const depth = options?.depth ?? 0;
    const repo = createWorkflowsRepository(userId);
    const workflow = await repo.get(workflowId);
    if (!workflow) throw new Error('Workflow not found');
    if (workflow.nodes.length === 0) throw new Error('Workflow has no nodes');

    // Merge input parameters into variables under __inputs namespace
    if (options?.inputs) {
      workflow.variables = { ...workflow.variables, __inputs: options.inputs };
    }

    // Check for active execution
    if (this.activeExecutions.has(workflowId)) {
      throw new Error('Workflow is already running');
    }

    const abortController = new AbortController();
    this.activeExecutions.set(workflowId, abortController);

    const wfLog = await repo.createLog(workflowId, workflow.name);
    const startTime = Date.now();

    // Emit started event so consumers (e.g. API endpoint) can capture the logId
    onProgress?.({ type: 'started', logId: wfLog.id });

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

      // Build alias map: nodeId → alias name (from outputAlias field on any node)
      const aliasToNodeId = new Map<string, string>();
      for (const node of executableNodes) {
        const alias = (node.data as unknown as Record<string, unknown>).outputAlias as
          | string
          | undefined;
        if (alias && typeof alias === 'string' && alias.trim()) {
          aliasToNodeId.set(alias.trim(), node.id);
        }
      }

      // Find global error handler node (max 1, validated at save time)
      const errorHandlerNode = executableNodes.find((n) => n.type === 'errorHandlerNode');
      const errorHandlerContinueOnSuccess =
        errorHandlerNode &&
        (errorHandlerNode.data as unknown as Record<string, unknown>).continueOnSuccess === true;

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

            // Skip error handler node during normal execution — invoked only on errors
            if (node.type === 'errorHandlerNode') {
              if (!nodeOutputs[nodeId]) {
                nodeOutputs[nodeId] = {
                  nodeId,
                  status: 'skipped',
                  completedAt: new Date().toISOString(),
                };
              }
              return nodeOutputs[nodeId];
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
              if (dryRun) {
                const args = resolveTemplates(
                  { userMessage: (node.data as LlmNodeData).userMessage },
                  nodeOutputs,
                  workflow.variables
                );
                return dryRunResult(node, args);
              }
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

            if (node.type === 'httpRequestNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'httpRequest' });
              if (dryRun) {
                const args = resolveTemplates(
                  {
                    url: (node.data as unknown as Record<string, unknown>).url,
                    method: (node.data as unknown as Record<string, unknown>).method,
                  },
                  nodeOutputs,
                  workflow.variables
                );
                return dryRunResult(node, args);
              }
              return await this.executeWithRetryAndTimeout(
                node,
                () => executeHttpRequestNode(node, nodeOutputs, workflow.variables),
                onProgress
              );
            }

            if (node.type === 'delayNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'delay' });
              if (dryRun) {
                return dryRunResult(node, {
                  duration: (node.data as unknown as Record<string, unknown>).duration,
                  unit: (node.data as unknown as Record<string, unknown>).unit,
                });
              }
              return await this.executeWithRetryAndTimeout(
                node,
                () =>
                  executeDelayNode(node, nodeOutputs, workflow.variables, abortController.signal),
                onProgress
              );
            }

            if (node.type === 'switchNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'switch' });
              return await this.executeWithRetryAndTimeout(
                node,
                async () => executeSwitchNode(node, nodeOutputs, workflow.variables),
                onProgress
              );
            }

            if (node.type === 'notificationNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'notification' });
              if (dryRun) {
                const args = resolveTemplates(
                  { message: (node.data as unknown as Record<string, unknown>).message },
                  nodeOutputs,
                  workflow.variables
                );
                return dryRunResult(node, {
                  ...args,
                  severity: (node.data as unknown as Record<string, unknown>).severity,
                });
              }
              return await this.executeWithRetryAndTimeout(
                node,
                async () => executeNotificationNode(node, nodeOutputs, workflow.variables),
                onProgress
              );
            }

            if (node.type === 'parallelNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'parallel' });
              const parallelStart = Date.now();

              const branchCount =
                ((node.data as unknown as Record<string, unknown>).branchCount as number) || 2;

              if (dryRun) {
                return dryRunResult(node, { branchCount });
              }

              try {
                // Parallel node: execute all branch downstream nodes concurrently.
                // Each branch is identified by 'branch-0', 'branch-1', etc. sourceHandle.
                const branchResults: Record<string, unknown> = {};

                // Identify direct targets for each branch handle
                const branchPromises = Array.from({ length: branchCount }, async (_, i) => {
                  const handle = `branch-${i}`;
                  const directTargets = workflow.edges
                    .filter((e) => e.source === nodeId && e.sourceHandle === handle)
                    .map((e) => e.target);
                  // For now, the parallel node just signals which branches exist.
                  // Downstream nodes will be executed naturally by topological sort.
                  branchResults[handle] = { targets: directTargets };
                });

                await Promise.all(branchPromises);

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

            if (node.type === 'mergeNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'merge' });
              // Find all upstream nodes that feed into this merge node
              const incomingNodeIds = workflow.edges
                .filter((e) => e.target === nodeId)
                .map((e) => e.source);
              return await this.executeWithRetryAndTimeout(
                node,
                async () =>
                  executeMergeNode(node, nodeOutputs, workflow.variables, incomingNodeIds),
                onProgress
              );
            }

            // Sticky notes are annotation-only — skip during execution
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

            if (node.type === 'approvalNode') {
              const apData = node.data as unknown as Record<string, unknown>;
              onProgress?.({ type: 'node_start', nodeId, toolName: 'approval' });

              if (dryRun) {
                return dryRunResult(node, {
                  approvalMessage: apData.approvalMessage,
                  timeoutMinutes: apData.timeoutMinutes,
                });
              }

              // Create approval record and pause workflow
              const approvalRepo = createWorkflowApprovalsRepository(userId);
              const timeoutMin =
                typeof apData.timeoutMinutes === 'number' ? apData.timeoutMinutes : undefined;
              const approval = await approvalRepo.create({
                workflowLogId: wfLog.id,
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

              // Mark node as running (awaiting)
              const approvalResult: NodeResult = {
                nodeId,
                status: 'running',
                output: { approvalId: approval.id, status: 'awaiting_approval' },
                startedAt: new Date().toISOString(),
              };
              nodeOutputs[nodeId] = approvalResult;

              // Update log to awaiting_approval
              await repo.updateLog(wfLog.id, {
                status: 'awaiting_approval',
                nodeResults: nodeOutputs,
              });

              onProgress?.({
                type: 'node_complete',
                nodeId,
                status: 'running',
                output: approvalResult.output,
              });

              // Emit special approval event
              onProgress?.({
                type: 'done',
                logId: wfLog.id,
                logStatus: 'awaiting_approval',
              });

              // Throw a special error to break out of the execution loop
              throw new ApprovalPauseError(approval.id);
            }

            if (node.type === 'subWorkflowNode') {
              const swData = node.data as unknown as Record<string, unknown>;
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
                const resolvedMapping = resolveTemplates(
                  inputMapping,
                  nodeOutputs,
                  workflow.variables
                );
                return dryRunResult(node, {
                  subWorkflowId,
                  inputMapping: resolvedMapping,
                  depth: depth + 1,
                });
              }

              return await this.executeWithRetryAndTimeout(
                node,
                async () => {
                  const startTime = Date.now();
                  // Resolve input mapping to build sub-workflow variables
                  const inputMapping = (swData.inputMapping ?? {}) as Record<string, string>;
                  const subVars = resolveTemplates(
                    inputMapping,
                    nodeOutputs,
                    workflow.variables
                  ) as Record<string, unknown>;

                  // Load the sub-workflow and execute it
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

                  // Merge parent variables with input mapping
                  const mergedVars = { ...subWorkflow.variables, ...subVars };

                  // Temporarily update sub-workflow variables for execution
                  const origVars = subWorkflow.variables;
                  subWorkflow.variables = mergedVars;

                  const subLog = await this.executeWorkflow(subWorkflowId, userId, undefined, {
                    dryRun,
                    depth: depth + 1,
                  });

                  // Restore original variables
                  subWorkflow.variables = origVars;

                  // Extract the last successful output from the sub-workflow
                  const subResults = subLog.nodeResults;
                  const successResults = Object.values(subResults).filter(
                    (r) => r.status === 'success' && r.output !== undefined
                  );
                  const lastOutput =
                    successResults.length > 0
                      ? successResults[successResults.length - 1]!.output
                      : null;

                  return {
                    nodeId,
                    status:
                      subLog.status === 'completed' ? ('success' as const) : ('error' as const),
                    output: lastOutput,
                    resolvedArgs: subVars,
                    error:
                      subLog.status === 'failed'
                        ? (subLog.error ?? 'Sub-workflow failed')
                        : undefined,
                    startedAt: new Date(startTime).toISOString(),
                    completedAt: new Date().toISOString(),
                    durationMs: Date.now() - startTime,
                  };
                },
                onProgress
              );
            }

            const toolData = node.data as ToolNodeData;
            onProgress?.({ type: 'node_start', nodeId, toolName: toolData.toolName });

            if (dryRun) {
              const args = resolveTemplates(
                toolData.toolArgs ?? {},
                nodeOutputs,
                workflow.variables
              );
              return dryRunResult(node, args);
            }

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

          // Mirror result to alias key so {{alias.output}} works in downstream templates
          for (const [alias, mappedNodeId] of aliasToNodeId) {
            if (mappedNodeId === nodeId) {
              nodeOutputs[alias] = nodeResult;
              break;
            }
          }

          // Emit progress
          if (nodeResult.status === 'error') {
            onProgress?.({
              type: 'node_error',
              nodeId,
              error: nodeResult.error,
            });

            // Invoke global error handler if present
            let handlerRecovered = false;
            if (errorHandlerNode && errorHandlerNode.id !== nodeId) {
              onProgress?.({
                type: 'node_start',
                nodeId: errorHandlerNode.id,
                toolName: 'errorHandler',
              });
              const handlerStart = Date.now();
              const handlerResult: NodeResult = {
                nodeId: errorHandlerNode.id,
                status: 'success',
                output: {
                  handled: true,
                  failedNodeId: nodeId,
                  error: nodeResult.error,
                  continueOnSuccess: !!errorHandlerContinueOnSuccess,
                },
                startedAt: new Date(handlerStart).toISOString(),
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - handlerStart,
              };
              nodeOutputs[errorHandlerNode.id] = handlerResult;

              // Mirror to alias
              for (const [alias, mappedNodeId] of aliasToNodeId) {
                if (mappedNodeId === errorHandlerNode.id) {
                  nodeOutputs[alias] = handlerResult;
                  break;
                }
              }

              onProgress?.({
                type: 'node_complete',
                nodeId: errorHandlerNode.id,
                status: 'success',
                output: handlerResult.output,
                durationMs: handlerResult.durationMs,
              });

              if (errorHandlerContinueOnSuccess) {
                handlerRecovered = true;
              }
            }

            // Skip all downstream nodes (unless error handler recovered)
            if (!handlerRecovered) {
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

            // Switch branching: skip all handles except the matched branch
            if (node?.type === 'switchNode' && nodeResult.branchTaken) {
              const switchData = node.data as SwitchNodeData;
              const allHandles = [...switchData.cases.map((c) => c.label), 'default'];
              for (const handle of allHandles) {
                if (handle !== nodeResult.branchTaken) {
                  const skippedNodes = getDownstreamNodesByHandle(nodeId, handle, workflow.edges);
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
      // Approval pause — not a failure, workflow is waiting for approval
      if (error instanceof ApprovalPauseError) {
        const finalLog = await repo.getLog(wfLog.id);
        return finalLog ?? wfLog;
      }

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
    const isVmNode =
      node.type === 'conditionNode' ||
      node.type === 'transformerNode' ||
      node.type === 'switchNode';

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
// Approval pause error (signals workflow paused for approval, not a failure)
// ============================================================================

class ApprovalPauseError extends Error {
  approvalId: string;
  constructor(approvalId: string) {
    super('Workflow paused for approval');
    this.name = 'ApprovalPauseError';
    this.approvalId = approvalId;
  }
}

// ============================================================================
// Singleton
// ============================================================================

/**
 * Creates a dry-run node result: resolvedArgs are shown but no side-effects occur.
 */
function dryRunResult(node: WorkflowNode, resolvedArgs: Record<string, unknown>): NodeResult {
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

let _workflowService: WorkflowService | null = null;

export function getWorkflowService(): WorkflowService {
  if (!_workflowService) {
    _workflowService = new WorkflowService();
  }
  return _workflowService;
}
