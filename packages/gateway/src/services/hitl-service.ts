/**
 * HITL (Human-in-the-Loop) Service
 *
 * Manages approval requests during workflow execution.
 * Supports: approve/reject, collect input, review tool calls, multi-turn conversation.
 */

import { randomUUID } from 'crypto';
import type {
  IHitlService,
  HITLRequest,
  HITLResponse,
  CreateHITLRequestInput,
} from '@ownpilot/core';
import { getAdapterSync } from '../db/adapters/index.js';
import { getLog } from './log.js';

const log = getLog('HitlService');

const DEFAULT_TIMEOUT_SECONDS = 1800;

/** Database row shape (snake_case) */
interface HitlRow {
  id: string;
  user_id: string;
  workflow_log_id: string | null;
  workflow_id: string | null;
  node_id: string | null;
  interaction_type: string;
  mode: string;
  status: string;
  prompt_message: string | null;
  context: Record<string, unknown> | string | null;
  response: HITLResponse | string | null;
  timeout_seconds: number;
  expires_at: string | null;
  decided_at: string | null;
  created_at: string;
}

/** Map a DB row (snake_case) to the HITLRequest interface (camelCase) */
function mapRow(row: HitlRow): HITLRequest {
  const ctx =
    typeof row.context === 'string' ? JSON.parse(row.context) : (row.context ?? {});
  const resp =
    typeof row.response === 'string' ? JSON.parse(row.response) : (row.response ?? null);

  return {
    id: row.id,
    userId: row.user_id,
    workflowLogId: row.workflow_log_id,
    workflowId: row.workflow_id,
    nodeId: row.node_id,
    interactionType: row.interaction_type as HITLRequest['interactionType'],
    mode: row.mode as HITLRequest['mode'],
    status: row.status as HITLRequest['status'],
    promptMessage: row.prompt_message,
    context: ctx,
    response: resp,
    timeoutSeconds: row.timeout_seconds,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export class HitlService implements IHitlService {
  private requestListeners: Array<(req: HITLRequest) => void> = [];
  private responseListeners: Array<(req: HITLRequest) => void> = [];

  // ---------------------------------------------------------------------------
  // createRequest
  // ---------------------------------------------------------------------------

  async createRequest(userId: string, input: CreateHITLRequestInput): Promise<HITLRequest> {
    const db = getAdapterSync();
    const id = randomUUID();
    const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    const context = input.context ?? {};

    const row = await db.queryOne<HitlRow>(
      `INSERT INTO hitl_requests
         (id, user_id, workflow_log_id, workflow_id, node_id,
          interaction_type, mode, status, prompt_message, context,
          timeout_seconds, expires_at, created_at)
       VALUES
         (?, ?, ?, ?, ?,
          ?, ?, 'pending', ?, ?,
          ?, NOW() + (? || ' seconds')::INTERVAL, NOW())
       RETURNING *`,
      [
        id,
        userId,
        input.workflowLogId ?? null,
        input.workflowId ?? null,
        input.nodeId ?? null,
        input.interactionType,
        input.mode,
        input.promptMessage ?? null,
        JSON.stringify(context),
        timeoutSeconds,
        timeoutSeconds,
      ],
    );

    if (!row) {
      throw new Error('Failed to create HITL request');
    }

    const request = mapRow(row);
    log.info('HITL request created', { id, userId, interactionType: input.interactionType });

    // Notify listeners
    for (const cb of this.requestListeners) {
      try {
        cb(request);
      } catch (err) {
        log.warn('Request listener error', { error: err });
      }
    }

    return request;
  }

  // ---------------------------------------------------------------------------
  // resolve
  // ---------------------------------------------------------------------------

  async resolve(
    requestId: string,
    userId: string,
    response: HITLResponse,
  ): Promise<HITLRequest> {
    const db = getAdapterSync();

    const statusMap: Record<string, string> = {
      approve: 'approved',
      reject: 'rejected',
      modify: 'modified',
      continue: 'approved',
    };
    const newStatus = statusMap[response.decision] ?? 'approved';

    const row = await db.queryOne<HitlRow>(
      `UPDATE hitl_requests
       SET status = ?, response = ?, decided_at = NOW()
       WHERE id = ? AND user_id = ? AND status = 'pending'
       RETURNING *`,
      [newStatus, JSON.stringify(response), requestId, userId],
    );

    if (!row) {
      throw new Error(`HITL request not found or already resolved: ${requestId}`);
    }

    const request = mapRow(row);
    log.info('HITL request resolved', {
      id: requestId,
      userId,
      decision: response.decision,
      status: newStatus,
    });

    // Notify listeners
    for (const cb of this.responseListeners) {
      try {
        cb(request);
      } catch (err) {
        log.warn('Response listener error', { error: err });
      }
    }

    return request;
  }

  // ---------------------------------------------------------------------------
  // getRequest
  // ---------------------------------------------------------------------------

  async getRequest(requestId: string, userId: string): Promise<HITLRequest | null> {
    const db = getAdapterSync();
    const row = await db.queryOne<HitlRow>(
      `SELECT * FROM hitl_requests WHERE id = ? AND user_id = ?`,
      [requestId, userId],
    );
    return row ? mapRow(row) : null;
  }

  // ---------------------------------------------------------------------------
  // listPending
  // ---------------------------------------------------------------------------

  async listPending(
    userId: string,
    options?: { workflowId?: string; limit?: number; offset?: number },
  ): Promise<{ items: HITLRequest[]; total: number }> {
    const db = getAdapterSync();
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [`user_id = ?`, `status = 'pending'`];
    const params: unknown[] = [userId];

    if (options?.workflowId) {
      conditions.push(`workflow_id = ?`);
      params.push(options.workflowId);
    }

    const where = conditions.join(' AND ');

    const countRow = await db.queryOne<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM hitl_requests WHERE ${where}`,
      params,
    );
    const total = parseInt(countRow?.count ?? '0', 10);

    const rows = await db.query<HitlRow>(
      `SELECT * FROM hitl_requests
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return {
      items: rows.map(mapRow),
      total,
    };
  }

  // ---------------------------------------------------------------------------
  // cancelForWorkflow
  // ---------------------------------------------------------------------------

  async cancelForWorkflow(workflowLogId: string, userId: string): Promise<number> {
    const db = getAdapterSync();
    const result = await db.execute(
      `UPDATE hitl_requests
       SET status = 'cancelled'
       WHERE workflow_log_id = ? AND user_id = ? AND status = 'pending'`,
      [workflowLogId, userId],
    );
    const count = result.changes;
    if (count > 0) {
      log.info('HITL requests cancelled for workflow', { workflowLogId, userId, count });
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // expireStale
  // ---------------------------------------------------------------------------

  async expireStale(): Promise<number> {
    const db = getAdapterSync();
    const result = await db.execute(
      `UPDATE hitl_requests
       SET status = 'expired'
       WHERE status = 'pending' AND expires_at < NOW()`,
    );
    const count = result.changes;
    if (count > 0) {
      log.info('Expired stale HITL requests', { count });
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Event subscriptions
  // ---------------------------------------------------------------------------

  onRequest(callback: (request: HITLRequest) => void): () => void {
    this.requestListeners.push(callback);
    return () => {
      const idx = this.requestListeners.indexOf(callback);
      if (idx >= 0) this.requestListeners.splice(idx, 1);
    };
  }

  onResponse(callback: (request: HITLRequest) => void): () => void {
    this.responseListeners.push(callback);
    return () => {
      const idx = this.responseListeners.indexOf(callback);
      if (idx >= 0) this.responseListeners.splice(idx, 1);
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: HitlService | null = null;

export function getHitlService(): HitlService {
  if (!_instance) {
    _instance = new HitlService();
  }
  return _instance;
}

/** Reset singleton (for tests) */
export function resetHitlService(): void {
  _instance = null;
}
