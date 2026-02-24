/**
 * ForEach executor — Iterates over an array, executing a body subgraph per item.
 */

import {
  createWorkflowsRepository,
  type WorkflowNode,
  type WorkflowEdge,
  type ForEachNodeData,
  type NodeResult,
} from '../../db/repositories/workflows.js';
import type { IToolService } from '@ownpilot/core';
import { getErrorMessage } from '../../routes/helpers.js';
import { getLog } from '../log.js';
import { topologicalSort, getForEachBodyNodes, getDownstreamNodesByHandle } from './dag-utils.js';
import { resolveTemplates } from './template-resolver.js';
import {
  executeNode,
  executeLlmNode,
  executeConditionNode,
  executeCodeNode,
  executeTransformerNode,
} from './node-executors.js';
import type { WorkflowProgressEvent } from './types.js';

const _log = getLog('WorkflowService');

/**
 * Execute a ForEach node: iterate over an array, executing body subgraph per item.
 */
export async function executeForEachNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
  edges: WorkflowEdge[],
  nodeMap: Map<string, WorkflowNode>,
  userId: string,
  abortSignal: AbortSignal,
  toolService: IToolService,
  onProgress?: (event: WorkflowProgressEvent) => void,
  repo?: ReturnType<typeof createWorkflowsRepository>,
  logId?: string
): Promise<NodeResult> {
  const startTime = Date.now();
  const data = node.data as ForEachNodeData;
  const maxIterations = data.maxIterations ?? 100;
  const onError = data.onError ?? 'stop';

  try {
    // 1. Resolve the array expression
    const resolvedArray = resolveTemplates(
      { _arr: data.arrayExpression },
      nodeOutputs,
      variables
    )._arr;

    if (!Array.isArray(resolvedArray)) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `ForEach: expression must return an array (got ${typeof resolvedArray})`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    // 2. Detect body subgraph
    const { bodyNodes } = getForEachBodyNodes(node.id, edges);

    // Safety cap
    const items = resolvedArray.slice(0, maxIterations);
    if (resolvedArray.length > maxIterations) {
      _log.warn(
        `ForEach ${node.id}: truncated ${resolvedArray.length} items to ${maxIterations}`
      );
    }

    // 3. Handle empty array — skip body
    if (items.length === 0) {
      for (const bodyId of bodyNodes) {
        nodeOutputs[bodyId] = {
          nodeId: bodyId,
          status: 'skipped',
          completedAt: new Date().toISOString(),
        };
        onProgress?.({ type: 'node_complete', nodeId: bodyId, status: 'skipped' });
      }
      return {
        nodeId: node.id,
        status: 'success',
        output: { results: [], count: 0, items: [] },
        iterationCount: 0,
        totalItems: 0,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    // 4. Topological sort body subgraph
    const bodyNodeList = [...bodyNodes]
      .map((id) => nodeMap.get(id))
      .filter(Boolean) as WorkflowNode[];
    const bodyEdges = edges.filter((e) => bodyNodes.has(e.source) && bodyNodes.has(e.target));
    const bodyLevels = topologicalSort(bodyNodeList, bodyEdges);

    // 5. Iterate
    const collectedResults: unknown[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < items.length; i++) {
      if (abortSignal.aborted) throw new Error('Workflow execution cancelled');

      const item = items[i];

      onProgress?.({
        type: 'foreach_iteration_start',
        nodeId: node.id,
        iterationIndex: i,
        iterationTotal: items.length,
      });

      // Set ForEach output for this iteration
      nodeOutputs[node.id] = {
        nodeId: node.id,
        status: 'success',
        output: { item, index: i, items, count: items.length },
        iterationCount: i + 1,
        totalItems: items.length,
        startedAt: new Date(startTime).toISOString(),
      };

      // Build iteration variables (supports {{itemVariable}} alias)
      const iterationVars = { ...variables };
      if (data.itemVariable) {
        iterationVars[data.itemVariable] = item;
        iterationVars[`${data.itemVariable}_index`] = i;
      }

      // Execute body subgraph level by level
      let iterationError: string | undefined;

      for (const bodyLevel of bodyLevels) {
        if (abortSignal.aborted) throw new Error('Workflow execution cancelled');

        const results = await Promise.allSettled(
          bodyLevel.map(async (bodyNodeId) => {
            // Skip if already skipped (e.g., condition branch)
            if (nodeOutputs[bodyNodeId]?.status === 'skipped') return nodeOutputs[bodyNodeId]!;

            const bodyNode = nodeMap.get(bodyNodeId);
            if (!bodyNode) {
              return {
                nodeId: bodyNodeId,
                status: 'error' as const,
                output: `Node ${bodyNodeId} not found in workflow graph`,
              };
            }
            onProgress?.({ type: 'node_start', nodeId: bodyNodeId });

            if (bodyNode.type === 'llmNode')
              return executeLlmNode(bodyNode, nodeOutputs, iterationVars);
            if (bodyNode.type === 'conditionNode')
              return executeConditionNode(bodyNode, nodeOutputs, iterationVars);
            if (bodyNode.type === 'codeNode')
              return executeCodeNode(bodyNode, nodeOutputs, iterationVars, userId, toolService);
            if (bodyNode.type === 'transformerNode')
              return executeTransformerNode(bodyNode, nodeOutputs, iterationVars);
            if (bodyNode.type === 'forEachNode') {
              return executeForEachNode(
                bodyNode,
                nodeOutputs,
                iterationVars,
                edges,
                nodeMap,
                userId,
                abortSignal,
                toolService,
                onProgress,
                repo,
                logId
              );
            }
            return executeNode(bodyNode, nodeOutputs, iterationVars, userId, toolService);
          })
        );

        // Process body results
        for (let j = 0; j < bodyLevel.length; j++) {
          const bodyNodeId = bodyLevel[j]!;
          const settled = results[j]!;

          if (settled.status === 'fulfilled') {
            nodeOutputs[bodyNodeId] = settled.value;
          } else {
            nodeOutputs[bodyNodeId] = {
              nodeId: bodyNodeId,
              status: 'error',
              error: getErrorMessage(settled.reason, 'Unexpected error'),
              completedAt: new Date().toISOString(),
            };
          }

          const bodyResult = nodeOutputs[bodyNodeId]!;

          if (bodyResult.status === 'error') {
            onProgress?.({ type: 'node_error', nodeId: bodyNodeId, error: bodyResult.error });
            iterationError = bodyResult.error;
          } else {
            onProgress?.({
              type: 'node_complete',
              nodeId: bodyNodeId,
              status: bodyResult.status,
              output: bodyResult.output,
              durationMs: bodyResult.durationMs,
              branchTaken: bodyResult.branchTaken,
            });
          }

          // Handle condition branching within body
          const bodyNode = nodeMap.get(bodyNodeId);
          if (bodyNode?.type === 'conditionNode' && bodyResult.branchTaken) {
            const skippedHandle = bodyResult.branchTaken === 'true' ? 'false' : 'true';
            const skippedInBody = getDownstreamNodesByHandle(
              bodyNodeId,
              skippedHandle,
              bodyEdges
            );
            for (const skipId of skippedInBody) {
              if (!nodeOutputs[skipId] || nodeOutputs[skipId].status !== 'skipped') {
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

        if (iterationError && onError === 'stop') break;
      }

      // Collect last body node's output as this iteration's result
      const lastLevel = bodyLevels[bodyLevels.length - 1] ?? [];
      const lastNodeId = lastLevel[lastLevel.length - 1];
      collectedResults.push(lastNodeId ? nodeOutputs[lastNodeId]?.output : item);

      if (iterationError) {
        errors.push({ index: i, error: iterationError });
        if (onError === 'stop') break;
      }

      onProgress?.({
        type: 'foreach_iteration_complete',
        nodeId: node.id,
        iterationIndex: i,
        iterationTotal: items.length,
      });

      // Persist intermediate progress
      if (repo && logId) {
        await repo.updateLog(logId, { nodeResults: nodeOutputs });
      }

      // Reset skipped status for body nodes before next iteration (condition branches may differ)
      for (const bodyId of bodyNodes) {
        if (nodeOutputs[bodyId]?.status === 'skipped') {
          delete nodeOutputs[bodyId];
        }
      }
    }

    // 6. Build ForEach final output
    const forEachOutput = {
      results: collectedResults,
      count: items.length,
      items,
      errors: errors.length > 0 ? errors : undefined,
      completedIterations: collectedResults.length,
    };

    return {
      nodeId: node.id,
      status: errors.length > 0 && onError === 'stop' ? 'error' : 'success',
      output: forEachOutput,
      iterationCount: collectedResults.length,
      totalItems: items.length,
      error: errors.length > 0 ? `${errors.length} iteration(s) failed` : undefined,
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'ForEach execution failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}
