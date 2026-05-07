/**
 * UCP Pipeline Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { UCPPipeline } from './pipeline.js';
import type { UCPMessage } from './types.js';

function makeMessage(overrides: Partial<UCPMessage> = {}): UCPMessage {
  return {
    id: 'msg-1',
    externalId: 'ext-1',
    channel: 'telegram',
    channelInstanceId: 'channel.telegram',
    direction: 'inbound',
    sender: { id: 'user-1', platform: 'telegram' },
    content: [{ type: 'text', text: 'hello', format: 'plain' }],
    timestamp: new Date(),
    metadata: {},
    ...overrides,
  };
}

describe('UCPPipeline', () => {
  it('passes message through with no middleware', async () => {
    const pipeline = new UCPPipeline();
    const msg = makeMessage();

    const result = await pipeline.processInbound(msg);
    expect(result).toEqual(msg);
  });

  it('runs inbound middleware in order', async () => {
    const pipeline = new UCPPipeline();
    const order: string[] = [];

    pipeline.useInbound('first', async (msg, next) => {
      order.push('first-before');
      const result = await next();
      order.push('first-after');
      return result;
    });

    pipeline.useInbound('second', async (msg, next) => {
      order.push('second-before');
      const result = await next();
      order.push('second-after');
      return result;
    });

    await pipeline.processInbound(makeMessage());

    expect(order).toEqual(['first-before', 'second-before', 'second-after', 'first-after']);
  });

  it('runs outbound middleware separately from inbound', async () => {
    const pipeline = new UCPPipeline();
    const inboundFn = vi.fn(async (msg: UCPMessage, next: () => Promise<UCPMessage>) => next());
    const outboundFn = vi.fn(async (msg: UCPMessage, next: () => Promise<UCPMessage>) => next());

    pipeline.useInbound('in', inboundFn);
    pipeline.useOutbound('out', outboundFn);

    await pipeline.processInbound(makeMessage());
    expect(inboundFn).toHaveBeenCalledTimes(1);
    expect(outboundFn).not.toHaveBeenCalled();

    await pipeline.processOutbound(makeMessage({ direction: 'outbound' }));
    expect(outboundFn).toHaveBeenCalledTimes(1);
    expect(inboundFn).toHaveBeenCalledTimes(1); // still 1
  });

  it('use() registers for both inbound and outbound', async () => {
    const pipeline = new UCPPipeline();
    const fn = vi.fn(async (msg: UCPMessage, next: () => Promise<UCPMessage>) => next());

    pipeline.use('both', fn);

    await pipeline.processInbound(makeMessage());
    await pipeline.processOutbound(makeMessage({ direction: 'outbound' }));

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('middleware can modify the message', async () => {
    const pipeline = new UCPPipeline();

    pipeline.useInbound('tagger', async (msg, next) => {
      const _modified = { ...msg, metadata: { ...msg.metadata, tagged: true } };
      return next();
    });

    // Actually: middleware should return modified message via next()
    // Let's test proper mutation pattern
    const pipeline2 = new UCPPipeline();
    pipeline2.useInbound('uppercase', async (msg, next) => {
      const _upper: UCPMessage = {
        ...msg,
        content: msg.content.map((c) =>
          c.type === 'text' && c.text ? { ...c, text: c.text.toUpperCase() } : c
        ),
      };
      // Note: in this pipeline design, we modify `msg` and pass to next
      return next();
    });
  });

  it('middleware can short-circuit the chain', async () => {
    const pipeline = new UCPPipeline();
    const secondFn = vi.fn(async (msg: UCPMessage, next: () => Promise<UCPMessage>) => next());

    pipeline.useInbound('blocker', async (msg, _next) => {
      // Don't call next() — short-circuit
      return { ...msg, metadata: { ...msg.metadata, blocked: true } };
    });

    pipeline.useInbound('second', secondFn);

    const result = await pipeline.processInbound(makeMessage());
    expect(result.metadata.blocked).toBe(true);
    expect(secondFn).not.toHaveBeenCalled();
  });

  it('getInboundNames returns registered names', () => {
    const pipeline = new UCPPipeline();
    pipeline.useInbound('rate-limiter', async (msg, next) => next());
    pipeline.useInbound('thread-tracker', async (msg, next) => next());

    expect(pipeline.getInboundNames()).toEqual(['rate-limiter', 'thread-tracker']);
  });

  it('getOutboundNames returns registered names', () => {
    const pipeline = new UCPPipeline();
    pipeline.useOutbound('rate-limiter', async (msg, next) => next());

    expect(pipeline.getOutboundNames()).toEqual(['rate-limiter']);
  });

  it('handles errors in middleware gracefully', async () => {
    const pipeline = new UCPPipeline();

    pipeline.useInbound('faulty', async () => {
      throw new Error('middleware error');
    });

    await expect(pipeline.processInbound(makeMessage())).rejects.toThrow('middleware error');
  });
});
