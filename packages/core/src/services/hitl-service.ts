/**
 * HITL (Human-in-the-Loop) Service Interface
 *
 * Manages approval requests during workflow execution.
 * Supports: approve/reject, collect input, review tool calls, multi-turn conversation.
 */

export type HITLInteractionType = 'approve_reject' | 'collect_input' | 'review_tool_calls' | 'multi_turn';
export type HITLMode = 'pre_execution' | 'post_execution';
export type HITLStatus = 'pending' | 'approved' | 'rejected' | 'modified' | 'expired' | 'cancelled';
export type HITLDecision = 'approve' | 'reject' | 'modify' | 'continue';

export interface HITLRequest {
  id: string;
  userId: string;
  workflowLogId: string | null;
  workflowId: string | null;
  nodeId: string | null;
  interactionType: HITLInteractionType;
  mode: HITLMode;
  status: HITLStatus;
  promptMessage: string | null;
  context: Record<string, unknown>;
  response: HITLResponse | null;
  timeoutSeconds: number;
  expiresAt: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface HITLResponse {
  decision: HITLDecision;
  modifiedContent?: unknown;
  feedback?: string;
}

export interface CreateHITLRequestInput {
  workflowLogId?: string;
  workflowId?: string;
  nodeId?: string;
  interactionType: HITLInteractionType;
  mode: HITLMode;
  promptMessage?: string;
  context?: Record<string, unknown>;
  timeoutSeconds?: number;
}

export interface IHitlService {
  /** Create a new HITL request and wait for response */
  createRequest(userId: string, input: CreateHITLRequestInput): Promise<HITLRequest>;

  /** Resolve a pending HITL request with a decision */
  resolve(requestId: string, userId: string, response: HITLResponse): Promise<HITLRequest>;

  /** Get a HITL request by ID */
  getRequest(requestId: string, userId: string): Promise<HITLRequest | null>;

  /** List pending requests for a user */
  listPending(
    userId: string,
    options?: { workflowId?: string; limit?: number; offset?: number },
  ): Promise<{ items: HITLRequest[]; total: number }>;

  /** Cancel all pending requests for a workflow execution */
  cancelForWorkflow(workflowLogId: string, userId: string): Promise<number>;

  /** Expire timed-out requests */
  expireStale(): Promise<number>;

  /** Subscribe to HITL events (for WebSocket push) */
  onRequest(callback: (request: HITLRequest) => void): () => void;
  onResponse(callback: (request: HITLRequest) => void): () => void;
}
