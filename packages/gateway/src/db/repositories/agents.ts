/**
 * Agents Repository (PostgreSQL)
 *
 * Stores agent configurations
 */

import { BaseRepository, parseJsonField } from './base.js';

export interface AgentRecord {
  id: string;
  name: string;
  systemPrompt?: string;
  provider: string;
  model: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface AgentRow {
  id: string;
  name: string;
  system_prompt: string | null;
  provider: string;
  model: string;
  config: string;
  created_at: string;
  updated_at: string;
}

function rowToAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    systemPrompt: row.system_prompt ?? undefined,
    provider: row.provider,
    model: row.model,
    config: parseJsonField(row.config, {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class AgentsRepository extends BaseRepository {
  async create(data: {
    id: string;
    name: string;
    systemPrompt?: string;
    provider: string;
    model: string;
    config?: Record<string, unknown>;
  }): Promise<AgentRecord> {
    await this.execute(
      `INSERT INTO agents (id, name, system_prompt, provider, model, config)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        data.id,
        data.name,
        data.systemPrompt ?? null,
        data.provider,
        data.model,
        JSON.stringify(data.config ?? {}),
      ]
    );

    const result = await this.getById(data.id);
    if (!result) throw new Error('Failed to create agent');
    return result;
  }

  async getById(id: string): Promise<AgentRecord | null> {
    const row = await this.queryOne<AgentRow>(
      `SELECT * FROM agents WHERE id = $1`,
      [id]
    );
    return row ? rowToAgent(row) : null;
  }

  async getByName(name: string): Promise<AgentRecord | null> {
    const row = await this.queryOne<AgentRow>(
      `SELECT * FROM agents WHERE name = $1`,
      [name]
    );
    return row ? rowToAgent(row) : null;
  }

  async getAll(): Promise<AgentRecord[]> {
    const rows = await this.query<AgentRow>(
      `SELECT * FROM agents ORDER BY name ASC`
    );
    return rows.map(rowToAgent);
  }

  async getPage(limit: number, offset: number): Promise<AgentRecord[]> {
    const rows = await this.query<AgentRow>(
      `SELECT * FROM agents ORDER BY name ASC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(rowToAgent);
  }

  async update(id: string, data: {
    name?: string;
    systemPrompt?: string;
    provider?: string;
    model?: string;
    config?: Record<string, unknown>;
  }): Promise<AgentRecord | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.systemPrompt !== undefined) {
      updates.push(`system_prompt = $${paramIndex++}`);
      values.push(data.systemPrompt);
    }
    if (data.provider !== undefined) {
      updates.push(`provider = $${paramIndex++}`);
      values.push(data.provider);
    }
    if (data.model !== undefined) {
      updates.push(`model = $${paramIndex++}`);
      values.push(data.model);
    }
    if (data.config !== undefined) {
      updates.push(`config = $${paramIndex++}`);
      values.push(JSON.stringify(data.config));
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = NOW()');
    values.push(id);

    await this.execute(
      `UPDATE agents SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    return this.getById(id);
  }

  /**
   * Atomic upsert for resync: creates if missing, merges config if exists.
   * Uses INSERT...ON CONFLICT to avoid check-then-act race conditions.
   */
  async upsertForResync(data: {
    id: string;
    name: string;
    systemPrompt?: string;
    provider: string;
    model: string;
    config?: Record<string, unknown>;
  }): Promise<void> {
    const configJson = JSON.stringify(data.config ?? {});
    await this.execute(
      `INSERT INTO agents (id, name, system_prompt, provider, model, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         config = agents.config::jsonb || $6::jsonb,
         updated_at = NOW()`,
      [
        data.id,
        data.name,
        data.systemPrompt ?? null,
        data.provider,
        data.model,
        configJson,
      ]
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM agents WHERE id = $1`,
      [id]
    );
    return result.changes > 0;
  }

  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM agents`
    );
    return parseInt(row?.count ?? '0', 10);
  }
}

export const agentsRepo = new AgentsRepository();

// Factory function
export function createAgentsRepository(): AgentsRepository {
  return new AgentsRepository();
}
