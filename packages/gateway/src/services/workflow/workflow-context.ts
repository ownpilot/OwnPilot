/**
 * Workflow Execution Context — shared types for dispatching workflow nodes.
 *
 * Bundles all per-execution state into a single interface so that dispatchNode
 * receives one context object instead of 12+ scattered parameters.
 *
 * Extracted as part of the WorkflowService Phase 2 split.
 */

import type {
  WorkflowNode,
  NodeResult,
  WorkflowLog,
} from '../../db/repositories/workflows/index.js';
import type { IToolService } from '@ownpilot/core/services';
import type { WorkflowProgressEvent } from './types.js';
import type { createWorkflowsRepository } from '../../db/repositories/workflows/index.js';

// ---------------------------------------------------------------------------
// Dispatch context
// ---------------------------------------------------------------------------

export interface DispatchNodeContext {
  node: WorkflowNode;
  nodeId: string;
  nodeOutputs: Record<string, NodeResult>;
  workflow: {
    variables: Record<string, unknown>;
    edges: { source: string; target: string; sourceHandle?: string }[];
  };
  nodeMap: Map<string, WorkflowNode>;
  userId: string;
  toolService: IToolService;
  abortSignal: AbortSignal;
  onProgress?: (event: WorkflowProgressEvent) => void;
  dryRun: boolean;
  repo: ReturnType<typeof createWorkflowsRepository>;
  logId: string;
  workflowId: string;
  depth: number;
}

// ---------------------------------------------------------------------------
// Dispatch callbacks
// ---------------------------------------------------------------------------

export interface DispatchCallbacks {
  retryFn: (
    node: WorkflowNode,
    executeFn: () => Promise<NodeResult>,
    onProgress?: (event: WorkflowProgressEvent) => void
  ) => Promise<NodeResult>;
  subWorkflowExecutor: (
    workflowId: string,
    userId: string,
    onProgress?: (event: WorkflowProgressEvent) => void,
    options?: { dryRun?: boolean; depth?: number; inputs?: Record<string, unknown> }
  ) => Promise<WorkflowLog>;
  subWorkflowCancel: (workflowId: string) => void;
}
