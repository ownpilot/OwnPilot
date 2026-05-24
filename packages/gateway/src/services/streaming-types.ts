/**
 * Streaming types — shared data shapes used by SSE chat streaming.
 *
 * Kept at services/ root rather than services/chat/ so consumers outside
 * the chat path (conversation-service, persistence) can describe stream
 * state without depending on the chat subtree.
 *
 * `services/chat/streaming.ts` re-exports these for chat-internal callers.
 */

import type { streamSSE } from 'hono/streaming';
import type { getAgent } from './agent/service.js';
import type { McpToolEvent } from '../mcp/mcp-events.js';

/** Configuration for creating SSE stream callbacks. */
export interface StreamingConfig {
  sseStream: Parameters<Parameters<typeof streamSSE>[1]>[0];
  agent: NonNullable<Awaited<ReturnType<typeof getAgent>>>;
  conversationId: string;
  userId: string;
  agentId: string;
  provider: string;
  model: string;
  historyLength: number;
  contextWindowOverride?: number;
}

/** Accumulated state from streaming, available after stream completes. */
export interface StreamState {
  streamedContent: string;
  lastUsage:
    | { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number }
    | undefined;
  traceToolCalls: Array<{
    name: string;
    arguments?: Record<string, unknown>;
    result?: string;
    success: boolean;
    duration?: number;
    startTime?: number;
    reason?: string;
  }>;
  startTime: number;
  /** Raw content before think-tag stripping (for think-tag state detection) */
  rawContent: string;
  /** Length of clean content already sent to the client */
  sentContentLength: number;
  /** Model is currently producing thinking content */
  isThinking: boolean;
  /** Accumulated thinking content from extended thinking (Anthropic) */
  thinkingContent: string;
  mcpToolEvents: Array<{
    type: McpToolEvent['type'];
    toolName: string;
    arguments?: Record<string, unknown>;
    result?: McpToolEvent['result'];
    timestamp: string;
  }>;
}
