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
export type WorkflowLogStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'awaiting_approval';
export type NodeExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface ToolNodeData {
  toolName: string;
  toolArgs: Record<string, unknown>;
  label: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
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
  retryCount?: number;
  timeoutMs?: number;
}

export interface ConditionNodeData {
  label: string;
  /** JS expression evaluated against upstream outputs — must return truthy/falsy */
  expression: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface CodeNodeData {
  label: string;
  language: 'javascript' | 'python' | 'shell';
  /** The script source code */
  code: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface TransformerNodeData {
  label: string;
  /** JS expression that transforms input data. `data` variable holds upstream output. */
  expression: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
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
  retryCount?: number;
  timeoutMs?: number;
}

export interface HttpRequestNodeData {
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** URL template — supports {{node_id.output}} expressions */
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  /** Request body (JSON string or raw text) — template-resolved */
  body?: string;
  bodyType?: 'json' | 'text' | 'form';
  auth?: {
    type: 'none' | 'bearer' | 'basic' | 'apiKey';
    token?: string;
    username?: string;
    password?: string;
    /** API key header name (default: X-API-Key) */
    headerName?: string;
  };
  /** Response body size limit in bytes (default: 1MB) */
  maxResponseSize?: number;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface DelayNodeData {
  label: string;
  /** Duration value — supports template expressions */
  duration: string;
  unit: 'seconds' | 'minutes' | 'hours';
  description?: string;
}

export interface SwitchNodeData {
  label: string;
  /** JS expression evaluated to produce a switch value */
  expression: string;
  /** Named cases: each has a label (handle ID) and a value to match against */
  cases: Array<{ label: string; value: string }>;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface ErrorHandlerNodeData {
  label: string;
  description?: string;
  continueOnSuccess?: boolean;
  outputAlias?: string;
}

export interface SubWorkflowNodeData {
  label: string;
  subWorkflowId?: string;
  subWorkflowName?: string;
  inputMapping?: Record<string, string>;
  maxDepth?: number;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface ApprovalNodeData {
  label: string;
  approvalMessage?: string;
  timeoutMinutes?: number;
  description?: string;
}

export interface StickyNoteNodeData {
  label: string;
  text?: string;
  color?: string;
}

export interface NotificationNodeData {
  label: string;
  message?: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface ParallelNodeData {
  label: string;
  branchCount: number;
  branchLabels?: string[];
  description?: string;
}

export interface MergeNodeData {
  label: string;
  mode?: 'waitAll' | 'firstCompleted';
  description?: string;
}

export type WorkflowNodeData =
  | ToolNodeData
  | TriggerNodeData
  | LlmNodeData
  | ConditionNodeData
  | CodeNodeData
  | TransformerNodeData
  | ForEachNodeData
  | HttpRequestNodeData
  | DelayNodeData
  | SwitchNodeData
  | ErrorHandlerNodeData
  | SubWorkflowNodeData
  | ApprovalNodeData
  | StickyNoteNodeData
  | NotificationNodeData
  | ParallelNodeData
  | MergeNodeData
  | Record<string, unknown>;

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

export interface InputParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required: boolean;
  defaultValue?: string;
  description?: string;
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
  inputSchema: InputParameter[];
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
  /** For condition nodes: 'true'/'false'. For switch nodes: matched case label or 'default'. */
  branchTaken?: string;
  /** For forEach nodes: number of iterations completed */
  iterationCount?: number;
  /** For forEach nodes: total items in the source array */
  totalItems?: number;
  /** Number of retry attempts (0 = succeeded on first try) */
  retryAttempts?: number;
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

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status?: WorkflowStatus;
  variables?: Record<string, unknown>;
  inputSchema?: InputParameter[];
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  status?: WorkflowStatus;
  variables?: Record<string, unknown>;
  inputSchema?: InputParameter[];
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
  input_schema: string;
  last_run: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

interface WorkflowVersionRow {
  id: string;
  workflow_id: string;
  version: number;
  nodes: string;
  edges: string;
  variables: string;
  created_at: string;
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
    inputSchema: parseJsonField<InputParameter[]>(row.input_schema, []),
    lastRun: row.last_run ? new Date(row.last_run) : null,
    runCount: row.run_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapVersion(row: WorkflowVersionRow): WorkflowVersion {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    version: row.version,
    nodes: parseJsonField<WorkflowNode[]>(row.nodes, []),
    edges: parseJsonField<WorkflowEdge[]>(row.edges, []),
    variables: parseJsonField<Record<string, unknown>>(row.variables, {}),
    createdAt: new Date(row.created_at),
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
      `INSERT INTO workflows (id, user_id, name, description, nodes, edges, status, variables, input_schema, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        this.userId,
        input.name,
        input.description ?? null,
        JSON.stringify(input.nodes),
        JSON.stringify(input.edges),
        input.status ?? 'inactive',
        JSON.stringify(input.variables ?? {}),
        JSON.stringify(input.inputSchema ?? []),
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
    if (input.inputSchema !== undefined) {
      updates.push(`input_schema = $${paramIndex++}`);
      values.push(JSON.stringify(input.inputSchema));
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

    const result = await this.execute('DELETE FROM workflows WHERE id = $1 AND user_id = $2', [
      id,
      this.userId,
    ]);
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
  // Workflow Versions
  // ==========================================================================

  async createVersion(workflowId: string): Promise<WorkflowVersion> {
    const workflow = await this.get(workflowId);
    if (!workflow) throw new Error('Workflow not found');

    // Get next version number
    const latest = await this.queryOne<{ max_version: number | null }>(
      `SELECT MAX(version) as max_version FROM workflow_versions WHERE workflow_id = $1`,
      [workflowId]
    );
    const nextVersion = (latest?.max_version ?? 0) + 1;

    const id = generateId('wfver');
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO workflow_versions (id, workflow_id, version, nodes, edges, variables, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        workflowId,
        nextVersion,
        JSON.stringify(workflow.nodes),
        JSON.stringify(workflow.edges),
        JSON.stringify(workflow.variables),
        now,
      ]
    );

    // Cleanup: keep only the last 50 versions
    await this.execute(
      `DELETE FROM workflow_versions WHERE workflow_id = $1 AND id NOT IN (
        SELECT id FROM workflow_versions WHERE workflow_id = $1
        ORDER BY version DESC LIMIT 50
      )`,
      [workflowId]
    );

    const version = await this.getVersion(workflowId, nextVersion);
    if (!version) throw new Error('Failed to create version');
    return version;
  }

  async getVersions(workflowId: string, limit = 20, offset = 0): Promise<WorkflowVersion[]> {
    const rows = await this.query<WorkflowVersionRow>(
      `SELECT wv.* FROM workflow_versions wv
       JOIN workflows w ON wv.workflow_id = w.id
       WHERE wv.workflow_id = $1 AND w.user_id = $2
       ORDER BY wv.version DESC LIMIT $3 OFFSET $4`,
      [workflowId, this.userId, limit, offset]
    );
    return rows.map(mapVersion);
  }

  async countVersions(workflowId: string): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM workflow_versions wv
       JOIN workflows w ON wv.workflow_id = w.id
       WHERE wv.workflow_id = $1 AND w.user_id = $2`,
      [workflowId, this.userId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async getVersion(workflowId: string, version: number): Promise<WorkflowVersion | null> {
    const row = await this.queryOne<WorkflowVersionRow>(
      `SELECT wv.* FROM workflow_versions wv
       JOIN workflows w ON wv.workflow_id = w.id
       WHERE wv.workflow_id = $1 AND wv.version = $2 AND w.user_id = $3`,
      [workflowId, version, this.userId]
    );
    return row ? mapVersion(row) : null;
  }

  async restoreVersion(workflowId: string, version: number): Promise<Workflow | null> {
    const ver = await this.getVersion(workflowId, version);
    if (!ver) return null;

    // Snapshot current state before restoring
    await this.createVersion(workflowId);

    // Update workflow with version data
    return this.update(workflowId, {
      nodes: ver.nodes,
      edges: ver.edges,
      variables: ver.variables,
    });
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
      `SELECT wl.* FROM workflow_logs wl
       JOIN workflows w ON wl.workflow_id = w.id
       WHERE wl.id = $1 AND w.user_id = $2`,
      [id, this.userId]
    );
    return row ? mapLog(row) : null;
  }

  async getLogsForWorkflow(workflowId: string, limit = 20, offset = 0): Promise<WorkflowLog[]> {
    const rows = await this.query<WorkflowLogRow>(
      `SELECT wl.* FROM workflow_logs wl
       JOIN workflows w ON wl.workflow_id = w.id
       WHERE wl.workflow_id = $1 AND w.user_id = $2
       ORDER BY wl.started_at DESC LIMIT $3 OFFSET $4`,
      [workflowId, this.userId, limit, offset]
    );
    return rows.map(mapLog);
  }

  async countLogsForWorkflow(workflowId: string): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM workflow_logs wl
       JOIN workflows w ON wl.workflow_id = w.id
       WHERE wl.workflow_id = $1 AND w.user_id = $2`,
      [workflowId, this.userId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async getRecentLogs(limit = 20, offset = 0): Promise<WorkflowLog[]> {
    const rows = await this.query<WorkflowLogRow>(
      `SELECT wl.* FROM workflow_logs wl
       JOIN workflows w ON wl.workflow_id = w.id
       WHERE w.user_id = $1
       ORDER BY wl.started_at DESC LIMIT $2 OFFSET $3`,
      [this.userId, limit, offset]
    );
    return rows.map(mapLog);
  }

  async countLogs(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM workflow_logs wl
       JOIN workflows w ON wl.workflow_id = w.id
       WHERE w.user_id = $1`,
      [this.userId]
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
