/**
 * Chat Repository
 *
 * CRUD operations for conversations and messages
 */

import { getDatabase } from '../connection.js';

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
  is_archived: number;
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
  is_error: number;
  input_tokens: number | null;
  output_tokens: number | null;
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
    isArchived: row.is_archived === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: JSON.parse(row.metadata || '{}'),
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
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : null,
    toolCallId: row.tool_call_id,
    trace: row.trace ? JSON.parse(row.trace) : null,
    isError: row.is_error === 1,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: new Date(row.created_at),
  };
}

// =====================================================
// REPOSITORY
// =====================================================

export class ChatRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  // =====================================================
  // CONVERSATIONS
  // =====================================================

  createConversation(input: CreateConversationInput): Conversation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, user_id, title, agent_id, agent_name, provider, model, system_prompt, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
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
      now
    );

    return this.getConversation(id)!;
  }

  getConversation(id: string): Conversation | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations WHERE id = ? AND user_id = ?
    `);
    const row = stmt.get(id, this.userId) as ConversationRow | undefined;
    return row ? rowToConversation(row) : null;
  }

  listConversations(query: ConversationQuery = {}): Conversation[] {
    const conditions: string[] = ['user_id = ?'];
    const params: unknown[] = [this.userId];

    if (query.agentId !== undefined) {
      conditions.push('agent_id = ?');
      params.push(query.agentId);
    }

    if (query.isArchived !== undefined) {
      conditions.push('is_archived = ?');
      params.push(query.isArchived ? 1 : 0);
    }

    if (query.search) {
      conditions.push('(title LIKE ? OR agent_name LIKE ?)');
      params.push(`%${query.search}%`, `%${query.search}%`);
    }

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const sql = `
      SELECT * FROM conversations
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params, limit, offset) as ConversationRow[];
    return rows.map(rowToConversation);
  }

  updateConversation(id: string, updates: Partial<CreateConversationInput & { isArchived?: boolean }>): Conversation | null {
    const sets: string[] = ['updated_at = datetime("now")'];
    const params: unknown[] = [];

    if (updates.title !== undefined) {
      sets.push('title = ?');
      params.push(updates.title);
    }
    if (updates.agentId !== undefined) {
      sets.push('agent_id = ?');
      params.push(updates.agentId);
    }
    if (updates.agentName !== undefined) {
      sets.push('agent_name = ?');
      params.push(updates.agentName);
    }
    if (updates.provider !== undefined) {
      sets.push('provider = ?');
      params.push(updates.provider);
    }
    if (updates.model !== undefined) {
      sets.push('model = ?');
      params.push(updates.model);
    }
    if (updates.isArchived !== undefined) {
      sets.push('is_archived = ?');
      params.push(updates.isArchived ? 1 : 0);
    }

    if (sets.length === 1) return this.getConversation(id);

    params.push(id, this.userId);

    const stmt = this.db.prepare(`
      UPDATE conversations SET ${sets.join(', ')} WHERE id = ? AND user_id = ?
    `);
    stmt.run(...params);

    return this.getConversation(id);
  }

  deleteConversation(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM conversations WHERE id = ? AND user_id = ?
    `);
    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  // Auto-generate title from first user message
  generateTitle(conversationId: string): string | null {
    const messages = this.getMessages(conversationId, { limit: 1 });
    const firstMessage = messages[0];
    if (!firstMessage) return null;

    let title = firstMessage.content.slice(0, 50);
    if (firstMessage.content.length > 50) {
      title += '...';
    }

    this.updateConversation(conversationId, { title });
    return title;
  }

  // =====================================================
  // MESSAGES
  // =====================================================

  addMessage(input: CreateMessageInput): Message {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, provider, model, tool_calls, tool_call_id, trace, is_error, input_tokens, output_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.conversationId,
      input.role,
      input.content,
      input.provider || null,
      input.model || null,
      input.toolCalls ? JSON.stringify(input.toolCalls) : null,
      input.toolCallId || null,
      input.trace ? JSON.stringify(input.trace) : null,
      input.isError ? 1 : 0,
      input.inputTokens || null,
      input.outputTokens || null,
      now
    );

    // Update conversation message count and updated_at
    this.db.prepare(`
      UPDATE conversations
      SET message_count = message_count + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(input.conversationId);

    return this.getMessage(id)!;
  }

  getMessage(id: string): Message | null {
    const stmt = this.db.prepare(`SELECT * FROM messages WHERE id = ?`);
    const row = stmt.get(id) as MessageRow | undefined;
    return row ? rowToMessage(row) : null;
  }

  getMessages(conversationId: string, options: { limit?: number; offset?: number; beforeId?: string } = {}): Message[] {
    const conditions: string[] = ['conversation_id = ?'];
    const params: unknown[] = [conversationId];

    if (options.beforeId) {
      conditions.push('created_at < (SELECT created_at FROM messages WHERE id = ?)');
      params.push(options.beforeId);
    }

    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const sql = `
      SELECT * FROM messages
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params, limit, offset) as MessageRow[];
    return rows.map(rowToMessage);
  }

  deleteMessage(id: string): boolean {
    // Get conversation_id first to update count
    const msg = this.getMessage(id);
    if (!msg) return false;

    const stmt = this.db.prepare(`DELETE FROM messages WHERE id = ?`);
    const result = stmt.run(id);

    if (result.changes > 0) {
      this.db.prepare(`
        UPDATE conversations
        SET message_count = message_count - 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(msg.conversationId);
    }

    return result.changes > 0;
  }

  // =====================================================
  // UTILITIES
  // =====================================================

  getOrCreateConversation(conversationId: string | null, input: CreateConversationInput): Conversation {
    if (conversationId) {
      const existing = this.getConversation(conversationId);
      if (existing) return existing;
    }
    return this.createConversation(input);
  }

  getConversationWithMessages(conversationId: string): { conversation: Conversation; messages: Message[] } | null {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return null;

    const messages = this.getMessages(conversationId);
    return { conversation, messages };
  }

  // Get recent conversations with preview (last message)
  getRecentConversations(limit = 20): Array<Conversation & { lastMessage?: string; lastMessageAt?: Date }> {
    const conversations = this.listConversations({ limit, isArchived: false });

    return conversations.map(conv => {
      const messages = this.getMessages(conv.id, { limit: 1 });
      const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

      return {
        ...conv,
        lastMessage: lastMsg?.content.slice(0, 100),
        lastMessageAt: lastMsg?.createdAt,
      };
    });
  }
}

// Default export for convenience
export const chatRepository = new ChatRepository();
