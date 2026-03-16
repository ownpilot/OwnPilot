/**
 * Fleet Repository (PostgreSQL)
 *
 * CRUD for fleet configs, sessions, tasks, and worker history.
 */

import { generateId } from '@ownpilot/core';
import type {
  FleetConfig,
  FleetSession,
  FleetTask,
  FleetWorkerResult,
  FleetWorkerConfig,
  FleetBudget,
  FleetScheduleConfig,
  FleetTaskPriority,
  FleetTaskStatus,
  FleetSessionState,
  FleetScheduleType,
  FleetWorkerType,
  CreateFleetInput,
  UpdateFleetInput,
  CreateFleetTaskInput,
} from '@ownpilot/core';
import { BaseRepository, parseJsonField, parseJsonFieldNullable } from './base.js';

// ============================================================================
// Row Types
// ============================================================================

interface FleetRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  mission: string;
  schedule_type: string;
  schedule_config: string;
  workers: string;
  budget: string;
  concurrency_limit: number;
  auto_start: boolean;
  provider: string | null;
  model: string | null;
  shared_context: string;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  id: string;
  fleet_id: string;
  state: string;
  started_at: string;
  stopped_at: string | null;
  cycles_completed: number;
  tasks_completed: number;
  tasks_failed: number;
  total_cost_usd: string;
  active_workers: number;
  shared_context: string;
}

