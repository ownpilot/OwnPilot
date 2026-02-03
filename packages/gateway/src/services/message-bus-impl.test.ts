/**
 * MessageBus Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MessageBus } from './message-bus-impl.js';
import type {
  NormalizedMessage,
  MessageProcessingResult,
} from '@ownpilot/core';

function createTestMessage(overrides?: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    id: randomUUID(),
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello!',
    metadata: { source: 'web' as const },
    timestamp: new Date(),
    ...overrides,
  };
}

function createTestResult(message: NormalizedMessage, content = 'Response'): MessageProcessingResult {
  return {
    response: {
      id: randomUUID(),
      sessionId: message.sessionId,
      role: 'assistant',
      content,
      metadata: { source: message.metadata.source },
      timestamp: new Date(),
    },
    streamed: false,
    durationMs: 10,
    stages: [],
  };
}

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  describe('process', () => {
    it('returns empty result when no middleware', async () => {
      const msg = createTestMessage();
      const result = await bus.process(msg);

      expect(result.response.role).toBe('assistant');
      expect(result.response.content).toBe('');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('runs middleware in order', async () => {
      const order: number[] = [];

      bus.use(async (msg, ctx, next) => {
        order.push(1);
        const result = await next();
        order.push(4);
        return result;
      });

      bus.use(async (msg, ctx, next) => {
        order.push(2);
        const result = await next();
        order.push(3);
        return result;
      });

      await bus.process(createTestMessage());
      expect(order).toEqual([1, 2, 3, 4]);
    });

    it('middleware can produce a response', async () => {
      bus.use(async (msg, _ctx, _next) => {
        return createTestResult(msg, 'Hello from middleware!');
      });

      const result = await bus.process(createTestMessage());
      expect(result.response.content).toBe('Hello from middleware!');
    });

    it('middleware can modify context', async () => {
      const values: unknown[] = [];

      bus.use(async (msg, ctx, next) => {
        ctx.set('key', 'value');
        return next();
      });

      bus.use(async (msg, ctx, next) => {
        values.push(ctx.get('key'));
        return next();
      });

      await bus.process(createTestMessage());
      expect(values).toEqual(['value']);
    });

    it('tracks stages', async () => {
      bus.useNamed('auth', async (msg, ctx, next) => next());
      bus.useNamed('process', async (msg, ctx, next) => next());

      const result = await bus.process(createTestMessage());
      expect(result.stages).toEqual(['auth', 'process']);
    });

    it('handles middleware errors', async () => {
      bus.useNamed('broken', async () => {
        throw new Error('Middleware failed');
      });

      const result = await bus.process(createTestMessage());
      expect(result.response.content).toContain('Middleware failed');
      expect(result.warnings).toBeDefined();
      expect(result.warnings![0]).toContain("Pipeline error in 'broken'");
    });

    it('supports abort', async () => {
      bus.use(async (msg, ctx, next) => {
        ctx.aborted = true;
        ctx.abortReason = 'Rate limited';
        return next();
      });

      bus.use(async (_msg, _ctx, _next) => {
        // This should not run
        throw new Error('Should not reach here');
      });

      const result = await bus.process(createTestMessage());
      expect(result.response.content).toBe('Rate limited');
    });

    it('passes initial context from options', async () => {
      const captured: unknown[] = [];

      bus.use(async (msg, ctx, next) => {
        captured.push(ctx.get('userId'));
        return next();
      });

      await bus.process(createTestMessage(), {
        context: { userId: 'user-123' },
      });

      expect(captured).toEqual(['user-123']);
    });

    it('stores stream callbacks in context', async () => {
      const onChunk = vi.fn();
      let streamFromCtx: unknown;

      bus.use(async (msg, ctx, next) => {
        streamFromCtx = ctx.get('stream');
        return next();
      });

      await bus.process(createTestMessage(), {
        stream: { onChunk },
      });

      expect(streamFromCtx).toBeDefined();
      expect((streamFromCtx as { onChunk: unknown }).onChunk).toBe(onChunk);
    });

    it('calls stream.onError on middleware error', async () => {
      const onError = vi.fn();

      bus.use(async () => {
        throw new Error('Stream fail');
      });

      await bus.process(createTestMessage(), {
        stream: { onError },
      });

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Stream fail',
      }));
    });
  });

  describe('getMiddlewareNames', () => {
    it('returns names of registered middleware', () => {
      bus.useNamed('auth', async (msg, ctx, next) => next());
      bus.useNamed('agent', async (msg, ctx, next) => next());
      bus.use(async (msg, ctx, next) => next());

      expect(bus.getMiddlewareNames()).toEqual(['auth', 'agent', 'middleware-2']);
    });
  });

  describe('warnings', () => {
    it('collects warnings from context', async () => {
      bus.use(async (msg, ctx, next) => {
        ctx.addWarning('Memory service unavailable');
        return next();
      });

      const result = await bus.process(createTestMessage());
      expect(result.warnings).toEqual(['Memory service unavailable']);
    });
  });
});
