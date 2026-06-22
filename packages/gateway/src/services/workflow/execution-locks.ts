/**
 * Workflow Execution Locks — tracks in-progress workflow executions.
 *
 * Provides atomic acquire/release/cancel/isRunning semantics for the
 * workflow execution mutex, preventing concurrent runs of the same workflow.
 */

export class WorkflowExecutionLocks {
  private readonly locks = new Map<string, AbortController>();

  /**
   * Atomically acquire the execution lock for a workflow.
   * Returns an AbortController if acquired, null if the workflow is already running.
   */
  tryAcquire(workflowId: string): AbortController | null {
    if (this.locks.has(workflowId)) {
      return null;
    }
    const controller = new AbortController();
    this.locks.set(workflowId, controller);
    return controller;
  }

  /**
   * Release the execution lock for a workflow.
   */
  release(workflowId: string): void {
    this.locks.delete(workflowId);
  }

  /**
   * Cancel a running workflow. Does NOT remove the lock — that is done by
   * release() (called from executeWorkflow's finally block). This matches the
   * original WorkflowService.cancelExecution semantics: abort only.
   * Returns true if a running workflow was found and cancelled.
   */
  cancel(workflowId: string): boolean {
    const controller = this.locks.get(workflowId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Check if a workflow is currently executing.
   */
  isRunning(workflowId: string): boolean {
    return this.locks.has(workflowId);
  }
}
