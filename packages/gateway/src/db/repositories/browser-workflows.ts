/**
 * Browser Workflows Repository
 *
 * CRUD for browser automation workflow definitions.
 */

import { generateId } from '@ownpilot/core';
import { BaseRepository, parseJsonField } from './base.js';
import type { BrowserAction } from '../../services/browser-service.js';

// ============================================================================
// Types
// ============================================================================

export interface BrowserWorkflow {
  id: string;
  userId: string;
  name: string;
  description: string;
  steps: BrowserAction[];
  parameters: WorkflowParameter[];
  triggerId: string | null;
  lastExecutedAt: Date | null;
  executionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowParameter {
  name: string;
  type: string;
  description: string;
}

export interface CreateBrowserWorkflowInput {
  name: string;
  description?: string;
  steps: BrowserAction[];
  parameters?: WorkflowParameter[];
  triggerId?: string;
}

export interface UpdateBrowserWorkflowInput {
  name?: string;
  description?: string;
  steps?: BrowserAction[];
  parameters?: WorkflowParameter[];
  triggerId?: string | null;
}

// ============================================================================
// Row Types
// ============================================================================

interface WorkflowRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  steps: string;
  parameters: string;
  trigger_id: string | null;
  last_executed_at: string | null;
  execution_count: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Row Mapper
// ============================================================================

function rowToWorkflow(row: WorkflowRow): BrowserWorkflow {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? '',
    steps: parseJsonField<BrowserAction[]>(row.steps, []),
    parameters: parseJsonField<WorkflowParameter[]>(row.parameters, []),
    triggerId: row.trigger_id,
    lastExecutedAt: row.last_executed_at ? new Date(row.last_executed_at) : null,
    executionCount: row.execution_count ?? 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class BrowserWorkflowsRepository extends BaseRepository {
  async create(userId: string, input: CreateBrowserWorkflowInput): Promise<BrowserWorkflow> {
    const id = generateId('bwf');
    const sql = `
      INSERT INTO browser_workflows (id, user_id, name, description, steps, parameters, trigger_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const rows = await this.query<WorkflowRow>(sql, [
      id,
      userId,
      input.name,
      input.description ?? '',
      JSON.stringify(input.steps),
      JSON.stringify(input.parameters ?? []),
      input.triggerId ?? null,
    ]);
    return rowToWorkflow(rows[0]!);
  }

  async getById(id: string, userId: string): Promise<BrowserWorkflow | null> {
    const rows = await this.query<WorkflowRow>(
      'SELECT * FROM browser_workflows WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return rows.length > 0 ? rowToWorkflow(rows[0]!) : null;
  }

  async listByUser(
    userId: string,
    limit = 20,
    offset = 0
  ): Promise<{ workflows: BrowserWorkflow[]; total: number }> {
    const countRows = await this.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM browser_workflows WHERE user_id = $1',
      [userId]
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const rows = await this.query<WorkflowRow>(
      'SELECT * FROM browser_workflows WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );

    return { workflows: rows.map(rowToWorkflow), total };
  }

  async update(
    id: string,
    userId: string,
    input: UpdateBrowserWorkflowInput
  ): Promise<BrowserWorkflow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (input.name !== undefined) {
      sets.push(`name = $${idx++}`);
      params.push(input.name);
    }
    if (input.description !== undefined) {
      sets.push(`description = $${idx++}`);
      params.push(input.description);
    }
    if (input.steps !== undefined) {
      sets.push(`steps = $${idx++}`);
      params.push(JSON.stringify(input.steps));
    }
    if (input.parameters !== undefined) {
      sets.push(`parameters = $${idx++}`);
      params.push(JSON.stringify(input.parameters));
    }
    if (input.triggerId !== undefined) {
      sets.push(`trigger_id = $${idx++}`);
      params.push(input.triggerId);
    }

    if (sets.length === 0) {
      return this.getById(id, userId);
    }

    sets.push(`updated_at = NOW()`);
    params.push(id, userId);

    const sql = `
      UPDATE browser_workflows
      SET ${sets.join(', ')}
      WHERE id = $${idx++} AND user_id = $${idx}
      RETURNING *
    `;

    const rows = await this.query<WorkflowRow>(sql, params);
    return rows.length > 0 ? rowToWorkflow(rows[0]!) : null;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const rows = await this.query<{ id: string }>(
      'DELETE FROM browser_workflows WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    return rows.length > 0;
  }
}
