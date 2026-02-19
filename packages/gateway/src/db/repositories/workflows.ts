/**
 * Workflows Repository
 *
 * Database operations for visual DAG tool pipelines.
 * Stores ReactFlow-compatible nodes/edges and execution logs.
 */

import { BaseRepository, parseJsonField } from './base.js';
import { generateId } from '@ownpilot/core';

// ============================================================================
// Types
// ============================================================================

export type WorkflowStatus = 'active' | 'inactive';
export type WorkflowLogStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type NodeExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface ToolNodeData {
  toolName: string;
  toolArgs: Record<string, unknown>;
  label: string;
  description?: string;
}

export interface TriggerNodeData {
  triggerType: 'manual' | 'schedule' | 'event' | 'condition' | 'webhook';
  label: string;
  cron?: string;
  timezone?: string;
  eventType?: string;
  filters?: Record<string, unknown>;
  condition?: string;
  threshold?: number;
  checkInterval?: number;
  webhookPath?: string;
  webhookSecret?: string;
  triggerId?: string;
}

export interface LlmNodeData {
  label: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
}

export interface ConditionNodeData {
  label: string;
  /** JS expression evaluated against upstream outputs — must return truthy/falsy */
  expression: string;
  description?: string;
}

export interface CodeNodeData {
  label: string;
  language: 'javascript' | 'python' | 'shell';
  /** The script source code */
  code: string;
  description?: string;
}

export interface TransformerNodeData {
  label: string;
  /** JS expression that transforms input data. `data` variable holds upstream output. */
  expression: string;
  description?: string;
}

export interface ForEachNodeData {
  label: string;
  /** Template expression resolving to an array, e.g. "{{node_1.output}}" */
  arrayExpression: string;
  /** Optional alias for the current item (e.g. "issue" → use {{issue}} in body nodes) */
  itemVariable?: string;
  /** Safety cap on iterations. Default: 100 */
  maxIterations?: number;
  /** Error strategy: 'stop' aborts on first error, 'continue' collects errors */
  onError?: 'stop' | 'continue';
  description?: string;
}

