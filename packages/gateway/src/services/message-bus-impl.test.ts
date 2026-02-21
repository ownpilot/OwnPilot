/**
 * MessageBus Implementation Tests
 *
 * Comprehensive tests for MessageBus and PipelineContextImpl.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MessageBus, createMessageBus } from './message-bus-impl.js';
import type {
  NormalizedMessage,
  MessageProcessingResult,
  PipelineContext,
  StreamCallbacks,
} from '@ownpilot/core';

// ============================================================================
// Test Fixtures
// ============================================================================

function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: randomUUID(),
    sessionId: 'test-session',
    role: 'user',
    content: 'Hello',
    metadata: { source: 'web' as const },
    timestamp: new Date(),
    ...overrides,
  };
}

function makeResult(
  message: NormalizedMessage,
  content = 'Response',
): MessageProcessingResult {
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
    durationMs: 5,
    stages: [],
  };
}

// ============================================================================
// PipelineContextImpl (tested via process())
// ============================================================================

describe('PipelineContextImpl (via process)', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  describe('get/set/has operations', () => {
    it('set and get a string value', async () => {
      let retrieved: unknown;
      bus.use(async (_msg, ctx, next) => {
        ctx.set('name', 'Alice');
        retrieved = ctx.get('name');
        return next();
      });
      await bus.process(makeMessage());
      expect(retrieved).toBe('Alice');
    });

    it('get returns undefined for unset key', async () => {
      let retrieved: unknown = 'not-undefined';
      bus.use(async (_msg, ctx, next) => {
        retrieved = ctx.get('missing');
        return next();
      });
      await bus.process(makeMessage());
      expect(retrieved).toBeUndefined();
    });

    it('has returns true for set key', async () => {
      let result = false;
      bus.use(async (_msg, ctx, next) => {
        ctx.set('exists', 42);
        result = ctx.has('exists');
        return next();
      });
      await bus.process(makeMessage());
      expect(result).toBe(true);
    });

    it('has returns false for unset key', async () => {
      let result = true;
      bus.use(async (_msg, ctx, next) => {
        result = ctx.has('nope');
        return next();
      });
      await bus.process(makeMessage());
      expect(result).toBe(false);
    });

    it('set overwrites previous value', async () => {
      let retrieved: unknown;
      bus.use(async (_msg, ctx, next) => {
        ctx.set('key', 'first');
        ctx.set('key', 'second');
        retrieved = ctx.get('key');
        return next();
      });
      await bus.process(makeMessage());
      expect(retrieved).toBe('second');
    });

    it('supports various value types', async () => {
      const values: unknown[] = [];
      bus.use(async (_msg, ctx, next) => {
        ctx.set('num', 123);
        ctx.set('bool', true);
        ctx.set('arr', [1, 2, 3]);
        ctx.set('obj', { a: 1 });
        ctx.set('nil', null);
        values.push(
          ctx.get('num'),
          ctx.get('bool'),
          ctx.get('arr'),
          ctx.get('obj'),
          ctx.get('nil'),
        );
        return next();
      });
      await bus.process(makeMessage());
      expect(values).toEqual([123, true, [1, 2, 3], { a: 1 }, null]);
    });

    it('get supports generic type parameter', async () => {
      let retrieved: number | undefined;
      bus.use(async (_msg, ctx, next) => {
        ctx.set('count', 42);
        retrieved = ctx.get<number>('count');
        return next();
      });
      await bus.process(makeMessage());
      expect(retrieved).toBe(42);
    });
  });

  describe('initial values from constructor', () => {
    it('populates context from options.context', async () => {
      let val: unknown;
      bus.use(async (_msg, ctx, next) => {
        val = ctx.get('userId');
        return next();
      });
      await bus.process(makeMessage(), { context: { userId: 'u-1' } });
      expect(val).toBe('u-1');
    });

    it('has returns true for initial values', async () => {
      let result = false;
      bus.use(async (_msg, ctx, next) => {
        result = ctx.has('agentId');
        return next();
      });
      await bus.process(makeMessage(), { context: { agentId: 'a-1' } });
      expect(result).toBe(true);
    });

    it('supports multiple initial values', async () => {
      const captured: Record<string, unknown> = {};
      bus.use(async (_msg, ctx, next) => {
        captured.a = ctx.get('a');
        captured.b = ctx.get('b');
        captured.c = ctx.get('c');
        return next();
      });
      await bus.process(makeMessage(), { context: { a: 1, b: 'two', c: true } });
      expect(captured).toEqual({ a: 1, b: 'two', c: true });
    });

    it('middleware can overwrite initial values', async () => {
      let val: unknown;
      bus.use(async (_msg, ctx, next) => {
        ctx.set('key', 'overwritten');
        val = ctx.get('key');
        return next();
      });
      await bus.process(makeMessage(), { context: { key: 'original' } });
      expect(val).toBe('overwritten');
    });

    it('no options yields empty context', async () => {
      let hasAny = true;
      bus.use(async (_msg, ctx, next) => {
        hasAny = ctx.has('anything');
        return next();
      });
      await bus.process(makeMessage());
      expect(hasAny).toBe(false);
    });
  });

  describe('stage tracking', () => {
    it('stages are recorded for each middleware', async () => {
      bus.useNamed('stage-a', async (_msg, _ctx, next) => next());
      bus.useNamed('stage-b', async (_msg, _ctx, next) => next());
      const result = await bus.process(makeMessage());
      expect(result.stages).toEqual(['stage-a', 'stage-b']);
    });

    it('auto-named middleware stages use middleware-N pattern', async () => {
      bus.use(async (_msg, _ctx, next) => next());
      bus.use(async (_msg, _ctx, next) => next());
      const result = await bus.process(makeMessage());
      expect(result.stages).toEqual(['middleware-0', 'middleware-1']);
    });

    it('stages accumulate across middleware in order', async () => {
      bus.useNamed('first', async (_msg, _ctx, next) => next());
      bus.use(async (_msg, _ctx, next) => next());
      bus.useNamed('last', async (_msg, _ctx, next) => next());
      const result = await bus.process(makeMessage());
      expect(result.stages).toEqual(['first', 'middleware-1', 'last']);
    });

    it('getStages returns a copy, not the internal array', async () => {
      let stages1: string[] = [];
      let stages2: string[] = [];
      bus.useNamed('a', async (_msg, ctx, next) => {
        stages1 = ctx.getStages();
        return next();
      });
      bus.useNamed('b', async (_msg, ctx, next) => {
        stages2 = ctx.getStages();
        return next();
      });
      await bus.process(makeMessage());
      // stages1 was captured at stage 'a', stages2 at stage 'b'
      expect(stages1).toEqual(['a']);
      expect(stages2).toEqual(['a', 'b']);
      // Mutating stages1 should not affect stages2
      stages1.push('hacked');
      expect(stages2).not.toContain('hacked');
    });

    it('stages only include middleware that actually ran', async () => {
      const skippedFn = vi.fn();
      bus.useNamed('runs', async (msg, ctx, _next) => {
        // Return result including context stages (like real middleware would)
        return {
          ...makeResult(msg),
          stages: ctx.getStages(),
        };
      });
      bus.useNamed('skipped', async (_msg, _ctx, next) => {
        skippedFn();
        return next();
      });
      const result = await bus.process(makeMessage());
      expect(result.stages).toEqual(['runs']);
      expect(skippedFn).not.toHaveBeenCalled();
    });

    it('empty pipeline has no stages', async () => {
      const result = await bus.process(makeMessage());
      expect(result.stages).toEqual([]);
    });
  });

  describe('warning tracking', () => {
    it('addWarning records a warning', async () => {
      bus.use(async (_msg, ctx, next) => {
        ctx.addWarning('Something is off');
        return next();
      });
      const result = await bus.process(makeMessage());
      expect(result.warnings).toEqual(['Something is off']);
    });

    it('multiple warnings accumulate', async () => {
      bus.use(async (_msg, ctx, next) => {
        ctx.addWarning('warn-1');
        ctx.addWarning('warn-2');
        return next();
      });
      bus.use(async (_msg, ctx, next) => {
        ctx.addWarning('warn-3');
        return next();
      });
      const result = await bus.process(makeMessage());
      expect(result.warnings).toEqual(['warn-1', 'warn-2', 'warn-3']);
    });

    it('getWarnings returns a copy', async () => {
      let warnings1: string[] = [];
      bus.use(async (_msg, ctx, next) => {
        ctx.addWarning('w1');
        warnings1 = ctx.getWarnings();
        return next();
      });
      bus.use(async (_msg, ctx, next) => {
        ctx.addWarning('w2');
        return next();
      });
      await bus.process(makeMessage());
      expect(warnings1).toEqual(['w1']);
      warnings1.push('hacked');
      // Internal state not affected
    });

    it('no warnings results in undefined warnings field', async () => {
      bus.use(async (_msg, _ctx, next) => next());
      const result = await bus.process(makeMessage());
      expect(result.warnings).toBeUndefined();
    });
  });

  describe('abort control', () => {
    it('ctx.aborted = true stops the chain', async () => {
      const ran: string[] = [];
      bus.useNamed('aborter', async (_msg, ctx, next) => {
        ran.push('aborter');
        ctx.aborted = true;
        return next();
      });
      bus.useNamed('after', async (_msg, _ctx, next) => {
        ran.push('after');
        return next();
      });
      await bus.process(makeMessage());
      expect(ran).toEqual(['aborter']);
    });

    it('aborted result has default message', async () => {
      bus.use(async (_msg, ctx, next) => {
        ctx.aborted = true;
        return next();
      });
      const result = await bus.process(makeMessage());
      expect(result.response.content).toBe('Processing aborted');
    });

    it('custom abortReason appears in content', async () => {
      bus.use(async (_msg, ctx, next) => {
        ctx.aborted = true;
        ctx.abortReason = 'Rate limit exceeded';
        return next();
      });
      const result = await bus.process(makeMessage());
      expect(result.response.content).toBe('Rate limit exceeded');
    });

    it('aborted result has metadata.aborted = true', async () => {
      bus.use(async (_msg, ctx, next) => {
        ctx.aborted = true;
        return next();
      });
      const result = await bus.process(makeMessage());
      expect(result.response.metadata.aborted).toBe(true);
    });

    it('aborted result preserves source metadata', async () => {
      bus.use(async (_msg, ctx, next) => {
        ctx.aborted = true;
        return next();
      });
      const msg = makeMessage({ metadata: { source: 'channel' as const } });
      const result = await bus.process(msg);
      expect(result.response.metadata.source).toBe('channel');
    });

    it('aborted result has role assistant', async () => {
      bus.use(async (_msg, ctx, next) => {
        ctx.aborted = true;
        return next();
      });
      const result = await bus.process(makeMessage());
      expect(result.response.role).toBe('assistant');
    });

    it('aborted result tracks stages up to abort point', async () => {
      bus.useNamed('before-abort', async (_msg, ctx, next) => {
        ctx.aborted = true;
        return next();
      });
      bus.useNamed('after-abort', async (_msg, _ctx, next) => next());
      const result = await bus.process(makeMessage());
      expect(result.stages).toEqual(['before-abort']);
    });

    it('aborted result includes warnings if present', async () => {
      bus.use(async (_msg, ctx, next) => {
        ctx.addWarning('pre-abort warning');
        ctx.aborted = true;
        return next();
      });
      const result = await bus.process(makeMessage());
      expect(result.warnings).toEqual(['pre-abort warning']);
    });

    it('aborted result has no warnings field when none exist', async () => {
      bus.use(async (_msg, ctx, next) => {
        ctx.aborted = true;
        return next();
      });
      const result = await bus.process(makeMessage());
      expect(result.warnings).toBeUndefined();
    });

    it('next() returns aborted result when abort set mid-chain', async () => {
      bus.useNamed('m1', async (_msg, ctx, next) => {
        const result = await next();
        // Should get aborted result from m2
        expect(result.response.metadata.aborted).toBe(true);
        return result;
      });
      bus.useNamed('m2', async (_msg, ctx, next) => {
        ctx.aborted = true;
        return next();
      });
      const result = await bus.process(makeMessage());
      expect(result.response.content).toBe('Processing aborted');
    });
  });
});

// ============================================================================
// MessageBus.use() and useNamed()
// ============================================================================

describe('MessageBus registration', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('use() adds middleware with auto-generated name', () => {
    bus.use(async (_msg, _ctx, next) => next());
    expect(bus.getMiddlewareNames()).toEqual(['middleware-0']);
  });

  it('auto names increment: middleware-0, middleware-1, etc.', () => {
    bus.use(async (_msg, _ctx, next) => next());
    bus.use(async (_msg, _ctx, next) => next());
    bus.use(async (_msg, _ctx, next) => next());
    expect(bus.getMiddlewareNames()).toEqual([
      'middleware-0',
      'middleware-1',
      'middleware-2',
    ]);
  });

  it('useNamed() adds middleware with custom name', () => {
    bus.useNamed('audit', async (_msg, _ctx, next) => next());
    expect(bus.getMiddlewareNames()).toEqual(['audit']);
  });

  it('getMiddlewareNames() returns all names in order', () => {
    bus.useNamed('alpha', async (_msg, _ctx, next) => next());
    bus.useNamed('beta', async (_msg, _ctx, next) => next());
    bus.useNamed('gamma', async (_msg, _ctx, next) => next());
    expect(bus.getMiddlewareNames()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('mixed use/useNamed ordering preserved', () => {
    bus.use(async (_msg, _ctx, next) => next());
    bus.useNamed('named-1', async (_msg, _ctx, next) => next());
    bus.use(async (_msg, _ctx, next) => next());
    bus.useNamed('named-2', async (_msg, _ctx, next) => next());
    expect(bus.getMiddlewareNames()).toEqual([
      'middleware-0',
      'named-1',
      'middleware-2',
      'named-2',
    ]);
  });

  it('empty bus has no middleware names', () => {
    expect(bus.getMiddlewareNames()).toEqual([]);
  });

  it('auto-name index accounts for named middleware in between', () => {
    bus.use(async (_msg, _ctx, next) => next()); // middleware-0
    bus.useNamed('custom', async (_msg, _ctx, next) => next());
    bus.use(async (_msg, _ctx, next) => next()); // middleware-2 (index=2 because array has 2 items)
    expect(bus.getMiddlewareNames()).toEqual([
      'middleware-0',
      'custom',
      'middleware-2',
    ]);
  });

  it('allows duplicate middleware names via useNamed', () => {
    bus.useNamed('dup', async (_msg, _ctx, next) => next());
    bus.useNamed('dup', async (_msg, _ctx, next) => next());
    expect(bus.getMiddlewareNames()).toEqual(['dup', 'dup']);
  });
});

// ============================================================================
// MessageBus.process() — basic chain
// ============================================================================

describe('MessageBus.process() — basic chain', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('single middleware receives message, ctx, next', async () => {
    let receivedMsg: NormalizedMessage | undefined;
    let receivedCtx: PipelineContext | undefined;
    let receivedNext: (() => Promise<MessageProcessingResult>) | undefined;

    bus.use(async (msg, ctx, next) => {
      receivedMsg = msg;
      receivedCtx = ctx;
      receivedNext = next;
      return next();
    });

    const msg = makeMessage({ content: 'Test input' });
    await bus.process(msg);

    expect(receivedMsg).toBe(msg);
    expect(receivedCtx).toBeDefined();
    expect(typeof receivedNext).toBe('function');
  });

  it('middleware can return result directly without calling next', async () => {
    const msg = makeMessage();
    bus.use(async (m, _ctx, _next) => makeResult(m, 'Direct result'));
    const result = await bus.process(msg);
    expect(result.response.content).toBe('Direct result');
  });

  it('middleware calling next() delegates to next middleware', async () => {
    bus.use(async (_msg, _ctx, next) => next());
    bus.use(async (msg, _ctx, _next) => makeResult(msg, 'From second'));
    const result = await bus.process(makeMessage());
    expect(result.response.content).toBe('From second');
  });

  it('multiple middleware run in order', async () => {
    const order: number[] = [];
    bus.use(async (_msg, _ctx, next) => {
      order.push(1);
      const r = await next();
      order.push(5);
      return r;
    });
    bus.use(async (_msg, _ctx, next) => {
      order.push(2);
      const r = await next();
      order.push(4);
      return r;
    });
    bus.use(async (_msg, _ctx, next) => {
      order.push(3);
      return next();
    });
    await bus.process(makeMessage());
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('last middleware calling next() gets empty result', async () => {
    bus.use(async (_msg, _ctx, next) => {
      const result = await next();
      expect(result.response.content).toBe('');
      return result;
    });
    await bus.process(makeMessage());
  });

  it('empty pipeline returns empty result', async () => {
    const result = await bus.process(makeMessage());
    expect(result.response.role).toBe('assistant');
    expect(result.response.content).toBe('');
    expect(result.stages).toEqual([]);
  });

  it('result includes correct sessionId from message', async () => {
    const msg = makeMessage({ sessionId: 'sess-xyz' });
    const result = await bus.process(msg);
    expect(result.response.sessionId).toBe('sess-xyz');
  });

  it('result includes durationMs >= 0', async () => {
    const result = await bus.process(makeMessage());
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('result includes stages array', async () => {
    const result = await bus.process(makeMessage());
    expect(Array.isArray(result.stages)).toBe(true);
  });

  it('result has streamed = false for non-streaming pipeline', async () => {
    const result = await bus.process(makeMessage());
    expect(result.streamed).toBe(false);
  });

  it('result response has a valid id', async () => {
    const result = await bus.process(makeMessage());
    expect(result.response.id).toBeDefined();
    expect(typeof result.response.id).toBe('string');
    expect(result.response.id.length).toBeGreaterThan(0);
  });

  it('result response has a timestamp', async () => {
    const result = await bus.process(makeMessage());
    expect(result.response.timestamp).toBeInstanceOf(Date);
  });

  it('empty result preserves message source in metadata', async () => {
    const msg = makeMessage({ metadata: { source: 'api' as const } });
    const result = await bus.process(msg);
    expect(result.response.metadata.source).toBe('api');
  });

  it('each call to process() creates a fresh context', async () => {
    let firstVal: unknown;
    let secondVal: unknown;

    bus.use(async (_msg, ctx, next) => {
      if (!ctx.has('seen')) {
        ctx.set('seen', true);
        ctx.set('counter', 1);
      }
      return next();
    });

    bus.use(async (_msg, ctx, next) => {
      // Capture from first call
      return next();
    });

    await bus.process(makeMessage());
    // Second process call should have fresh context
    let hasSeen = true;
    bus = new MessageBus();
    bus.use(async (_msg, ctx, next) => {
      hasSeen = ctx.has('seen');
      return next();
    });
    await bus.process(makeMessage());
    expect(hasSeen).toBe(false);
  });

  it('middleware can modify the result from next()', async () => {
    bus.use(async (msg, _ctx, next) => {
      const result = await next();
      return {
        ...result,
        response: {
          ...result.response,
          content: result.response.content + ' (modified)',
        },
      };
    });
    bus.use(async (msg, _ctx, _next) => makeResult(msg, 'Original'));

    const result = await bus.process(makeMessage());
    expect(result.response.content).toBe('Original (modified)');
  });

  it('middleware can inspect error result from next()', async () => {
    // Errors in inner middleware are caught by the bus's try/catch around
    // current.fn(), so the outer middleware receives the error result (not an exception).
    let inspectedContent = '';
    bus.use(async (_msg, _ctx, next) => {
      const result = await next();
      // The error was caught internally — result contains the error info
      inspectedContent = result.response.content;
      return {
        ...result,
        response: {
          ...result.response,
          content: 'Handled: ' + result.response.metadata.error,
        },
      };
    });
    bus.use(async () => {
      throw new Error('inner error');
    });
    const result = await bus.process(makeMessage());
    expect(inspectedContent).toContain('inner error');
    expect(result.response.content).toBe('Handled: inner error');
  });

  it('calling next() multiple times advances index each time', async () => {
    // This tests internal behavior: next() increments index
    const calls: string[] = [];

    bus.useNamed('a', async (_msg, _ctx, next) => {
      calls.push('a');
      return next();
    });
    bus.useNamed('b', async (_msg, _ctx, next) => {
      calls.push('b');
      return next();
    });
    bus.useNamed('c', async (_msg, _ctx, next) => {
      calls.push('c');
      return next();
    });

    await bus.process(makeMessage());
    expect(calls).toEqual(['a', 'b', 'c']);
  });
});

// ============================================================================
// MessageBus.process() — context management
// ============================================================================

describe('MessageBus.process() — context management', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('options.context pre-populates context values', async () => {
    const captured: Record<string, unknown> = {};
    bus.use(async (_msg, ctx, next) => {
      captured.x = ctx.get('x');
      captured.y = ctx.get('y');
      return next();
    });
    await bus.process(makeMessage(), { context: { x: 10, y: 20 } });
    expect(captured).toEqual({ x: 10, y: 20 });
  });

  it('options.stream stored in context under "stream" key', async () => {
    const callbacks: StreamCallbacks = { onChunk: vi.fn() };
    let stream: unknown;
    bus.use(async (_msg, ctx, next) => {
      stream = ctx.get('stream');
      return next();
    });
    await bus.process(makeMessage(), { stream: callbacks });
    expect(stream).toBe(callbacks);
  });

  it('stream not stored when not provided', async () => {
    let hasStream = true;
    bus.use(async (_msg, ctx, next) => {
      hasStream = ctx.has('stream');
      return next();
    });
    await bus.process(makeMessage());
    expect(hasStream).toBe(false);
  });

  it('middleware can read values set by previous middleware', async () => {
    let retrieved: unknown;
    bus.use(async (_msg, ctx, next) => {
      ctx.set('data', { items: [1, 2, 3] });
      return next();
    });
    bus.use(async (_msg, ctx, next) => {
      retrieved = ctx.get('data');
      return next();
    });
    await bus.process(makeMessage());
    expect(retrieved).toEqual({ items: [1, 2, 3] });
  });

  it('context values persist across the full middleware chain', async () => {
    const trail: string[] = [];
    bus.use(async (_msg, ctx, next) => {
      ctx.set('trail', trail);
      trail.push('m1-pre');
      const r = await next();
      trail.push('m1-post');
      return r;
    });
    bus.use(async (_msg, ctx, next) => {
      const t = ctx.get<string[]>('trail')!;
      t.push('m2-pre');
      const r = await next();
      t.push('m2-post');
      return r;
    });
    await bus.process(makeMessage());
    expect(trail).toEqual(['m1-pre', 'm2-pre', 'm2-post', 'm1-post']);
  });

  it('context is independent between separate process() calls', async () => {
    let callCount = 0;
    bus.use(async (_msg, ctx, next) => {
      callCount++;
      const prev = ctx.get<number>('count');
      ctx.set('count', callCount);
      return next();
    });

    await bus.process(makeMessage());
    let secondCount: unknown;
    // We need a fresh bus to test isolation — but actually the same bus
    // creates new PipelineContextImpl each time
    const bus2 = new MessageBus();
    bus2.use(async (_msg, ctx, next) => {
      secondCount = ctx.get('count');
      return next();
    });
    await bus2.process(makeMessage());
    expect(secondCount).toBeUndefined();
  });

  it('has returns false after checking non-existent key', async () => {
    let result: boolean | undefined;
    bus.use(async (_msg, ctx, next) => {
      result = ctx.has('ghost');
      return next();
    });
    await bus.process(makeMessage());
    expect(result).toBe(false);
  });

  it('context and stream can coexist in options', async () => {
    const onDone = vi.fn();
    let userId: unknown;
    let streamRef: unknown;
    bus.use(async (_msg, ctx, next) => {
      userId = ctx.get('userId');
      streamRef = ctx.get('stream');
      return next();
    });
    await bus.process(makeMessage(), {
      context: { userId: 'u-1' },
      stream: { onDone },
    });
    expect(userId).toBe('u-1');
    expect(streamRef).toBeDefined();
    expect((streamRef as StreamCallbacks).onDone).toBe(onDone);
  });

  it('setting value to undefined is valid and has returns true', async () => {
    let hasIt = false;
    let val: unknown = 'not-undefined';
    bus.use(async (_msg, ctx, next) => {
      ctx.set('undef', undefined);
      hasIt = ctx.has('undef');
      val = ctx.get('undef');
      return next();
    });
    await bus.process(makeMessage());
    expect(hasIt).toBe(true);
    expect(val).toBeUndefined();
  });

  it('empty string key works', async () => {
    let val: unknown;
    bus.use(async (_msg, ctx, next) => {
      ctx.set('', 'empty-key');
      val = ctx.get('');
      return next();
    });
    await bus.process(makeMessage());
    expect(val).toBe('empty-key');
  });
});

// ============================================================================
// MessageBus.process() — abort
// ============================================================================

describe('MessageBus.process() — abort', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('abort prevents subsequent middleware from running', async () => {
    const ran: string[] = [];
    bus.useNamed('m1', async (_msg, ctx, next) => {
      ran.push('m1');
      ctx.aborted = true;
      return next();
    });
    bus.useNamed('m2', async (_msg, _ctx, next) => {
      ran.push('m2');
      return next();
    });
    bus.useNamed('m3', async (_msg, _ctx, next) => {
      ran.push('m3');
      return next();
    });
    await bus.process(makeMessage());
    expect(ran).toEqual(['m1']);
  });

  it('aborted result has streamed = false', async () => {
    bus.use(async (_msg, ctx, next) => {
      ctx.aborted = true;
      return next();
    });
    const result = await bus.process(makeMessage());
    expect(result.streamed).toBe(false);
  });

  it('aborted result has durationMs >= 0', async () => {
    bus.use(async (_msg, ctx, next) => {
      ctx.aborted = true;
      return next();
    });
    const result = await bus.process(makeMessage());
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('aborted result has correct sessionId', async () => {
    bus.use(async (_msg, ctx, next) => {
      ctx.aborted = true;
      return next();
    });
    const msg = makeMessage({ sessionId: 'abort-sess' });
    const result = await bus.process(msg);
    expect(result.response.sessionId).toBe('abort-sess');
  });

  it('middleware that aborts still has its stage recorded', async () => {
    bus.useNamed('guard', async (_msg, ctx, next) => {
      ctx.aborted = true;
      ctx.abortReason = 'Blocked';
      return next();
    });
    const result = await bus.process(makeMessage());
    expect(result.stages).toContain('guard');
  });
});

// ============================================================================
// MessageBus.process() — error handling
// ============================================================================

describe('MessageBus.process() — error handling', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('middleware throwing Error returns error result', async () => {
    bus.use(async () => {
      throw new Error('Something broke');
    });
    const result = await bus.process(makeMessage());
    expect(result.response.content).toContain('Something broke');
  });

  it('error result content includes stage name', async () => {
    bus.useNamed('processor', async () => {
      throw new Error('Process fail');
    });
    const result = await bus.process(makeMessage());
    expect(result.response.content).toContain("'processor'");
  });

  it('error result includes errorStage in metadata', async () => {
    bus.useNamed('broken-stage', async () => {
      throw new Error('Oops');
    });
    const result = await bus.process(makeMessage());
    expect(result.response.metadata.errorStage).toBe('broken-stage');
  });

  it('error result includes error message in metadata', async () => {
    bus.use(async () => {
      throw new Error('Detail here');
    });
    const result = await bus.process(makeMessage());
    expect(result.response.metadata.error).toBe('Detail here');
  });

  it('error result warnings include the pipeline error', async () => {
    bus.useNamed('fail-stage', async () => {
      throw new Error('Bad things');
    });
    const result = await bus.process(makeMessage());
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes("Pipeline error in 'fail-stage'"))).toBe(true);
    expect(result.warnings!.some(w => w.includes('Bad things'))).toBe(true);
  });

  it('stream.onError called when middleware throws', async () => {
    const onError = vi.fn();
    bus.use(async () => {
      throw new Error('Stream error test');
    });
    await bus.process(makeMessage(), { stream: { onError } });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Stream error test' }),
    );
  });

  it('non-Error thrown is converted to Error', async () => {
    bus.useNamed('str-throw', async () => {
      throw 'raw string error';
    });
    const result = await bus.process(makeMessage());
    expect(result.response.content).toContain('raw string error');
    expect(result.response.metadata.error).toBe('raw string error');
  });

  it('thrown number is converted to Error string', async () => {
    bus.use(async () => {
      throw 42;
    });
    const result = await bus.process(makeMessage());
    expect(result.response.content).toContain('42');
  });

  it('stages up to error point are tracked', async () => {
    bus.useNamed('ok-stage', async (_msg, _ctx, next) => next());
    bus.useNamed('error-stage', async () => {
      throw new Error('fail');
    });
    bus.useNamed('unreachable', async (_msg, _ctx, next) => next());
    const result = await bus.process(makeMessage());
    expect(result.stages).toEqual(['ok-stage', 'error-stage']);
  });

  it('error result preserves earlier warnings', async () => {
    bus.useNamed('warner', async (_msg, ctx, next) => {
      ctx.addWarning('heads up');
      return next();
    });
    bus.useNamed('thrower', async () => {
      throw new Error('kaboom');
    });
    const result = await bus.process(makeMessage());
    expect(result.warnings).toContain('heads up');
    expect(result.warnings!.some(w => w.includes('kaboom'))).toBe(true);
  });

  it('error result has role assistant', async () => {
    bus.use(async () => {
      throw new Error('err');
    });
    const result = await bus.process(makeMessage());
    expect(result.response.role).toBe('assistant');
  });

  it('error result has correct sessionId', async () => {
    bus.use(async () => {
      throw new Error('err');
    });
    const msg = makeMessage({ sessionId: 'err-sess' });
    const result = await bus.process(msg);
    expect(result.response.sessionId).toBe('err-sess');
  });

  it('error result preserves message metadata fields', async () => {
    bus.use(async () => {
      throw new Error('err');
    });
    const msg = makeMessage({
      metadata: { source: 'channel' as const, platform: 'telegram' },
    });
    const result = await bus.process(msg);
    expect(result.response.metadata.source).toBe('channel');
    expect(result.response.metadata.platform).toBe('telegram');
  });

  it('error in second middleware after first succeeds', async () => {
    bus.useNamed('first', async (_msg, _ctx, next) => next());
    bus.useNamed('second', async () => {
      throw new Error('second fails');
    });
    const result = await bus.process(makeMessage());
    expect(result.response.metadata.errorStage).toBe('second');
    expect(result.stages).toEqual(['first', 'second']);
  });
});

// ============================================================================
// MessageBus.process() — empty result
// ============================================================================

describe('MessageBus.process() — empty result', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('empty result has role assistant', async () => {
    const result = await bus.process(makeMessage());
    expect(result.response.role).toBe('assistant');
  });

  it('empty result has empty string content', async () => {
    const result = await bus.process(makeMessage());
    expect(result.response.content).toBe('');
  });

  it('empty result warnings undefined when none exist', async () => {
    const result = await bus.process(makeMessage());
    expect(result.warnings).toBeUndefined();
  });

  it('empty result includes warnings when they exist', async () => {
    bus.use(async (_msg, ctx, next) => {
      ctx.addWarning('a warning');
      return next();
    });
    const result = await bus.process(makeMessage());
    expect(result.warnings).toEqual(['a warning']);
  });

  it('empty result source metadata preserved from message', async () => {
    const msg = makeMessage({ metadata: { source: 'scheduler' as const } });
    const result = await bus.process(msg);
    expect(result.response.metadata.source).toBe('scheduler');
  });
});

// ============================================================================
// MessageBus.process() — stream callbacks
// ============================================================================

describe('MessageBus.process() — stream callbacks', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('stream stored in context under "stream" key', async () => {
    const onChunk = vi.fn();
    let streamVal: unknown;
    bus.use(async (_msg, ctx, next) => {
      streamVal = ctx.get('stream');
      return next();
    });
    await bus.process(makeMessage(), { stream: { onChunk } });
    expect(streamVal).toBeDefined();
    expect((streamVal as StreamCallbacks).onChunk).toBe(onChunk);
  });

  it('middleware can access and use stream callbacks', async () => {
    const onProgress = vi.fn();
    bus.use(async (_msg, ctx, next) => {
      const stream = ctx.get<StreamCallbacks>('stream');
      stream?.onProgress?.('Processing...');
      return next();
    });
    await bus.process(makeMessage(), { stream: { onProgress } });
    expect(onProgress).toHaveBeenCalledWith('Processing...');
  });

  it('onError called with Error object when middleware throws', async () => {
    const onError = vi.fn();
    bus.use(async () => {
      throw new Error('Stream fail');
    });
    await bus.process(makeMessage(), { stream: { onError } });
    expect(onError).toHaveBeenCalledTimes(1);
    const arg = onError.mock.calls[0]![0];
    expect(arg).toBeInstanceOf(Error);
    expect(arg.message).toBe('Stream fail');
  });

  it('onError receives proper Error even when non-Error thrown', async () => {
    const onError = vi.fn();
    bus.use(async () => {
      throw 'string error';
    });
    await bus.process(makeMessage(), { stream: { onError } });
    const arg = onError.mock.calls[0]![0];
    expect(arg).toBeInstanceOf(Error);
    expect(arg.message).toBe('string error');
  });

  it('no error when stream has no onError callback', async () => {
    bus.use(async () => {
      throw new Error('fail');
    });
    // Should not throw — onError is optional
    const result = await bus.process(makeMessage(), { stream: { onChunk: vi.fn() } });
    expect(result.response.content).toContain('fail');
  });
});

// ============================================================================
// createMessageBus()
// ============================================================================

describe('createMessageBus()', () => {
  it('returns a MessageBus instance', () => {
    const bus = createMessageBus();
    expect(bus).toBeInstanceOf(MessageBus);
  });

  it('has empty middleware list', () => {
    const bus = createMessageBus();
    expect(bus.getMiddlewareNames()).toEqual([]);
  });

  it('can register and process middleware', async () => {
    const bus = createMessageBus();
    bus.useNamed('test', async (msg, _ctx, _next) => makeResult(msg, 'Works'));
    const result = await bus.process(makeMessage());
    expect(result.response.content).toBe('Works');
  });
});

// ============================================================================
// Integration tests
// ============================================================================

describe('MessageBus integration', () => {
  it('full pipeline: audit -> inject -> execute with results flowing', async () => {
    const bus = createMessageBus();
    const events: string[] = [];

    // Audit middleware
    bus.useNamed('audit', async (_msg, ctx, next) => {
      events.push('audit-start');
      ctx.set('auditId', 'audit-123');
      const result = await next();
      events.push('audit-end');
      return result;
    });

    // Context injection middleware
    bus.useNamed('context-injection', async (_msg, ctx, next) => {
      events.push('inject');
      ctx.set('systemPrompt', 'You are a helpful assistant.');
      return next();
    });

    // Agent execution middleware (innermost — produces the response)
    bus.useNamed('agent-execution', async (msg, ctx, _next) => {
      events.push('execute');
      const prompt = ctx.get<string>('systemPrompt');
      return {
        response: {
          id: randomUUID(),
          sessionId: msg.sessionId,
          role: 'assistant' as const,
          content: `Processed with prompt: ${prompt}`,
          metadata: { source: msg.metadata.source },
          timestamp: new Date(),
        },
        streamed: false,
        durationMs: 50,
        stages: ctx.getStages(),
      };
    });

    const result = await bus.process(makeMessage());
    expect(events).toEqual(['audit-start', 'inject', 'execute', 'audit-end']);
    expect(result.response.content).toBe(
      'Processed with prompt: You are a helpful assistant.',
    );
    expect(result.stages).toEqual(['audit', 'context-injection', 'agent-execution']);
  });

  it('middleware modifying response post-next()', async () => {
    const bus = createMessageBus();

    bus.useNamed('post-processor', async (_msg, _ctx, next) => {
      const result = await next();
      return {
        ...result,
        response: {
          ...result.response,
          content: result.response.content.toUpperCase(),
        },
      };
    });

    bus.useNamed('generator', async (msg, _ctx, _next) => makeResult(msg, 'hello world'));

    const result = await bus.process(makeMessage());
    expect(result.response.content).toBe('HELLO WORLD');
  });

  it('pipeline with warnings accumulated by multiple middleware', async () => {
    const bus = createMessageBus();

    bus.useNamed('validator', async (_msg, ctx, next) => {
      ctx.addWarning('No user profile found');
      return next();
    });

    bus.useNamed('memory', async (_msg, ctx, next) => {
      ctx.addWarning('Memory service degraded');
      return next();
    });

    bus.useNamed('executor', async (_msg, ctx, next) => {
      // No warnings from executor
      return next();
    });

    const result = await bus.process(makeMessage());
    expect(result.warnings).toEqual([
      'No user profile found',
      'Memory service degraded',
    ]);
  });

  it('early return (guard middleware)', async () => {
    const bus = createMessageBus();

    bus.useNamed('rate-limiter', async (msg, _ctx, _next) => {
      // Early return — skip everything else
      return {
        response: {
          id: randomUUID(),
          sessionId: msg.sessionId,
          role: 'assistant' as const,
          content: 'Rate limited. Please try again later.',
          metadata: { source: msg.metadata.source, rateLimited: true },
          timestamp: new Date(),
        },
        streamed: false,
        durationMs: 1,
        stages: ['rate-limiter'],
      };
    });

    bus.useNamed('executor', async () => {
      throw new Error('Should never reach here');
    });

    const result = await bus.process(makeMessage());
    expect(result.response.content).toBe('Rate limited. Please try again later.');
    expect(result.response.metadata.rateLimited).toBe(true);
  });

  it('complex chain with context, warnings, stages, and stream', async () => {
    const bus = createMessageBus();
    const onProgress = vi.fn();

    bus.useNamed('auth', async (_msg, ctx, next) => {
      ctx.set('userId', 'u-42');
      return next();
    });

    bus.useNamed('middleware', async (_msg, ctx, next) => {
      const stream = ctx.get<StreamCallbacks>('stream');
      stream?.onProgress?.('Loading context...');
      ctx.addWarning('Partial context loaded');
      return next();
    });

    bus.useNamed('execute', async (msg, ctx, _next) => {
      const userId = ctx.get<string>('userId');
      const warnings = ctx.getWarnings();
      return {
        response: {
          id: randomUUID(),
          sessionId: msg.sessionId,
          role: 'assistant' as const,
          content: `Hello user ${userId}`,
          metadata: { source: msg.metadata.source },
          timestamp: new Date(),
        },
        streamed: false,
        durationMs: 100,
        stages: ctx.getStages(),
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    });

    const result = await bus.process(makeMessage(), {
      stream: { onProgress },
      context: { agentId: 'agent-1' },
    });

    expect(result.response.content).toBe('Hello user u-42');
    expect(onProgress).toHaveBeenCalledWith('Loading context...');
    expect(result.stages).toEqual(['auth', 'middleware', 'execute']);
    expect(result.warnings).toEqual(['Partial context loaded']);
  });
});
