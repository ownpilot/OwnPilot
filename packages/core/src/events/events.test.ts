/**
 * EventBus Legacy API Tests
 *
 * Tests backward compatibility of the legacy API (getEventBus, createEvent).
 * These tests verify that existing code continues to work unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEvent,
  getEventBus,
  resetEventBus,
  EventTypes,
  type ILegacyEventBus,
} from './index.js';

describe('Legacy EventBus API', () => {
  let bus: ILegacyEventBus;

  beforeEach(() => {
    resetEventBus();
    bus = getEventBus();
  });

  // ==========================================================================
  // Basic emit / on / off
  // ==========================================================================

  describe('emit and on', () => {
    it('calls handler when event type matches', () => {
      const handler = vi.fn();
      bus.on('agent.complete', handler);

      const event = createEvent('agent.complete', 'agent', 'test', { result: 'ok' });
      bus.emit(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('does not call handler for non-matching type', () => {
      const handler = vi.fn();
      bus.on('agent.complete', handler);

      bus.emit(createEvent('agent.error', 'agent', 'test', { error: 'fail' }));

      expect(handler).not.toHaveBeenCalled();
    });

    it('supports multiple handlers for the same event type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('tool.executed', handler1);
      bus.on('tool.executed', handler2);

      bus.emit(createEvent('tool.executed', 'tool', 'test', {}));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('supports multiple event types independently', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('resource.created', handler1);
      bus.on('resource.deleted', handler2);

      bus.emit(createEvent('resource.created', 'resource', 'test', {}));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('off', () => {
    it('removes a handler', () => {
      const handler = vi.fn();
      bus.on('agent.complete', handler);
      bus.off('agent.complete', handler);

      bus.emit(createEvent('agent.complete', 'agent', 'test', {}));

      expect(handler).not.toHaveBeenCalled();
    });

    it('returns unsubscribe function from on()', () => {
      const handler = vi.fn();
      const unsub = bus.on('agent.complete', handler);

      unsub();
      bus.emit(createEvent('agent.complete', 'agent', 'test', {}));

      expect(handler).not.toHaveBeenCalled();
    });

    it('does not throw when removing non-existent handler', () => {
      const handler = vi.fn();
      expect(() => bus.off('nonexistent', handler)).not.toThrow();
    });
  });

  // ==========================================================================
  // Category handlers
  // ==========================================================================

  describe('onCategory', () => {
    it('fires for all events in a category', () => {
      const handler = vi.fn();
      bus.onCategory('resource', handler);

      bus.emit(createEvent('resource.created', 'resource', 'test', {}));
      bus.emit(createEvent('resource.updated', 'resource', 'test', {}));
      bus.emit(createEvent('resource.deleted', 'resource', 'test', {}));

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('does not fire for events in other categories', () => {
      const handler = vi.fn();
      bus.onCategory('resource', handler);

      bus.emit(createEvent('tool.executed', 'tool', 'test', {}));
      bus.emit(createEvent('agent.complete', 'agent', 'test', {}));

      expect(handler).not.toHaveBeenCalled();
    });

    it('returns unsubscribe function', () => {
      const handler = vi.fn();
      const unsub = bus.onCategory('agent', handler);

      bus.emit(createEvent('agent.complete', 'agent', 'test', {}));
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      bus.emit(createEvent('agent.error', 'agent', 'test', {}));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Pattern matching (wildcards)
  // ==========================================================================

  describe('onPattern', () => {
    it('matches single wildcard *', () => {
      const handler = vi.fn();
      bus.onPattern('agent.*', handler);

      bus.emit(createEvent('agent.complete', 'agent', 'test', {}));
      bus.emit(createEvent('agent.error', 'agent', 'test', {}));

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('single wildcard * does not match deeper paths', () => {
      const handler = vi.fn();
      bus.onPattern('resource.*', handler);

      bus.emit(createEvent('resource.goal.updated', 'resource', 'test', {}));

      expect(handler).not.toHaveBeenCalled();
    });

    it('matches double wildcard **', () => {
      const handler = vi.fn();
      bus.onPattern('resource.**', handler);

      bus.emit(createEvent('resource.created', 'resource', 'test', {}));
      bus.emit(createEvent('resource.goal.updated', 'resource', 'test', {}));

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('matches middle wildcard', () => {
      const handler = vi.fn();
      bus.onPattern('plugin.*.status', handler);

      bus.emit(createEvent('plugin.reminder.status', 'plugin', 'test', {}));
      bus.emit(createEvent('plugin.gmail.status', 'plugin', 'test', {}));

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('does not match non-matching patterns', () => {
      const handler = vi.fn();
      bus.onPattern('plugin.*.status', handler);

      bus.emit(createEvent('plugin.reminder.error', 'plugin', 'test', {}));

      expect(handler).not.toHaveBeenCalled();
    });

    it('returns unsubscribe function', () => {
      const handler = vi.fn();
      const unsub = bus.onPattern('agent.*', handler);

      bus.emit(createEvent('agent.complete', 'agent', 'test', {}));
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      bus.emit(createEvent('agent.error', 'agent', 'test', {}));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Combined handlers
  // ==========================================================================

  describe('combined handlers', () => {
    it('fires exact, category, and pattern handlers for a single event', () => {
      const exactHandler = vi.fn();
      const categoryHandler = vi.fn();
      const patternHandler = vi.fn();

      bus.on('resource.created', exactHandler);
      bus.onCategory('resource', categoryHandler);
      bus.onPattern('resource.*', patternHandler);

      bus.emit(createEvent('resource.created', 'resource', 'test', {}));

      expect(exactHandler).toHaveBeenCalledTimes(1);
      expect(categoryHandler).toHaveBeenCalledTimes(1);
      expect(patternHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Error safety
  // ==========================================================================

  describe('error handling', () => {
    it('does not propagate sync handler errors', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      bus.on('test.event', () => {
        throw new Error('handler error');
      });

      expect(() => {
        bus.emit(createEvent('test.event', 'system', 'test', {}));
      }).not.toThrow();

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('does not propagate async handler errors', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      bus.on('test.event', async () => {
        throw new Error('async handler error');
      });

      expect(() => {
        bus.emit(createEvent('test.event', 'system', 'test', {}));
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('continues calling other handlers after one throws', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const goodHandler = vi.fn();

      bus.on('test.event', () => {
        throw new Error('bad handler');
      });
      bus.on('test.event', goodHandler);

      bus.emit(createEvent('test.event', 'system', 'test', {}));

      expect(goodHandler).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });
  });

  // ==========================================================================
  // clear()
  // ==========================================================================

  describe('clear', () => {
    it('removes all handlers', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      const h3 = vi.fn();

      bus.on('test.event', h1);
      bus.onCategory('resource', h2);
      bus.onPattern('agent.*', h3);

      bus.clear();

      bus.emit(createEvent('test.event', 'resource', 'test', {}));
      bus.emit(createEvent('agent.complete', 'agent', 'test', {}));

      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
      expect(h3).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// createEvent helper
// ============================================================================

describe('createEvent', () => {
  it('creates a typed event with all fields', () => {
    const event = createEvent('resource.created', 'resource', 'test-source', { id: '123' });

    expect(event.type).toBe('resource.created');
    expect(event.category).toBe('resource');
    expect(event.source).toBe('test-source');
    expect(event.data).toEqual({ id: '123' });
    expect(event.timestamp).toBeDefined();
    expect(typeof event.timestamp).toBe('string');
  });

  it('creates a valid ISO timestamp', () => {
    const event = createEvent('test', 'system', 'test', {});
    const parsed = new Date(event.timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });
});

// ============================================================================
// EventTypes constants
// ============================================================================

describe('EventTypes', () => {
  it('has all expected event type constants', () => {
    expect(EventTypes.AGENT_COMPLETE).toBe('agent.complete');
    expect(EventTypes.AGENT_ERROR).toBe('agent.error');
    expect(EventTypes.TOOL_REGISTERED).toBe('tool.registered');
    expect(EventTypes.TOOL_EXECUTED).toBe('tool.executed');
    expect(EventTypes.RESOURCE_CREATED).toBe('resource.created');
    expect(EventTypes.RESOURCE_UPDATED).toBe('resource.updated');
    expect(EventTypes.RESOURCE_DELETED).toBe('resource.deleted');
    expect(EventTypes.PLUGIN_STATUS).toBe('plugin.status');
    expect(EventTypes.SYSTEM_STARTUP).toBe('system.startup');
    expect(EventTypes.SYSTEM_SHUTDOWN).toBe('system.shutdown');
  });
});

// ============================================================================
// Singleton lifecycle
// ============================================================================

describe('getEventBus / resetEventBus', () => {
  beforeEach(() => {
    resetEventBus();
  });

  it('returns an EventBus instance', () => {
    const bus = getEventBus();
    expect(bus).toBeDefined();
    expect(typeof bus.emit).toBe('function');
    expect(typeof bus.on).toBe('function');
  });

  it('returns the same instance on repeated calls', () => {
    const bus1 = getEventBus();
    const bus2 = getEventBus();
    expect(bus1).toBe(bus2);
  });

  it('creates a new instance after reset', () => {
    const bus1 = getEventBus();
    resetEventBus();
    const bus2 = getEventBus();
    expect(bus1).not.toBe(bus2);
  });

  it('clears handlers on reset', () => {
    const handler = vi.fn();
    const bus = getEventBus();
    bus.on('test', handler);

    resetEventBus();

    const newBus = getEventBus();
    newBus.emit(createEvent('test', 'system', 'test', {}));

    expect(handler).not.toHaveBeenCalled();
  });
});
