/**
 * Conversations Repository
 */

import { getDatabase } from '../connection.js';

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
    metadata: JSON.parse(row.metadata || '{}'),
  };
}

export class ConversationsRepository {
  private db = getDatabase();

  create(data: {
    id: string;
    agentName: string;
    systemPrompt?: string;
    metadata?: Record<string, unknown>;
  }): Conversation {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, agent_name, system_prompt, metadata)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      data.id,
      data.agentName,
      data.systemPrompt ?? null,
      JSON.stringify(data.metadata ?? {})
    );

    return this.getById(data.id)!;
  }

  getById(id: string): Conversation | null {
    const stmt = this.db.prepare<string, ConversationRow>(`
      SELECT * FROM conversations WHERE id = ?
    `);

    const row = stmt.get(id);
    return row ? rowToConversation(row) : null;
  }

  getByAgent(agentName: string, limit = 50): Conversation[] {
    const stmt = this.db.prepare<[string, number], ConversationRow>(`
      SELECT * FROM conversations
      WHERE agent_name = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `);

    return stmt.all(agentName, limit).map(rowToConversation);
  }

  getAll(limit = 100, offset = 0): Conversation[] {
    const stmt = this.db.prepare<[number, number], ConversationRow>(`
      SELECT * FROM conversations
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `);

    return stmt.all(limit, offset).map(rowToConversation);
  }

  updateTimestamp(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE conversations
      SET updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(id);
  }

  updateSystemPrompt(id: string, systemPrompt: string): void {
    const stmt = this.db.prepare(`
      UPDATE conversations
      SET system_prompt = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(systemPrompt, id);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM conversations WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  count(): number {
    const stmt = this.db.prepare<[], { count: number }>(`
      SELECT COUNT(*) as count FROM conversations
    `);

    return stmt.get()?.count ?? 0;
  }
}

export const conversationsRepo = new ConversationsRepository();
