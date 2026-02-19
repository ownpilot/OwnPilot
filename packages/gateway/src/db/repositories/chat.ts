/**
 * Chat Repository
 *
 * CRUD operations for conversations and messages
 */

import { BaseRepository, parseJsonField, parseJsonFieldNullable } from './base.js';
import { truncate } from '../../routes/helpers.js';

// =====================================================
// TYPES
// =====================================================

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  agentId: string | null;
  agentName: string | null;
  provider: string | null;
  model: string | null;
  systemPrompt: string | null;
  messageCount: number;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface MessageAttachment {
  type: 'image' | 'file';
  mimeType?: string;
  filename?: string;
  size?: number;
  /** Path to the saved file in workspace (base64 NOT stored in DB) */
  path?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  provider: string | null;
  model: string | null;
  toolCalls: unknown[] | null;
  toolCallId: string | null;
  trace: Record<string, unknown> | null;
  isError: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  attachments: MessageAttachment[] | null;
  createdAt: Date;
}

export interface CreateConversationInput {
  title?: string;
  agentId?: string;
  agentName?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateMessageInput {
  conversationId: string;
  role: Message['role'];
  content: string;
  provider?: string;
  model?: string;
  toolCalls?: unknown[];
  toolCallId?: string;
  trace?: Record<string, unknown>;
  isError?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  attachments?: MessageAttachment[];
}

export interface ConversationQuery {
  agentId?: string;
  isArchived?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

// =====================================================
// ROW TYPES
// =====================================================

interface ConversationRow {
  id: string;
  user_id: string;
  title: string | null;
  agent_id: string | null;
  agent_name: string | null;
  provider: string | null;
  model: string | null;
  system_prompt: string | null;
  message_count: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  metadata: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  provider: string | null;
  model: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  trace: string | null;
  is_error: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  attachments: string | null;
  created_at: string;
}

// =====================================================
// CONVERTERS
// =====================================================

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    agentId: row.agent_id,
    agentName: row.agent_name,
    provider: row.provider,
    model: row.model,
    systemPrompt: row.system_prompt,
    messageCount: row.message_count,
    isArchived: row.is_archived,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: parseJsonField(row.metadata, {}),
  };
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Message['role'],
    content: row.content,
    provider: row.provider,
    model: row.model,
    toolCalls: parseJsonFieldNullable(row.tool_calls),
    toolCallId: row.tool_call_id,
    trace: parseJsonFieldNullable(row.trace),
    isError: row.is_error,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    attachments: parseJsonFieldNullable<MessageAttachment[]>(row.attachments),
    createdAt: new Date(row.created_at),
  };
}

// =====================================================
// REPOSITORY
// =====================================================

