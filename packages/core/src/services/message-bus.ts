/**
 * IMessageBus - Unified Message Processing Pipeline
 *
 * All messages (from any source) flow through this single pipeline.
 * The pipeline is built from composable middleware stages.
 *
 * Pipeline stages (as middleware):
 * 1. Session resolution — ensure session exists
 * 2. Memory injection — inject memories/goals into context
 * 3. Agent execution — agent.chat(message, options)
 * 4. Post-processing — extract memories, update goals, evaluate triggers
 * 5. Persistence — save to database
 * 6. Response routing — send response back to source
 * 7. Audit logging — log to request_logs
 *
 * Usage:
 *   const bus = registry.get(Services.Message);
 *
 *   // Add middleware
 *   bus.use(async (msg, ctx, next) => {
 *     ctx.set('startTime', Date.now());
 *     const result = await next();
 *     ctx.set('duration', Date.now() - ctx.get('startTime'));
 *     return result;
 *   });
 *
 *   // Process a message
 *   const result = await bus.process(normalizedMessage);
 */

import type { NormalizedMessage, MessageProcessingResult } from './message-types.js';
import type { StreamChunk, ToolCall } from '../agent/types.js';

// ============================================================================
// Pipeline Context
// ============================================================================

/**
 * Mutable context bag that travels through the pipeline.
 * Middleware can read and write values.
 */
export interface PipelineContext {
  /** Get a value by key */
  get<T = unknown>(key: string): T | undefined;

  /** Set a value by key */
  set(key: string, value: unknown): void;

  /** Check if a key exists */
  has(key: string): boolean;

  /** Add a stage name (for tracking which stages ran) */
  addStage(name: string): void;

  /** Add a warning (non-fatal issue) */
  addWarning(message: string): void;

  /** Whether processing should be aborted */
  aborted: boolean;

  /** Abort reason */
  abortReason?: string;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Message middleware function.
 *
 * Receives the incoming message, a pipeline context, and a `next` function
 * to call the next middleware in the chain.
 *
 * Returns the processing result.
 */
export type MessageMiddleware = (
  message: NormalizedMessage,
  ctx: PipelineContext,
  next: () => Promise<MessageProcessingResult>,
) => Promise<MessageProcessingResult>;

// ============================================================================
// Stream Callbacks
// ============================================================================

/**
 * Result object passed to onToolEnd callbacks.
 */
export interface ToolEndResult {
  /** Tool execution output */
  readonly content: string;
  /** Whether the tool execution failed */
  readonly isError?: boolean;
  /** Execution time in milliseconds */
  readonly durationMs?: number;
}

/**
 * Callbacks for streaming responses.
 * Signatures match agent.chat() so middleware can pass them through directly.
 */
export interface StreamCallbacks {
  /** Called for each streaming chunk (content delta, tool calls, usage, done flag) */
  onChunk?(chunk: StreamChunk): void;

  /** Called before a tool is executed — return { approved: false } to block */
  onBeforeToolCall?(toolCall: ToolCall): Promise<{ approved: boolean; reason?: string }>;

  /** Called when a tool starts executing */
  onToolStart?(toolCall: ToolCall): void;

  /** Called when a tool finishes executing */
  onToolEnd?(toolCall: ToolCall, result: ToolEndResult): void;

  /** Called for progress/status messages */
  onProgress?(message: string, data?: Record<string, unknown>): void;

  /** Called when the pipeline finishes (after all middleware) */
  onDone?(result: MessageProcessingResult): void;

  /** Called on pipeline error */
  onError?(error: Error): void;
}

// ============================================================================
// Process Options
// ============================================================================

export interface ProcessOptions {
  /** Stream callbacks (if streaming is requested) */
  stream?: StreamCallbacks;

  /** Override pipeline context values */
  context?: Record<string, unknown>;
}

// ============================================================================
// IMessageBus
// ============================================================================

export interface IMessageBus {
  /**
   * Process a message through the full pipeline.
   * Returns the assistant's response message with metadata.
   */
  process(message: NormalizedMessage, options?: ProcessOptions): Promise<MessageProcessingResult>;

  /**
   * Add a middleware to the pipeline.
   * Middleware runs in the order it was added.
   */
  use(middleware: MessageMiddleware): void;

  /**
   * Add a named middleware at a specific position.
   * Useful for inserting middleware before/after specific stages.
   */
  useNamed(name: string, middleware: MessageMiddleware): void;

  /**
   * Get the list of registered middleware names.
   */
  getMiddlewareNames(): string[];
}
