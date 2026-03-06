/**
 * EdgeMqttClient Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockLog, mockMqttConnect } = vi.hoisted(() => ({
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockMqttConnect: vi.fn(),
}));

vi.mock('./log.js', () => ({
  getLog: vi.fn(() => mockLog),
}));

vi.mock('mqtt', () => ({
  default: { connect: mockMqttConnect },
  connect: mockMqttConnect,
}));

// ---------------------------------------------------------------------------
// Mock MQTT Client helper
// ---------------------------------------------------------------------------

function makeMockMqttClient(connected = true) {
  const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const client = {
    connected,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!eventHandlers[event]) eventHandlers[event] = [];
      eventHandlers[event].push(cb);
    }),
    subscribe: vi.fn((_topic: string, cb?: (err?: Error) => void) => cb?.()),
    unsubscribe: vi.fn((_topic: string, cb?: (err?: Error) => void) => cb?.()),
    publish: vi.fn((_topic: string, _msg: string, cb?: (err?: Error) => void) => cb?.()),
    end: vi.fn(),
    // Helper: emit an event to registered handlers
    _emit: (event: string, ...args: unknown[]) => {
      for (const handler of eventHandlers[event] ?? []) {
        handler(...args);
      }
    },
  };
  return client;
}

import {
  EdgeMqttClient,
  getEdgeMqttClient,
  telemetryTopic,
  commandTopic,
  statusTopic,
  telemetryWildcard,
  statusWildcard,
  parseTopicIds,
} from './edge-mqtt-client.js';

// ---------------------------------------------------------------------------
// Topic helper tests
// ---------------------------------------------------------------------------

describe('topic helpers', () => {
  it('telemetryTopic builds correct topic', () => {
    expect(telemetryTopic('user1', 'device1')).toBe('ownpilot/user1/devices/device1/telemetry');
  });

  it('commandTopic builds correct topic', () => {
    expect(commandTopic('user1', 'device1')).toBe('ownpilot/user1/devices/device1/commands');
  });

  it('statusTopic builds correct topic', () => {
    expect(statusTopic('user1', 'device1')).toBe('ownpilot/user1/devices/device1/status');
  });

  it('telemetryWildcard returns correct wildcard', () => {
    expect(telemetryWildcard()).toBe('ownpilot/+/devices/+/telemetry');
  });

  it('statusWildcard returns correct wildcard', () => {
    expect(statusWildcard()).toBe('ownpilot/+/devices/+/status');
  });
});

describe('parseTopicIds', () => {
  it('parses userId and deviceId from valid topic', () => {
    const result = parseTopicIds('ownpilot/user1/devices/device1/telemetry');
    expect(result).toEqual({ userId: 'user1', deviceId: 'device1' });
  });

  it('parses from status topic', () => {
    const result = parseTopicIds('ownpilot/user-42/devices/sensor-abc/status');
    expect(result).toEqual({ userId: 'user-42', deviceId: 'sensor-abc' });
  });

  it('returns null for wrong prefix', () => {
    expect(parseTopicIds('other/user1/devices/device1/telemetry')).toBeNull();
  });

  it('returns null for missing devices segment', () => {
    expect(parseTopicIds('ownpilot/user1/device1/telemetry')).toBeNull();
  });

  it('returns null for too few segments', () => {
    expect(parseTopicIds('ownpilot/user1')).toBeNull();
  });

  it('returns null for empty userId', () => {
    expect(parseTopicIds('ownpilot//devices/device1/telemetry')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EdgeMqttClient tests
// ---------------------------------------------------------------------------

describe('EdgeMqttClient', () => {
  let client: EdgeMqttClient;
  let mockMqttClient: ReturnType<typeof makeMockMqttClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MQTT_BROKER_URL;
    client = new EdgeMqttClient();
    mockMqttClient = makeMockMqttClient();
    mockMqttConnect.mockReturnValue(mockMqttClient);
  });

  afterEach(() => {
    delete process.env.MQTT_BROKER_URL;
  });

  // --- connect() ---

  it('returns false when no MQTT_BROKER_URL configured', async () => {
    const result = await client.connect();
    expect(result).toBe(false);
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('dormant'));
  });

  it('returns false when MQTT package not available', async () => {
    vi.doMock('mqtt', () => {
      throw new Error('Module not found');
    });
    process.env.MQTT_BROKER_URL = 'mqtt://localhost:1883';
    const result = await client.connect('mqtt://localhost:1883');
    expect(result).toBe(false);
  });

  it('isConnected returns false when not connected', () => {
    expect(client.isConnected()).toBe(false);
  });

  it('getBrokerUrl returns null when not connected', () => {
    expect(client.getBrokerUrl()).toBeNull();
  });

  // --- subscribe() ---

  it('subscribe adds handler and returns unsubscribe function', async () => {
    // Inject mock client manually (bypass connect)
    (client as any).client = mockMqttClient;
    const handler = vi.fn();
    const unsub = client.subscribe('test/topic', handler);

    expect(typeof unsub).toBe('function');
    expect(mockMqttClient.subscribe).toHaveBeenCalledWith('test/topic');
  });

  it('unsubscribe function removes handler', async () => {
    (client as any).client = mockMqttClient;
    const handler = vi.fn();
    const unsub = client.subscribe('test/topic', handler);

    unsub();
    expect(mockMqttClient.unsubscribe).toHaveBeenCalledWith('test/topic');
  });

  it('multiple handlers for same topic: only unsubscribes when last removed', async () => {
    (client as any).client = mockMqttClient;
    const h1 = vi.fn();
    const h2 = vi.fn();
    const unsub1 = client.subscribe('test/topic', h1);
    const unsub2 = client.subscribe('test/topic', h2);

    unsub1(); // h2 still subscribed
    expect(mockMqttClient.unsubscribe).not.toHaveBeenCalled();

    unsub2(); // last handler removed
    expect(mockMqttClient.unsubscribe).toHaveBeenCalledWith('test/topic');
  });

  // --- dispatchMessage (via message event) ---
  // Inject connectFn directly to bypass dynamic import, then call doConnect()

  function connectWithMock(c: EdgeMqttClient, mc: ReturnType<typeof makeMockMqttClient>) {
    (c as any).connectFn = () => mc;
    (c as any).brokerUrl = 'mqtt://localhost:1883';
    (c as any).doConnect();
  }

  it('dispatches message to exact topic handler', () => {
    connectWithMock(client, mockMqttClient);
    const handler = vi.fn();
    client.subscribe('ownpilot/user1/devices/d1/telemetry', handler);

    mockMqttClient._emit(
      'message',
      'ownpilot/user1/devices/d1/telemetry',
      Buffer.from('{"temp":22}')
    );

    expect(handler).toHaveBeenCalledWith('ownpilot/user1/devices/d1/telemetry', { temp: 22 });
  });

  it('dispatches message to wildcard + handler', () => {
    connectWithMock(client, mockMqttClient);
    const handler = vi.fn();
    client.subscribe('ownpilot/+/devices/+/telemetry', handler);

    mockMqttClient._emit('message', 'ownpilot/user1/devices/d1/telemetry', Buffer.from('hello'));

    expect(handler).toHaveBeenCalledWith('ownpilot/user1/devices/d1/telemetry', 'hello');
  });

  it('dispatches message to # wildcard handler', () => {
    connectWithMock(client, mockMqttClient);
    const handler = vi.fn();
    client.subscribe('ownpilot/#', handler);

    mockMqttClient._emit('message', 'ownpilot/user1/devices/d1/status', 'online');

    expect(handler).toHaveBeenCalled();
  });

  it('does NOT dispatch to non-matching topic', () => {
    connectWithMock(client, mockMqttClient);
    const handler = vi.fn();
    client.subscribe('ownpilot/user1/devices/d1/telemetry', handler);

    mockMqttClient._emit('message', 'ownpilot/user1/devices/d1/status', 'online');

    expect(handler).not.toHaveBeenCalled();
  });

  it('handler errors are caught and logged as warning', () => {
    connectWithMock(client, mockMqttClient);
    const badHandler = vi.fn(() => {
      throw new Error('handler blew up');
    });
    client.subscribe('test/topic', badHandler);

    mockMqttClient._emit('message', 'test/topic', 'data');

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('handler error'));
  });

  // --- publish() ---

  it('publish rejects when not connected', async () => {
    (client as any).client = { ...mockMqttClient, connected: false };
    await expect(client.publish('test/topic', { foo: 'bar' })).rejects.toThrow('not connected');
  });

  it('publish serializes object payload as JSON', async () => {
    (client as any).client = mockMqttClient;
    await client.publish('test/topic', { temperature: 22 });
    expect(mockMqttClient.publish).toHaveBeenCalledWith(
      'test/topic',
      '{"temperature":22}',
      expect.any(Function)
    );
  });

  it('publish sends string payload as-is', async () => {
    (client as any).client = mockMqttClient;
    await client.publish('test/topic', 'raw string');
    expect(mockMqttClient.publish).toHaveBeenCalledWith(
      'test/topic',
      'raw string',
      expect.any(Function)
    );
  });

  it('publish rejects when publish cb returns error', async () => {
    mockMqttClient.publish.mockImplementation(
      (_t: string, _m: string, cb?: (err?: Error) => void) => cb?.(new Error('broker error'))
    );
    (client as any).client = mockMqttClient;
    await expect(client.publish('test/topic', 'data')).rejects.toThrow('broker error');
  });

  // --- disconnect() ---

  it('disconnect closes client and clears brokerUrl', () => {
    (client as any).client = mockMqttClient;
    (client as any).brokerUrl = 'mqtt://localhost:1883';
    client.disconnect();
    expect(mockMqttClient.end).toHaveBeenCalledWith(true);
    expect(client.getBrokerUrl()).toBeNull();
    expect(client.isConnected()).toBe(false);
  });

  it('disconnect clears reconnect timer', () => {
    const timer = setTimeout(() => {}, 60000);
    (client as any).reconnectTimer = timer;
    client.disconnect();
    expect((client as any).reconnectTimer).toBeNull();
  });

  // --- matchesTopic ---

  it('matchesTopic handles + wildcard', () => {
    const mc = client as any;
    expect(mc.matchesTopic('a/+/c', 'a/b/c')).toBe(true);
    expect(mc.matchesTopic('a/+/c', 'a/b/d')).toBe(false);
  });

  it('matchesTopic handles # wildcard (matches rest)', () => {
    const mc = client as any;
    expect(mc.matchesTopic('a/#', 'a/b/c/d')).toBe(true);
    // MQTT spec: a/# also matches a (# matches zero or more levels)
    expect(mc.matchesTopic('a/#', 'a')).toBe(true);
    expect(mc.matchesTopic('a/#', 'b/c')).toBe(false);
  });

  it('matchesTopic returns false for different segment counts', () => {
    const mc = client as any;
    expect(mc.matchesTopic('a/b', 'a/b/c')).toBe(false);
  });

  // --- getEdgeMqttClient singleton ---

  it('getEdgeMqttClient returns same instance on repeated calls', () => {
    const a = getEdgeMqttClient();
    const b = getEdgeMqttClient();
    expect(a).toBe(b);
  });

  // =========================================================================
  // connect() line 106 — doConnect() is called when connectFn already set
  // =========================================================================

  describe('connect() doConnect path (line 106)', () => {
    it('calls doConnect when connectFn is already cached (line 106)', async () => {
      // Pre-inject connectFn so the import() block is skipped → reaches line 106
      (client as any).connectFn = mockMqttConnect;

      const result = await client.connect('mqtt://localhost:1883');

      expect(mockMqttConnect).toHaveBeenCalledWith('mqtt://localhost:1883', expect.any(Object));
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // doConnect() early return when connectFn/brokerUrl absent (line 110)
  // =========================================================================

  it('doConnect returns false when connectFn is not set (line 110 early return)', () => {
    // client.connectFn is null by default — doConnect() hits the early return
    const result = (client as any).doConnect() as boolean;
    expect(result).toBe(false);
  });

  // =========================================================================
  // doConnect() event handler bodies (lines 120-121, 124-125, 136, 140-141, 145-146)
  // =========================================================================

  describe('doConnect() event handlers', () => {
    it('connect event resets reconnectDelay and resubscribes topics (lines 110, 120-125)', () => {
      // Pre-populate handlers map so resubscribe loop finds a topic
      const handler = vi.fn();
      (client as any).handlers.set('ownpilot/+/devices/+/telemetry', new Set([handler]));

      connectWithMock(client, mockMqttClient);

      // Simulate reconnect → reconnectDelay may have been raised
      (client as any).reconnectDelay = 8000;
      mockMqttClient._emit('connect');

      // line 121: delay reset to 1000
      expect((client as any).reconnectDelay).toBe(1000);
      // lines 124-125: resubscribed the topic
      expect(mockMqttClient.subscribe).toHaveBeenCalledWith('ownpilot/+/devices/+/telemetry');
    });

    it('error event logs warning (line 136)', () => {
      connectWithMock(client, mockMqttClient);
      expect(() => mockMqttClient._emit('error', new Error('connection refused'))).not.toThrow();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('MQTT error'));
    });

    it('close event calls scheduleReconnect (lines 140-141)', () => {
      connectWithMock(client, mockMqttClient);
      vi.useFakeTimers();
      mockMqttClient._emit('close');
      expect(vi.getTimerCount()).toBe(1);
    });

    it('offline event calls scheduleReconnect (lines 145-146)', () => {
      connectWithMock(client, mockMqttClient);
      vi.useFakeTimers();
      mockMqttClient._emit('offline');
      expect(vi.getTimerCount()).toBe(1);
    });
  });

  // =========================================================================
  // doConnect() catch block (lines 151-153)
  // =========================================================================

  describe('doConnect() catch block (lines 151-153)', () => {
    it('returns false and schedules reconnect when connectFn throws', () => {
      // Inject a throwing connectFn
      (client as any).connectFn = () => {
        throw new Error('connection refused');
      };
      (client as any).brokerUrl = 'mqtt://localhost:1883';

      vi.useFakeTimers();
      const result = (client as any).doConnect() as boolean;

      expect(result).toBe(false);
      // scheduleReconnect called → timer pending
      expect(vi.getTimerCount()).toBe(1);
    });
  });

  // =========================================================================
  // scheduleReconnect() (lines 158–164)
  // =========================================================================

  describe('scheduleReconnect() (lines 158–164)', () => {
    it('returns early when reconnect timer is already set (line 158)', () => {
      connectWithMock(client, mockMqttClient);
      vi.useFakeTimers();

      mockMqttClient._emit('close'); // first scheduleReconnect → sets timer
      mockMqttClient._emit('close'); // second → timer already set → early return

      // Only 1 pending timer
      expect(vi.getTimerCount()).toBe(1);
    });

    it('timer fires, calls doConnect, and doubles reconnect delay (lines 160-164)', async () => {
      const reconnectClient = makeMockMqttClient();
      connectWithMock(client, mockMqttClient);
      vi.useFakeTimers();

      // Inject a new connectFn that returns reconnectClient on next call
      (client as any).connectFn = () => reconnectClient;
      const delayBefore = (client as any).reconnectDelay as number; // 1000

      mockMqttClient._emit('close'); // triggers scheduleReconnect

      await vi.advanceTimersByTimeAsync(delayBefore + 1);

      // doConnect was called again — client updated to reconnectClient
      expect((client as any).client).toBe(reconnectClient);
      // Delay doubled (line 164)
      expect((client as any).reconnectDelay).toBe(delayBefore * 2);
    });

    it('reconnect delay caps at maxReconnectDelay', async () => {
      const reconnectClient = makeMockMqttClient();
      connectWithMock(client, mockMqttClient);
      (client as any).reconnectDelay = 20000;
      (client as any).connectFn = () => reconnectClient;
      vi.useFakeTimers();

      mockMqttClient._emit('close');
      await vi.advanceTimersByTimeAsync(20001);

      // 20000 * 2 = 40000 capped at 30000
      expect((client as any).reconnectDelay).toBe(30000);
    });
  });

  // =========================================================================
  // dispatchMessage() wildcard handler error (line 277)
  // =========================================================================

  describe('wildcard handler error (line 277)', () => {
    it('logs warning when wildcard-matched handler throws', () => {
      connectWithMock(client, mockMqttClient);

      // Subscribe to a wildcard pattern
      const throwingHandler = vi.fn(() => {
        throw new Error('wildcard handler blew up');
      });
      client.subscribe('ownpilot/+/devices/+/telemetry', throwingHandler);

      // Dispatch a specific topic that matches via wildcard (not exact)
      // The exact topic is NOT subscribed — only the pattern is
      mockMqttClient._emit('message', 'ownpilot/user1/devices/dev1/telemetry', 'data');

      expect(throwingHandler).toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('handler error'));
    });
  });
});
