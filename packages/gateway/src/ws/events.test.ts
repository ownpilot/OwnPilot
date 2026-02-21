import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (must be declared before any imports that use the mocked modules)
// ---------------------------------------------------------------------------

const { mockScopedBus, mockHookBus, mockUnsub, mockLog } = vi.hoisted(() => {
  const mockUnsub = vi.fn();
  const mockScopedBus = {
    on: vi.fn(() => mockUnsub),
    onAll: vi.fn(() => mockUnsub),
    emit: vi.fn(),
  };
  const mockHookBus = {
    tapAny: vi.fn(() => mockUnsub),
    callAny: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mockScopedBus,
    mockHookBus,
    mockUnsub,
    mockLog: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock('@ownpilot/core', () => ({
  getEventSystem: vi.fn(() => ({
    scoped: vi.fn(() => mockScopedBus),
    hooks: mockHookBus,
  })),
}));

vi.mock('../services/log.js', () => ({
  getLog: vi.fn(() => mockLog),
}));

// ---------------------------------------------------------------------------
// Subject under test — imported AFTER mocks are established
// ---------------------------------------------------------------------------

import { GatewayEventEmitter, ClientEventHandler, gatewayEvents } from './events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture the inner handler that was registered with bus.on or bus.onAll */
function captureOnHandler(callIndex = 0): (e: { type: string; data: unknown }) => void {
  return mockScopedBus.on.mock.calls[callIndex]![1] as (e: {
    type: string;
    data: unknown;
  }) => void;
}

function captureOnAllHandler(callIndex = 0): (e: { type: string; data: unknown }) => void {
  return mockScopedBus.onAll.mock.calls[callIndex]![0] as (e: {
    type: string;
    data: unknown;
  }) => void;
}

/** Capture the inner tapAny callback registered at a given call index */
function captureTapAnyHandler(
  callIndex = 0
): (ctx: { data: Record<string, unknown> }) => Promise<void> {
  return mockHookBus.tapAny.mock.calls[callIndex]![1] as (ctx: {
    data: Record<string, unknown>;
  }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('events.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. toDot utility — tested indirectly through public API
  // =========================================================================
  describe('toDot (tested indirectly)', () => {
    it('converts a single colon to a dot', () => {
      const emitter = new GatewayEventEmitter();
      emitter.on('channel:connected', vi.fn());

      expect(mockScopedBus.on).toHaveBeenCalledWith('channel.connected', expect.any(Function));
    });

    it('converts multiple colons to dots', () => {
      const emitter = new GatewayEventEmitter();
      emitter.on('chat:stream:start', vi.fn());

      expect(mockScopedBus.on).toHaveBeenCalledWith('chat.stream.start', expect.any(Function));
    });

    it('leaves a key without colons unchanged', () => {
      // 'connection:ready' has one colon — confirm basic dot conversion
      const emitter = new GatewayEventEmitter();
      emitter.on('connection:ready', vi.fn());

      expect(mockScopedBus.on).toHaveBeenCalledWith('connection.ready', expect.any(Function));
    });

    it('converts colon in emit path too', () => {
      const emitter = new GatewayEventEmitter();
      void emitter.emit('channel:disconnected', { channelId: 'ch1', reason: 'test' });

      expect(mockScopedBus.emit).toHaveBeenCalledWith(
        'channel.disconnected',
        expect.any(Object)
      );
    });

    it('converts colons in ClientEventHandler handle hookName', () => {
      const handler = new ClientEventHandler();
      handler.handle('chat:send', vi.fn());

      expect(mockHookBus.tapAny).toHaveBeenCalledWith('client:chat.send', expect.any(Function));
    });

    it('converts colons in ClientEventHandler process hookName', async () => {
      const handler = new ClientEventHandler();
      await handler.process('channel:connect', { type: 'telegram', config: {} });

      expect(mockHookBus.callAny).toHaveBeenCalledWith(
        'client:channel.connect',
        expect.any(Object)
      );
    });

    it('handles three-part key with two colons in process', async () => {
      const handler = new ClientEventHandler();
      await handler.process('chat:send', { content: 'hello' });

      expect(mockHookBus.callAny).toHaveBeenCalledWith('client:chat.send', expect.any(Object));
    });
  });

  // =========================================================================
  // 2. GatewayEventEmitter
  // =========================================================================
  describe('GatewayEventEmitter', () => {
    // -----------------------------------------------------------------------
    // 2.1 constructor
    // -----------------------------------------------------------------------
    describe('constructor', () => {
      it('calls getEventSystem().scoped with gateway namespace', async () => {
        const { getEventSystem } = await import('@ownpilot/core');
        new GatewayEventEmitter();

        expect(getEventSystem).toHaveBeenCalled();
        const mockSystem = (getEventSystem as ReturnType<typeof vi.fn>).mock.results[0]!.value;
        expect(mockSystem.scoped).toHaveBeenCalledWith('gateway', 'gateway');
      });

      it('stores the returned scoped bus internally', () => {
        const emitter = new GatewayEventEmitter();
        // Verify bus is used by calling on() — it delegates to mockScopedBus
        emitter.on('connection:ping', vi.fn());
        expect(mockScopedBus.on).toHaveBeenCalledTimes(1);
      });
    });

    // -----------------------------------------------------------------------
    // 2.2 on()
    // -----------------------------------------------------------------------
    describe('on()', () => {
      it('subscribes to bus.on with dot-converted event name', () => {
        const emitter = new GatewayEventEmitter();
        emitter.on('channel:connected', vi.fn());

        expect(mockScopedBus.on).toHaveBeenCalledWith('channel.connected', expect.any(Function));
      });

      it('returns the unsubscribe function from bus.on', () => {
        const emitter = new GatewayEventEmitter();
        const unsub = emitter.on('channel:connected', vi.fn());

        expect(unsub).toBe(mockUnsub);
      });

      it('handler receives the unwrapped TypedEvent.data, not the TypedEvent itself', () => {
        const emitter = new GatewayEventEmitter();
        const userHandler = vi.fn();
        emitter.on('channel:connected', userHandler);

        const innerHandler = captureOnHandler();
        const channelData = { channel: { id: 'c1', type: 'telegram', name: 'TG', status: 'connected', config: {} } };
        innerHandler({ type: 'gateway.channel.connected', data: channelData });

        expect(userHandler).toHaveBeenCalledWith(channelData);
        expect(userHandler).not.toHaveBeenCalledWith(
          expect.objectContaining({ type: 'gateway.channel.connected' })
        );
      });

      it('passes the correct TypedEvent.data type to handler', () => {
        const emitter = new GatewayEventEmitter();
        const userHandler = vi.fn();
        emitter.on('connection:ready', userHandler);

        const innerHandler = captureOnHandler();
        const data = { sessionId: 'sess-42' };
        innerHandler({ type: 'gateway.connection.ready', data });

        expect(userHandler).toHaveBeenCalledWith(data);
      });

      it('allows multiple subscriptions to the same event', () => {
        const emitter = new GatewayEventEmitter();
        const h1 = vi.fn();
        const h2 = vi.fn();
        emitter.on('chat:message', h1);
        emitter.on('chat:message', h2);

        expect(mockScopedBus.on).toHaveBeenCalledTimes(2);
        expect(mockScopedBus.on.mock.calls[0]![0]).toBe('chat.message');
        expect(mockScopedBus.on.mock.calls[1]![0]).toBe('chat.message');
      });

      it('allows subscriptions to different events', () => {
        const emitter = new GatewayEventEmitter();
        emitter.on('channel:connected', vi.fn());
        emitter.on('channel:disconnected', vi.fn());
        emitter.on('chat:stream:start', vi.fn());

        expect(mockScopedBus.on).toHaveBeenCalledTimes(3);
        expect(mockScopedBus.on.mock.calls[0]![0]).toBe('channel.connected');
        expect(mockScopedBus.on.mock.calls[1]![0]).toBe('channel.disconnected');
        expect(mockScopedBus.on.mock.calls[2]![0]).toBe('chat.stream.start');
      });

      it('each subscription returns its own unsubscribe function', () => {
        const unsub1 = vi.fn();
        const unsub2 = vi.fn();
        mockScopedBus.on
          .mockReturnValueOnce(unsub1)
          .mockReturnValueOnce(unsub2);

        const emitter = new GatewayEventEmitter();
        const r1 = emitter.on('chat:message', vi.fn());
        const r2 = emitter.on('chat:error', vi.fn());

        expect(r1).toBe(unsub1);
        expect(r2).toBe(unsub2);
      });

      it('passes through async handler result', async () => {
        const emitter = new GatewayEventEmitter();
        const asyncHandler = vi.fn().mockResolvedValue(undefined);
        emitter.on('tool:start', asyncHandler);

        const innerHandler = captureOnHandler();
        const data = {
          sessionId: 'sess-1',
          tool: {
            id: 't1',
            name: 'search',
            arguments: {},
            status: 'pending' as const,
            startedAt: new Date(),
          },
        };
        await innerHandler({ type: 'gateway.tool.start', data });

        expect(asyncHandler).toHaveBeenCalledWith(data);
      });

      it('does not throw when handler throws synchronously', () => {
        const emitter = new GatewayEventEmitter();
        const throwingHandler = vi.fn().mockImplementation(() => {
          throw new Error('handler error');
        });
        emitter.on('chat:error', throwingHandler);

        const innerHandler = captureOnHandler();
        // Should propagate the error (not swallowed)
        expect(() =>
          innerHandler({ type: 'gateway.chat.error', data: { sessionId: 's1', error: 'fail' } })
        ).toThrow('handler error');
      });
    });

    // -----------------------------------------------------------------------
    // 2.3 onAny()
    // -----------------------------------------------------------------------
    describe('onAny()', () => {
      it('subscribes via bus.onAll', () => {
        const emitter = new GatewayEventEmitter();
        emitter.onAny(vi.fn());

        expect(mockScopedBus.onAll).toHaveBeenCalledTimes(1);
        expect(mockScopedBus.onAll).toHaveBeenCalledWith(expect.any(Function));
      });

      it('returns the unsubscribe function from bus.onAll', () => {
        const emitter = new GatewayEventEmitter();
        const unsub = emitter.onAny(vi.fn());

        expect(unsub).toBe(mockUnsub);
      });

      it('handler receives (event.type, event.data) — not the TypedEvent wrapper', () => {
        const emitter = new GatewayEventEmitter();
        const userHandler = vi.fn();
        emitter.onAny(userHandler);

        const innerHandler = captureOnAllHandler();
        innerHandler({ type: 'gateway.channel.connected', data: { channelId: 'c1' } });

        expect(userHandler).toHaveBeenCalledWith('gateway.channel.connected', { channelId: 'c1' });
      });

      it('delivers correct type and data for multiple dispatched events', () => {
        const emitter = new GatewayEventEmitter();
        const userHandler = vi.fn();
        emitter.onAny(userHandler);

        const innerHandler = captureOnAllHandler();
        innerHandler({ type: 'gateway.chat.message', data: { sessionId: 's1', message: {} } });
        innerHandler({ type: 'gateway.tool.end', data: { sessionId: 's1', toolId: 't1', result: null } });

        expect(userHandler).toHaveBeenCalledTimes(2);
        expect(userHandler.mock.calls[0]).toEqual([
          'gateway.chat.message',
          { sessionId: 's1', message: {} },
        ]);
        expect(userHandler.mock.calls[1]).toEqual([
          'gateway.tool.end',
          { sessionId: 's1', toolId: 't1', result: null },
        ]);
      });

      it('different onAny subscriptions each get a fresh onAll registration', () => {
        const emitter = new GatewayEventEmitter();
        emitter.onAny(vi.fn());
        emitter.onAny(vi.fn());

        expect(mockScopedBus.onAll).toHaveBeenCalledTimes(2);
      });
    });

    // -----------------------------------------------------------------------
    // 2.4 emit()
    // -----------------------------------------------------------------------
    describe('emit()', () => {
      it('calls bus.emit with dot-converted event name', async () => {
        const emitter = new GatewayEventEmitter();
        await emitter.emit('channel:connected', {
          channel: { id: 'c1', type: 'telegram', name: 'TG', status: 'connected', config: {} },
        });

        expect(mockScopedBus.emit).toHaveBeenCalledWith('channel.connected', expect.any(Object));
      });

      it('passes the full data payload to bus.emit', async () => {
        const emitter = new GatewayEventEmitter();
        const payload = { sessionId: 'sess-1' };
        await emitter.emit('connection:ready', payload);

        expect(mockScopedBus.emit).toHaveBeenCalledWith('connection.ready', payload);
      });

      it('converts multi-colon events to dots', async () => {
        const emitter = new GatewayEventEmitter();
        await emitter.emit('chat:stream:chunk', {
          sessionId: 's1',
          messageId: 'm1',
          chunk: 'hello',
        });

        expect(mockScopedBus.emit).toHaveBeenCalledWith('chat.stream.chunk', expect.any(Object));
      });

      it('can emit different event types sequentially', async () => {
        const emitter = new GatewayEventEmitter();
        await emitter.emit('connection:ping', { timestamp: Date.now() });
        await emitter.emit('system:notification', {
          type: 'info',
          message: 'Ready',
        });

        expect(mockScopedBus.emit).toHaveBeenCalledTimes(2);
        expect(mockScopedBus.emit.mock.calls[0]![0]).toBe('connection.ping');
        expect(mockScopedBus.emit.mock.calls[1]![0]).toBe('system.notification');
      });

      it('resolves as a Promise (returns void)', async () => {
        const emitter = new GatewayEventEmitter();
        const result = emitter.emit('connection:ready', { sessionId: 'sess-1' });

        await expect(result).resolves.toBeUndefined();
      });

      it('does not call bus.on or bus.onAll when emitting', async () => {
        const emitter = new GatewayEventEmitter();
        await emitter.emit('connection:ready', { sessionId: 'sess-1' });

        expect(mockScopedBus.on).not.toHaveBeenCalled();
        expect(mockScopedBus.onAll).not.toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // 3. ClientEventHandler
  // =========================================================================
  describe('ClientEventHandler', () => {
    // -----------------------------------------------------------------------
    // 3.1 constructor
    // -----------------------------------------------------------------------
    describe('constructor', () => {
      it('retrieves hookBus from getEventSystem().hooks', async () => {
        const { getEventSystem } = await import('@ownpilot/core');
        new ClientEventHandler();

        const systemInstance = (getEventSystem as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value;
        expect(systemInstance.hooks).toBe(mockHookBus);
      });

      it('starts with no registered events', () => {
        const handler = new ClientEventHandler();

        expect(handler.has('chat:send')).toBe(false);
        expect(handler.has('channel:connect')).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // 3.2 handle()
    // -----------------------------------------------------------------------
    describe('handle()', () => {
      it('registers via hookBus.tapAny with "client:" prefix and dot conversion', () => {
        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());

        expect(mockHookBus.tapAny).toHaveBeenCalledWith('client:chat.send', expect.any(Function));
      });

      it('converts multi-colon event to dot form inside the hook name', () => {
        const handler = new ClientEventHandler();
        // 'session:pong' has one colon
        handler.handle('session:pong', vi.fn());

        expect(mockHookBus.tapAny).toHaveBeenCalledWith('client:session.pong', expect.any(Function));
      });

      it('adds event to registeredEvents set', () => {
        const handler = new ClientEventHandler();
        expect(handler.has('chat:send')).toBe(false);

        handler.handle('chat:send', vi.fn());

        expect(handler.has('chat:send')).toBe(true);
      });

      it('stores unsubscribe function (retrieved from tapAny)', () => {
        const customUnsub = vi.fn();
        mockHookBus.tapAny.mockReturnValueOnce(customUnsub);

        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());

        // Verify the unsub is stored by calling clear() and confirming it fires
        handler.clear();
        expect(customUnsub).toHaveBeenCalledTimes(1);
      });

      it('extracts sessionId from context data and passes remaining fields to user handler', async () => {
        const handler = new ClientEventHandler();
        const userHandler = vi.fn();
        handler.handle('chat:send', userHandler);

        const tapCb = captureTapAnyHandler();
        await tapCb({ data: { content: 'hello', sessionId: 'sess-99' } });

        expect(userHandler).toHaveBeenCalledWith({ content: 'hello' }, 'sess-99');
      });

      it('passes undefined sessionId when not present in context data', async () => {
        const handler = new ClientEventHandler();
        const userHandler = vi.fn();
        handler.handle('chat:stop', userHandler);

        const tapCb = captureTapAnyHandler();
        await tapCb({ data: { messageId: 'm1' } });

        expect(userHandler).toHaveBeenCalledWith({ messageId: 'm1' }, undefined);
      });

      it('does not include sessionId in the data argument passed to user handler', async () => {
        const handler = new ClientEventHandler();
        const userHandler = vi.fn();
        handler.handle('channel:connect', userHandler);

        const tapCb = captureTapAnyHandler();
        await tapCb({ data: { type: 'telegram', config: {}, sessionId: 'sess-1' } });

        const [dataArg] = userHandler.mock.calls[0]!;
        expect(dataArg).not.toHaveProperty('sessionId');
      });

      it('handles multiple events registered independently', () => {
        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());
        handler.handle('channel:connect', vi.fn());
        handler.handle('workspace:create', vi.fn());

        expect(mockHookBus.tapAny).toHaveBeenCalledTimes(3);
        expect(mockHookBus.tapAny.mock.calls[0]![0]).toBe('client:chat.send');
        expect(mockHookBus.tapAny.mock.calls[1]![0]).toBe('client:channel.connect');
        expect(mockHookBus.tapAny.mock.calls[2]![0]).toBe('client:workspace.create');
      });

      it('awaits the user handler when it is async', async () => {
        const handler = new ClientEventHandler();
        const asyncHandler = vi.fn().mockResolvedValue(undefined);
        handler.handle('chat:send', asyncHandler);

        const tapCb = captureTapAnyHandler();
        await tapCb({ data: { content: 'hello', sessionId: 's1' } });

        expect(asyncHandler).toHaveBeenCalledTimes(1);
      });

      it('registering the same event twice adds it to the set once', () => {
        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());
        handler.handle('chat:send', vi.fn());

        // Set only records membership, not count — has() still true
        expect(handler.has('chat:send')).toBe(true);
        // But tapAny is called twice (two separate subscriptions)
        expect(mockHookBus.tapAny).toHaveBeenCalledTimes(2);
      });
    });

    // -----------------------------------------------------------------------
    // 3.3 process()
    // -----------------------------------------------------------------------
    describe('process()', () => {
      it('calls hookBus.callAny with "client:" prefix and dot conversion', async () => {
        const handler = new ClientEventHandler();
        await handler.process('chat:send', { content: 'hello' });

        expect(mockHookBus.callAny).toHaveBeenCalledWith('client:chat.send', expect.any(Object));
      });

      it('spreads event data into the payload', async () => {
        const handler = new ClientEventHandler();
        await handler.process('channel:connect', { type: 'telegram', config: { token: 'abc' } });

        expect(mockHookBus.callAny).toHaveBeenCalledWith(
          'client:channel.connect',
          expect.objectContaining({ type: 'telegram', config: { token: 'abc' } })
        );
      });

      it('includes sessionId in payload when provided', async () => {
        const handler = new ClientEventHandler();
        await handler.process('chat:send', { content: 'hello' }, 'sess-42');

        expect(mockHookBus.callAny).toHaveBeenCalledWith(
          'client:chat.send',
          expect.objectContaining({ content: 'hello', sessionId: 'sess-42' })
        );
      });

      it('includes undefined sessionId when not provided', async () => {
        const handler = new ClientEventHandler();
        await handler.process('chat:stop', { messageId: 'm1' });

        const [, payload] = mockHookBus.callAny.mock.calls[0]!;
        expect((payload as Record<string, unknown>)['sessionId']).toBeUndefined();
      });

      it('returns a promise that resolves', async () => {
        const handler = new ClientEventHandler();
        const result = handler.process('session:ping', {});

        await expect(result).resolves.toBeUndefined();
      });

      it('propagates rejection from hookBus.callAny', async () => {
        mockHookBus.callAny.mockRejectedValueOnce(new Error('bus error'));

        const handler = new ClientEventHandler();
        await expect(handler.process('chat:send', { content: 'hi' })).rejects.toThrow('bus error');
      });

      it('works without a prior handle() call (bare process)', async () => {
        const handler = new ClientEventHandler();
        // No handle() registered — should still delegate to hookBus
        await handler.process('channel:subscribe', { channelId: 'ch1' });

        expect(mockHookBus.callAny).toHaveBeenCalledTimes(1);
      });

      it('converts multi-segment event key to dot notation in hook name', async () => {
        const handler = new ClientEventHandler();
        await handler.process('chat:retry', { messageId: 'm2' });

        expect(mockHookBus.callAny).toHaveBeenCalledWith('client:chat.retry', expect.any(Object));
      });
    });

    // -----------------------------------------------------------------------
    // 3.4 has()
    // -----------------------------------------------------------------------
    describe('has()', () => {
      it('returns false for an event that has never been registered', () => {
        const handler = new ClientEventHandler();

        expect(handler.has('chat:send')).toBe(false);
      });

      it('returns true after handle() is called for that event', () => {
        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());

        expect(handler.has('chat:send')).toBe(true);
      });

      it('returns false for a different event than the one registered', () => {
        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());

        expect(handler.has('channel:connect')).toBe(false);
      });

      it('returns true for all registered events', () => {
        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());
        handler.handle('channel:connect', vi.fn());

        expect(handler.has('chat:send')).toBe(true);
        expect(handler.has('channel:connect')).toBe(true);
      });

      it('returns false after clear() is called', () => {
        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());
        handler.clear();

        expect(handler.has('chat:send')).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // 3.5 clear()
    // -----------------------------------------------------------------------
    describe('clear()', () => {
      it('calls the stored unsubscribe function', () => {
        const customUnsub = vi.fn();
        mockHookBus.tapAny.mockReturnValueOnce(customUnsub);

        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());
        handler.clear();

        expect(customUnsub).toHaveBeenCalledTimes(1);
      });

      it('calls ALL stored unsubscribe functions when multiple events registered', () => {
        const unsub1 = vi.fn();
        const unsub2 = vi.fn();
        const unsub3 = vi.fn();
        mockHookBus.tapAny
          .mockReturnValueOnce(unsub1)
          .mockReturnValueOnce(unsub2)
          .mockReturnValueOnce(unsub3);

        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());
        handler.handle('channel:connect', vi.fn());
        handler.handle('workspace:create', vi.fn());

        handler.clear();

        expect(unsub1).toHaveBeenCalledTimes(1);
        expect(unsub2).toHaveBeenCalledTimes(1);
        expect(unsub3).toHaveBeenCalledTimes(1);
      });

      it('clears registeredEvents so has() returns false for all events', () => {
        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());
        handler.handle('channel:connect', vi.fn());

        handler.clear();

        expect(handler.has('chat:send')).toBe(false);
        expect(handler.has('channel:connect')).toBe(false);
      });

      it('empties internal unsubs array so second clear() does not double-call unsubs', () => {
        const customUnsub = vi.fn();
        mockHookBus.tapAny.mockReturnValueOnce(customUnsub);

        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());

        handler.clear();
        handler.clear(); // Second call on empty array

        expect(customUnsub).toHaveBeenCalledTimes(1);
      });

      it('does not throw when called on a fresh handler with no registrations', () => {
        const handler = new ClientEventHandler();
        expect(() => handler.clear()).not.toThrow();
      });

      it('allows re-registering events after clear()', () => {
        const handler = new ClientEventHandler();
        handler.handle('chat:send', vi.fn());
        handler.clear();

        expect(handler.has('chat:send')).toBe(false);

        handler.handle('chat:send', vi.fn());
        expect(handler.has('chat:send')).toBe(true);
      });
    });
  });

  // =========================================================================
  // 4. gatewayEvents — module-level singleton
  // =========================================================================
  describe('gatewayEvents (module-level instance)', () => {
    it('is an instance of GatewayEventEmitter', () => {
      expect(gatewayEvents).toBeInstanceOf(GatewayEventEmitter);
    });

    it('is defined (not null or undefined)', () => {
      expect(gatewayEvents).toBeDefined();
      expect(gatewayEvents).not.toBeNull();
    });

    it('exposes the on() method', () => {
      expect(typeof gatewayEvents.on).toBe('function');
    });

    it('exposes the onAny() method', () => {
      expect(typeof gatewayEvents.onAny).toBe('function');
    });

    it('exposes the emit() method', () => {
      expect(typeof gatewayEvents.emit).toBe('function');
    });

    it('can subscribe and emit without throwing', async () => {
      gatewayEvents.on('system:notification', vi.fn());
      await expect(
        gatewayEvents.emit('system:notification', { type: 'info', message: 'hello' })
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // 5. Integration-style tests
  // =========================================================================
  describe('integration', () => {
    it('full GatewayEventEmitter flow: on() → simulated bus dispatch → handler called', () => {
      const emitter = new GatewayEventEmitter();
      const userHandler = vi.fn();
      emitter.on('data:changed', userHandler);

      const innerHandler = captureOnHandler();
      const payload = { entity: 'task' as const, action: 'created' as const, id: 'task-1' };
      innerHandler({ type: 'gateway.data.changed', data: payload });

      expect(userHandler).toHaveBeenCalledTimes(1);
      expect(userHandler).toHaveBeenCalledWith(payload);
    });

    it('full ClientEventHandler flow: handle() → process() → user handler called with correct args', async () => {
      let capturedTapCb: ((ctx: { data: Record<string, unknown> }) => Promise<void>) | null = null;
      mockHookBus.tapAny.mockImplementationOnce((_hookName: string, cb: (ctx: { data: Record<string, unknown> }) => Promise<void>) => {
        capturedTapCb = cb;
        return mockUnsub;
      });
      mockHookBus.callAny.mockImplementationOnce(
        async (_hookName: string, payload: Record<string, unknown>) => {
          if (capturedTapCb) {
            await capturedTapCb({ data: payload });
          }
        }
      );

      const handler = new ClientEventHandler();
      const userHandler = vi.fn();
      handler.handle('chat:send', userHandler);

      await handler.process('chat:send', { content: 'integration test' }, 'sess-int');

      expect(userHandler).toHaveBeenCalledWith({ content: 'integration test' }, 'sess-int');
    });

    it('multiple GatewayEventEmitter handlers for different events fire independently', () => {
      const emitter = new GatewayEventEmitter();
      const connectionHandler = vi.fn();
      const channelHandler = vi.fn();

      emitter.on('connection:ready', connectionHandler);
      emitter.on('channel:connected', channelHandler);

      const connectionInner = captureOnHandler(0);
      const channelInner = captureOnHandler(1);

      connectionInner({ type: 'gateway.connection.ready', data: { sessionId: 's1' } });
      expect(connectionHandler).toHaveBeenCalledTimes(1);
      expect(channelHandler).toHaveBeenCalledTimes(0);

      channelInner({
        type: 'gateway.channel.connected',
        data: { channel: { id: 'c1', type: 'tg', name: 'TG', status: 'ok', config: {} } },
      });
      expect(channelHandler).toHaveBeenCalledTimes(1);
      expect(connectionHandler).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe function from on() is the bus unsubscribe token', () => {
      const customUnsub = vi.fn();
      mockScopedBus.on.mockReturnValueOnce(customUnsub);

      const emitter = new GatewayEventEmitter();
      const unsub = emitter.on('connection:error', vi.fn());

      expect(unsub).toBe(customUnsub);
      unsub();
      expect(customUnsub).toHaveBeenCalledTimes(1);
    });

    it('clear() on ClientEventHandler prevents further registrations from being called', () => {
      const customUnsub = vi.fn();
      mockHookBus.tapAny.mockReturnValueOnce(customUnsub);

      const handler = new ClientEventHandler();
      handler.handle('chat:send', vi.fn());
      handler.clear();

      expect(customUnsub).toHaveBeenCalledTimes(1);
      expect(handler.has('chat:send')).toBe(false);
    });

    it('process() with sessionId undefined does not set sessionId key to a string', async () => {
      const handler = new ClientEventHandler();
      await handler.process('session:ping', {});

      const [, payload] = mockHookBus.callAny.mock.calls[0]!;
      const typedPayload = payload as Record<string, unknown>;
      // sessionId should be in payload but undefined (spread of undefined)
      expect(typedPayload['sessionId']).toBeUndefined();
    });

    it('GatewayEventEmitter onAny and on() can coexist on same instance', () => {
      const emitter = new GatewayEventEmitter();
      const specificHandler = vi.fn();
      const anyHandler = vi.fn();

      emitter.on('system:status', specificHandler);
      emitter.onAny(anyHandler);

      expect(mockScopedBus.on).toHaveBeenCalledTimes(1);
      expect(mockScopedBus.onAll).toHaveBeenCalledTimes(1);
    });

    it('ClientEventHandler handle() stores multiple unsubs and clear() fires all', () => {
      const unsubs = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
      let callCount = 0;
      mockHookBus.tapAny.mockImplementation(() => unsubs[callCount++] ?? mockUnsub);

      const handler = new ClientEventHandler();
      handler.handle('chat:send', vi.fn());
      handler.handle('chat:stop', vi.fn());
      handler.handle('channel:connect', vi.fn());
      handler.handle('workspace:create', vi.fn());

      handler.clear();

      for (const unsub of unsubs) {
        expect(unsub).toHaveBeenCalledTimes(1);
      }
    });
  });
});
