/**
 * Personal Assistant Core
 *
 * Central orchestration for the AI Gateway:
 * - Conversation routing and management
 * - Plugin coordination
 * - Code generation with sandbox execution
 * - Multi-modal handling (text, images, files)
 * - Context management
 */

import type { Message } from '../agent/types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Assistant configuration
 */
export interface AssistantConfig {
  /** Assistant name */
  name: string;
  /** System prompt */
  systemPrompt: string;
  /** Default language */
  language: 'en' | 'auto';
  /** Personality traits */
  personality?: {
    formal?: boolean;
    humor?: boolean;
    verbose?: boolean;
  };
  /** Enabled capabilities */
  capabilities: AssistantCapability[];
  /** Maximum context tokens */
  maxContextTokens?: number;
  /** Tool execution timeout (ms) */
  toolTimeout?: number;
}

/**
 * Assistant capabilities
 */
export type AssistantCapability =
  | 'chat' // General conversation
  | 'code' // Code generation and execution
  | 'tools' // Tool usage
  | 'memory' // Long-term memory
  | 'plugins' // Plugin system
  | 'scheduler' // Scheduled tasks
  | 'multimodal' // Images, audio, files
  | 'web'; // Web browsing

/**
 * User context for personalization
 */
export interface UserContext {
  userId: string;
  preferences: {
    language: string;
    timezone: string;
    currency: string;
  };
  permissions: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Conversation context
 */
export interface ConversationContext {
  conversationId: string;
  channel: string;
  messages: Message[];
  metadata?: Record<string, unknown>;
}

/**
 * Assistant request
 */
export interface AssistantRequest {
  /** User message */
  message: string;
  /** Attached files/images */
  attachments?: Array<{
    type: 'image' | 'file' | 'audio';
    data: string;
    mimeType: string;
    name?: string;
  }>;
  /** User context */
  user: UserContext;
  /** Conversation context */
  conversation: ConversationContext;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Assistant response
 */
export interface AssistantResponse {
  /** Response message */
  message: string;
  /** Tool calls made */
  toolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: unknown;
  }>;
  /** Generated code (if any) */
  code?: {
    language: string;
    code: string;
    executionResult?: unknown;
  };
  /** Attachments to send */
  attachments?: Array<{
    type: 'image' | 'file';
    data: string;
    mimeType: string;
    name: string;
  }>;
  /** Suggestions for follow-up */
  suggestions?: string[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Intent classification result
 */
export interface IntentResult {
  /** Primary intent */
  intent: Intent;
  /** Confidence (0-1) */
  confidence: number;
  /** Extracted entities */
  entities: Record<string, unknown>;
  /** Suggested tools */
  suggestedTools?: string[];
  /** Should delegate to plugin */
  pluginId?: string;
}

/**
 * Possible intents
 */
export type Intent =
  | 'general_chat' // General conversation
  | 'question' // Asking a question
  | 'task' // Requesting a task
  | 'code_request' // Code generation/help
  | 'tool_use' // Explicit tool request
  | 'schedule' // Scheduling related
  | 'memory' // Remember/recall
  | 'settings' // Change settings
  | 'help' // Help request
  | 'unknown';

// =============================================================================
// Memory Oversight
// =============================================================================

export * from './memory-oversight.js';