export type WorkflowNodeData = ToolNodeData | TriggerNodeData | LlmNodeData
  | ConditionNodeData | CodeNodeData | TransformerNodeData | ForEachNodeData;

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface Workflow {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: WorkflowStatus;
  variables: Record<string, unknown>;
  lastRun: Date | null;
  runCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NodeResult {
  nodeId: string;
  status: NodeExecutionStatus;
  output?: unknown;
  resolvedArgs?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  /** For condition nodes: which branch was taken */
  branchTaken?: 'true' | 'false';
  /** For forEach nodes: number of iterations completed */
  iterationCount?: number;
  /** For forEach nodes: total items in the source array */
  totalItems?: number;
}

export interface WorkflowLog {
  id: string;
  workflowId: string | null;
  workflowName: string | null;
  status: WorkflowLogStatus;
  nodeResults: Record<string, NodeResult>;
  error: string | null;
  durationMs: number | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status?: WorkflowStatus;
  variables?: Record<string, unknown>;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  status?: WorkflowStatus;
  variables?: Record<string, unknown>;
}

// ============================================================================
// Row types (DB snake_case)
// ============================================================================

interface WorkflowRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  nodes: string;
  edges: string;
  status: WorkflowStatus;
  variables: string;
  last_run: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

interface WorkflowLogRow {
  id: string;
  workflow_id: string | null;
  workflow_name: string | null;
  status: WorkflowLogStatus;
  node_results: string;
  error: string | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
}

// ============================================================================
// Row mappers
// ============================================================================

function mapWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    nodes: parseJsonField<WorkflowNode[]>(row.nodes, []),
    edges: parseJsonField<WorkflowEdge[]>(row.edges, []),
    status: row.status,
    variables: parseJsonField<Record<string, unknown>>(row.variables, {}),
    lastRun: row.last_run ? new Date(row.last_run) : null,
    runCount: row.run_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapLog(row: WorkflowLogRow): WorkflowLog {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    status: row.status,
    nodeResults: parseJsonField<Record<string, NodeResult>>(row.node_results, {}),
    error: row.error,
    durationMs: row.duration_ms,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}

// ============================================================================
// Repository
// ============================================================================

export class WorkflowsRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  // ==========================================================================
  // Workflow CRUD
  // ==========================================================================

  async create(input: CreateWorkflowInput): Promise<Workflow> {
    const id = generateId('wf');
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO workflows (id, user_id, name, description, nodes, edges, status, variables, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        this.userId,
        input.name,
        input.description ?? null,
        JSON.stringify(input.nodes),
        JSON.stringify(input.edges),
        input.status ?? 'inactive',
        JSON.stringify(input.variables ?? {}),
        now,
        now,
      ]
    );

    const workflow = await this.get(id);
    if (!workflow) throw new Error('Failed to create workflow');
    return workflow;
  }

  async get(id: string): Promise<Workflow | null> {
    const row = await this.queryOne<WorkflowRow>(
      'SELECT * FROM workflows WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? mapWorkflow(row) : null;
  }

  async update(id: string, input: UpdateWorkflowInput): Promise<Workflow | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updates: string[] = ['updated_at = $1'];
    const values: unknown[] = [new Date().toISOString()];
    let paramIndex = 2;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }
    if (input.nodes !== undefined) {
      updates.push(`nodes = $${paramIndex++}`);
      values.push(JSON.stringify(input.nodes));
    }
    if (input.edges !== undefined) {
      updates.push(`edges = $${paramIndex++}`);
      values.push(JSON.stringify(input.edges));
    }
    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }
    if (input.variables !== undefined) {
      updates.push(`variables = $${paramIndex++}`);
      values.push(JSON.stringify(input.variables));
    }

    values.push(id, this.userId);

    await this.execute(
      `UPDATE workflows SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      values
    );

    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    // Detach logs: preserve workflow name, set workflow_id = NULL
    const workflow = await this.get(id);
    if (workflow) {
      await this.execute(
        `UPDATE workflow_logs SET workflow_name = COALESCE(workflow_name, $1), workflow_id = NULL WHERE workflow_id = $2`,
        [workflow.name, id]
      );
    }

    const result = await this.execute(
      'DELETE FROM workflows WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return result.changes > 0;
  }

  async getPage(limit: number, offset: number): Promise<Workflow[]> {
    const rows = await this.query<WorkflowRow>(
      'SELECT * FROM workflows WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3',
      [this.userId, limit, offset]
    );
    return rows.map(mapWorkflow);
  }

  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM workflows WHERE user_id = $1',
      [this.userId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async markRun(id: string): Promise<void> {
    await this.execute(
      `UPDATE workflows SET last_run = $1, run_count = run_count + 1, updated_at = $1 WHERE id = $2 AND user_id = $3`,
      [new Date().toISOString(), id, this.userId]
    );
  }

  // ==========================================================================
  // Workflow Logs
  // ==========================================================================

  async createLog(workflowId: string, workflowName: string): Promise<WorkflowLog> {
    const id = generateId('wflog');
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO workflow_logs (id, workflow_id, workflow_name, status, node_results, started_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, workflowId, workflowName, 'running', '{}', now]
    );

    const log = await this.getLog(id);
    if (!log) throw new Error('Failed to create workflow log');
    return log;
  }

  async updateLog(
    logId: string,
    update: {
      status?: WorkflowLogStatus;
      nodeResults?: Record<string, NodeResult>;
      error?: string;
      completedAt?: string;
      durationMs?: number;
    }
  ): Promise<void> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (update.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(update.status);
    }
    if (update.nodeResults !== undefined) {
      updates.push(`node_results = $${paramIndex++}`);
      values.push(JSON.stringify(update.nodeResults));
    }
    if (update.error !== undefined) {
      updates.push(`error = $${paramIndex++}`);
      values.push(update.error);
    }
    if (update.completedAt !== undefined) {
      updates.push(`completed_at = $${paramIndex++}`);
      values.push(update.completedAt);
    }
    if (update.durationMs !== undefined) {
      updates.push(`duration_ms = $${paramIndex++}`);
      values.push(update.durationMs);
    }

    if (updates.length === 0) return;

    values.push(logId);
    await this.execute(
      `UPDATE workflow_logs SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  async getLog(id: string): Promise<WorkflowLog | null> {
    const row = await this.queryOne<WorkflowLogRow>(
      'SELECT * FROM workflow_logs WHERE id = $1',
      [id]
    );
    return row ? mapLog(row) : null;
  }

  async getLogsForWorkflow(workflowId: string, limit = 20, offset = 0): Promise<WorkflowLog[]> {
    const rows = await this.query<WorkflowLogRow>(
      'SELECT * FROM workflow_logs WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3',
      [workflowId, limit, offset]
    );
    return rows.map(mapLog);
  }

  async countLogsForWorkflow(workflowId: string): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM workflow_logs WHERE workflow_id = $1',
      [workflowId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async getRecentLogs(limit = 20, offset = 0): Promise<WorkflowLog[]> {
    const rows = await this.query<WorkflowLogRow>(
      'SELECT * FROM workflow_logs ORDER BY started_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return rows.map(mapLog);
  }

  async countLogs(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM workflow_logs'
    );
    return parseInt(row?.count ?? '0', 10);
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createWorkflowsRepository(userId = 'default'): WorkflowsRepository {
  return new WorkflowsRepository(userId);
}
