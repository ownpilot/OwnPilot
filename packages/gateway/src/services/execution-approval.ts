/**
 * Execution Approval Service
 *
 * Manages real-time approval requests for 'prompt' mode execution.
 * Flow: SSE event → UI dialog → HTTP POST → resolve promise → execution continues.
 */

/** In-memory pending approvals */
const pendingApprovals = new Map<string, {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/** Default timeout for approval requests (2 minutes) */
const APPROVAL_TIMEOUT_MS = 120_000;

/**
 * Create a pending approval request.
 * Returns a promise that resolves when the user approves/rejects or timeout occurs.
 * Called from chat route's requestApproval callback.
 */
export function createApprovalRequest(approvalId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      resolve(false); // Timeout = auto-reject
    }, APPROVAL_TIMEOUT_MS);

    pendingApprovals.set(approvalId, { resolve, timer });
  });
}

/**
 * Resolve a pending approval request.
 * Called from the HTTP endpoint when user clicks approve/reject.
 * Returns true if the approval was found and resolved, false if expired/not found.
 */
export function resolveApproval(approvalId: string, approved: boolean): boolean {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;

  clearTimeout(pending.timer);
  pendingApprovals.delete(approvalId);
  pending.resolve(approved);
  return true;
}

/**
 * Generate a unique approval ID
 */
export function generateApprovalId(): string {
  return `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}


