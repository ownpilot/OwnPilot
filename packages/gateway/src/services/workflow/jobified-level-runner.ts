/**
 * Jobified Level Runner — executes a topological level via the persistent job queue.
 *
 * Each node in the level is enqueued as a separate job (via enqueueWorkflowLevel).
 * This function then polls repo.getLog() until all nodes report completion
 * (success / error / skipped) or the workflow is aborted / times out.
 *
 * Extracted from WorkflowService.jobifiedExecuteLevel() as part of Phase 3.
 */

import { sleep } from '@ownpilot/core/types';
import type {
  WorkflowNode,
  WorkflowEdge,
  NodeResult,
} from '../../db/repositories/workflows/index.js';
import { enqueueWorkflowLevel } from './workflow-node-job-handler.js';
import type { WorkflowProgressEvent } from './types.js';

export interface JobifiedLevelRunnerDeps {
  repo: {
    getLog: (logId: string) => Promise<{
      nodeResults?: Record<string, NodeResult>;
    } | null>;
  };
  onProgress?: (event: WorkflowProgressEvent) => void;
}

export interface JobifiedLevelRunnerOptions {
  /** Poll interval between checks for job completion (ms). */
  pollIntervalMs: number;
  /** Max time to wait for all jobs to complete (ms). */
  maxWaitMs: number;
}

/**
 * Execute a batch of nodes at the same topological level via the persistent job queue.
 *
 * Enqueues each node as a job, then blocks until all have reported completion
 * (success / error / skipped) or abort / timeout.
 */
export async function runJobifiedLevel(
  workflowId: string,
  levelNodeIds: string[],
  nodeMap: Map<string, WorkflowNode>,
  workflow: { edges: WorkflowEdge[]; variables: Record<string, unknown> },
  userId: string,
  abortSignal: AbortSignal,
  logId: string,
  nodeOutputs: Record<string, NodeResult>,
  deps: JobifiedLevelRunnerDeps,
  options: JobifiedLevelRunnerOptions
): Promise<void> {
  const { repo } = deps;
  const { pollIntervalMs, maxWaitMs } = options;

  const wfRunId = logId;
  await enqueueWorkflowLevel(
    workflowId,
    wfRunId,
    userId,
    levelNodeIds,
    nodeMap,
    workflow.edges,
    workflow.variables,
    nodeOutputs
  );

  // Poll until all level nodes appear in nodeResults (or abort, or timeout).
  const start = Date.now();
  while (true) {
    if (abortSignal.aborted) {
      throw new Error('Workflow execution cancelled');
    }
    const wfLog = await repo.getLog(logId);
    const results = wfLog?.nodeResults ?? {};
    const allDone = levelNodeIds.every(
      (id) =>
        results[id]?.output !== undefined ||
        results[id]?.status === 'success' ||
        results[id]?.status === 'error' ||
        results[id]?.status === 'skipped'
    );
    if (allDone) break;
    if (Date.now() - start >= maxWaitMs) {
      const pending = levelNodeIds.filter(
        (id) =>
          results[id]?.output === undefined &&
          results[id]?.status !== 'success' &&
          results[id]?.status !== 'error' &&
          results[id]?.status !== 'skipped'
      );
      throw new Error(
        `Jobified workflow level timed out after ${maxWaitMs}ms waiting for ${pending.length} node(s): ${pending.join(', ')}`
      );
    }
    await sleep(pollIntervalMs);
  }
}
