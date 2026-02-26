/**
 * Coding Agent Results Repository
 *
 * Persists outcomes from coding agent task executions (both user-initiated and AI-tool-initiated).
 */

import { BaseRepository, parseBool } from './base.js';

// =============================================================================
// ROW TYPE
// =============================================================================

interface ResultRow {
  id: string;
  user_id: string;
  session_id: string | null;
  provider: string;
  prompt: string;
  cwd: string | null;
  model: string | null;
  success: number | boolean;
  output: string;
  exit_code: number | null;
  error: string | null;
  duration_ms: number;
  cost_usd: number | null;
  mode: string | null;
  created_at: string;
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface CodingAgentResultRecord {
  id: string;
  userId: string;
  sessionId?: string;
  provider: string;
  prompt: string;
  cwd?: string;
  model?: string;
  success: boolean;
  output: string;
  exitCode?: number;
  error?: string;
  durationMs: number;
  costUsd?: number;
  mode?: string;
  createdAt: string;
}

export interface SaveResultInput {
  id: string;
  userId?: string;
  sessionId?: string;
  provider: string;
  prompt: string;
  cwd?: string;
  model?: string;
  success: boolean;
  output: string;
  exitCode?: number;
  error?: string;
  durationMs: number;
  costUsd?: number;
  mode?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function rowToRecord(row: ResultRow): CodingAgentResultRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id ?? undefined,
    provider: row.provider,
    prompt: row.prompt,
    cwd: row.cwd ?? undefined,
    model: row.model ?? undefined,
    success: parseBool(row.success),
    output: row.output,
    exitCode: row.exit_code ?? undefined,
    error: row.error ?? undefined,
    durationMs: Number(row.duration_ms),
    costUsd: row.cost_usd != null ? Number(row.cost_usd) : undefined,
    mode: row.mode ?? undefined,
    createdAt: row.created_at,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class CodingAgentResultsRepository extends BaseRepository {
  async save(input: SaveResultInput): Promise<CodingAgentResultRecord> {
    const userId = input.userId ?? 'default';

    await this.execute(
      `INSERT INTO coding_agent_results (
        id, user_id, session_id, provider, prompt, cwd, model,
        success, output, exit_code, error, duration_ms, cost_usd, mode
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        input.id,
        userId,
        input.sessionId ?? null,
        input.provider,
        input.prompt,
        input.cwd ?? null,
        input.model ?? null,
        input.success,
        input.output,
        input.exitCode ?? null,
        input.error ?? null,
        input.durationMs,
        input.costUsd ?? null,
        input.mode ?? null,
      ]
    );

    const result = await this.getById(input.id, userId);
    if (!result) throw new Error('Failed to save coding agent result');
    return result;
  }

  async getById(id: string, userId = 'default'): Promise<CodingAgentResultRecord | null> {
    const row = await this.queryOne<ResultRow>(
      'SELECT * FROM coding_agent_results WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return row ? rowToRecord(row) : null;
  }

  async getBySessionId(
    sessionId: string,
    userId = 'default'
  ): Promise<CodingAgentResultRecord | null> {
    const row = await this.queryOne<ResultRow>(
      'SELECT * FROM coding_agent_results WHERE session_id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    return row ? rowToRecord(row) : null;
  }

  async list(userId = 'default', limit = 50, offset = 0): Promise<CodingAgentResultRecord[]> {
    const rows = await this.query<ResultRow>(
      'SELECT * FROM coding_agent_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );
    return rows.map(rowToRecord);
  }

  async count(userId = 'default'): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM coding_agent_results WHERE user_id = $1',
      [userId]
    );
    return parseInt(row?.count ?? '0', 10);
  }
}

// =============================================================================
// SINGLETON & FACTORY
// =============================================================================

export const codingAgentResultsRepo = new CodingAgentResultsRepository();

export function createCodingAgentResultsRepository(): CodingAgentResultsRepository {
  return new CodingAgentResultsRepository();
}
