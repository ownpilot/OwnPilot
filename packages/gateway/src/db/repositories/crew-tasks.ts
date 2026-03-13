/**
 * Crew Task Queue Repository — CRUD for crew_task_queue
 *
 * Pull-based task queue where crew agents claim and complete tasks.
 */

import { BaseRepository } from './base.js';

// ── DB Row Type ─────────────────────────────────────

interface TaskRow {
  id: string;
  crew_id: string;
  created_by: string;
  claimed_by: string | null;
  task_name: string;
  description: string;
  context: string | null;
  expected_output: string | null;
  priority: string;
  status: string;
  result: string | null;
  deadline: string | null;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
}

// ── Record Type ─────────────────────────────────────

export type CrewTaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type CrewTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface CrewTask {
  id: string;
  crewId: string;
  createdBy: string;
  claimedBy: string | null;
  taskName: string;
  description: string;
  context: string | null;
  expectedOutput: string | null;
  priority: CrewTaskPriority;
  status: CrewTaskStatus;
  result: string | null;
  deadline: Date | null;
  createdAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
}

// ── Row → Record Mapper ─────────────────────────────

function rowToTask(row: TaskRow): CrewTask {
  return {
    id: row.id,
    crewId: row.crew_id,
    createdBy: row.created_by,
    claimedBy: row.claimed_by,
    taskName: row.task_name,
    description: row.description,
    context: row.context,
    expectedOutput: row.expected_output,
    priority: row.priority as CrewTaskPriority,
    status: row.status as CrewTaskStatus,
    result: row.result,
    deadline: row.deadline ? new Date(row.deadline) : null,
    createdAt: new Date(row.created_at),
    claimedAt: row.claimed_at ? new Date(row.claimed_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}

// ── Priority ordering for SQL ───────────────────────

const PRIORITY_ORDER = `CASE priority
  WHEN 'urgent' THEN 0
  WHEN 'high' THEN 1
  WHEN 'normal' THEN 2
  WHEN 'low' THEN 3
  ELSE 4
END`;

// ── Repository ──────────────────────────────────────

export class CrewTasksRepository extends BaseRepository {
  async create(data: {
    crewId: string;
    createdBy: string;
    taskName: string;
    description: string;
    context?: string;
    expectedOutput?: string;
    priority?: CrewTaskPriority;
    deadline?: Date;
  }): Promise<CrewTask> {
    const rows = await this.query<TaskRow>(
      `INSERT INTO crew_task_queue (crew_id, created_by, task_name, description, context, expected_output, priority, deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.crewId,
        data.createdBy,
        data.taskName,
        data.description,
        data.context ?? null,
        data.expectedOutput ?? null,
        data.priority ?? 'normal',
        data.deadline ?? null,
      ]
    );
    return rowToTask(rows[0]!);
  }

  async getById(taskId: string): Promise<CrewTask | null> {
    const row = await this.queryOne<TaskRow>(
      `SELECT * FROM crew_task_queue WHERE id = $1`,
      [taskId]
    );
    return row ? rowToTask(row) : null;
  }

  async claim(taskId: string, agentId: string): Promise<CrewTask | null> {
    const rows = await this.query<TaskRow>(
      `UPDATE crew_task_queue
       SET claimed_by = $1, status = 'in_progress', claimed_at = NOW()
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [agentId, taskId]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async claimHighestPriority(crewId: string, agentId: string): Promise<CrewTask | null> {
    const rows = await this.query<TaskRow>(
      `UPDATE crew_task_queue
       SET claimed_by = $2, status = 'in_progress', claimed_at = NOW()
       WHERE id = (
         SELECT id FROM crew_task_queue
         WHERE crew_id = $1 AND status = 'pending'
         ORDER BY ${PRIORITY_ORDER}, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [crewId, agentId]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async complete(taskId: string, agentId: string, result: string): Promise<CrewTask | null> {
    const rows = await this.query<TaskRow>(
      `UPDATE crew_task_queue
       SET status = 'completed', result = $1, completed_at = NOW()
       WHERE id = $2 AND claimed_by = $3
       RETURNING *`,
      [result, taskId, agentId]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async fail(taskId: string, agentId: string, error: string): Promise<CrewTask | null> {
    const rows = await this.query<TaskRow>(
      `UPDATE crew_task_queue
       SET status = 'failed', result = $1, completed_at = NOW()
       WHERE id = $2 AND claimed_by = $3
       RETURNING *`,
      [error, taskId, agentId]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }

  async listPending(crewId: string, limit = 10): Promise<CrewTask[]> {
    const rows = await this.query<TaskRow>(
      `SELECT * FROM crew_task_queue
       WHERE crew_id = $1 AND status = 'pending'
       ORDER BY ${PRIORITY_ORDER}, created_at ASC
       LIMIT $2`,
      [crewId, limit]
    );
    return rows.map(rowToTask);
  }

  async listByAgent(agentId: string, status?: CrewTaskStatus): Promise<CrewTask[]> {
    if (status) {
      const rows = await this.query<TaskRow>(
        `SELECT * FROM crew_task_queue WHERE claimed_by = $1 AND status = $2 ORDER BY created_at DESC`,
        [agentId, status]
      );
      return rows.map(rowToTask);
    }
    const rows = await this.query<TaskRow>(
      `SELECT * FROM crew_task_queue WHERE claimed_by = $1 ORDER BY created_at DESC`,
      [agentId]
    );
    return rows.map(rowToTask);
  }

  async listByCrew(
    crewId: string,
    status?: CrewTaskStatus,
    limit = 20,
    offset = 0
  ): Promise<{ tasks: CrewTask[]; total: number }> {
    const whereClause = status
      ? 'WHERE crew_id = $1 AND status = $2'
      : 'WHERE crew_id = $1';
    const params = status ? [crewId, status] : [crewId];

    const countRow = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM crew_task_queue ${whereClause}`,
      params
    );
    const total = parseInt(countRow?.count ?? '0', 10);

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const rows = await this.query<TaskRow>(
      `SELECT * FROM crew_task_queue ${whereClause}
       ORDER BY ${PRIORITY_ORDER}, created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset]
    );

    return { tasks: rows.map(rowToTask), total };
  }
}

// ── Singleton ───────────────────────────────────────

let _instance: CrewTasksRepository | null = null;

export function getCrewTasksRepository(): CrewTasksRepository {
  if (!_instance) {
    _instance = new CrewTasksRepository();
  }
  return _instance;
}
