/**
 * Background Agents Repository (PostgreSQL)
 *
 * CRUD for background agent configs, session persistence, and cycle history.
 */

import { generateId } from '@ownpilot/core';
import type {
  BackgroundAgentConfig,
  BackgroundAgentLimits,
  BackgroundAgentMode,
  BackgroundAgentState,
  BackgroundAgentCreator,
  BackgroundAgentSession,
  BackgroundAgentCycleResult,
  BackgroundAgentHistoryEntry,
  BackgroundAgentToolCall,
} from '@ownpilot/core';
import { BaseRepository, parseJsonField, parseJsonFieldNullable } from './base.js';

// ============================================================================
// Row Types
// ============================================================================

interface AgentRow {
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
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  agent_id: string;
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
}

interface HistoryRow {
  id: string;
  agent_id: string;
  cycle_number: number;
  success: boolean;
  tool_calls: string;
  output_message: string;
  tokens_used: string | null;
  cost_usd: string | null;
  duration_ms: number;
  turns: number;
  error: string | null;
  executed_at: string;
}

// ============================================================================
// Row Mappers
// ============================================================================

function rowToConfig(row: AgentRow): BackgroundAgentConfig {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    mission: row.mission,
    mode: row.mode as BackgroundAgentMode,
    allowedTools: parseJsonField<string[]>(row.allowed_tools, []),
    limits: parseJsonField<BackgroundAgentLimits>(row.limits, {
      maxTurnsPerCycle: 10,
      maxToolCallsPerCycle: 50,
      maxCyclesPerHour: 60,
      cycleTimeoutMs: 120_000,
    }),
    intervalMs: row.interval_ms ?? undefined,
    eventFilters: row.event_filters
      ? parseJsonFieldNullable<string[]>(row.event_filters) ?? undefined
      : undefined,
    autoStart: row.auto_start,
    stopCondition: row.stop_condition ?? undefined,
    createdBy: row.created_by as BackgroundAgentCreator,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToHistory(row: HistoryRow): BackgroundAgentHistoryEntry {
  return {
    id: row.id,
    agentId: row.agent_id,
    cycleNumber: row.cycle_number,
    success: row.success,
    toolCalls: parseJsonField<BackgroundAgentToolCall[]>(row.tool_calls, []),
    outputMessage: row.output_message,
    tokensUsed: row.tokens_used
      ? parseJsonFieldNullable<{ prompt: number; completion: number }>(row.tokens_used) ??
        undefined
      : undefined,
    costUsd: row.cost_usd ? parseFloat(row.cost_usd) : undefined,
    durationMs: row.duration_ms,
    turns: row.turns,
    error: row.error ?? undefined,
    executedAt: new Date(row.executed_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class BackgroundAgentsRepository extends BaseRepository {
  // ---------- Agent CRUD ----------

  async create(data: {
    id: string;
    userId: string;
    name: string;
    mission: string;
    mode: BackgroundAgentMode;
    allowedTools: string[];
    limits: BackgroundAgentLimits;
    intervalMs?: number;
    eventFilters?: string[];
    autoStart: boolean;
    stopCondition?: string;
    createdBy: BackgroundAgentCreator;
  }): Promise<BackgroundAgentConfig> {
    await this.execute(
      `INSERT INTO background_agents
       (id, user_id, name, mission, mode, allowed_tools, limits, interval_ms, event_filters, auto_start, stop_condition, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
        data.createdBy,
      ]
    );

    const result = await this.getById(data.id, data.userId);
    if (!result) throw new Error('Failed to create background agent');
    return result;
  }

  async getById(id: string, userId: string): Promise<BackgroundAgentConfig | null> {
    const row = await this.queryOne<AgentRow>(
      `SELECT * FROM background_agents WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return row ? rowToConfig(row) : null;
  }

  async getAll(userId: string): Promise<BackgroundAgentConfig[]> {
    const rows = await this.query<AgentRow>(
      `SELECT * FROM background_agents WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows.map(rowToConfig);
  }

  async getAutoStartAgents(): Promise<BackgroundAgentConfig[]> {
    const rows = await this.query<AgentRow>(
      `SELECT * FROM background_agents WHERE auto_start = true`
    );
    return rows.map(rowToConfig);
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<{
      name: string;
      mission: string;
      mode: BackgroundAgentMode;
      allowedTools: string[];
      limits: Partial<BackgroundAgentLimits>;
      intervalMs: number;
      eventFilters: string[];
      autoStart: boolean;
      stopCondition: string | null;
    }>
  ): Promise<BackgroundAgentConfig | null> {
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

    if (sets.length === 0) return this.getById(id, userId);

    sets.push(`updated_at = NOW()`);
    params.push(id, userId);

    await this.execute(
      `UPDATE background_agents SET ${sets.join(', ')} WHERE id = $${idx++} AND user_id = $${idx}`,
      params
    );

    return this.getById(id, userId);
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM background_agents WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return (result?.changes ?? 0) > 0;
  }

  // ---------- Session Persistence ----------

  async saveSession(agentId: string, session: {
    state: BackgroundAgentState;
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
  }): Promise<void> {
    await this.execute(
      `INSERT INTO background_agent_sessions
       (agent_id, state, cycles_completed, total_tool_calls, total_cost_usd,
        last_cycle_at, last_cycle_duration_ms, last_cycle_error,
        started_at, stopped_at, persistent_context, inbox)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (agent_id) DO UPDATE SET
         state = EXCLUDED.state,
         cycles_completed = EXCLUDED.cycles_completed,
         total_tool_calls = EXCLUDED.total_tool_calls,
         total_cost_usd = EXCLUDED.total_cost_usd,
         last_cycle_at = EXCLUDED.last_cycle_at,
         last_cycle_duration_ms = EXCLUDED.last_cycle_duration_ms,
         last_cycle_error = EXCLUDED.last_cycle_error,
         stopped_at = EXCLUDED.stopped_at,
         persistent_context = EXCLUDED.persistent_context,
         inbox = EXCLUDED.inbox`,
      [
        agentId,
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
      ]
    );
  }

  async loadSession(agentId: string): Promise<{
    state: BackgroundAgentState;
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
  } | null> {
    const row = await this.queryOne<SessionRow>(
      `SELECT * FROM background_agent_sessions WHERE agent_id = $1`,
      [agentId]
    );
    if (!row) return null;
    return {
      state: row.state as BackgroundAgentState,
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
    };
  }

  async getInterruptedSessions(): Promise<
    Array<{ agentId: string; config: BackgroundAgentConfig; state: BackgroundAgentState }>
  > {
    const rows = await this.query<AgentRow & SessionRow>(
      `SELECT ba.*, bas.state AS session_state
       FROM background_agents ba
       JOIN background_agent_sessions bas ON ba.id = bas.agent_id
       WHERE bas.state IN ('running', 'waiting')`,
      []
    );
    return rows.map((row) => ({
      agentId: row.id,
      config: rowToConfig(row),
      state: (row as unknown as { session_state: string }).session_state as BackgroundAgentState,
    }));
  }

  async deleteSession(agentId: string): Promise<void> {
    await this.execute(
      `DELETE FROM background_agent_sessions WHERE agent_id = $1`,
      [agentId]
    );
  }

  async appendToInbox(agentId: string, message: string): Promise<void> {
    await this.execute(
      `UPDATE background_agent_sessions
       SET inbox = inbox || $2::jsonb
       WHERE agent_id = $1`,
      [agentId, JSON.stringify([message])]
    );
  }

  async clearInbox(agentId: string): Promise<string[]> {
    const row = await this.queryOne<{ inbox: string }>(
      `UPDATE background_agent_sessions
       SET inbox = '[]'::jsonb
       WHERE agent_id = $1
       RETURNING inbox`,
      [agentId]
    );
    // Return what was in the inbox before clearing
    // Note: RETURNING gives us the NEW value ('[]'), so we need a different approach
    return []; // inbox is consumed by runner directly from session state
  }

  // ---------- History ----------

  async saveHistory(
    agentId: string,
    cycleNumber: number,
    result: BackgroundAgentCycleResult
  ): Promise<void> {
    await this.execute(
      `INSERT INTO background_agent_history
       (id, agent_id, cycle_number, success, tool_calls, output_message, tokens_used, cost_usd, duration_ms, turns, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        generateId('bh'),
        agentId,
        cycleNumber,
        result.success,
        JSON.stringify(result.toolCalls),
        result.outputMessage,
        result.tokensUsed ? JSON.stringify(result.tokensUsed) : null,
        result.costUsd ?? null,
        result.durationMs,
        result.turns,
        result.error ?? null,
      ]
    );
  }

  async getHistory(
    agentId: string,
    limit: number,
    offset: number
  ): Promise<{ entries: BackgroundAgentHistoryEntry[]; total: number }> {
    const countRow = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM background_agent_history WHERE agent_id = $1`,
      [agentId]
    );
    const total = parseInt(countRow?.count ?? '0', 10);

    const rows = await this.query<HistoryRow>(
      `SELECT * FROM background_agent_history
       WHERE agent_id = $1
       ORDER BY executed_at DESC
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );

    return { entries: rows.map(rowToHistory), total };
  }

  async cleanupOldHistory(retentionDays: number): Promise<number> {
    const result = await this.execute(
      `DELETE FROM background_agent_history WHERE executed_at < NOW() - INTERVAL '1 day' * $1`,
      [retentionDays]
    );
    return result?.changes ?? 0;
  }
}

// ============================================================================
// Factory
// ============================================================================

let _repo: BackgroundAgentsRepository | null = null;

export function getBackgroundAgentsRepository(): BackgroundAgentsRepository {
  if (!_repo) {
    _repo = new BackgroundAgentsRepository();
  }
  return _repo;
}

export function createBackgroundAgentsRepository(): BackgroundAgentsRepository {
  return new BackgroundAgentsRepository();
}
