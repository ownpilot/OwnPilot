/**
 * Claws Repository (PostgreSQL)
 *
 * CRUD for claw configs, session persistence, and execution history.
 */

import { generateId } from '@ownpilot/core';
import type {
  ClawConfig,
  ClawLimits,
  ClawMode,
  ClawState,
  ClawSandboxMode,
  ClawCreator,
  ClawCycleResult,
  ClawHistoryEntry,
  ClawToolCall,
  ClawEscalation,
} from '@ownpilot/core';
import { DEFAULT_CLAW_LIMITS } from '@ownpilot/core';
import { BaseRepository, parseJsonField, parseJsonFieldNullable } from './base.js';

// ============================================================================
// Row Types
// ============================================================================

interface ClawRow {
  id: string;
  user_id: string;
  name: string;
  mission: string;
  mode: string;
  allowed_tools: string;
  limits: string;
  interval_ms: number | null;
  event_filters: string | null;
  auto_start: boolean;
  stop_condition: string | null;
  provider: string | null;
  model: string | null;
  workspace_id: string | null;
  soul_id: string | null;
  parent_claw_id: string | null;
  depth: number;
  sandbox: string;
  coding_agent_provider: string | null;
  skills: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  claw_id: string;
  state: string;
  cycles_completed: number;
  total_tool_calls: number;
  total_cost_usd: string;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_cycle_error: string | null;
  started_at: string;
  stopped_at: string | null;
  persistent_context: string;
  inbox: string;
  artifacts: string;
  pending_escalation: string | null;
}

interface HistoryRow {
  id: string;
  claw_id: string;
  cycle_number: number;
  entry_type: string;
  success: boolean;
  tool_calls: string;
  output_message: string;
  tokens_used: string | null;
  cost_usd: string | null;
  duration_ms: number;
  error: string | null;
  executed_at: string;
}

// ============================================================================
// Row Mappers
// ============================================================================

