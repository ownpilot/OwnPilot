/**
 * Workflow Node Job Handler
 *
 * Executes a single workflow node as a persistent job.
 * gap 24.1 Phase 2 — connects JobQueueService to WorkflowService.dispatchNode.
 *
 * Each node of a workflow-level DAG runs as its own job. The job payload contains
 * everything needed to resume from crash: workflowId, nodeId, workflowRunId,
 * nodeOutputs (already persisted by previous nodes), and the full workflow definition.
 *
 * Crash recovery: on worker restart, orphaned 'active' jobs are reclaimed (FOR UPDATE
 * SKIP LOCKED). The worker reads nodeOutputs from workflow_logs, builds the execution
 * context, and resumes from the next pending node.
 */

import type { JobRecord } from '../../db/repositories/jobs.js';
import type { IToolService } from '@ownpilot/core';
import type { NodeResult, WorkflowNode, WorkflowEdge } from '../../db/repositories/workflows.js';
import { createWorkflowsRepository } from '../../db/repositories/workflows.js';
import { JobQueueService } from '../job-queue-service.js';
import { getLog } from '../log.js';
import { getDownstreamNodes } from './dag-utils.js';

const log = getLog('WorkflowNodeJobHandler');

export interface WorkflowNodePayload {
  workflowId: string;
  nodeId: string;
  workflowRunId: string;
  nodeOutputs: Record<string, NodeResult>;
  /**
   * Serialized workflow definition — nodes + edges + variables.
   * Stored in payload so the worker can reconstruct context without DB round-trip
   * for the workflow definition (the log already has the full workflow snapshot).
   */
  workflowSnapshot: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    variables: Record<string, unknown>;
  };
  userId: string;
  /**
   * Service-orchestrated executions enqueue topological levels themselves.
   * Crash recovery can opt into worker-chained downstream enqueueing.
   */
  orchestrateDownstream?: boolean;
}

function isSuccessfulDependency(result: NodeResult | undefined): boolean {
  return result?.status === 'success' || result?.output !== undefined;
}

/**
 * Register the workflow node job handler with the JobQueueService.
 * Called once at server boot.
 */
export function registerWorkflowNodeWorker(): () => void {
  const queue = JobQueueService.getInstance();
  return queue.startWorker(
    async (job: JobRecord) => {
      return await executeWorkflowNodeJob(job);
    },
    { queue: 'workflow_nodes', concurrency: 4, name: 'workflow_node_worker' }
  );
}

/**
 * Enqueue all nodes at a given topological level.
 * Called by WorkflowService.executeWorkflow when using jobified execution.
 */
export async function enqueueWorkflowLevel(
  workflowId: string,
  workflowRunId: string,
  userId: string,
  level: string[],
  nodeMap: Map<string, WorkflowNode>,
  workflowEdges: WorkflowEdge[],
  workflowVariables: Record<string, unknown>,
  nodeOutputs: Record<string, NodeResult>
): Promise<void> {
  const queue = JobQueueService.getInstance();
  const nodesToEnqueue = level.map((id) => nodeMap.get(id)!).filter((n) => n && !nodeOutputs[n.id]); // skip already-executed nodes

  await Promise.all(
    nodesToEnqueue.map((node) =>
      queue.enqueue(
        'workflow_node',
        {
          workflowId,
          nodeId: node.id,
          workflowRunId,
          nodeOutputs: { ...nodeOutputs }, // snapshot per job to avoid concurrent mutations
          workflowSnapshot: {
            nodes: Array.from(nodeMap.values()),
            edges: workflowEdges as WorkflowEdge[],
            variables: workflowVariables,
          },
          userId,
          orchestrateDownstream: false,
        } satisfies WorkflowNodePayload,
        { queue: 'workflow_nodes' }
      )
    )
  );
}

/**
 * Execute a single workflow node job.
 * Returns the NodeResult which is stored as the job's result field.
 * On error, the job is marked failed (JobQueueService.fail called automatically).
 */
