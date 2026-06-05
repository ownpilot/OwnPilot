/**
 * Execution Approval Service
 *
 * Manages real-time approval requests for 'prompt' mode execution.
 * Flow: SSE event → UI dialog → HTTP POST → resolve promise → execution continues.
 */

import { generateId } from '@ownpilot/core';

/** Default timeout for approval requests (2 minutes) */
const APPROVAL_TIMEOUT_MS = 120_000;

/**
 * Hard cap on concurrent in-flight approval requests. Beyond this we reject
 * new requests with `ApprovalCapExceededError` to bound memory and timer
 * pressure (Plan 04 Step 4).
 */
const MAX_PENDING = 1000;

/** Atomic decision recorded the moment an approval is resolved. */
interface ApprovalDecision {
  approved: boolean;
  decidedBy: string;
  decidedAt: number;
}

interface PendingApproval {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  /** UserId of the session that initiated the approval — must match caller */
  ownerUserId: string;
  /**
   * Set synchronously by the first resolver to win the race. The map entry
   * is deleted at the same time, so subsequent `get()` calls can't observe
   * this — the field exists to attach audit metadata to the resolved entry
   * for the singleflight winner only.
   */
  decision: ApprovalDecision | null;
}

/** Thrown by createApprovalRequest when the in-flight cap is reached. */
export class ApprovalCapExceededError extends Error {
  constructor() {
    super(`Too many pending approvals (max ${MAX_PENDING})`);
    this.name = 'ApprovalCapExceededError';
  }
}

/** Discriminated result of resolveApproval — caller maps each reason to an HTTP code. */
type ResolveResult =
  | { ok: true; decision: ApprovalDecision }
  | {
      ok: false;
      reason: 'expired_or_missing' | 'forbidden';
    };

/** In-memory pending approvals — keyed by approvalId */
const pendingApprovals = new Map<string, PendingApproval>();

/**
 * Create a pending approval request.
 * Returns a promise that resolves when the user approves/rejects or timeout occurs.
 * Called from chat route's requestApproval callback.
 * @param approvalId  Unique identifier for this approval
 * @param ownerUserId  The userId who initiated this approval — only they may resolve it
 * @throws ApprovalCapExceededError when the in-flight cap is reached.
 */
export function createApprovalRequest(approvalId: string, ownerUserId: string): Promise<boolean> {
  // Hard cap: reject before allocating a timer or storing state. The
  // cap-guarded check is intentionally *outside* the Promise constructor so
  // a rejected request is observable to callers without registering a
  // dangling resolve callback.
  if (pendingApprovals.size >= MAX_PENDING) {
    return Promise.reject(new ApprovalCapExceededError());
  }

  // Clear any existing approval with the same ID to prevent timer leaks
  const existing = pendingApprovals.get(approvalId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.resolve(false); // Auto-reject the old one
    pendingApprovals.delete(approvalId);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Auto-reject on timeout. If the entry is already gone (raced with
      // resolveApproval), the .delete is a no-op.
      pendingApprovals.delete(approvalId);
      resolve(false);
    }, APPROVAL_TIMEOUT_MS);
    // unref so an unanswered approval timer doesn't block process exit —
    // resolveApproval / clearTimeout still cancels the active timer.
    timer.unref?.();

    pendingApprovals.set(approvalId, {
      resolve,
      timer,
      ownerUserId,
      decision: null,
    });
  });
}

/**
 * Resolve a pending approval request.
 * Called from the HTTP endpoint when user clicks approve/reject.
 * Only the userId that created the approval may resolve it (IDOR guard).
 *
 * Atomicity: Node.js runs sync JS to completion before draining the timer
 * queue, so the get → ownership-check → delete → resolve sequence is one
 * atomic step from the perspective of any other resolver. The first
 * concurrent caller wins; the second sees `pendingApprovals.get()` return
 * `undefined` and gets `expired_or_missing` (Plan 04 Step 5).
 */
export function resolveApproval(
  approvalId: string,
  approved: boolean,
  callerUserId: string
): ResolveResult {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return { ok: false, reason: 'expired_or_missing' };
  // IDOR guard: reject if caller is not the owner of this approval
  if (pending.ownerUserId !== callerUserId) return { ok: false, reason: 'forbidden' };

  // Single-winner: delete first so the entry is invisible to any concurrent
  // resolver that may already be past its `get` call. The set of these is
  // bounded by the JS event loop's single-thread guarantee.
  pendingApprovals.delete(approvalId);
  clearTimeout(pending.timer);

  const decision: ApprovalDecision = {
    approved,
    decidedBy: callerUserId,
    decidedAt: Date.now(),
  };
  pending.decision = decision;
  pending.resolve(approved);
  return { ok: true, decision };
}

/**
 * Generate a unique approval ID
 */
export function generateApprovalId(): string {
  return generateId('approval');
}
