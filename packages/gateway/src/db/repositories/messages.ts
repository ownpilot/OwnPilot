/**
 * Messages Repository
 */

import { getDatabase } from '../connection.js';

export interface Message {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  toolCallId?: string;
  createdAt: Date;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: string;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Message['role'],
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    toolCallId: row.tool_call_id ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

export class MessagesRepository {
  private db = getDatabase();

  create(data: {
    id: string;
    conversationId: string;
    role: Message['role'];
    content: string;
    toolCalls?: Message['toolCalls'];
    toolCallId?: string;
  }): Message {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      data.id,
      data.conversationId,
      data.role,
      data.content,
      data.toolCalls ? JSON.stringify(data.toolCalls) : null,
      data.toolCallId ?? null
    );

    return this.getById(data.id)!;
  }

  getById(id: string): Message | null {
    const stmt = this.db.prepare<string, MessageRow>(`
      SELECT * FROM messages WHERE id = ?
    `);

    const row = stmt.get(id);
    return row ? rowToMessage(row) : null;
  }

  getByConversation(conversationId: string, limit?: number): Message[] {
    const query = limit
      ? `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?`
      : `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`;

    const stmt = limit
      ? this.db.prepare<[string, number], MessageRow>(query)
      : this.db.prepare<string, MessageRow>(query);

    const rows = limit
      ? (stmt as ReturnType<typeof this.db.prepare<[string, number], MessageRow>>).all(conversationId, limit)
      : (stmt as ReturnType<typeof this.db.prepare<string, MessageRow>>).all(conversationId);

    return rows.map(rowToMessage);
  }

  getRecent(conversationId: string, count: number): Message[] {
    const stmt = this.db.prepare<[string, number], MessageRow>(`
      SELECT * FROM (
        SELECT * FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      ) ORDER BY created_at ASC
    `);

    return stmt.all(conversationId, count).map(rowToMessage);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM messages WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  deleteByConversation(conversationId: string): number {
    const stmt = this.db.prepare(`DELETE FROM messages WHERE conversation_id = ?`);
    const result = stmt.run(conversationId);
    return result.changes;
  }

  count(conversationId?: string): number {
    if (conversationId) {
      const stmt = this.db.prepare<string, { count: number }>(`
        SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?
      `);
      return stmt.get(conversationId)?.count ?? 0;
    }

    const stmt = this.db.prepare<[], { count: number }>(`
      SELECT COUNT(*) as count FROM messages
    `);
    return stmt.get()?.count ?? 0;
  }
}

export const messagesRepo = new MessagesRepository();