async function executeWorkflowNodeJob(job: JobRecord): Promise<Record<string, unknown>> {
  const {
    workflowId,
    nodeId,
    workflowRunId,
    nodeOutputs,
    workflowSnapshot,
    userId,
    orchestrateDownstream,
  } = job.payload as unknown as WorkflowNodePayload;

  const repo = createWorkflowsRepository(userId);

  // Reconstruct nodeMap from snapshot
  const nodeMap = new Map(workflowSnapshot.nodes.map((n) => [n.id, n]));

  // Gate: check all upstream nodes have completed successfully
  const node = nodeMap.get(nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in workflow ${workflowId}`);
  }

  for (const edge of workflowSnapshot.edges) {
    if (edge.target === nodeId && !isSuccessfulDependency(nodeOutputs[edge.source])) {
      throw new Error(`Upstream node ${edge.source} has not completed — cannot execute ${nodeId}`);
    }
  }

  // Get tool service (lazy to avoid circular deps)
  const { getServiceRegistry, Services } = await import('@ownpilot/core');
  const toolService = getServiceRegistry().get(Services.Tool) as IToolService;

  // Build the execution context for dispatchNode
  // The real dispatchNode in WorkflowService does the full routing.
  // Here we inline the minimal dispatch for this node.
  const result = await executeNodeInline(node, nodeOutputs, workflowSnapshot, userId, toolService);

  // Persist node output to workflow log (enables crash recovery). Merge with
  // the latest log state so parallel nodes in the same level do not clobber
  // each other's results when they started from the same payload snapshot.
  const currentLog = await repo.getLog(workflowRunId);
  const newNodeOutputs = {
    ...nodeOutputs,
    ...(currentLog?.nodeResults ?? {}),
    [nodeId]: result,
  };
  await repo.persistNodeOutputs(workflowRunId, newNodeOutputs);

  // Service-orchestrated runs advance by topological level; recovery runs can
  // let workers enqueue the next unblocked nodes from persisted state.
  if (orchestrateDownstream) {
    await enqueueUnblockedDownstream(
      workflowId,
      workflowRunId,
      userId,
      nodeId,
      nodeMap,
      workflowSnapshot.edges,
      workflowSnapshot.variables,
      newNodeOutputs
    );
  }

  log.debug('Workflow node job completed', { jobId: job.id, nodeId, status: result.status });

  return result as unknown as Record<string, unknown>;
}

/**
 * Inline node executor (mirrors dispatchNode routing for a single node).
 * Uses the actual executor functions from node-executors.ts.
 */
async function executeNodeInline(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  workflowSnapshot: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    variables: Record<string, unknown>;
  },
  userId: string,
  toolService: IToolService
): Promise<NodeResult> {
  const nodeExecutors = await import('./node-executors.js');

  switch (node.type) {
    case 'llmNode':
      return nodeExecutors.executeLlmNode(node, nodeOutputs, workflowSnapshot.variables);

    case 'conditionNode':
      return nodeExecutors.executeConditionNode(node, nodeOutputs, workflowSnapshot.variables);

    case 'codeNode':
      return nodeExecutors.executeCodeNode(
        node,
        nodeOutputs,
        workflowSnapshot.variables,
        userId,
        toolService
      );

    case 'toolNode':
      return nodeExecutors.executeNode(
        node,
        nodeOutputs,
        workflowSnapshot.variables,
        userId,
        toolService
      );

    case 'httpRequestNode':
      return nodeExecutors.executeHttpRequestNode(node, nodeOutputs, workflowSnapshot.variables);

    case 'delayNode':
      return nodeExecutors.executeDelayNode(node, nodeOutputs, workflowSnapshot.variables);

    case 'switchNode':
      return nodeExecutors.executeSwitchNode(node, nodeOutputs, workflowSnapshot.variables);

    case 'notificationNode':
      return nodeExecutors.executeNotificationNode(node, nodeOutputs, workflowSnapshot.variables);

    case 'mergeNode': {
      const incomingNodeIds = workflowSnapshot.edges
        .filter((e) => e.target === node.id)
        .map((e) => e.source);
      return nodeExecutors.executeMergeNode(
        node,
        nodeOutputs,
        workflowSnapshot.variables,
        incomingNodeIds
      );
    }

    case 'dataStoreNode':
      return nodeExecutors.executeDataStoreNode(node, nodeOutputs, workflowSnapshot.variables);

    case 'schemaValidatorNode':
      return nodeExecutors.executeSchemaValidatorNode(
        node,
        nodeOutputs,
        workflowSnapshot.variables
      );

    case 'filterNode':
      return nodeExecutors.executeFilterNode(node, nodeOutputs, workflowSnapshot.variables);

    case 'mapNode':
      return nodeExecutors.executeMapNode(node, nodeOutputs, workflowSnapshot.variables);

    case 'aggregateNode':
      return nodeExecutors.executeAggregateNode(node, nodeOutputs, workflowSnapshot.variables);

    case 'webhookResponseNode':
      return nodeExecutors.executeWebhookResponseNode(
        node,
        nodeOutputs,
        workflowSnapshot.variables
      );

    case 'errorHandlerNode':
    case 'stickyNoteNode':
    case 'approvalNode':
    case 'parallelNode':
    case 'subWorkflowNode':
    case 'forEachNode':
    case 'triggerNode':
      log.warn(`Node type ${node.type} not yet jobified, running sync`);
      return nodeExecutors.executeNode(
        node,
        nodeOutputs,
        workflowSnapshot.variables,
        userId,
        toolService
      );

    default:
      return nodeExecutors.executeNode(
        node,
        nodeOutputs,
        workflowSnapshot.variables,
        userId,
        toolService
      );
  }
}

/**
 * Check if any downstream nodes are now unblocked and enqueue them.
 * A node is unblocked when ALL its upstream dependencies have completed successfully.
 */
async function enqueueUnblockedDownstream(
  workflowId: string,
  workflowRunId: string,
  userId: string,
  completedNodeId: string,
  nodeMap: Map<string, WorkflowNode>,
  workflowEdges: WorkflowEdge[],
  workflowVariables: Record<string, unknown>,
  nodeOutputs: Record<string, NodeResult>
): Promise<void> {
  const downstream = getDownstreamNodes(completedNodeId, workflowEdges);

  for (const downId of downstream) {
    // Check if all upstream nodes of this downstream node completed successfully
    const upstreamEdges = workflowEdges.filter((e) => e.target === downId);
    const allUpstreamComplete = upstreamEdges.every((e) =>
      isSuccessfulDependency(nodeOutputs[e.source])
    );

    if (!allUpstreamComplete) continue;

    // Check if already executed (shouldn't happen, but defensive)
    if (nodeOutputs[downId]) continue;

    const downNode = nodeMap.get(downId);
    if (!downNode) continue;

    // Skip trigger nodes
    if (downNode.type === 'triggerNode') continue;

    const queue = JobQueueService.getInstance();
    await queue.enqueue(
      'workflow_node',
      {
        workflowId,
        nodeId: downId,
        workflowRunId,
        nodeOutputs: { ...nodeOutputs }, // snapshot per job to avoid concurrent mutations
        workflowSnapshot: {
          nodes: Array.from(nodeMap.values()),
          edges: workflowEdges,
          variables: workflowVariables,
        },
        userId,
        orchestrateDownstream: true,
      } satisfies WorkflowNodePayload,
      { queue: 'workflow_nodes' }
    );
    log.debug('Enqueued unblocked downstream node', {
      nodeId: downId,
      unblockedBy: completedNodeId,
    });
  }
}

/**
 * Resume a crashed workflow from its persisted nodeOutputs.
 * Called during orphan recovery to restart incomplete workflow runs.
 */
export async function resumeWorkflowFromRecovery(
  workflowRunId: string,
  userId: string
): Promise<void> {
  const repo = createWorkflowsRepository(userId);
  const recovery = await repo.getLogForRecovery(workflowRunId);
  if (!recovery) {
    log.debug('No recovery data found for workflow log', { workflowRunId });
    return;
  }

  const { nodeResults: nodeOutputs, workflowId } = recovery;

  // Get current workflow definition
  const workflow = await repo.get(workflowId);
  if (!workflow) {
    log.warn('Workflow not found for recovery', { workflowId, workflowRunId });
    return;
  }

  const executableNodes = workflow.nodes.filter((n: WorkflowNode) => n.type !== 'triggerNode');

  // Find pending nodes whose upstream dependencies are already persisted.
  // Workers will chain further downstream nodes after each recovery job.
  const pendingNodeIds: string[] = [];
  for (const n of executableNodes) {
    if (nodeOutputs[n.id]) continue;
    const incoming = workflow.edges.filter((e: WorkflowEdge) => e.target === n.id);
    const upstreamReady = incoming.every((e: WorkflowEdge) => {
      const result = nodeOutputs[e.source];
      return isSuccessfulDependency(result);
    });
    if (upstreamReady) {
      pendingNodeIds.push(n.id);
    }
  }

  if (pendingNodeIds.length === 0) {
    log.debug('No pending nodes found for recovery', { workflowRunId });
    return;
  }

  log.info(`Resuming workflow ${workflowId} from crash, ${pendingNodeIds.length} pending nodes`, {
    workflowRunId,
    pendingNodeIds,
  });

  // Enqueue all pending nodes — they'll gate on upstream completion
  const queue = JobQueueService.getInstance();
  await Promise.all(
    pendingNodeIds.map((nodeId) =>
      queue.enqueue(
        'workflow_node',
        {
          workflowId,
          nodeId,
          workflowRunId,
          nodeOutputs: { ...nodeOutputs }, // snapshot per job to avoid concurrent mutations
          workflowSnapshot: {
            nodes: workflow.nodes,
            edges: workflow.edges,
            variables: workflow.variables,
          },
          userId,
          orchestrateDownstream: true,
        } satisfies WorkflowNodePayload,
        { queue: 'workflow_nodes' }
      )
    )
  );
}