function rowToConfig(row: ClawRow): ClawConfig {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    mission: row.mission,
    mode: row.mode as ClawMode,
    allowedTools: parseJsonField<string[]>(row.allowed_tools, []),
    limits: parseJsonField<ClawLimits>(row.limits, { ...DEFAULT_CLAW_LIMITS }),
    intervalMs: row.interval_ms ?? undefined,
    eventFilters: row.event_filters
      ? (parseJsonFieldNullable<string[]>(row.event_filters) ?? undefined)
      : undefined,
    autoStart: row.auto_start,
    stopCondition: row.stop_condition ?? undefined,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    soulId: row.soul_id ?? undefined,
    parentClawId: row.parent_claw_id ?? undefined,
    depth: row.depth,
    sandbox: row.sandbox as ClawSandboxMode,
    codingAgentProvider: row.coding_agent_provider ?? undefined,
    skills: parseJsonField<string[]>(row.skills ?? '[]', []),
    createdBy: row.created_by as ClawCreator,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToHistory(row: HistoryRow): ClawHistoryEntry {
  return {
    id: row.id,
    clawId: row.claw_id,
    cycleNumber: row.cycle_number,
    entryType: row.entry_type as 'cycle' | 'escalation',
    success: row.success,
    toolCalls: parseJsonField<ClawToolCall[]>(row.tool_calls, []),
    outputMessage: row.output_message,
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

export class ClawsRepository extends BaseRepository {
  // ---------- Claw CRUD ----------

  async create(data: {
    id: string;
    userId: string;
    name: string;
    mission: string;
    mode: ClawMode;
    allowedTools: string[];
    limits: ClawLimits;
    intervalMs?: number;
    eventFilters?: string[];
    autoStart: boolean;
    stopCondition?: string;
    provider?: string;
    model?: string;
    soulId?: string;
    parentClawId?: string;
    depth: number;
    sandbox: ClawSandboxMode;
    codingAgentProvider?: string;
    skills?: string[];
    createdBy: ClawCreator;
  }): Promise<ClawConfig> {
    await this.execute(
      `INSERT INTO claws
       (id, user_id, name, mission, mode, allowed_tools, limits, interval_ms, event_filters,
        auto_start, stop_condition, provider, model, soul_id, parent_claw_id,
        depth, sandbox, coding_agent_provider, skills, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [
        data.id,
        data.userId,
        data.name,
        data.mission,
        data.mode,
        JSON.stringify(data.allowedTools),
        JSON.stringify(data.limits),
        data.intervalMs ?? null,
        data.eventFilters ? JSON.stringify(data.eventFilters) : null,
        data.autoStart,
        data.stopCondition ?? null,
        data.provider ?? null,
        data.model ?? null,
        data.soulId ?? null,
        data.parentClawId ?? null,
        data.depth,
        data.sandbox,
        data.codingAgentProvider ?? null,
        JSON.stringify(data.skills ?? []),
        data.createdBy,
      ]
    );

    const result = await this.getById(data.id, data.userId);
    if (!result) throw new Error('Failed to create claw');
    return result;
  }

  async getById(id: string, userId: string): Promise<ClawConfig | null> {
    const row = await this.queryOne<ClawRow>(
      `SELECT * FROM claws WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return row ? rowToConfig(row) : null;
  }

  async getByIdAnyUser(id: string): Promise<ClawConfig | null> {
    const row = await this.queryOne<ClawRow>(`SELECT * FROM claws WHERE id = $1`, [id]);
    return row ? rowToConfig(row) : null;
  }

  async getAll(userId: string): Promise<ClawConfig[]> {
    const rows = await this.query<ClawRow>(
      `SELECT * FROM claws WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows.map(rowToConfig);
  }

  async getAutoStartClaws(): Promise<ClawConfig[]> {
    const rows = await this.query<ClawRow>(`SELECT * FROM claws WHERE auto_start = true`);
    return rows.map(rowToConfig);
  }

  async getChildClaws(parentId: string): Promise<ClawConfig[]> {
    const rows = await this.query<ClawRow>(
      `SELECT * FROM claws WHERE parent_claw_id = $1 ORDER BY created_at ASC`,
      [parentId]
    );
    return rows.map(rowToConfig);
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<{
      name: string;
      mission: string;
      mode: ClawMode;
      allowedTools: string[];
      limits: Partial<ClawLimits>;
      intervalMs: number;
      eventFilters: string[];
      autoStart: boolean;
      stopCondition: string | null;
      provider: string | null;
      model: string | null;
      workspaceId: string;
      soulId: string | null;
      sandbox: ClawSandboxMode;
      codingAgentProvider: string | null;
      skills: string[];
    }>
  ): Promise<ClawConfig | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (updates.name !== undefined) {
      sets.push(`name = $${idx++}`);
      params.push(updates.name);
    }
    if (updates.mission !== undefined) {
      sets.push(`mission = $${idx++}`);
      params.push(updates.mission);
    }
    if (updates.mode !== undefined) {
      sets.push(`mode = $${idx++}`);
      params.push(updates.mode);
    }
    if (updates.allowedTools !== undefined) {
      sets.push(`allowed_tools = $${idx++}`);
      params.push(JSON.stringify(updates.allowedTools));
    }
    if (updates.limits !== undefined) {
      sets.push(`limits = $${idx++}`);
      params.push(JSON.stringify(updates.limits));
    }
    if (updates.intervalMs !== undefined) {
      sets.push(`interval_ms = $${idx++}`);
      params.push(updates.intervalMs);
    }
    if (updates.eventFilters !== undefined) {
      sets.push(`event_filters = $${idx++}`);
      params.push(JSON.stringify(updates.eventFilters));
    }
    if (updates.autoStart !== undefined) {
      sets.push(`auto_start = $${idx++}`);
      params.push(updates.autoStart);
    }
    if (updates.stopCondition !== undefined) {
      sets.push(`stop_condition = $${idx++}`);
      params.push(updates.stopCondition);
    }
    if (updates.provider !== undefined) {
      sets.push(`provider = $${idx++}`);
      params.push(updates.provider);
    }
    if (updates.model !== undefined) {
      sets.push(`model = $${idx++}`);
      params.push(updates.model);
    }
    if (updates.workspaceId !== undefined) {
      sets.push(`workspace_id = $${idx++}`);
      params.push(updates.workspaceId);
    }
    if (updates.soulId !== undefined) {
      sets.push(`soul_id = $${idx++}`);
      params.push(updates.soulId);
    }
    if (updates.sandbox !== undefined) {
      sets.push(`sandbox = $${idx++}`);
      params.push(updates.sandbox);
    }
    if (updates.codingAgentProvider !== undefined) {
      sets.push(`coding_agent_provider = $${idx++}`);
      params.push(updates.codingAgentProvider);
    }
    if (updates.skills !== undefined) {
      sets.push(`skills = $${idx++}`);
      params.push(JSON.stringify(updates.skills));
    }

    if (sets.length === 0) return this.getById(id, userId);

    sets.push(`updated_at = NOW()`);
    params.push(id, userId);

    await this.execute(
      `UPDATE claws SET ${sets.join(', ')} WHERE id = $${idx++} AND user_id = $${idx}`,
      params
    );

    return this.getById(id, userId);
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.execute(`DELETE FROM claws WHERE id = $1 AND user_id = $2`, [
      id,
      userId,
    ]);
    return (result?.changes ?? 0) > 0;
  }

  // ---------- Session Persistence ----------

  async saveSession(
    clawId: string,
    session: {
      state: ClawState;
      cyclesCompleted: number;
      totalToolCalls: number;
      totalCostUsd: number;
      lastCycleAt: Date | null;
      lastCycleDurationMs: number | null;
      lastCycleError: string | null;
      startedAt: Date;
      stoppedAt: Date | null;
      persistentContext: Record<string, unknown>;
      inbox: string[];
      artifacts: string[];
      pendingEscalation: ClawEscalation | null;
    }
  ): Promise<void> {
    await this.execute(
      `INSERT INTO claw_sessions
       (claw_id, state, cycles_completed, total_tool_calls, total_cost_usd,
        last_cycle_at, last_cycle_duration_ms, last_cycle_error,
        started_at, stopped_at, persistent_context, inbox, artifacts, pending_escalation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (claw_id) DO UPDATE SET
         state = EXCLUDED.state,
         cycles_completed = EXCLUDED.cycles_completed,
         total_tool_calls = EXCLUDED.total_tool_calls,
         total_cost_usd = EXCLUDED.total_cost_usd,
         last_cycle_at = EXCLUDED.last_cycle_at,
         last_cycle_duration_ms = EXCLUDED.last_cycle_duration_ms,
         last_cycle_error = EXCLUDED.last_cycle_error,
         stopped_at = EXCLUDED.stopped_at,
         persistent_context = EXCLUDED.persistent_context,
         inbox = EXCLUDED.inbox,
         artifacts = EXCLUDED.artifacts,
         pending_escalation = EXCLUDED.pending_escalation`,
      [
        clawId,
        session.state,
        session.cyclesCompleted,
        session.totalToolCalls,
        session.totalCostUsd,
        session.lastCycleAt,
        session.lastCycleDurationMs,
        session.lastCycleError,
        session.startedAt,
        session.stoppedAt,
        JSON.stringify(session.persistentContext),
        JSON.stringify(session.inbox),
        JSON.stringify(session.artifacts),
        session.pendingEscalation ? JSON.stringify(session.pendingEscalation) : null,
      ]
    );
  }

  async loadSession(clawId: string): Promise<{
    state: ClawState;
    cyclesCompleted: number;
    totalToolCalls: number;
    totalCostUsd: number;
    lastCycleAt: Date | null;
    lastCycleDurationMs: number | null;
    lastCycleError: string | null;
    startedAt: Date;
    stoppedAt: Date | null;
    persistentContext: Record<string, unknown>;
    inbox: string[];
    artifacts: string[];
    pendingEscalation: ClawEscalation | null;
  } | null> {
    const row = await this.queryOne<SessionRow>(
      `SELECT * FROM claw_sessions WHERE claw_id = $1`,
      [clawId]
    );
    if (!row) return null;
    return {
      state: row.state as ClawState,
      cyclesCompleted: row.cycles_completed,
      totalToolCalls: row.total_tool_calls,
      totalCostUsd: parseFloat(row.total_cost_usd),
      lastCycleAt: row.last_cycle_at ? new Date(row.last_cycle_at) : null,
      lastCycleDurationMs: row.last_cycle_duration_ms,
      lastCycleError: row.last_cycle_error,
      startedAt: new Date(row.started_at),
      stoppedAt: row.stopped_at ? new Date(row.stopped_at) : null,
      persistentContext: parseJsonField<Record<string, unknown>>(row.persistent_context, {}),
      inbox: parseJsonField<string[]>(row.inbox, []),
      artifacts: parseJsonField<string[]>(row.artifacts, []),
      pendingEscalation: row.pending_escalation
        ? (parseJsonFieldNullable<ClawEscalation>(row.pending_escalation) ?? null)
        : null,
    };
  }

  async getInterruptedSessions(): Promise<
    Array<{ clawId: string; config: ClawConfig; state: ClawState }>
  > {
    const rows = await this.query<ClawRow & { session_state: string }>(
      `SELECT c.*, cs.state AS session_state
       FROM claws c
       JOIN claw_sessions cs ON c.id = cs.claw_id
       WHERE cs.state IN ('running', 'waiting')`,
      []
    );
    return rows.map((row) => ({
      clawId: row.id,
      config: rowToConfig(row),
      state: row.session_state as ClawState,
    }));
  }

  async deleteSession(clawId: string): Promise<void> {
    await this.execute(`DELETE FROM claw_sessions WHERE claw_id = $1`, [clawId]);
  }

  async appendToInbox(clawId: string, message: string): Promise<void> {
    await this.execute(
      `UPDATE claw_sessions
       SET inbox = inbox || $2::jsonb
       WHERE claw_id = $1`,
      [clawId, JSON.stringify([message])]
    );
  }

  // ---------- History ----------

  async saveHistory(clawId: string, cycleNumber: number, result: ClawCycleResult): Promise<void> {
    await this.execute(
      `INSERT INTO claw_history
       (id, claw_id, cycle_number, entry_type, success, tool_calls, output_message, tokens_used, cost_usd, duration_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        generateId('ch'),
        clawId,
        cycleNumber,
        'cycle',
        result.success,
        JSON.stringify(result.toolCalls),
        result.outputMessage,
        result.tokensUsed ? JSON.stringify(result.tokensUsed) : null,
        result.costUsd ?? null,
        result.durationMs,
        result.error ?? null,
      ]
    );
  }

  async saveEscalationHistory(
    clawId: string,
    cycleNumber: number,
    escalation: ClawEscalation
  ): Promise<void> {
    await this.execute(
      `INSERT INTO claw_history
       (id, claw_id, cycle_number, entry_type, success, output_message, duration_ms)
       VALUES ($1, $2, $3, 'escalation', $4, $5, 0)`,
      [
        generateId('ch'),
        clawId,
        cycleNumber,
        false,
        `Escalation requested: ${escalation.type} — ${escalation.reason}`,
      ]
    );
  }

  async getHistory(
    clawId: string,
    limit: number,
    offset: number
  ): Promise<{ entries: ClawHistoryEntry[]; total: number }> {
    const countRow = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM claw_history WHERE claw_id = $1`,
      [clawId]
    );
    const total = parseInt(countRow?.count ?? '0', 10);

    const rows = await this.query<HistoryRow>(
      `SELECT * FROM claw_history
       WHERE claw_id = $1
       ORDER BY executed_at DESC
       LIMIT $2 OFFSET $3`,
      [clawId, limit, offset]
    );

    return { entries: rows.map(rowToHistory), total };
  }

  async cleanupOldHistory(retentionDays: number): Promise<number> {
    const result = await this.execute(
      `DELETE FROM claw_history WHERE executed_at < NOW() - INTERVAL '1 day' * $1`,
      [retentionDays]
    );
    return result?.changes ?? 0;
  }

  // ---------- Audit Log ----------

  async saveAuditEntry(entry: {
    clawId: string;
    cycleNumber: number;
    toolName: string;
    toolArgs: Record<string, unknown>;
    toolResult: string;
    success: boolean;
    durationMs: number;
    category?: string;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO claw_audit_log (id, claw_id, cycle_number, tool_name, tool_args, tool_result, success, duration_ms, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        generateId('aud'),
        entry.clawId,
        entry.cycleNumber,
        entry.toolName,
        JSON.stringify(entry.toolArgs),
        (entry.toolResult ?? '').slice(0, 10_000),
        entry.success,
        entry.durationMs,
        entry.category ?? this.categorizeToolCall(entry.toolName),
      ]
    );
  }

  async saveAuditBatch(entries: Array<{
    clawId: string;
    cycleNumber: number;
    toolName: string;
    toolArgs: Record<string, unknown>;
    toolResult: string;
    success: boolean;
    durationMs: number;
    category?: string;
  }>): Promise<void> {
    for (const entry of entries) {
      await this.saveAuditEntry(entry);
    }
  }

  async getAuditLog(
    clawId: string,
    limit: number,
    offset: number,
    category?: string
  ): Promise<{ entries: Array<{
    id: string;
    clawId: string;
    cycleNumber: number;
    toolName: string;
    toolArgs: Record<string, unknown>;
    toolResult: string;
    success: boolean;
    durationMs: number;
    category: string;
    executedAt: string;
  }>; total: number }> {
    let countSql = `SELECT COUNT(*) as count FROM claw_audit_log WHERE claw_id = $1`;
    let sql = `SELECT * FROM claw_audit_log WHERE claw_id = $1`;
    const params: unknown[] = [clawId];
    let paramIdx = 2;

    if (category) {
      const catFilter = ` AND category = $${paramIdx++}`;
      countSql += catFilter;
      sql += catFilter;
      params.push(category);
    }

    const countRow = await this.queryOne<{ count: string }>(countSql, params);
    const total = parseInt(countRow?.count ?? '0', 10);

    sql += ` ORDER BY executed_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`;
    const rows = await this.query<{
      id: string; claw_id: string; cycle_number: number; tool_name: string;
      tool_args: string; tool_result: string; success: boolean; duration_ms: number;
      category: string; executed_at: string;
    }>(sql, [...params, limit, offset]);

    return {
      entries: rows.map((r) => ({
        id: r.id,
        clawId: r.claw_id,
        cycleNumber: r.cycle_number,
        toolName: r.tool_name,
        toolArgs: parseJsonField<Record<string, unknown>>(r.tool_args, {}),
        toolResult: r.tool_result,
        success: r.success,
        durationMs: r.duration_ms,
        category: r.category,
        executedAt: r.executed_at,
      })),
      total,
    };
  }

  private categorizeToolCall(toolName: string): string {
    if (toolName.startsWith('claw_')) return 'claw';
    if (toolName.startsWith('browse_') || toolName === 'browser_click' || toolName === 'browser_type' || toolName === 'browser_fill_form' || toolName === 'browser_screenshot' || toolName === 'browser_extract') return 'browser';
    if (toolName === 'run_cli_tool' || toolName === 'install_cli_tool' || toolName === 'list_cli_tools') return 'cli';
    if (toolName === 'run_coding_task' || toolName.startsWith('orchestrat')) return 'coding-agent';
    if (toolName.startsWith('fetch_') || toolName.startsWith('http_') || toolName === 'search_web' || toolName === 'post_json' || toolName === 'call_json_api') return 'web';
    if (toolName.startsWith('execute_') || toolName === 'eval_js' || toolName === 'eval_python') return 'code-exec';
    if (toolName.startsWith('git_')) return 'git';
    if (toolName.includes('memory') || toolName.includes('goal') || toolName.includes('plan')) return 'knowledge';
    if (toolName.startsWith('read_file') || toolName.startsWith('write_file') || toolName.startsWith('list_dir') || toolName.startsWith('delete_file')) return 'filesystem';
    return 'tool';
  }
}

// ============================================================================
// Factory
// ============================================================================

let _repo: ClawsRepository | null = null;

export function getClawsRepository(): ClawsRepository {
  if (!_repo) {
    _repo = new ClawsRepository();
  }
  return _repo;
}

export function createClawsRepository(): ClawsRepository {
  return new ClawsRepository();
}
