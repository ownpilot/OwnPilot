/**
 * Workflow types — Progress events and execution context interfaces.
 */

import type { NodeExecutionStatus, WorkflowLogStatus } from '../../db/repositories/workflows.js';

// ============================================================================
// Progress event types
// ============================================================================

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
  status?: NodeExecutionStatus;
  output?: unknown;
  resolvedArgs?: Record<string, unknown>;
  branchTaken?: string;
  error?: string;
  durationMs?: number;
  logId?: string;
  logStatus?: WorkflowLogStatus;
  /** ForEach: current iteration index (0-based) */
  iterationIndex?: number;
  /** ForEach: total items being iterated */
  iterationTotal?: number;
  /** Retry: current attempt number (1-based) */
  retryAttempt?: number;
}

/** Result of a tool execution within a workflow node. */
export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}
