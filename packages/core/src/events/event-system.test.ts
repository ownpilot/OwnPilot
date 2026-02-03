/**
 * EventSystem Tests
 *
 * Tests for the unified facade combining EventBus + HookBus + ScopedBus.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventSystem, getEventSystem, resetEventSystem } from './event-system.js';

describe('EventSystem', () => {
  let system: EventSystem;

  beforeEach(() => {
    system = new EventSystem();
  });

  // ==========================================================================
  // Event + Hook integration
  // ==========================================================================

  describe('events and hooks together', () => {
    it('events fire independently from hooks', async () => {
      const eventHandler = vi.fn();
      const hookHandler = vi.fn();

      system.on('tool.executed', eventHandler);
      system.hooks.tap('tool:before-execute', hookHandler);

      // Fire event
      system.emit('tool.executed', 'test', {
        name: 'calc',
        duration: 10,
        success: true,
      });

      // Fire hook
      await system.hooks.call('tool:before-execute', {
        toolName: 'calc',
        args: {},
      });

      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(hookHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Scoped bus creation
  // ==========================================================================

  describe('scoped', () => {
    it('creates scoped bus with correct prefix', () => {
      const scoped = system.scoped('channel', 'channel-manager');

      expect(scoped.prefix).toBe('channel');
      expect(scoped.source).toBe('channel-manager');
    });

    it('scoped events flow to system', () => {
      const handler = vi.fn();
      system.onPattern('channel.**', handler);

      const scoped = system.scoped('channel', 'channel-manager');
      scoped.emit('connected', { channelId: 'c1' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('scoped hooks flow to system', async () => {
      const handler = vi.fn();
      system.hooks.tapAny('channel:before-send', handler);

      const scoped = system.scoped('channel', 'channel-manager');
      await scoped.hooks.call('before-send', { message: 'hello' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('uses prefix as default source', () => {
      const scoped = system.scoped('gateway');
      expect(scoped.source).toBe('gateway');
    });
  });

  // ==========================================================================
  // clear
  // ==========================================================================

  describe('clear', () => {
    it('clears both events and hooks', async () => {
      const eventHandler = vi.fn();
      const hookHandler = vi.fn();

      system.on('tool.executed', eventHandler);
      system.hooks.tap('tool:before-execute', hookHandler);

      system.clear();

      system.emit('tool.executed', 'test', { name: 'calc', duration: 10, success: true });
      await system.hooks.call('tool:before-execute', { toolName: 'calc', args: {} });

      expect(eventHandler).not.toHaveBeenCalled();
      expect(hookHandler).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Singleton
// ============================================================================

describe('getEventSystem / resetEventSystem', () => {
  beforeEach(() => {
    resetEventSystem();
  });

  it('returns an EventSystem instance', () => {
    const system = getEventSystem();
    expect(system).toBeDefined();
    expect(typeof system.emit).toBe('function');
    expect(typeof system.hooks.tap).toBe('function');
    expect(typeof system.scoped).toBe('function');
  });

  it('returns the same instance on repeated calls', () => {
    const s1 = getEventSystem();
    const s2 = getEventSystem();
    expect(s1).toBe(s2);
  });

  it('creates a new instance after reset', () => {
    const s1 = getEventSystem();
    resetEventSystem();
    const s2 = getEventSystem();
    expect(s1).not.toBe(s2);
  });

  it('clears all handlers on reset', () => {
    const handler = vi.fn();
    const system = getEventSystem();
    system.on('tool.executed', handler);

    resetEventSystem();

    const newSystem = getEventSystem();
    newSystem.emit('tool.executed', 'test', { name: 'calc', duration: 10, success: true });

    expect(handler).not.toHaveBeenCalled();
  });
});
