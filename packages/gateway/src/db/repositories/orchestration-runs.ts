/**
 * Orchestration Runs Repository
 *
 * Persists multi-step CLI tool orchestration runs.
 */

import { BaseRepository, parseJsonField } from './base.js';
import type {
  OrchestrationRunStatus,
  OrchestrationStep,
  CodingAgentPermissions,
} from '@ownpilot/core';

// =============================================================================
// ROW TYPE
// =============================================================================

interface RunRow {
  id: string;
  user_id: string;
  goal: string;
  provider: string;
  cwd: string;
  model: string | null;
  status: string;
  steps: string;
  current_step: number;
  max_steps: number;
  auto_mode: number | boolean;
  skill_ids: string;
  permissions: string | null;
  total_duration_ms: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface OrchestrationRunRecord {
  id: string;
  userId: string;
  goal: string;
  provider: string;
  cwd: string;
  model?: string;
  status: OrchestrationRunStatus;
  steps: OrchestrationStep[];
  currentStep: number;
  maxSteps: number;
  autoMode: boolean;
  skillIds: string[];
  permissions?: CodingAgentPermissions;
  totalDurationMs?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateRunInput {
  id: string;
  userId: string;
  goal: string;
  provider: string;
  cwd: string;
  model?: string;
  maxSteps?: number;
  autoMode?: boolean;
  skillIds?: string[];
  permissions?: CodingAgentPermissions;
}

// =============================================================================
// HELPERS
// =============================================================================

function rowToRecord(row: RunRow): OrchestrationRunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    goal: row.goal,
    provider: row.provider,
    cwd: row.cwd,
    model: row.model ?? undefined,
    status: row.status as OrchestrationRunStatus,
    steps: parseJsonField<OrchestrationStep[]>(row.steps, []),
    currentStep: Number(row.current_step),
    maxSteps: Number(row.max_steps),
    autoMode: typeof row.auto_mode === 'boolean' ? row.auto_mode : !!row.auto_mode,
    skillIds: parseJsonField<string[]>(row.skill_ids, []),
    permissions: row.permissions ? parseJsonField<CodingAgentPermissions>(row.permissions, {} as CodingAgentPermissions) : undefined,
    totalDurationMs: row.total_duration_ms != null ? Number(row.total_duration_ms) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class OrchestrationRunsRepository extends BaseRepository {
  async create(input: CreateRunInput): Promise<OrchestrationRunRecord> {
    await this.execute(
      `INSERT INTO orchestration_runs (
        id, user_id, goal, provider, cwd, model,
        max_steps, auto_mode, skill_ids, permissions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.id,
        input.userId,
        input.goal,
        input.provider,
        input.cwd,
        input.model ?? null,
        input.maxSteps ?? 10,
        input.autoMode ?? false,
        JSON.stringify(input.skillIds ?? []),
        input.permissions ? JSON.stringify(input.permissions) : null,
      ]
    );
    const record = await this.getById(input.id, input.userId);
    if (!record) throw new Error('Failed to create orchestration run');
    return record;
  }

  async getById(id: string, userId: string): Promise<OrchestrationRunRecord | null> {
    const row = await this.queryOne<RunRow>(
      'SELECT * FROM orchestration_runs WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return row ? rowToRecord(row) : null;
  }

  async list(
    userId: string,
    limit = 20,
    offset = 0
  ): Promise<OrchestrationRunRecord[]> {
    const rows = await this.query<RunRow>(
      'SELECT * FROM orchestration_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );
    return rows.map(rowToRecord);
  }

  async listActive(userId: string): Promise<OrchestrationRunRecord[]> {
    const rows = await this.query<RunRow>(
      `SELECT * FROM orchestration_runs
       WHERE user_id = $1 AND status IN ('planning', 'running', 'waiting_user', 'paused')
       ORDER BY created_at DESC`,
      [userId]
    );
    return rows.map(rowToRecord);
  }

  async updateStatus(
    id: string,
    userId: string,
    status: OrchestrationRunStatus,
    extra?: { completedAt?: string; totalDurationMs?: number }
  ): Promise<void> {
    const parts = ['status = $3', 'updated_at = NOW()'];
    const params: unknown[] = [id, userId, status];
    let idx = 4;

    if (extra?.completedAt) {
      parts.push(`completed_at = $${idx++}`);
      params.push(extra.completedAt);
    }
    if (extra?.totalDurationMs != null) {
      parts.push(`total_duration_ms = $${idx++}`);
      params.push(extra.totalDurationMs);
    }

    await this.execute(
      `UPDATE orchestration_runs SET ${parts.join(', ')} WHERE id = $1 AND user_id = $2`,
      params
    );
  }

  async updateSteps(
    id: string,
    userId: string,
    steps: OrchestrationStep[],
    currentStep: number
  ): Promise<void> {
    await this.execute(
      `UPDATE orchestration_runs SET steps = $3, current_step = $4, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [id, userId, JSON.stringify(steps), currentStep]
    );
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.execute(
      'DELETE FROM orchestration_runs WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return (result as unknown as { rowCount?: number })?.rowCount !== 0;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let _instance: OrchestrationRunsRepository | undefined;

export function createOrchestrationRunsRepository(): OrchestrationRunsRepository {
  return new OrchestrationRunsRepository();
}

export const orchestrationRunsRepo: OrchestrationRunsRepository = (() => {
  if (!_instance) _instance = createOrchestrationRunsRepository();
  return _instance;
})();