export class ChatRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  // =====================================================
  // CONVERSATIONS
  // =====================================================

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO conversations (id, user_id, title, agent_id, agent_name, provider, model, system_prompt, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        this.userId,
        input.title || null,
        input.agentId || null,
        input.agentName || null,
        input.provider || null,
        input.model || null,
        input.systemPrompt || null,
        JSON.stringify(input.metadata || {}),
        now,
        now,
      ]
    );

    const conversation = await this.getConversation(id);
    if (!conversation) throw new Error('Failed to create conversation');
    return conversation;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const row = await this.queryOne<ConversationRow>(
      'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? rowToConversation(row) : null;
  }

  async listConversations(query: ConversationQuery = {}): Promise<Conversation[]> {
    const conditions: string[] = ['user_id = $1'];
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.agentId !== undefined) {
      conditions.push(`agent_id = $${paramIndex++}`);
      params.push(query.agentId);
    }

    if (query.isArchived !== undefined) {
      conditions.push(`is_archived = $${paramIndex++}`);
      params.push(query.isArchived);
    }

    if (query.search) {
      conditions.push(`(title ILIKE $${paramIndex} OR agent_name ILIKE $${paramIndex})`);
      params.push(`%${this.escapeLike(query.search)}%`);
      paramIndex++;
    }

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const rows = await this.query<ConversationRow>(
      `SELECT * FROM conversations
       WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );

    return rows.map(rowToConversation);
  }

  async updateConversation(id: string, updates: Partial<CreateConversationInput & { isArchived?: boolean }>): Promise<Conversation | null> {
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.title !== undefined) {
      sets.push(`title = $${paramIndex++}`);
      params.push(updates.title);
    }
    if (updates.agentId !== undefined) {
      sets.push(`agent_id = $${paramIndex++}`);
      params.push(updates.agentId);
    }
    if (updates.agentName !== undefined) {
      sets.push(`agent_name = $${paramIndex++}`);
      params.push(updates.agentName);
    }
    if (updates.provider !== undefined) {
      sets.push(`provider = $${paramIndex++}`);
      params.push(updates.provider);
    }
    if (updates.model !== undefined) {
      sets.push(`model = $${paramIndex++}`);
      params.push(updates.model);
    }
    if (updates.isArchived !== undefined) {
      sets.push(`is_archived = $${paramIndex++}`);
      params.push(updates.isArchived);
    }

    if (sets.length === 1) return this.getConversation(id);

    params.push(id, this.userId);

    await this.execute(
      `UPDATE conversations SET ${sets.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      params
    );

    return this.getConversation(id);
  }

  async deleteConversation(id: string): Promise<boolean> {
    const result = await this.execute(
      'DELETE FROM conversations WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return result.changes > 0;
  }

  async deleteConversations(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    // Delete messages first (they reference conversations)
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    await this.execute(
      `DELETE FROM messages WHERE conversation_id IN (${placeholders})`,
      ids
    );

    // Delete conversations scoped to user
    const convPlaceholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const userParamIdx = ids.length + 1;
    const result = await this.execute(
      `DELETE FROM conversations WHERE id IN (${convPlaceholders}) AND user_id = $${userParamIdx}`,
      [...ids, this.userId]
    );
    return result.changes;
  }

  async deleteOldConversations(olderThanDays: number): Promise<number> {
    // Validate input to prevent SQL injection via INTERVAL interpolation
    const days = Math.floor(Math.abs(olderThanDays));
    if (!Number.isFinite(days) || days <= 0) {
      return 0;
    }
    // Find old conversation IDs — use MAKE_INTERVAL for parameterized query
    const rows = await this.query<{ id: string }>(
      `SELECT id FROM conversations WHERE user_id = $1 AND updated_at < NOW() - MAKE_INTERVAL(days => $2)`,
      [this.userId, days]
    );
    const ids = rows.map(r => r.id);
    if (ids.length === 0) return 0;
    return this.deleteConversations(ids);
  }

  async archiveConversations(ids: string[], archived: boolean): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const archivedIdx = ids.length + 1;
    const userIdx = ids.length + 2;
    const result = await this.execute(
      `UPDATE conversations SET is_archived = $${archivedIdx}, updated_at = NOW() WHERE id IN (${placeholders}) AND user_id = $${userIdx}`,
      [...ids, archived, this.userId]
    );
    return result.changes;
  }

  // Auto-generate title from first user message
  async generateTitle(conversationId: string): Promise<string | null> {
    const messages = await this.getMessages(conversationId, { limit: 1 });
    const firstMessage = messages[0];
    if (!firstMessage) return null;

    const title = truncate(firstMessage.content);

    await this.updateConversation(conversationId, { title });
    return title;
  }

  // =====================================================
  // MESSAGES
  // =====================================================

  async addMessage(input: CreateMessageInput): Promise<Message> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO messages (id, conversation_id, role, content, provider, model, tool_calls, tool_call_id, trace, is_error, input_tokens, output_tokens, attachments, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        input.conversationId,
        input.role,
        input.content,
        input.provider || null,
        input.model || null,
        input.toolCalls ? JSON.stringify(input.toolCalls) : null,
        input.toolCallId || null,
        input.trace ? JSON.stringify(input.trace) : null,
        input.isError || false,
        input.inputTokens || null,
        input.outputTokens || null,
        input.attachments?.length ? JSON.stringify(input.attachments) : null,
        now,
      ]
    );

    // Update conversation message count and updated_at
    await this.execute(
      `UPDATE conversations
       SET message_count = message_count + 1, updated_at = NOW()
       WHERE id = $1`,
      [input.conversationId]
    );

    const message = await this.getMessage(id);
    if (!message) throw new Error('Failed to create message');
    return message;
  }

  async getMessage(id: string): Promise<Message | null> {
    const row = await this.queryOne<MessageRow>(
      'SELECT * FROM messages WHERE id = $1',
      [id]
    );
    return row ? rowToMessage(row) : null;
  }

  async getMessages(conversationId: string, options: { limit?: number; offset?: number; beforeId?: string } = {}): Promise<Message[]> {
    const conditions: string[] = ['conversation_id = $1'];
    const params: unknown[] = [conversationId];
    let paramIndex = 2;

    if (options.beforeId) {
      conditions.push(`created_at < (SELECT created_at FROM messages WHERE id = $${paramIndex++})`);
      params.push(options.beforeId);
    }

    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const rows = await this.query<MessageRow>(
      `SELECT * FROM messages
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at ASC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );

    return rows.map(rowToMessage);
  }

  async deleteMessage(id: string): Promise<boolean> {
    // Get conversation_id first to update count
    const msg = await this.getMessage(id);
    if (!msg) return false;

    const result = await this.execute('DELETE FROM messages WHERE id = $1', [id]);

    if (result.changes > 0) {
      await this.execute(
        `UPDATE conversations
         SET message_count = message_count - 1, updated_at = NOW()
         WHERE id = $1`,
        [msg.conversationId]
      );
    }

    return result.changes > 0;
  }

  // =====================================================
  // UTILITIES
  // =====================================================

  async getOrCreateConversation(conversationId: string | null, input: CreateConversationInput): Promise<Conversation> {
    if (conversationId) {
      const existing = await this.getConversation(conversationId);
      if (existing) return existing;
    }
    return this.createConversation(input);
  }

  async getConversationWithMessages(conversationId: string): Promise<{ conversation: Conversation; messages: Message[] } | null> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return null;

    const messages = await this.getMessages(conversationId);
    return { conversation, messages };
  }

  // Get recent conversations with preview (last message)
  async getRecentConversations(limit = 20): Promise<Array<Conversation & { lastMessage?: string; lastMessageAt?: Date }>> {
    const conversations = await this.listConversations({ limit, isArchived: false });

    const result: Array<Conversation & { lastMessage?: string; lastMessageAt?: Date }> = [];
    for (const conv of conversations) {
      const messages = await this.getMessages(conv.id, { limit: 1 });
      const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

      result.push({
        ...conv,
        lastMessage: lastMsg?.content.slice(0, 100),
        lastMessageAt: lastMsg?.createdAt,
      });
    }

    return result;
  }
}

// Factory function
export function createChatRepository(userId = 'default'): ChatRepository {
  return new ChatRepository(userId);
}
