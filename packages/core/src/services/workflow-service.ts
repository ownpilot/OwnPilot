/**
 * IWorkflowService - Workflow Execution Interface
 *
 * Provides workflow execution, cancellation, and status checks.
 *
 * Usage:
 *   const workflows = registry.get(Services.Workflow);
 *   const log = await workflows.executeWorkflow('wf-1', 'user-1');
 */

// ============================================================================
// Types
// ============================================================================

export type WorkflowLogStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_approval';

export interface WorkflowLog {
  readonly id: string;
  readonly workflowId: string | null;
  readonly workflowName: string | null;
  readonly status: WorkflowLogStatus;
  readonly nodeResults: Record<string, unknown>;
  readonly error: string | null;
  readonly durationMs: number | null;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

export interface WorkflowProgressEvent {
  type:
    | 'started'
    | 'node_start'
    | 'node_complete'
    | 'node_error'
    | 'node_retry'
    | 'done'
    | 'error'
    | 'foreach_iteration_start'
    | 'foreach_iteration_complete';
  nodeId?: string;
  toolName?: string;
  status?: string;
  result?: unknown;
  resolvedArgs?: Record<string, unknown>;
  branchTaken?: string;
  error?: string;
  durationMs?: number;
  logId?: string;
  logStatus?: WorkflowLogStatus;
  retryAttempt?: number;
  iterationIndex?: number;
  iterationTotal?: number;
}

// ============================================================================
// IWorkflowService
// ============================================================================

export interface WorkflowExecuteOptions {
  dryRun?: boolean;
  depth?: number;
  inputs?: Record<string, unknown>;
}

export interface IWorkflowService {
  /**
   * Execute a workflow by ID.
   */
  executeWorkflow(
    workflowId: string,
    userId: string,
    onProgress?: (event: WorkflowProgressEvent) => void,
    options?: WorkflowExecuteOptions
  ): Promise<WorkflowLog>;

  /**
   * Cancel a running workflow execution.
   */
  cancelExecution(workflowId: string): boolean;

  /**
   * Check if a workflow is currently running.
   */
  isRunning(workflowId: string): boolean;
}
