/**
 * IWorkflowService - Workflow Execution Interface
 *
 * Provides workflow execution, cancellation, and status checks.
 *
 * Usage:
 *   const workflows = getWorkflowService();
 *   const log = await workflows.executeWorkflow('wf-1', 'user-1');
 */

// ============================================================================
// Types
// ============================================================================

export type WorkflowLogStatus =
  'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_approval';

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

// ============================================================================
// Singleton access — same pattern as MemoryService / GoalService / etc.
// ============================================================================

import { hasServiceRegistry, getServiceRegistry } from './registry.js';
import { ServiceToken } from './registry.js';

export const WorkflowToken = new ServiceToken<IWorkflowService>('workflow');

let _workflowService: IWorkflowService | null = null;

export function setWorkflowService(service: IWorkflowService): void {
  _workflowService = service;
  if (hasServiceRegistry()) {
    try {
      const registry = getServiceRegistry();
      if (!registry.has(WorkflowToken)) {
        registry.register(WorkflowToken, service);
      }
    } catch {
      // Registry not ready
    }
  }
}

export function getWorkflowService(): IWorkflowService {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(WorkflowToken);
    } catch {
      // Fall through
    }
  }
  if (!_workflowService) {
    throw new Error(
      'WorkflowService not initialized. Call setWorkflowService() during gateway startup.'
    );
  }
  return _workflowService;
}

export function hasWorkflowService(): boolean {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().has(WorkflowToken);
    } catch {
      // Fall through
    }
  }
  return _workflowService !== null;
}
