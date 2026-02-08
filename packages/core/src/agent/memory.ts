/**
 * Conversation memory management
 */

import { randomUUID } from 'node:crypto';
import type {
  Conversation,
  Message,
  MemoryConfig,
  ContentPart,
  ToolCall,
  ToolResult,
} from './types.js';
import { getLog } from '../services/get-log.js';

const log = getLog('Memory');

/**
 * Default memory configuration
 */
const DEFAULT_MEMORY_CONFIG: Required<MemoryConfig> = {
  maxMessages: 100,
  maxTokens: 100000,
  summarize: false,
  persistence: 'session',
};

/**
 * Conversation memory manager
 */
export class ConversationMemory {
  private readonly conversations = new Map<string, Conversation>();
  private readonly config: Required<MemoryConfig>;

  constructor(config: MemoryConfig = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
  }

  /**
   * Create a new conversation
   */
  create(systemPrompt?: string, metadata?: Record<string, unknown>): Conversation {
    const now = new Date();
    const conversation: Conversation = {
      id: randomUUID(),
      systemPrompt,
      messages: [],
      createdAt: now,
      updatedAt: now,
      metadata,
    };

    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  /**
   * Get a conversation by ID
   */
  get(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  /**
   * Check if a conversation exists
   */
  has(id: string): boolean {
    return this.conversations.has(id);
  }

  /**
   * Add a message to a conversation
   */
  addMessage(conversationId: string, message: Message): Conversation | undefined {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return undefined;

    let newMessages = [...conversation.messages, message];

    // Apply message limit
    if (newMessages.length > this.config.maxMessages) {
      const excess = newMessages.length - this.config.maxMessages;
      newMessages = newMessages.slice(excess);
    }

    const updated: Conversation = {
      ...conversation,
      messages: newMessages,
      updatedAt: new Date(),
    };

    this.conversations.set(conversationId, updated);
    return updated;
  }

  /**
   * Add a user message
   */
  addUserMessage(
    conversationId: string,
    content: string | readonly ContentPart[],
    metadata?: Record<string, unknown>
  ): Conversation | undefined {
    return this.addMessage(conversationId, {
      role: 'user',
      content,
      metadata,
    });
  }

  /**
   * Add an assistant message
   */
  addAssistantMessage(
    conversationId: string,
    content: string,
    toolCalls?: readonly ToolCall[],
    metadata?: Record<string, unknown>
  ): Conversation | undefined {
    return this.addMessage(conversationId, {
      role: 'assistant',
      content,
      toolCalls,
      metadata,
    });
  }

  /**
   * Add tool results message
   */
  addToolResults(
    conversationId: string,
    results: readonly ToolResult[]
  ): Conversation | undefined {
    return this.addMessage(conversationId, {
      role: 'tool',
      content: '',
      toolResults: results,
    });
  }

  /**
   * Get messages for context (applies token limit)
   */
  getContextMessages(conversationId: string): readonly Message[] {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return [];

    const messages = [...conversation.messages];

    // If we have a token limit, trim from the beginning
    if (this.config.maxTokens > 0) {
      let tokenCount = 0;
      let startIndex = messages.length;

      // Count tokens from the end (most recent first)
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg) continue;

        const msgTokens = this.estimateTokens(msg);
        if (tokenCount + msgTokens > this.config.maxTokens) {
          startIndex = i + 1;
          break;
        }
        tokenCount += msgTokens;
        startIndex = i;
      }

      return messages.slice(startIndex);
    }

    return messages;
  }

  /**
   * Get messages with system prompt
   */
  getFullContext(conversationId: string): readonly Message[] {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return [];

    const contextMessages = this.getContextMessages(conversationId);

    if (conversation.systemPrompt) {
      return [
        { role: 'system', content: conversation.systemPrompt },
        ...contextMessages,
      ];
    }

    return contextMessages;
  }

