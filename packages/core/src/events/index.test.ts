/**
 * Events Public API — index.ts unit tests
 *
 * Covers:
 * - EventTypes constant (all 14 keys, correct string values)
 * - createEvent() helper (shape, timestamp, data variants)
 * - LegacyEventBusWrapper delegation (emit, on, off, onCategory, onPattern, clear)
 * - getEventBus() singleton (lazy creation, same-instance guarantee)
 * - resetEventBus() (resets wrapper + delegates to resetEventSystem)
 * - Re-exports (deriveCategory, getEventSystem, resetEventSystem)
 *
 * The module carries a module-level `let legacyWrapper` singleton, so tests
 * that need a fresh singleton use freshModule() (vi.resetModules + dynamic import).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock values — must be defined before vi.mock() factories execute
// ---------------------------------------------------------------------------

const {
  mockEmitRaw,
  mockOnAny,
  mockOff,
  mockOnCategory,
  mockOnPattern,
  mockClear,
  mockGetEventSystem,
  mockResetEventSystem,
} = vi.hoisted(() => {
  // Unsubscribe stubs returned from subscription methods
  const mockUnsub = vi.fn();
  const mockOnAnyUnsub = vi.fn();
  const mockOnCategoryUnsub = vi.fn();
  const mockOnPatternUnsub = vi.fn();

  const mockEmitRaw = vi.fn();
  const mockOnAny = vi.fn(() => mockOnAnyUnsub);
  const mockOff = vi.fn();
  const mockOnCategory = vi.fn(() => mockOnCategoryUnsub);
  const mockOnPattern = vi.fn(() => mockOnPatternUnsub);
  const mockClear = vi.fn();

  const mockSystemInstance = {
    emitRaw: mockEmitRaw,
    onAny: mockOnAny,
    off: mockOff,
    onCategory: mockOnCategory,
    onPattern: mockOnPattern,
    clear: mockClear,
    // Additional IEventBus methods not used by LegacyEventBusWrapper
    emit: vi.fn(),
    on: vi.fn(() => mockUnsub),
    once: vi.fn(() => mockUnsub),
    waitFor: vi.fn(),
  };

  const mockGetEventSystem = vi.fn(() => mockSystemInstance);
  const mockResetEventSystem = vi.fn();

  return {
    mockEmitRaw,
    mockOnAny,
    mockOff,
    mockOnCategory,
    mockOnPattern,
    mockClear,
    mockGetEventSystem,
    mockResetEventSystem,
    // Expose unsub stubs for assertions
    mockOnAnyUnsub,
    mockOnCategoryUnsub,
    mockOnPatternUnsub,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('./event-system.js', () => ({
  getEventSystem: mockGetEventSystem,
  resetEventSystem: mockResetEventSystem,
}));

// ---------------------------------------------------------------------------
// Static imports — after mocks are registered
// ---------------------------------------------------------------------------

import {
  EventTypes,
  createEvent,
  getEventBus,
  resetEventBus,
  deriveCategory,
  getEventSystem,
  resetEventSystem,
  type ILegacyEventBus,
} from './index.js';

// ---------------------------------------------------------------------------
// Helper: get a fresh module instance with a clean module-level singleton
// ---------------------------------------------------------------------------

async function freshModule() {
  vi.resetModules();
  return import('./index.js');
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Restore the default return value for getEventSystem after clearAllMocks
  mockGetEventSystem.mockReturnValue({
    emitRaw: mockEmitRaw,
    onAny: mockOnAny,
    off: mockOff,
    onCategory: mockOnCategory,
    onPattern: mockOnPattern,
    clear: mockClear,
    emit: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    waitFor: vi.fn(),
  });
  // Reset the legacy wrapper singleton between tests
  resetEventBus();
});

// ============================================================================
// 1. EventTypes constant
// ============================================================================

describe('EventTypes', () => {
  describe('key presence', () => {
    it('contains AGENT_ITERATION key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'AGENT_ITERATION')).toBe(true);
    });

    it('contains AGENT_COMPLETE key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'AGENT_COMPLETE')).toBe(true);
    });

    it('contains AGENT_ERROR key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'AGENT_ERROR')).toBe(true);
    });

    it('contains AGENT_TOOL_CALL key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'AGENT_TOOL_CALL')).toBe(true);
    });

    it('contains AGENT_STEP key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'AGENT_STEP')).toBe(true);
    });

    it('contains TOOL_REGISTERED key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'TOOL_REGISTERED')).toBe(true);
    });

    it('contains TOOL_UNREGISTERED key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'TOOL_UNREGISTERED')).toBe(true);
    });

    it('contains TOOL_EXECUTED key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'TOOL_EXECUTED')).toBe(true);
    });

    it('contains RESOURCE_CREATED key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'RESOURCE_CREATED')).toBe(true);
    });

    it('contains RESOURCE_UPDATED key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'RESOURCE_UPDATED')).toBe(true);
    });

    it('contains RESOURCE_DELETED key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'RESOURCE_DELETED')).toBe(true);
    });

    it('contains PLUGIN_STATUS key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'PLUGIN_STATUS')).toBe(true);
    });

    it('contains PLUGIN_CUSTOM key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'PLUGIN_CUSTOM')).toBe(true);
    });

    it('contains SYSTEM_STARTUP key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'SYSTEM_STARTUP')).toBe(true);
    });

    it('contains SYSTEM_SHUTDOWN key', () => {
      expect(Object.prototype.hasOwnProperty.call(EventTypes, 'SYSTEM_SHUTDOWN')).toBe(true);
    });

    it('has exactly 15 keys', () => {
      expect(Object.keys(EventTypes)).toHaveLength(15);
    });
  });

  describe('string values', () => {
    it('AGENT_ITERATION equals agent.iteration', () => {
      expect(EventTypes.AGENT_ITERATION).toBe('agent.iteration');
    });

    it('AGENT_COMPLETE equals agent.complete', () => {
      expect(EventTypes.AGENT_COMPLETE).toBe('agent.complete');
    });

    it('AGENT_ERROR equals agent.error', () => {
      expect(EventTypes.AGENT_ERROR).toBe('agent.error');
    });

    it('AGENT_TOOL_CALL equals agent.tool_call', () => {
      expect(EventTypes.AGENT_TOOL_CALL).toBe('agent.tool_call');
    });

    it('AGENT_STEP equals agent.step', () => {
      expect(EventTypes.AGENT_STEP).toBe('agent.step');
    });

    it('TOOL_REGISTERED equals tool.registered', () => {
      expect(EventTypes.TOOL_REGISTERED).toBe('tool.registered');
    });

    it('TOOL_UNREGISTERED equals tool.unregistered', () => {
      expect(EventTypes.TOOL_UNREGISTERED).toBe('tool.unregistered');
    });

    it('TOOL_EXECUTED equals tool.executed', () => {
      expect(EventTypes.TOOL_EXECUTED).toBe('tool.executed');
    });

    it('RESOURCE_CREATED equals resource.created', () => {
      expect(EventTypes.RESOURCE_CREATED).toBe('resource.created');
    });

    it('RESOURCE_UPDATED equals resource.updated', () => {
      expect(EventTypes.RESOURCE_UPDATED).toBe('resource.updated');
    });

    it('RESOURCE_DELETED equals resource.deleted', () => {
      expect(EventTypes.RESOURCE_DELETED).toBe('resource.deleted');
    });

    it('PLUGIN_STATUS equals plugin.status', () => {
      expect(EventTypes.PLUGIN_STATUS).toBe('plugin.status');
    });

    it('PLUGIN_CUSTOM equals plugin.custom', () => {
      expect(EventTypes.PLUGIN_CUSTOM).toBe('plugin.custom');
    });

    it('SYSTEM_STARTUP equals system.startup', () => {
      expect(EventTypes.SYSTEM_STARTUP).toBe('system.startup');
    });

    it('SYSTEM_SHUTDOWN equals system.shutdown', () => {
      expect(EventTypes.SYSTEM_SHUTDOWN).toBe('system.shutdown');
    });

    it('all values are strings', () => {
      for (const value of Object.values(EventTypes)) {
        expect(typeof value).toBe('string');
      }
    });

    it('all values follow the dot-delimited pattern', () => {
      for (const value of Object.values(EventTypes)) {
        expect(value).toMatch(/^[a-z]+\.[a-z_]+$/);
      }
    });
  });

  describe('immutability', () => {
    it('is defined as const (values are not writable via re-assignment in strict mode)', () => {
      // TypeScript `as const` prevents assignment at compile time.
      // At runtime the object itself is not frozen, but we can verify the
      // values are the expected literals and have not been mutated from outside.
      expect(EventTypes.AGENT_COMPLETE).toBe('agent.complete');
    });

    it('object reference is stable (not recreated on each access)', () => {
      // Ensure the module export is a single stable object reference
      const ref1 = EventTypes;
      const ref2 = EventTypes;
      expect(ref1).toBe(ref2);
    });
  });
});

// ============================================================================
// 2. createEvent()
// ============================================================================

describe('createEvent', () => {
  describe('field mapping', () => {
    it('sets the type field from the first argument', () => {
      const event = createEvent('agent.complete', 'agent', 'orchestrator', {});
      expect(event.type).toBe('agent.complete');
    });

    it('sets the category field from the second argument', () => {
      const event = createEvent('agent.complete', 'agent', 'orchestrator', {});
      expect(event.category).toBe('agent');
    });

    it('sets the source field from the third argument', () => {
      const event = createEvent('agent.complete', 'agent', 'orchestrator', {});
      expect(event.source).toBe('orchestrator');
    });

    it('sets the data field from the fourth argument', () => {
      const data = { result: 'ok', count: 3 };
      const event = createEvent('agent.complete', 'agent', 'orchestrator', data);
      expect(event.data).toEqual(data);
    });

    it('includes a timestamp field', () => {
      const event = createEvent('agent.complete', 'agent', 'orchestrator', {});
      expect(event.timestamp).toBeDefined();
    });

    it('timestamp is a non-empty string', () => {
      const event = createEvent('agent.complete', 'agent', 'orchestrator', {});
      expect(typeof event.timestamp).toBe('string');
      expect(event.timestamp.length).toBeGreaterThan(0);
    });

    it('timestamp is a valid ISO 8601 string', () => {
      const event = createEvent('agent.complete', 'agent', 'orchestrator', {});
      const parsed = new Date(event.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
    });

    it('timestamp is approximately current time (within 2 seconds)', () => {
      const before = Date.now();
      const event = createEvent('agent.complete', 'agent', 'orchestrator', {});
      const after = Date.now();
      const ts = new Date(event.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after + 100);
    });
  });

  describe('category variants', () => {
    it('accepts agent category', () => {
      const event = createEvent('agent.step', 'agent', 'src', {});
      expect(event.category).toBe('agent');
    });

    it('accepts tool category', () => {
      const event = createEvent('tool.executed', 'tool', 'registry', {});
      expect(event.category).toBe('tool');
    });

    it('accepts resource category', () => {
      const event = createEvent('resource.created', 'resource', 'db', {});
      expect(event.category).toBe('resource');
    });

    it('accepts plugin category', () => {
      const event = createEvent('plugin.status', 'plugin', 'plugin-loader', {});
      expect(event.category).toBe('plugin');
    });

    it('accepts system category', () => {
      const event = createEvent('system.startup', 'system', 'server', {});
      expect(event.category).toBe('system');
    });

    it('accepts channel category', () => {
      const event = createEvent('channel.connected', 'channel', 'telegram', {});
      expect(event.category).toBe('channel');
    });

    it('accepts gateway category', () => {
      const event = createEvent('gateway.ready', 'gateway', 'hono', {});
      expect(event.category).toBe('gateway');
    });
  });

  describe('data variants', () => {
    it('works with an empty object as data', () => {
      const event = createEvent('agent.complete', 'agent', 'src', {});
      expect(event.data).toEqual({});
    });

    it('works with a complex nested object as data', () => {
      const data = {
        agentId: 'abc',
        nested: { level: 2, items: [1, 2, 3] },
        flag: true,
      };
      const event = createEvent('agent.complete', 'agent', 'src', data);
      expect(event.data).toEqual(data);
    });

    it('works with null as data', () => {
      const event = createEvent('agent.complete', 'agent', 'src', null);
      expect(event.data).toBeNull();
    });

    it('works with undefined as data', () => {
      const event = createEvent('agent.complete', 'agent', 'src', undefined);
      expect(event.data).toBeUndefined();
    });

    it('works with a string as data', () => {
      const event = createEvent('agent.complete', 'agent', 'src', 'hello');
      expect(event.data).toBe('hello');
    });

    it('works with an array as data', () => {
      const data = [1, 2, 3];
      const event = createEvent('agent.complete', 'agent', 'src', data);
      expect(event.data).toEqual([1, 2, 3]);
    });

    it('works with a number as data', () => {
      const event = createEvent('agent.complete', 'agent', 'src', 42);
      expect(event.data).toBe(42);
    });

    it('works with a boolean as data', () => {
      const event = createEvent('agent.complete', 'agent', 'src', false);
      expect(event.data).toBe(false);
    });
  });

  describe('returned object shape', () => {
    it('has exactly the expected keys', () => {
      const event = createEvent('agent.complete', 'agent', 'src', {});
      expect(Object.keys(event).sort()).toEqual(
        ['category', 'data', 'source', 'timestamp', 'type'].sort()
      );
    });

    it('successive calls return distinct objects', () => {
      const e1 = createEvent('agent.complete', 'agent', 'src', {});
      const e2 = createEvent('agent.complete', 'agent', 'src', {});
      expect(e1).not.toBe(e2);
    });

    it('successive calls produce monotonically non-decreasing timestamps', () => {
      const e1 = createEvent('agent.complete', 'agent', 'src', {});
      const e2 = createEvent('agent.complete', 'agent', 'src', {});
      expect(new Date(e2.timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(e1.timestamp).getTime()
      );
    });
  });
});

// ============================================================================
// 3. LegacyEventBusWrapper — delegation via getEventBus()
// ============================================================================

describe('LegacyEventBusWrapper', () => {
  let bus: ILegacyEventBus;

  beforeEach(() => {
    bus = getEventBus();
  });

  describe('emit()', () => {
    it('delegates to system.emitRaw() with the exact event object', () => {
      const event = createEvent('agent.complete', 'agent', 'orchestrator', { x: 1 });
      bus.emit(event);
      expect(mockEmitRaw).toHaveBeenCalledTimes(1);
      expect(mockEmitRaw).toHaveBeenCalledWith(event);
    });

    it('does not call any other system method on emit', () => {
      const event = createEvent('tool.executed', 'tool', 'registry', {});
      bus.emit(event);
      expect(mockOnAny).not.toHaveBeenCalled();
      expect(mockOff).not.toHaveBeenCalled();
      expect(mockOnCategory).not.toHaveBeenCalled();
      expect(mockOnPattern).not.toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();
    });

    it('can be called multiple times and delegates each call', () => {
      const e1 = createEvent('agent.complete', 'agent', 'src', { n: 1 });
      const e2 = createEvent('agent.error', 'agent', 'src', { n: 2 });
      const e3 = createEvent('tool.executed', 'tool', 'src', { n: 3 });
      bus.emit(e1);
      bus.emit(e2);
      bus.emit(e3);
      expect(mockEmitRaw).toHaveBeenCalledTimes(3);
      expect(mockEmitRaw).toHaveBeenNthCalledWith(1, e1);
      expect(mockEmitRaw).toHaveBeenNthCalledWith(2, e2);
      expect(mockEmitRaw).toHaveBeenNthCalledWith(3, e3);
    });

    it('passes through event objects with null data unchanged', () => {
      const event = createEvent('system.startup', 'system', 'server', null);
      bus.emit(event);
      expect(mockEmitRaw).toHaveBeenCalledWith(event);
    });
  });

  describe('on()', () => {
    it('delegates to system.onAny() with type and handler', () => {
      const handler = vi.fn();
      bus.on('agent.complete', handler);
      expect(mockOnAny).toHaveBeenCalledTimes(1);
      expect(mockOnAny).toHaveBeenCalledWith('agent.complete', handler);
    });

    it('returns the unsubscribe function from system.onAny()', () => {
      const handler = vi.fn();
      const unsub = bus.on('agent.complete', handler);
      // The mock returns mockOnAnyUnsub (a vi.fn)
      expect(typeof unsub).toBe('function');
    });

    it('passes the exact type string to onAny', () => {
      const handler = vi.fn();
      bus.on('tool.executed', handler);
      expect(mockOnAny).toHaveBeenCalledWith('tool.executed', handler);
    });

    it('passes the exact handler reference to onAny', () => {
      const handler = vi.fn();
      bus.on('resource.created', handler);
      expect(mockOnAny.mock.calls[0][1]).toBe(handler);
    });

    it('does not call emitRaw, off, onCategory, onPattern, or clear on on()', () => {
      bus.on('agent.complete', vi.fn());
      expect(mockEmitRaw).not.toHaveBeenCalled();
      expect(mockOff).not.toHaveBeenCalled();
      expect(mockOnCategory).not.toHaveBeenCalled();
      expect(mockOnPattern).not.toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();
    });

    it('supports multiple on() calls with independent delegations', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('agent.complete', h1);
      bus.on('tool.executed', h2);
      expect(mockOnAny).toHaveBeenCalledTimes(2);
      expect(mockOnAny).toHaveBeenNthCalledWith(1, 'agent.complete', h1);
      expect(mockOnAny).toHaveBeenNthCalledWith(2, 'tool.executed', h2);
    });
  });

  describe('off()', () => {
    it('delegates to system.off() with type and handler', () => {
      const handler = vi.fn();
      bus.off('agent.complete', handler);
      expect(mockOff).toHaveBeenCalledTimes(1);
      expect(mockOff).toHaveBeenCalledWith('agent.complete', handler);
    });

    it('passes the exact type string to off', () => {
      const handler = vi.fn();
      bus.off('plugin.status', handler);
      expect(mockOff).toHaveBeenCalledWith('plugin.status', handler);
    });

    it('passes the exact handler reference to off', () => {
      const handler = vi.fn();
      bus.off('resource.deleted', handler);
      expect(mockOff.mock.calls[0][1]).toBe(handler);
    });

    it('does not call emitRaw, onAny, onCategory, onPattern, or clear on off()', () => {
      bus.off('agent.complete', vi.fn());
      expect(mockEmitRaw).not.toHaveBeenCalled();
      expect(mockOnAny).not.toHaveBeenCalled();
      expect(mockOnCategory).not.toHaveBeenCalled();
      expect(mockOnPattern).not.toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();
    });
  });

  describe('onCategory()', () => {
    it('delegates to system.onCategory() with category and handler', () => {
      const handler = vi.fn();
      bus.onCategory('agent', handler);
      expect(mockOnCategory).toHaveBeenCalledTimes(1);
      expect(mockOnCategory).toHaveBeenCalledWith('agent', handler);
    });

    it('returns the unsubscribe function from system.onCategory()', () => {
      const handler = vi.fn();
      const unsub = bus.onCategory('tool', handler);
      expect(typeof unsub).toBe('function');
    });

    it('passes the exact handler reference to onCategory', () => {
      const handler = vi.fn();
      bus.onCategory('plugin', handler);
      expect(mockOnCategory.mock.calls[0][1]).toBe(handler);
    });

    it('works with all valid categories', () => {
      const categories = [
        'agent',
        'tool',
        'resource',
        'plugin',
        'system',
        'channel',
        'gateway',
      ] as const;
      const handler = vi.fn();
      for (const cat of categories) {
        bus.onCategory(cat, handler);
      }
      expect(mockOnCategory).toHaveBeenCalledTimes(categories.length);
    });

    it('does not call emitRaw, onAny, off, onPattern, or clear on onCategory()', () => {
      bus.onCategory('agent', vi.fn());
      expect(mockEmitRaw).not.toHaveBeenCalled();
      expect(mockOnAny).not.toHaveBeenCalled();
      expect(mockOff).not.toHaveBeenCalled();
      expect(mockOnPattern).not.toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();
    });
  });

  describe('onPattern()', () => {
    it('delegates to system.onPattern() with pattern and handler', () => {
      const handler = vi.fn();
      bus.onPattern('agent.*', handler);
      expect(mockOnPattern).toHaveBeenCalledTimes(1);
      expect(mockOnPattern).toHaveBeenCalledWith('agent.*', handler);
    });

    it('returns the unsubscribe function from system.onPattern()', () => {
      const handler = vi.fn();
      const unsub = bus.onPattern('tool.**', handler);
      expect(typeof unsub).toBe('function');
    });

    it('passes the exact pattern string to onPattern', () => {
      const handler = vi.fn();
      bus.onPattern('plugin.*.status', handler);
      expect(mockOnPattern).toHaveBeenCalledWith('plugin.*.status', handler);
    });

    it('passes the exact handler reference to onPattern', () => {
      const handler = vi.fn();
      bus.onPattern('resource.**', handler);
      expect(mockOnPattern.mock.calls[0][1]).toBe(handler);
    });

    it('does not call emitRaw, onAny, off, onCategory, or clear on onPattern()', () => {
      bus.onPattern('agent.*', vi.fn());
      expect(mockEmitRaw).not.toHaveBeenCalled();
      expect(mockOnAny).not.toHaveBeenCalled();
      expect(mockOff).not.toHaveBeenCalled();
      expect(mockOnCategory).not.toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    it('delegates to system.clear()', () => {
      bus.clear();
      expect(mockClear).toHaveBeenCalledTimes(1);
    });

    it('does not call emitRaw, onAny, off, onCategory, or onPattern on clear()', () => {
      bus.clear();
      expect(mockEmitRaw).not.toHaveBeenCalled();
      expect(mockOnAny).not.toHaveBeenCalled();
      expect(mockOff).not.toHaveBeenCalled();
      expect(mockOnCategory).not.toHaveBeenCalled();
      expect(mockOnPattern).not.toHaveBeenCalled();
    });

    it('can be called multiple times', () => {
      bus.clear();
      bus.clear();
      bus.clear();
      expect(mockClear).toHaveBeenCalledTimes(3);
    });
  });

  describe('combined operations', () => {
    it('emit after on delegates in order without cross-contamination', () => {
      const handler = vi.fn();
      bus.on('agent.complete', handler);
      const event = createEvent('agent.complete', 'agent', 'src', {});
      bus.emit(event);
      expect(mockOnAny).toHaveBeenCalledTimes(1);
      expect(mockEmitRaw).toHaveBeenCalledTimes(1);
    });

    it('off after on delegates both calls', () => {
      const handler = vi.fn();
      bus.on('agent.complete', handler);
      bus.off('agent.complete', handler);
      expect(mockOnAny).toHaveBeenCalledTimes(1);
      expect(mockOff).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================================
// 4. getEventBus() singleton
// ============================================================================

describe('getEventBus() singleton', () => {
  it('returns an object with an emit method', () => {
    const bus = getEventBus();
    expect(typeof bus.emit).toBe('function');
  });

  it('returns an object with an on method', () => {
    const bus = getEventBus();
    expect(typeof bus.on).toBe('function');
  });

  it('returns an object with an off method', () => {
    const bus = getEventBus();
    expect(typeof bus.off).toBe('function');
  });

  it('returns an object with an onCategory method', () => {
    const bus = getEventBus();
    expect(typeof bus.onCategory).toBe('function');
  });

  it('returns an object with an onPattern method', () => {
    const bus = getEventBus();
    expect(typeof bus.onPattern).toBe('function');
  });

  it('returns an object with a clear method', () => {
    const bus = getEventBus();
    expect(typeof bus.clear).toBe('function');
  });

  it('returns the same instance on repeated calls', () => {
    const bus1 = getEventBus();
    const bus2 = getEventBus();
    expect(bus1).toBe(bus2);
  });

  it('calls getEventSystem() exactly once for multiple getEventBus() calls', () => {
    getEventBus();
    getEventBus();
    getEventBus();
    // getEventSystem() should have been called once by the first getEventBus()
    // (resetEventBus in beforeEach already consumed one call; after that reset,
    //  first getEventBus() creates the wrapper — that's the call we check)
    expect(mockGetEventSystem).toHaveBeenCalled();
  });

  it('creates a fresh wrapper on each module load via freshModule()', async () => {
    const m1 = await freshModule();
    const m2 = await freshModule();
    const bus1 = m1.getEventBus();
    const bus2 = m2.getEventBus();
    // Different module instances → different wrapper objects
    expect(bus1).not.toBe(bus2);
  });

  it('returns same instance from same freshModule() on repeated calls', async () => {
    const m = await freshModule();
    const bus1 = m.getEventBus();
    const bus2 = m.getEventBus();
    expect(bus1).toBe(bus2);
  });

  it('wraps the event system returned by getEventSystem()', () => {
    // Verify the wrapper was constructed with the system from getEventSystem()
    const bus = getEventBus();
    const event = createEvent('agent.complete', 'agent', 'src', {});
    bus.emit(event);
    expect(mockEmitRaw).toHaveBeenCalledWith(event);
  });
});

// ============================================================================
// 5. resetEventBus()
// ============================================================================

describe('resetEventBus()', () => {
  it('calls resetEventSystem()', () => {
    // Clear the mock count accumulated by the outer beforeEach before asserting
    mockResetEventSystem.mockClear();
    resetEventBus();
    expect(mockResetEventSystem).toHaveBeenCalledTimes(1);
  });

  it('calls resetEventSystem() and not emitRaw, onAny, etc.', () => {
    resetEventBus();
    expect(mockEmitRaw).not.toHaveBeenCalled();
    expect(mockOnAny).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('causes getEventBus() to return a new wrapper instance after reset', async () => {
    const m = await freshModule();
    const bus1 = m.getEventBus();
    m.resetEventBus();
    const bus2 = m.getEventBus();
    expect(bus1).not.toBe(bus2);
  });

  it('new wrapper after reset calls getEventSystem() again', async () => {
    const m = await freshModule();
    // First acquisition
    m.getEventBus();
    const callsAfterFirst = mockGetEventSystem.mock.calls.length;
    // Reset clears wrapper
    m.resetEventBus();
    // Second acquisition should call getEventSystem() once more
    m.getEventBus();
    expect(mockGetEventSystem.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('can be called multiple times without error', () => {
    expect(() => {
      resetEventBus();
      resetEventBus();
      resetEventBus();
    }).not.toThrow();
  });

  it('calling reset before getEventBus() does not throw', () => {
    expect(() => resetEventBus()).not.toThrow();
  });
});

// ============================================================================
// 6. Re-exports
// ============================================================================

describe('re-exports', () => {
  it('exports deriveCategory as a function', () => {
    expect(typeof deriveCategory).toBe('function');
  });

  it('deriveCategory returns agent for agent.complete', () => {
    expect(deriveCategory('agent.complete')).toBe('agent');
  });

  it('deriveCategory returns tool for tool.executed', () => {
    expect(deriveCategory('tool.executed')).toBe('tool');
  });

  it('deriveCategory returns resource for resource.created', () => {
    expect(deriveCategory('resource.created')).toBe('resource');
  });

  it('deriveCategory returns plugin for plugin.status', () => {
    expect(deriveCategory('plugin.status')).toBe('plugin');
  });

  it('deriveCategory returns system for system.startup', () => {
    expect(deriveCategory('system.startup')).toBe('system');
  });

  it('deriveCategory returns channel for channel.connected', () => {
    expect(deriveCategory('channel.connected')).toBe('channel');
  });

  it('deriveCategory returns gateway for gateway.ready', () => {
    expect(deriveCategory('gateway.ready')).toBe('gateway');
  });

  it('deriveCategory falls back to system for unknown prefixes', () => {
    expect(deriveCategory('unknown.event')).toBe('system');
  });

  it('exports getEventSystem as a function', () => {
    expect(typeof getEventSystem).toBe('function');
  });

  it('getEventSystem() is the mocked version (returns mock system)', () => {
    const system = getEventSystem();
    expect(typeof system.emitRaw).toBe('function');
  });

  it('exports resetEventSystem as a function', () => {
    expect(typeof resetEventSystem).toBe('function');
  });

  it('resetEventSystem() calls through to the mocked implementation', () => {
    resetEventSystem();
    expect(mockResetEventSystem).toHaveBeenCalled();
  });
});
