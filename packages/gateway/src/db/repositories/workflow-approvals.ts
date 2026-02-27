/**
 * Workflow Approvals Repository
 *
 * Manages approval gate records for workflow execution pause/resume.
 */

import { BaseRepository, parseJsonField } from './base.js';
import { generateId } from '@ownpilot/core';

// ============================================================================
// Types
// ============================================================================

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface WorkflowApproval {
  id: string;
  workflowLogId: string;
  workflowId: string;
  nodeId: string;
  userId: string;
  status: ApprovalStatus;
  context: Record<string, unknown>;
  message: string | null;
  decidedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CreateApprovalInput {
  workflowLogId: string;
  workflowId: string;
  nodeId: string;
  context?: Record<string, unknown>;
  message?: string;
  expiresAt?: Date;
}

// ============================================================================
// Row type
// ============================================================================

interface ApprovalRow {
  id: string;
  workflow_log_id: string;
  workflow_id: string;
  node_id: string;
  user_id: string;
  status: ApprovalStatus;
  context: string;
  message: string | null;
  decided_at: string | null;
  expires_at: string | null;
  created_at: string;
}

function mapApproval(row: ApprovalRow): WorkflowApproval {
  return {
    id: row.id,
    workflowLogId: row.workflow_log_id,
    workflowId: row.workflow_id,
    nodeId: row.node_id,
    userId: row.user_id,
    status: row.status,
    context: parseJsonField<Record<string, unknown>>(row.context, {}),
    message: row.message,
    decidedAt: row.decided_at ? new Date(row.decided_at) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    createdAt: new Date(row.created_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class WorkflowApprovalsRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async create(input: CreateApprovalInput): Promise<WorkflowApproval> {
    const id = generateId('wfappr');
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO workflow_approvals (id, workflow_log_id, workflow_id, node_id, user_id, status, context, message, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        input.workflowLogId,
        input.workflowId,
        input.nodeId,
        this.userId,
        'pending',
        JSON.stringify(input.context ?? {}),
        input.message ?? null,
        input.expiresAt?.toISOString() ?? null,
        now,
      ]
    );

    const approval = await this.get(id);
    if (!approval) throw new Error('Failed to create approval');
    return approval;
  }

  async get(id: string): Promise<WorkflowApproval | null> {
    const row = await this.queryOne<ApprovalRow>(
      'SELECT * FROM workflow_approvals WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? mapApproval(row) : null;
  }

  async decide(id: string, status: 'approved' | 'rejected'): Promise<WorkflowApproval | null> {
    const now = new Date().toISOString();
    await this.execute(
      `UPDATE workflow_approvals SET status = $1, decided_at = $2 WHERE id = $3 AND user_id = $4 AND status = 'pending'`,
      [status, now, id, this.userId]
    );
    return this.get(id);
  }

  async getPending(limit = 20, offset = 0): Promise<WorkflowApproval[]> {
    const rows = await this.query<ApprovalRow>(
      `SELECT * FROM workflow_approvals WHERE user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [this.userId, limit, offset]
    );
    return rows.map(mapApproval);
  }

  async countPending(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM workflow_approvals WHERE user_id = $1 AND status = 'pending'`,
      [this.userId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async getAll(limit = 20, offset = 0): Promise<WorkflowApproval[]> {
    const rows = await this.query<ApprovalRow>(
      `SELECT * FROM workflow_approvals WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [this.userId, limit, offset]
    );
    return rows.map(mapApproval);
  }

  async countAll(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM workflow_approvals WHERE user_id = $1`,
      [this.userId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async getByLogId(logId: string): Promise<WorkflowApproval | null> {
    const row = await this.queryOne<ApprovalRow>(
      `SELECT * FROM workflow_approvals WHERE workflow_log_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [logId, this.userId]
    );
    return row ? mapApproval(row) : null;
  }
}

export function createWorkflowApprovalsRepository(userId = 'default'): WorkflowApprovalsRepository {
  return new WorkflowApprovalsRepository(userId);
}