  /**
   * Estimate token count for a message (rough approximation)
   */
  private estimateTokens(message: Message): number {
    let chars = 0;

    if (typeof message.content === 'string') {
      chars += message.content.length;
    } else {
      for (const part of message.content) {
        if (part.type === 'text') {
          chars += part.text.length;
        } else if (part.type === 'image') {
          // Images are roughly 85 tokens for low res, 170+ for high res
          chars += 500;
        }
      }
    }

    // Add overhead for tool calls
    if (message.toolCalls) {
      for (const tc of message.toolCalls) {
        chars += tc.name.length + tc.arguments.length + 50;
      }
    }

    // Add overhead for tool results
    if (message.toolResults) {
      for (const tr of message.toolResults) {
        chars += tr.content.length + 50;
      }
    }

    // ~4 characters per token
    return Math.ceil(chars / 4);
  }

  /**
   * Clear a conversation's messages
   */
  clearMessages(conversationId: string): boolean {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return false;

    this.conversations.set(conversationId, {
      ...conversation,
      messages: [],
      updatedAt: new Date(),
    });

    return true;
  }

  /**
   * Delete a conversation
   */
  delete(conversationId: string): boolean {
    return this.conversations.delete(conversationId);
  }

  /**
   * Update conversation metadata
   */
  updateMetadata(
    conversationId: string,
    metadata: Record<string, unknown>
  ): Conversation | undefined {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return undefined;

    const updated: Conversation = {
      ...conversation,
      metadata: { ...conversation.metadata, ...metadata },
      updatedAt: new Date(),
    };

    this.conversations.set(conversationId, updated);
    return updated;
  }

  /**
   * Update system prompt
   */
  updateSystemPrompt(conversationId: string, systemPrompt: string): Conversation | undefined {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return undefined;

    const updated: Conversation = {
      ...conversation,
      systemPrompt,
      updatedAt: new Date(),
    };

    this.conversations.set(conversationId, updated);
    return updated;
  }

  /**
   * Get all conversation IDs
   */
  getAllIds(): readonly string[] {
    return Array.from(this.conversations.keys());
  }

  /**
   * Get conversation count
   */
  getCount(): number {
    return this.conversations.size;
  }

  /**
   * Get conversation statistics
   */
  getStats(conversationId: string): {
    messageCount: number;
    estimatedTokens: number;
    lastActivity: Date;
  } | undefined {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return undefined;

    let totalTokens = 0;
    for (const msg of conversation.messages) {
      totalTokens += this.estimateTokens(msg);
    }

    return {
      messageCount: conversation.messages.length,
      estimatedTokens: totalTokens,
      lastActivity: conversation.updatedAt,
    };
  }

  /**
   * Export conversation to JSON
   */
  export(conversationId: string): string | undefined {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return undefined;

    return JSON.stringify(conversation, null, 2);
  }

  /**
   * Import conversation from JSON
   */
  import(json: string): Conversation | undefined {
    try {
      const data = JSON.parse(json);

      // Validate required fields
      if (!data.id || !Array.isArray(data.messages)) {
        return undefined;
      }

      const conversation: Conversation = {
        id: data.id,
        systemPrompt: data.systemPrompt,
        messages: data.messages,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        metadata: data.metadata,
      };

      this.conversations.set(conversation.id, conversation);
      return conversation;
    } catch (error) {
      log.warn('Failed to import conversation:', error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  /**
   * Fork a conversation (create a copy)
   */
  fork(conversationId: string): Conversation | undefined {
    const original = this.conversations.get(conversationId);
    if (!original) return undefined;

    const forked: Conversation = {
      ...original,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        ...original.metadata,
        forkedFrom: conversationId,
      },
    };

    this.conversations.set(forked.id, forked);
    return forked;
  }

  /**
   * Clear all conversations
   */
  clear(): void {
    this.conversations.clear();
  }
}

/**
 * Create a conversation memory instance
 */
export function createMemory(config?: MemoryConfig): ConversationMemory {
  return new ConversationMemory(config);
}
