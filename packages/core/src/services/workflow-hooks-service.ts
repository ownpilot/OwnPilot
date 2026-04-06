/**
 * Workflow Hooks Service Interface
 *
 * Lifecycle hooks for workflow execution.
 * Feature-flag driven, configured per-workflow.
 */

export type WorkflowHookType = 'logging' | 'metrics' | 'notification' | 'webhook' | 'custom';

export type WorkflowHookEvent =
  | 'workflow_start'
  | 'workflow_end'
  | 'node_start'
  | 'node_end'
  | 'node_error'
  | 'node_retry'
  | 'approval_required'
  | 'approval_resolved';

export interface WorkflowHookConfig {
  id: string;
  workflowId: string;
  hookType: WorkflowHookType;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowHookContext {
  workflowId: string;
  workflowLogId: string;
  workflowName: string;
  nodeId?: string;
  nodeLabel?: string;
  nodeType?: string;
  event: WorkflowHookEvent;
  timestamp: Date;
  data?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}

export interface IWorkflowHooksService {
  /** Fire a hook event for a workflow */
  fire(context: WorkflowHookContext): Promise<void>;

  /** Get all enabled hooks for a workflow */
  getHooks(workflowId: string): Promise<WorkflowHookConfig[]>;

  /** Create or update a hook config */
  upsertHook(
    workflowId: string,
    hookType: WorkflowHookType,
    config: Record<string, unknown>,
    enabled?: boolean,
  ): Promise<WorkflowHookConfig>;

  /** Delete a hook config */
  deleteHook(hookId: string): Promise<void>;

  /** Enable/disable a hook */
  toggleHook(hookId: string, enabled: boolean): Promise<WorkflowHookConfig>;
}
