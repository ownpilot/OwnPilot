/**
 * Conversations Repository (PostgreSQL)
 */

import { BaseRepository, parseJsonField } from './base.js';

export interface Conversation {
  id: string;
  agentName: string;
  systemPrompt?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

interface ConversationRow {
  id: string;
  agent_name: string;
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
  metadata: string;
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    agentName: row.agent_name,
    systemPrompt: row.system_prompt ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: parseJsonField(row.metadata, {}),
  };
}

export class ConversationsRepository extends BaseRepository {
  async create(data: {
    id: string;
    agentName: string;
    systemPrompt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Conversation> {
    await this.execute(
      `INSERT INTO conversations (id, agent_name, system_prompt, metadata)
       VALUES ($1, $2, $3, $4)`,
      [data.id, data.agentName, data.systemPrompt ?? null, JSON.stringify(data.metadata ?? {})]
    );

    const result = await this.getById(data.id);
    if (!result) throw new Error('Failed to create conversation');
    return result;
  }

  async getById(id: string): Promise<Conversation | null> {
    const row = await this.queryOne<ConversationRow>(`SELECT * FROM conversations WHERE id = $1`, [
      id,
    ]);
    return row ? rowToConversation(row) : null;
  }

  async getByAgent(agentName: string, limit = 50): Promise<Conversation[]> {
    const rows = await this.query<ConversationRow>(
      `SELECT * FROM conversations
       WHERE agent_name = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [agentName, limit]
    );
    return rows.map(rowToConversation);
  }

  async getAll(limit = 100, offset = 0): Promise<Conversation[]> {
    const rows = await this.query<ConversationRow>(
      `SELECT * FROM conversations
       ORDER BY updated_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(rowToConversation);
  }

  async updateTimestamp(id: string): Promise<void> {
    await this.execute(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [id]);
  }

  async updateSystemPrompt(id: string, systemPrompt: string): Promise<void> {
    await this.execute(
      `UPDATE conversations SET system_prompt = $1, updated_at = NOW() WHERE id = $2`,
      [systemPrompt, id]
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(`DELETE FROM conversations WHERE id = $1`, [id]);
    return result.changes > 0;
  }

  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM conversations`
    );
    return parseInt(row?.count ?? '0', 10);
  }
}

export const conversationsRepo = new ConversationsRepository();

// Factory function
export function createConversationsRepository(): ConversationsRepository {
  return new ConversationsRepository();
}
