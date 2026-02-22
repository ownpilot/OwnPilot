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

export type WorkflowLogStatus = 'running' | 'completed' | 'failed' | 'cancelled';

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
  type: 'node_start' | 'node_complete' | 'node_error' | 'done' | 'error'
    | 'foreach_iteration_start' | 'foreach_iteration_complete';
  nodeId?: string;
  toolName?: string;
  status?: string;
  result?: unknown;
  resolvedArgs?: Record<string, unknown>;
  branchTaken?: 'true' | 'false';
  error?: string;
  durationMs?: number;
  logId?: string;
  logStatus?: WorkflowLogStatus;
  iterationIndex?: number;
  iterationTotal?: number;
}

// ============================================================================
// IWorkflowService
// ============================================================================

export interface IWorkflowService {
  /**
   * Execute a workflow by ID.
   */
  executeWorkflow(
    workflowId: string,
    userId: string,
    onProgress?: (event: WorkflowProgressEvent) => void,
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