interface TaskRow {
  id: string;
  fleet_id: string;
  title: string;
  description: string;
  assigned_worker: string | null;
  priority: string;
  status: string;
  input: string | null;
  output: string | null;
  depends_on: string;
  retries: number;
  max_retries: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface WorkerHistoryRow {
  id: string;
  session_id: string;
  worker_id: string;
  worker_name: string;
  worker_type: string;
  task_id: string | null;
  success: boolean;
  output: string;
  tool_calls: string;
  tokens_used: string | null;
  cost_usd: string | null;
  duration_ms: number;
  error: string | null;
  executed_at: string;
}

// ============================================================================
// Row Mappers
// ============================================================================

function rowToFleet(row: FleetRow): FleetConfig {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? undefined,
    mission: row.mission,
    scheduleType: row.schedule_type as FleetScheduleType,
    scheduleConfig: parseJsonFieldNullable<FleetScheduleConfig>(row.schedule_config) ?? undefined,
    workers: parseJsonField<FleetWorkerConfig[]>(row.workers, []),
    budget: parseJsonFieldNullable<FleetBudget>(row.budget) ?? undefined,
    concurrencyLimit: row.concurrency_limit,
    autoStart: row.auto_start,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    sharedContext: parseJsonFieldNullable<Record<string, unknown>>(row.shared_context) ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToSession(row: SessionRow): FleetSession {
  return {
    id: row.id,
    fleetId: row.fleet_id,
    state: row.state as FleetSessionState,
    startedAt: new Date(row.started_at),
    stoppedAt: row.stopped_at ? new Date(row.stopped_at) : undefined,
    cyclesCompleted: row.cycles_completed,
    tasksCompleted: row.tasks_completed,
    tasksFailed: row.tasks_failed,
    totalCostUsd: parseFloat(row.total_cost_usd) || 0,
    activeWorkers: row.active_workers,
    sharedContext: parseJsonField<Record<string, unknown>>(row.shared_context, {}),
  };
}

function rowToTask(row: TaskRow): FleetTask {
  return {
    id: row.id,
    fleetId: row.fleet_id,
    title: row.title,
    description: row.description,
    assignedWorker: row.assigned_worker ?? undefined,
    priority: row.priority as FleetTaskPriority,
    status: row.status as FleetTaskStatus,
    input: row.input
      ? (parseJsonFieldNullable<Record<string, unknown>>(row.input) ?? undefined)
      : undefined,
    output: row.output ?? undefined,
    dependsOn: parseJsonField<string[]>(row.depends_on, []),
    retries: row.retries,
    maxRetries: row.max_retries,
    error: row.error ?? undefined,
    createdAt: new Date(row.created_at),
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

function rowToWorkerResult(row: WorkerHistoryRow): FleetWorkerResult {
  return {
    id: row.id,
    sessionId: row.session_id,
    workerId: row.worker_id,
    workerName: row.worker_name,
    workerType: row.worker_type as FleetWorkerType,
    taskId: row.task_id ?? undefined,
    success: row.success,
    output: row.output,
    toolCalls: parseJsonField<
      Array<{ tool?: string; name: string; args: unknown; result: unknown }>
    >(row.tool_calls, []).map((tc) => ({
      tool: tc.tool ?? tc.name,
      name: tc.name,
      args: tc.args,
      result: tc.result,
    })),
    tokensUsed: row.tokens_used
      ? (parseJsonFieldNullable<{ prompt: number; completion: number }>(row.tokens_used) ??
        undefined)
      : undefined,
    costUsd: row.cost_usd ? parseFloat(row.cost_usd) : undefined,
    durationMs: row.duration_ms,
    error: row.error ?? undefined,
    executedAt: new Date(row.executed_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class FleetRepository extends BaseRepository {
  // ---- Fleet CRUD ----

  async create(input: CreateFleetInput & { id: string }): Promise<FleetConfig> {
    const row = await this.queryOne<FleetRow>(
      `INSERT INTO fleets (id, user_id, name, description, mission, schedule_type, schedule_config,
        workers, budget, concurrency_limit, auto_start, provider, model, shared_context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        input.id,
        input.userId,
        input.name,
        input.description ?? null,
        input.mission,
        input.scheduleType ?? 'on-demand',
        JSON.stringify(input.scheduleConfig ?? {}),
        JSON.stringify(input.workers),
        JSON.stringify(input.budget ?? {}),
        input.concurrencyLimit ?? 5,
        input.autoStart ?? false,
        input.provider ?? null,
        input.model ?? null,
        JSON.stringify(input.sharedContext ?? {}),
      ]
    );
    if (!row) throw new Error('Failed to create fleet');
    return rowToFleet(row);
  }

  async getById(fleetId: string, userId: string): Promise<FleetConfig | null> {
    const row = await this.queryOne<FleetRow>(
      'SELECT * FROM fleets WHERE id = $1 AND user_id = $2',
      [fleetId, userId]
    );
    return row ? rowToFleet(row) : null;
  }

  async getAll(userId: string): Promise<FleetConfig[]> {
    const rows = await this.query<FleetRow>(
      'SELECT * FROM fleets WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId]
    );
    return rows.map(rowToFleet);
  }

  async getAutoStartFleets(): Promise<FleetConfig[]> {
    const rows = await this.query<FleetRow>('SELECT * FROM fleets WHERE auto_start = true');
    return rows.map(rowToFleet);
  }

  async update(
    fleetId: string,
    userId: string,
    updates: UpdateFleetInput
  ): Promise<FleetConfig | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const addClause = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${idx++}`);
      params.push(value);
    };

    if (updates.name !== undefined) addClause('name', updates.name);
    if (updates.description !== undefined) addClause('description', updates.description);
    if (updates.mission !== undefined) addClause('mission', updates.mission);
    if (updates.scheduleType !== undefined) addClause('schedule_type', updates.scheduleType);
    if (updates.scheduleConfig !== undefined)
      addClause('schedule_config', JSON.stringify(updates.scheduleConfig));
    if (updates.workers !== undefined) addClause('workers', JSON.stringify(updates.workers));
    if (updates.budget !== undefined) addClause('budget', JSON.stringify(updates.budget));
    if (updates.concurrencyLimit !== undefined)
      addClause('concurrency_limit', updates.concurrencyLimit);
    if (updates.autoStart !== undefined) addClause('auto_start', updates.autoStart);
    if (updates.provider !== undefined) addClause('provider', updates.provider);
    if (updates.model !== undefined) addClause('model', updates.model);
    if (updates.sharedContext !== undefined)
      addClause('shared_context', JSON.stringify(updates.sharedContext));

    if (setClauses.length === 0) return this.getById(fleetId, userId);

    addClause('updated_at', new Date().toISOString());

    const row = await this.queryOne<FleetRow>(
      `UPDATE fleets SET ${setClauses.join(', ')}
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING *`,
      [...params, fleetId, userId]
    );
    return row ? rowToFleet(row) : null;
  }

  async delete(fleetId: string, userId: string): Promise<boolean> {
    const rows = await this.query(
      'DELETE FROM fleets WHERE id = $1 AND user_id = $2 RETURNING id',
      [fleetId, userId]
    );
    return rows.length > 0;
  }

  // ---- Sessions ----

  async createSession(
    fleetId: string,
    sharedContext?: Record<string, unknown>
  ): Promise<FleetSession> {
    const id = generateId('fls');
    const row = await this.queryOne<SessionRow>(
      `INSERT INTO fleet_sessions (id, fleet_id, state, shared_context)
       VALUES ($1, $2, 'running', $3)
       RETURNING *`,
      [id, fleetId, JSON.stringify(sharedContext ?? {})]
    );
    if (!row) throw new Error('Failed to create fleet session');
    return rowToSession(row);
  }

  async getSession(fleetId: string): Promise<FleetSession | null> {
    const row = await this.queryOne<SessionRow>(
      `SELECT * FROM fleet_sessions WHERE fleet_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [fleetId]
    );
    return row ? rowToSession(row) : null;
  }

  async updateSession(
    sessionId: string,
    updates: Partial<{
      state: FleetSessionState;
      stoppedAt: Date;
      cyclesCompleted: number;
      tasksCompleted: number;
      tasksFailed: number;
      totalCostUsd: number;
      activeWorkers: number;
      sharedContext: Record<string, unknown>;
    }>
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (updates.state !== undefined) {
      setClauses.push(`state = $${idx++}`);
      params.push(updates.state);
    }
    if (updates.stoppedAt !== undefined) {
      setClauses.push(`stopped_at = $${idx++}`);
      params.push(updates.stoppedAt.toISOString());
    }
    if (updates.cyclesCompleted !== undefined) {
      setClauses.push(`cycles_completed = $${idx++}`);
      params.push(updates.cyclesCompleted);
    }
    if (updates.tasksCompleted !== undefined) {
      setClauses.push(`tasks_completed = $${idx++}`);
      params.push(updates.tasksCompleted);
    }
    if (updates.tasksFailed !== undefined) {
      setClauses.push(`tasks_failed = $${idx++}`);
      params.push(updates.tasksFailed);
    }
    if (updates.totalCostUsd !== undefined) {
      setClauses.push(`total_cost_usd = $${idx++}`);
      params.push(updates.totalCostUsd);
    }
    if (updates.activeWorkers !== undefined) {
      setClauses.push(`active_workers = $${idx++}`);
      params.push(updates.activeWorkers);
    }
    if (updates.sharedContext !== undefined) {
      setClauses.push(`shared_context = $${idx++}`);
      params.push(JSON.stringify(updates.sharedContext));
    }

    if (setClauses.length === 0) return;

    await this.query(`UPDATE fleet_sessions SET ${setClauses.join(', ')} WHERE id = $${idx}`, [
      ...params,
      sessionId,
    ]);
  }

  async listSessions(userId: string): Promise<FleetSession[]> {
    const rows = await this.query<SessionRow>(
      `SELECT fs.* FROM fleet_sessions fs
       JOIN fleets f ON f.id = fs.fleet_id
       WHERE f.user_id = $1
       ORDER BY fs.started_at DESC`,
      [userId]
    );
    return rows.map(rowToSession);
  }

  // ---- Tasks ----

  async createTask(fleetId: string, input: CreateFleetTaskInput): Promise<FleetTask> {
    const id = generateId('flt');
    const row = await this.queryOne<TaskRow>(
      `INSERT INTO fleet_tasks (id, fleet_id, title, description, assigned_worker, priority, input, depends_on, max_retries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        fleetId,
        input.title,
        input.description,
        input.assignedWorker ?? null,
        input.priority ?? 'normal',
        input.input ? JSON.stringify(input.input) : null,
        JSON.stringify(input.dependsOn ?? []),
        input.maxRetries ?? 3,
      ]
    );
    if (!row) throw new Error('Failed to create fleet task');
    return rowToTask(row);
  }

  async getTask(taskId: string): Promise<FleetTask | null> {
    const row = await this.queryOne<TaskRow>('SELECT * FROM fleet_tasks WHERE id = $1', [taskId]);
    return row ? rowToTask(row) : null;
  }

  async listTasks(fleetId: string, status?: string): Promise<FleetTask[]> {
    const sql = status
      ? "SELECT * FROM fleet_tasks WHERE fleet_id = $1 AND status = $2 ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END, created_at ASC"
      : "SELECT * FROM fleet_tasks WHERE fleet_id = $1 ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END, created_at ASC";
    const params = status ? [fleetId, status] : [fleetId];
    const rows = await this.query<TaskRow>(sql, params);
    return rows.map(rowToTask);
  }

  async updateTask(
    taskId: string,
    updates: Partial<{
      status: FleetTaskStatus;
      output: string;
      error: string;
      startedAt: Date;
      completedAt: Date;
      retries: number;
      assignedWorker: string;
    }>
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (updates.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      params.push(updates.status);
    }
    if (updates.output !== undefined) {
      setClauses.push(`output = $${idx++}`);
      params.push(updates.output);
    }
    if (updates.error !== undefined) {
      setClauses.push(`error = $${idx++}`);
      params.push(updates.error);
    }
    if (updates.startedAt !== undefined) {
      setClauses.push(`started_at = $${idx++}`);
      params.push(updates.startedAt.toISOString());
    }
    if (updates.completedAt !== undefined) {
      setClauses.push(`completed_at = $${idx++}`);
      params.push(updates.completedAt.toISOString());
    }
    if (updates.retries !== undefined) {
      setClauses.push(`retries = $${idx++}`);
      params.push(updates.retries);
    }
    if (updates.assignedWorker !== undefined) {
      setClauses.push(`assigned_worker = $${idx++}`);
      params.push(updates.assignedWorker);
    }

    if (setClauses.length === 0) return;

    await this.query(`UPDATE fleet_tasks SET ${setClauses.join(', ')} WHERE id = $${idx}`, [
      ...params,
      taskId,
    ]);
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const rows = await this.query(
      `UPDATE fleet_tasks SET status = 'cancelled' WHERE id = $1 AND status IN ('queued', 'running') RETURNING id`,
      [taskId]
    );
    return rows.length > 0;
  }

  /** Get tasks ready to run: queued, dependencies met (completed or no deps) */
  async getReadyTasks(fleetId: string, limit: number): Promise<FleetTask[]> {
    // Tasks where all depends_on are completed
    const rows = await this.query<TaskRow>(
      `SELECT t.* FROM fleet_tasks t
       WHERE t.fleet_id = $1
         AND t.status = 'queued'
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(t.depends_on) dep
           WHERE NOT EXISTS (
             SELECT 1 FROM fleet_tasks d WHERE d.id = dep AND d.status = 'completed'
           )
         )
       ORDER BY
         CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END,
         t.created_at ASC
       LIMIT $2`,
      [fleetId, limit]
    );
    return rows.map(rowToTask);
  }

  /**
   * Fail all queued tasks that depend on a given failed task.
   * Cascades recursively: if task B depends on A, and C depends on B,
   * failing A will also fail B and C.
   */
  async failDependentTasks(fleetId: string, failedTaskId: string): Promise<number> {
    // Find all queued tasks in this fleet whose depends_on array contains failedTaskId
    const rows = await this.query<TaskRow>(
      `UPDATE fleet_tasks
       SET status = 'failed',
           error = 'Dependency task failed',
           completed_at = $3
       WHERE fleet_id = $1
         AND status = 'queued'
         AND depends_on::jsonb @> $2::jsonb
       RETURNING *`,
      [fleetId, JSON.stringify([failedTaskId]), new Date().toISOString()]
    );

    // Recursively fail tasks that depend on the newly-failed tasks
    let totalFailed = rows.length;
    for (const row of rows) {
      const cascaded = await this.failDependentTasks(fleetId, row.id);
      totalFailed += cascaded;
    }

    return totalFailed;
  }

  /**
   * Re-queue tasks stuck in 'running' status (orphaned from a previous crash).
   */
  async requeueOrphanedTasks(sessionId: string): Promise<number> {
    const rows = await this.query(
      `UPDATE fleet_tasks
       SET status = 'queued',
           started_at = NULL,
           assigned_worker = NULL
       WHERE fleet_id = (
         SELECT fleet_id FROM fleet_sessions WHERE id = $1
       )
         AND status = 'running'
       RETURNING id`,
      [sessionId]
    );
    return rows.length;
  }

  // ---- Cleanup ----

  /**
   * Delete old completed/failed/stopped sessions older than N days.
   * Uses stopped_at for terminated sessions, falls back to started_at.
   * Returns the number of deleted sessions.
   */
  async cleanupOldSessions(olderThanDays: number = 30): Promise<number> {
    const result = await this.query(
      `DELETE FROM fleet_sessions WHERE state IN ('completed', 'stopped', 'error') AND COALESCE(stopped_at, started_at) < NOW() - INTERVAL '1 day' * $1 RETURNING id`,
      [olderThanDays]
    );
    return result.length;
  }

  // ---- Worker History ----

  async saveWorkerResult(result: FleetWorkerResult): Promise<void> {
    await this.query(
      `INSERT INTO fleet_worker_history (id, session_id, worker_id, worker_name, worker_type,
        task_id, success, output, tool_calls, tokens_used, cost_usd, duration_ms, error, executed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        result.id,
        result.sessionId,
        result.workerId,
        result.workerName,
        result.workerType,
        result.taskId ?? null,
        result.success,
        result.output,
        JSON.stringify(result.toolCalls ?? []),
        result.tokensUsed ? JSON.stringify(result.tokensUsed) : null,
        result.costUsd ?? 0,
        result.durationMs,
        result.error ?? null,
        result.executedAt.toISOString(),
      ]
    );
  }

  async getWorkerHistory(
    fleetId: string,
    limit: number,
    offset: number
  ): Promise<{ entries: FleetWorkerResult[]; total: number }> {
    const countRow = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM fleet_worker_history wh
       JOIN fleet_sessions fs ON fs.id = wh.session_id
       WHERE fs.fleet_id = $1`,
      [fleetId]
    );
    const total = parseInt(countRow?.count ?? '0', 10);

    const rows = await this.query<WorkerHistoryRow>(
      `SELECT wh.* FROM fleet_worker_history wh
       JOIN fleet_sessions fs ON fs.id = wh.session_id
       WHERE fs.fleet_id = $1
       ORDER BY wh.executed_at DESC
       LIMIT $2 OFFSET $3`,
      [fleetId, limit, offset]
    );

    return { entries: rows.map(rowToWorkerResult), total };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _repo: FleetRepository | null = null;

export function getFleetRepository(): FleetRepository {
  if (!_repo) {
    _repo = new FleetRepository();
  }
  return _repo;
}
