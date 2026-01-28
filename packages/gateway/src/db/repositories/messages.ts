/**
 * Messages Repository (PostgreSQL)
 */

import { BaseRepository } from './base.js';

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
  let toolCalls = undefined;
  if (row.tool_calls) {
    try {
      toolCalls = typeof row.tool_calls === 'string' ? JSON.parse(row.tool_calls) : row.tool_calls;
    } catch {
      toolCalls = undefined;
    }
  }

  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Message['role'],
    content: row.content,
    toolCalls,
    toolCallId: row.tool_call_id ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

export class MessagesRepository extends BaseRepository {
  async create(data: {
    id: string;
    conversationId: string;
    role: Message['role'];
    content: string;
    toolCalls?: Message['toolCalls'];
    toolCallId?: string;
  }): Promise<Message> {
    await this.execute(
      `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        data.id,
        data.conversationId,
        data.role,
        data.content,
        data.toolCalls ? JSON.stringify(data.toolCalls) : null,
        data.toolCallId ?? null,
      ]
    );

    const result = await this.getById(data.id);
    if (!result) throw new Error('Failed to create message');
    return result;
  }

  async getById(id: string): Promise<Message | null> {
    const row = await this.queryOne<MessageRow>(
      `SELECT * FROM messages WHERE id = $1`,
      [id]
    );
    return row ? rowToMessage(row) : null;
  }

  async getByConversation(conversationId: string, limit?: number): Promise<Message[]> {
    const query = limit
      ? `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2`
      : `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`;

    const rows = limit
      ? await this.query<MessageRow>(query, [conversationId, limit])
      : await this.query<MessageRow>(query, [conversationId]);

    return rows.map(rowToMessage);
  }

  async getRecent(conversationId: string, count: number): Promise<Message[]> {
    const rows = await this.query<MessageRow>(
      `SELECT * FROM (
        SELECT * FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      ) subq ORDER BY created_at ASC`,
      [conversationId, count]
    );
    return rows.map(rowToMessage);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM messages WHERE id = $1`,
      [id]
    );
    return result.changes > 0;
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    const result = await this.execute(
      `DELETE FROM messages WHERE conversation_id = $1`,
      [conversationId]
    );
    return result.changes;
  }

  async count(conversationId?: string): Promise<number> {
    if (conversationId) {
      const row = await this.queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM messages WHERE conversation_id = $1`,
        [conversationId]
      );
      return parseInt(row?.count ?? '0', 10);
    }

    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM messages`
    );
    return parseInt(row?.count ?? '0', 10);
  }
}

export const messagesRepo = new MessagesRepository();

// Factory function
export function createMessagesRepository(): MessagesRepository {
  return new MessagesRepository();
}
