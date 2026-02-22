/**
 * EventBus Tests (New Typed API)
 *
 * Tests for the enhanced EventBus with:
 * - Typed emit/on via EventMap
 * - once() support
 * - waitFor() support
 * - Pattern matching
 * - Error isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from './event-bus.js';
import type { TypedEvent } from './types.js';

describe('EventBus (new API)', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // ==========================================================================
  // Typed emit / on
  // ==========================================================================

  describe('typed emit and on', () => {
    it('emits typed events with auto-generated metadata', () => {
      const handler = vi.fn();
      bus.on('agent.complete', handler);

      bus.emit('agent.complete', 'orchestrator', {
        agentId: 'a1',
        response: 'done',
        iterationCount: 3,
        duration: 1500,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0] as TypedEvent;
      expect(event.type).toBe('agent.complete');
      expect(event.category).toBe('agent');
      expect(event.source).toBe('orchestrator');
      expect(event.data).toEqual({
        agentId: 'a1',
        response: 'done',
        iterationCount: 3,
        duration: 1500,
      });
      expect(event.timestamp).toBeDefined();
    });

    it('auto-derives category from event type', () => {
      const handler = vi.fn();
      bus.onCategory('tool', handler);

      bus.emit('tool.executed', 'registry', {
        name: 'calculate',
        duration: 50,
        success: true,
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('supports channel events with deep paths', () => {
      const handler = vi.fn();
      bus.onPattern('channel.message.**', handler);

      bus.emit('channel.message.received', 'telegram', {
        message: { id: 'm1' } as Record<string, unknown>,
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // emitRaw (backward compat)
  // ==========================================================================

  describe('emitRaw', () => {
    it('dispatches pre-constructed TypedEvent objects', () => {
      const handler = vi.fn();
      bus.onAny('custom.event', handler);

      bus.emitRaw({
        type: 'custom.event',
        category: 'system',
        timestamp: new Date().toISOString(),
        source: 'test',
        data: { foo: 'bar' },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].data).toEqual({ foo: 'bar' });
    });
  });

  // ==========================================================================
  // once()
  // ==========================================================================

  describe('once', () => {
    it('fires handler only once', () => {
      const handler = vi.fn();
      bus.once('tool.executed', handler);

      bus.emit('tool.executed', 'test', { name: 'calc', duration: 10, success: true });
      bus.emit('tool.executed', 'test', { name: 'calc', duration: 20, success: true });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('returns unsubscribe function that works before first call', () => {
      const handler = vi.fn();
      const unsub = bus.once('tool.executed', handler);

      unsub();
      bus.emit('tool.executed', 'test', { name: 'calc', duration: 10, success: true });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // waitFor()
  // ==========================================================================

  describe('waitFor', () => {
    it('resolves when event is emitted', async () => {
      const promise = bus.waitFor('agent.complete');

      // Emit after a tick
      setTimeout(() => {
        bus.emit('agent.complete', 'test', {
          agentId: 'a1',
          iterationCount: 1,
          duration: 100,
        });
      }, 0);

      const event = await promise;
      expect(event.type).toBe('agent.complete');
      expect(event.data.agentId).toBe('a1');
    });

    it('rejects on timeout', async () => {
      const promise = bus.waitFor('agent.complete', 50);

      await expect(promise).rejects.toThrow("waitFor('agent.complete') timed out after 50ms");
    });

    it('only resolves once (first event)', async () => {
      const promise = bus.waitFor('tool.executed');

      bus.emit('tool.executed', 'test', { name: 'first', duration: 10, success: true });
      bus.emit('tool.executed', 'test', { name: 'second', duration: 20, success: true });

      const event = await promise;
      expect(event.data.name).toBe('first');
    });
  });

  // ==========================================================================
  // onAny (escape hatch)
  // ==========================================================================

  describe('onAny', () => {
    it('subscribes to dynamic event types', () => {
      const handler = vi.fn();
      bus.onAny('custom.dynamic.event', handler);

      bus.emitRaw({
        type: 'custom.dynamic.event',
        category: 'system',
        timestamp: new Date().toISOString(),
        source: 'test',
        data: {},
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Pattern matching
  // ==========================================================================

  describe('pattern matching', () => {
    it('matches single wildcard *', () => {
      const handler = vi.fn();
      bus.onPattern('agent.*', handler);

      bus.emit('agent.complete', 'test', { agentId: 'a1', iterationCount: 1, duration: 100 });
      bus.emit('agent.error', 'test', { agentId: 'a1', error: 'fail', iteration: 1 });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('matches double wildcard **', () => {
      const handler = vi.fn();
      bus.onPattern('channel.**', handler);

      bus.emit('channel.connected', 'test', {
        channelPluginId: 'c1',
        platform: 'telegram',
        status: 'connected',
      });
      bus.emit('channel.message.received', 'test', { message: {} as Record<string, unknown> });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('matches middle wildcard', () => {
      const handler = vi.fn();
      bus.onPattern('gateway.chat.*', handler);

      bus.emitRaw({
        type: 'gateway.chat.message',
        category: 'gateway',
        timestamp: new Date().toISOString(),
        source: 'test',
        data: {},
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Error isolation
  // ==========================================================================

  describe('error isolation', () => {
    it('catches sync errors without propagation', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      bus.onAny('test.event', () => {
        throw new Error('sync fail');
      });

      expect(() => {
        bus.emitRaw({
          type: 'test.event',
          category: 'system',
          timestamp: new Date().toISOString(),
          source: 'test',
          data: {},
        });
      }).not.toThrow();

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('catches async errors without propagation', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      bus.onAny('test.event', async () => {
        throw new Error('async fail');
      });

      bus.emitRaw({
        type: 'test.event',
        category: 'system',
        timestamp: new Date().toISOString(),
        source: 'test',
        data: {},
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('continues calling other handlers after one throws', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const goodHandler = vi.fn();

      bus.onAny('test.event', () => {
        throw new Error('bad');
      });
      bus.onAny('test.event', goodHandler);

      bus.emitRaw({
        type: 'test.event',
        category: 'system',
        timestamp: new Date().toISOString(),
        source: 'test',
        data: {},
      });

      expect(goodHandler).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });
  });

  // ==========================================================================
  // clear()
  // ==========================================================================

  describe('clear', () => {
    it('removes all handlers across all subscription types', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      const h3 = vi.fn();

      bus.on('agent.complete', h1);
      bus.onCategory('resource', h2);
      bus.onPattern('tool.*', h3);

      bus.clear();

      bus.emit('agent.complete', 'test', { agentId: 'a1', iterationCount: 1, duration: 100 });
      bus.emit('resource.created', 'test', { resourceType: 'goal', id: '1' });
      bus.emit('tool.executed', 'test', { name: 'calc', duration: 10, success: true });

      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
      expect(h3).not.toHaveBeenCalled();
    });
  });
});
