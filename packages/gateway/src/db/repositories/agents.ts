/**
 * Agents Repository
 *
 * Stores agent configurations
 */

import { getDatabase } from '../connection.js';

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
    config: JSON.parse(row.config || '{}'),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class AgentsRepository {
  private db = getDatabase();

  create(data: {
    id: string;
    name: string;
    systemPrompt?: string;
    provider: string;
    model: string;
    config?: Record<string, unknown>;
  }): AgentRecord {
    const stmt = this.db.prepare(`
      INSERT INTO agents (id, name, system_prompt, provider, model, config)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      data.id,
      data.name,
      data.systemPrompt ?? null,
      data.provider,
      data.model,
      JSON.stringify(data.config ?? {})
    );

    return this.getById(data.id)!;
  }

  getById(id: string): AgentRecord | null {
    const stmt = this.db.prepare<string, AgentRow>(`
      SELECT * FROM agents WHERE id = ?
    `);

    const row = stmt.get(id);
    return row ? rowToAgent(row) : null;
  }

  getByName(name: string): AgentRecord | null {
    const stmt = this.db.prepare<string, AgentRow>(`
      SELECT * FROM agents WHERE name = ?
    `);

    const row = stmt.get(name);
    return row ? rowToAgent(row) : null;
  }

  getAll(): AgentRecord[] {
    const stmt = this.db.prepare<[], AgentRow>(`
      SELECT * FROM agents ORDER BY name ASC
    `);

    return stmt.all().map(rowToAgent);
  }

  update(id: string, data: {
    name?: string;
    systemPrompt?: string;
    provider?: string;
    model?: string;
    config?: Record<string, unknown>;
  }): AgentRecord | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.systemPrompt !== undefined) {
      updates.push('system_prompt = ?');
      values.push(data.systemPrompt);
    }
    if (data.provider !== undefined) {
      updates.push('provider = ?');
      values.push(data.provider);
    }
    if (data.model !== undefined) {
      updates.push('model = ?');
      values.push(data.model);
    }
    if (data.config !== undefined) {
      updates.push('config = ?');
      values.push(JSON.stringify(data.config));
    }

    if (updates.length === 0) return existing;

    updates.push("updated_at = datetime('now')");
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE agents SET ${updates.join(', ')} WHERE id = ?
    `);

    stmt.run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM agents WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  count(): number {
    const stmt = this.db.prepare<[], { count: number }>(`
      SELECT COUNT(*) as count FROM agents
    `);

    return stmt.get()?.count ?? 0;
  }
}

export const agentsRepo = new AgentsRepository();
