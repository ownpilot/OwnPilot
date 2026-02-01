/**
 * MessageBus Implementation
 *
 * Middleware-based message processing pipeline.
 * All messages (web, channel, API, trigger) flow through the same pipeline.
 *
 * The pipeline is composable: each middleware can process the message,
 * modify the context, and optionally delegate to the next middleware.
 *
 * Usage:
 *   const bus = createMessageBus();
 *
 *   bus.use(async (msg, ctx, next) => {
 *     // pre-processing
 *     const result = await next();
 *     // post-processing
 *     return result;
 *   });
 *
 *   const result = await bus.process(message);
 */

import { randomUUID } from 'node:crypto';
import type {
  IMessageBus,
  MessageMiddleware,
  ProcessOptions,
  PipelineContext,
  StreamCallbacks,
} from '@ownpilot/core';
import type {
  NormalizedMessage,
  MessageProcessingResult,
} from '@ownpilot/core';

// ============================================================================
// Pipeline Context Implementation
// ============================================================================

class PipelineContextImpl implements PipelineContext {
  private readonly values = new Map<string, unknown>();
  private readonly stages: string[] = [];
  private readonly warnings: string[] = [];

  aborted = false;
  abortReason?: string;

  constructor(initial?: Record<string, unknown>) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        this.values.set(k, v);
      }
    }
  }

  get<T = unknown>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  addStage(name: string): void {
    this.stages.push(name);
  }

  addWarning(message: string): void {
    this.warnings.push(message);
  }

  getStages(): string[] {
    return [...this.stages];
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }
}

// ============================================================================
// MessageBus Implementation
// ============================================================================

interface NamedMiddleware {
  name: string;
  fn: MessageMiddleware;
}

export class MessageBus implements IMessageBus {
  private readonly middlewares: NamedMiddleware[] = [];

  use(middleware: MessageMiddleware): void {
    this.middlewares.push({
      name: `middleware-${this.middlewares.length}`,
      fn: middleware,
    });
  }

  useNamed(name: string, middleware: MessageMiddleware): void {
    this.middlewares.push({ name, fn: middleware });
  }

  getMiddlewareNames(): string[] {
    return this.middlewares.map(m => m.name);
  }

  async process(
    message: NormalizedMessage,
    options?: ProcessOptions,
  ): Promise<MessageProcessingResult> {
    const startTime = Date.now();
    const ctx = new PipelineContextImpl(options?.context);

    // Store stream callbacks in context if provided
    if (options?.stream) {
      ctx.set('stream', options.stream);
    }

    // Build middleware chain (inside-out composition)
    let index = 0;

    const next = async (): Promise<MessageProcessingResult> => {
      if (ctx.aborted) {
        return this.createAbortedResult(message, ctx, startTime);
      }

      if (index >= this.middlewares.length) {
        // End of chain — return default empty result
        // (the agent execution middleware should produce the real result)
        return this.createEmptyResult(message, ctx, startTime);
      }

      const current = this.middlewares[index++]!;
      const stageName = current.name;
      ctx.addStage(stageName);

      try {
        return await current.fn(message, ctx, next);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // Notify stream callbacks of error
        const stream = ctx.get<StreamCallbacks>('stream');
        stream?.onError?.(err);

        return {
          response: {
            id: randomUUID(),
            sessionId: message.sessionId,
            role: 'assistant',
            content: `Error in pipeline stage '${stageName}': ${err.message}`,
            metadata: {
              ...message.metadata,
              error: err.message,
              errorStage: stageName,
            },
            timestamp: new Date(),
          },
          streamed: false,
          durationMs: Date.now() - startTime,
          stages: ctx.getStages(),
          warnings: [
            ...ctx.getWarnings(),
            `Pipeline error in '${stageName}': ${err.message}`,
          ],
        };
      }
    };

    return next();
  }

  private createEmptyResult(
    message: NormalizedMessage,
    ctx: PipelineContextImpl,
    startTime: number,
  ): MessageProcessingResult {
    return {
      response: {
        id: randomUUID(),
        sessionId: message.sessionId,
        role: 'assistant',
        content: '',
        metadata: { source: message.metadata.source },
        timestamp: new Date(),
      },
      streamed: false,
      durationMs: Date.now() - startTime,
      stages: ctx.getStages(),
      warnings: ctx.getWarnings().length > 0 ? ctx.getWarnings() : undefined,
    };
  }

  private createAbortedResult(
    message: NormalizedMessage,
    ctx: PipelineContextImpl,
    startTime: number,
  ): MessageProcessingResult {
    return {
      response: {
        id: randomUUID(),
        sessionId: message.sessionId,
        role: 'assistant',
        content: ctx.abortReason ?? 'Processing aborted',
        metadata: {
          source: message.metadata.source,
          aborted: true,
        },
        timestamp: new Date(),
      },
      streamed: false,
      durationMs: Date.now() - startTime,
      stages: ctx.getStages(),
      warnings: ctx.getWarnings().length > 0 ? ctx.getWarnings() : undefined,
    };
  }
}

/**
 * Create a new MessageBus instance.
 */
export function createMessageBus(): MessageBus {
  return new MessageBus();
}
