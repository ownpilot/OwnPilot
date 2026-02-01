/**
 * ScopedEventBus Tests
 *
 * Tests for auto-prefixed event namespaces:
 * - Emit with auto-prefix
 * - Subscribe within scope
 * - onAll pattern matching
 * - Nested scopes
 * - Scoped hooks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from './event-bus.js';
import { HookBus } from './hook-bus.js';
import { ScopedEventBus } from './scoped-bus.js';
import type { TypedEvent } from './types.js';

describe('ScopedEventBus', () => {
  let eventBus: EventBus;
  let hookBus: HookBus;
  let scoped: ScopedEventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    hookBus = new HookBus();
    scoped = new ScopedEventBus(eventBus, hookBus, 'channel', 'channel-manager');
  });

  // ==========================================================================
  // Emit with auto-prefix
  // ==========================================================================

  describe('emit', () => {
    it('prefixes event type with scope prefix', () => {
      const handler = vi.fn();
      eventBus.onAny('channel.connected', handler);

      scoped.emit('connected', { channelId: 'c1' });

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0] as TypedEvent;
      expect(event.type).toBe('channel.connected');
      expect(event.source).toBe('channel-manager');
      expect(event.data).toEqual({ channelId: 'c1' });
    });

    it('sets correct category from prefix', () => {
      const handler = vi.fn();
      eventBus.onCategory('channel', handler);

      scoped.emit('disconnected', { reason: 'timeout' });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Subscribe within scope
  // ==========================================================================

  describe('on', () => {
    it('subscribes to prefixed event type on global bus', () => {
      const handler = vi.fn();
      scoped.on('connected', handler);

      // Emit directly on global bus with full type
      eventBus.emitRaw({
        type: 'channel.connected',
        category: 'channel',
        timestamp: new Date().toISOString(),
        source: 'test',
        data: { channelId: 'c1' },
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not receive events outside scope', () => {
      const handler = vi.fn();
      scoped.on('connected', handler);

      eventBus.emitRaw({
        type: 'gateway.connected',
        category: 'gateway',
        timestamp: new Date().toISOString(),
        source: 'test',
        data: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('returns unsubscribe function', () => {
      const handler = vi.fn();
      const unsub = scoped.on('connected', handler);

      unsub();

      scoped.emit('connected', {});
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // once
  // ==========================================================================

  describe('once', () => {
    it('fires handler only once within scope', () => {
      const handler = vi.fn();
      scoped.once('connected', handler);

      scoped.emit('connected', { first: true });
      scoped.emit('connected', { second: true });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].data).toEqual({ first: true });
    });
  });

  // ==========================================================================
  // onAll
  // ==========================================================================

  describe('onAll', () => {
    it('subscribes to all events within scope using ** pattern', () => {
      const handler = vi.fn();
      scoped.onAll(handler);

      scoped.emit('connected', { channelId: 'c1' });
      scoped.emit('message.received', { messageId: 'm1' });
      scoped.emit('error', { error: 'fail' });

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('does not receive events outside scope', () => {
      const handler = vi.fn();
      scoped.onAll(handler);

      eventBus.emitRaw({
        type: 'gateway.connected',
        category: 'gateway',
        timestamp: new Date().toISOString(),
        source: 'test',
        data: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Nested scopes
  // ==========================================================================

  describe('nested scopes', () => {
    it('creates sub-scope with combined prefix', () => {
      const messageBus = scoped.scoped('message');
      const handler = vi.fn();
      eventBus.onAny('channel.message.received', handler);

      messageBus.emit('received', { messageId: 'm1' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('sub-scope inherits parent source by default', () => {
      const messageBus = scoped.scoped('message');
      const handler = vi.fn();
      eventBus.onAny('channel.message.sent', handler);

      messageBus.emit('sent', {});

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0] as TypedEvent;
      expect(event.source).toBe('channel-manager');
    });

    it('sub-scope can override source', () => {
      const messageBus = scoped.scoped('message', 'telegram-adapter');
      const handler = vi.fn();
      eventBus.onAny('channel.message.sent', handler);

      messageBus.emit('sent', {});

      const event = handler.mock.calls[0][0] as TypedEvent;
      expect(event.source).toBe('telegram-adapter');
    });

    it('deep nesting works', () => {
      const handler = vi.fn();
      eventBus.onAny('channel.message.user.action', handler);

      scoped.scoped('message').scoped('user').emit('action', { userId: 'u1' });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Scoped hooks
  // ==========================================================================

  describe('scoped hooks', () => {
    it('prefixes hook names with scope', async () => {
      const handler = vi.fn();
      hookBus.tapAny('channel:before-send', handler);

      await scoped.hooks.call('before-send', { message: 'hello' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('tap registers on global hook bus with prefix', async () => {
      const handler = vi.fn();
      scoped.hooks.tap('before-send', handler);

      await hookBus.callAny('channel:before-send', { message: 'hello' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('returns unsubscribe from scoped tap', async () => {
      const handler = vi.fn();
      const unsub = scoped.hooks.tap('before-send', handler);

      unsub();

      await scoped.hooks.call('before-send', { message: 'hello' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Cross-scope communication
  // ==========================================================================

  describe('cross-scope communication', () => {
    it('events from scoped bus are visible on global bus', () => {
      const globalHandler = vi.fn();
      eventBus.onPattern('channel.**', globalHandler);

      scoped.emit('connected', { channelId: 'c1' });

      expect(globalHandler).toHaveBeenCalledTimes(1);
    });

    it('global events are visible within scope', () => {
      const scopedHandler = vi.fn();
      scoped.on('connected', scopedHandler);

      // Another system emits to global bus
      eventBus.emitRaw({
        type: 'channel.connected',
        category: 'channel',
        timestamp: new Date().toISOString(),
        source: 'other-system',
        data: { channelId: 'c2' },
      });

      expect(scopedHandler).toHaveBeenCalledTimes(1);
    });
  });
});
