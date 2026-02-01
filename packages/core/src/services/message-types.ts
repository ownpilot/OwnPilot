/**
 * Normalized Message Types
 *
 * Single message format used everywhere in the system, regardless
 * of source (web UI, channel, API, trigger engine).
 *
 * All input normalizers convert platform-specific formats to this shape.
 * All output routers read this shape to send responses back.
 */

import type { SessionSource } from './session-service.js';

// ============================================================================
// Core Types
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface NormalizedAttachment {
  readonly type: 'image' | 'file' | 'audio' | 'video';
  readonly url?: string;
  readonly mimeType?: string;
  readonly filename?: string;
  readonly size?: number;
}

export interface NormalizedToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: string;
  readonly durationMs?: number;
}

// ============================================================================
// NormalizedMessage
// ============================================================================

export interface NormalizedMessage {
  /** Unique message ID */
  readonly id: string;

  /** Session this message belongs to */
  readonly sessionId: string;

  /** Message role */
  readonly role: MessageRole;

  /** Text content */
  readonly content: string;

  /** Optional file/media attachments */
  readonly attachments?: NormalizedAttachment[];

  /** If this is a reply, the ID of the original message */
  readonly replyToId?: string;

  /** Extensible metadata */
  readonly metadata: MessageMetadata;

  /** When the message was created */
  readonly timestamp: Date;
}

export interface MessageMetadata {
  /** Source of the message (web, channel, api, etc.) */
  readonly source: SessionSource;

  /** Channel plugin ID (for channel messages) */
  readonly channelPluginId?: string;

  /** Platform name (telegram, discord, etc.) */
  readonly platform?: string;

  /** Platform-specific message ID */
  readonly platformMessageId?: string;

  /** Platform-specific chat/conversation ID */
  readonly platformChatId?: string;

  /** AI provider used (for assistant messages) */
  readonly provider?: string;

  /** AI model used (for assistant messages) */
  readonly model?: string;

  /** Tool calls made (for assistant messages) */
  readonly toolCalls?: NormalizedToolCall[];

  /** Token usage (for assistant messages) */
  readonly tokens?: { input: number; output: number };

  /** Whether streaming is requested */
  readonly stream?: boolean;

  /** Conversation ID this message belongs to */
  readonly conversationId?: string;

  /** Agent ID processing the message */
  readonly agentId?: string;

  /** Arbitrary additional data */
  readonly [key: string]: unknown;
}

// ============================================================================
// Processing Result
// ============================================================================

/**
 * Result of processing a message through the pipeline.
 * Contains the response message plus any pipeline metadata.
 */
export interface MessageProcessingResult {
  /** The response message (assistant's reply) */
  readonly response: NormalizedMessage;

  /** Whether the response was streamed */
  readonly streamed: boolean;

  /** Processing duration in ms */
  readonly durationMs: number;

  /** Pipeline stages that ran */
  readonly stages: string[];

  /** Any non-fatal warnings from pipeline stages */
  readonly warnings?: string[];
}
