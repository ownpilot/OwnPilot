import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebSocket, RawData } from 'ws';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSessionManager = {
  count: 0,
  create: vi.fn(() => ({ id: 'session-1' })),
  send: vi.fn(() => true),
  touch: vi.fn(),
  consumeRateLimit: vi.fn(() => true),
  removeBySocket: vi.fn(),
  broadcast: vi.fn(() => 3),
  cleanup: vi.fn(() => 0),
  subscribeToChannel: vi.fn(),
  unsubscribeFromChannel: vi.fn(),
  setMetadata: vi.fn(),
  get: vi.fn(),
};

const mockClientHandler = {
  handle: vi.fn(),
  has: vi.fn(() => true),
  process: vi.fn(() => Promise.resolve()),
  clear: vi.fn(),
};

const mockWss = {
  on: vi.fn(),
  clients: new Set<WebSocket>(),
  close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
  handleUpgrade: vi.fn(),
  emit: vi.fn(),
};

/** Mock channel service instance */
const mockChannelServiceInst = {
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  send: vi.fn(async () => 'msg-1'),
  getChannel: vi.fn(() => ({ getPlatform: () => 'test-platform', getStatus: () => 'connected' })),
  listChannels: vi.fn(
    () => [] as Array<{ pluginId: string; platform: string; name: string; status: string }>
  ),
};

/** Mock event system for setupLegacyEventForwarding */
const mockEventSystem = {
  onPattern: vi.fn(() => () => {}),
  on: vi.fn(() => () => {}),
  onAny: vi.fn(() => () => {}),
};

/** Mock EventBusBridge instance */
const mockEventBridgeInst = {
  start: vi.fn(),
  stop: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  publish: vi.fn(),
};

/** Mock coding agent session manager */
const mockCodingAgentSessions = {
  writeToSession: vi.fn(),
  resizeSession: vi.fn(),
  subscribe: vi.fn(),
};

// Use class mocks so `new` works correctly
vi.mock('ws', () => {
  class MockWebSocketServer {
    on = mockWss.on;
    clients = mockWss.clients;
    close = mockWss.close;
    handleUpgrade = mockWss.handleUpgrade;
    emit = mockWss.emit;
    constructor() {
      // constructor captured by vi.fn wrapper if needed
    }
  }
  return { WebSocketServer: MockWebSocketServer };
});

vi.mock('./session.js', () => ({
  sessionManager: mockSessionManager,
}));

vi.mock('./events.js', () => {
  class MockClientEventHandler {
    handle = mockClientHandler.handle;
    has = mockClientHandler.has;
    process = mockClientHandler.process;
    clear = mockClientHandler.clear;
  }
  return { ClientEventHandler: MockClientEventHandler };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getChannelService: vi.fn(() => mockChannelServiceInst),
    getEventSystem: vi.fn(() => mockEventSystem),
  };
});

vi.mock('../routes/agents.js', () => ({
  getOrCreateDefaultAgent: vi.fn(),
  isDemoMode: vi.fn(),
}));

vi.mock('../routes/helpers.js', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : 'Unknown error')),
}));

vi.mock('../config/defaults.js', () => ({
  WS_PORT: 8081,
  WS_HEARTBEAT_INTERVAL_MS: 30000,
  WS_SESSION_TIMEOUT_MS: 300000,
  WS_MAX_PAYLOAD_BYTES: 1048576,
  WS_MAX_CONNECTIONS: 100,
  WS_READY_STATE_OPEN: 1,
}));

vi.mock('./event-bridge.js', () => ({
  EventBusBridge: vi.fn(function () {
    return mockEventBridgeInst;
  }),
  setEventBusBridge: vi.fn(),
}));

vi.mock('../services/coding-agent-sessions.js', () => ({
  getCodingAgentSessionManager: vi.fn(() => mockCodingAgentSessions),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSocket(readyState = 1): WebSocket {
  return {
    readyState,
    on: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    send: vi.fn(),
  } as unknown as WebSocket;
}

function createMockRequest(
  url = '/',
  headers: Record<string, string> = {},
  remoteAddress = '127.0.0.1'
): {
  url: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string };
} {
  return {
    url,
    headers: { host: 'localhost', ...headers },
    socket: { remoteAddress },
  };
}

/**
 * After gateway.start() or gateway.attachToServer(), extract the 'connection'
 * handler registered on mockWss.
 */
function getConnectionHandler(): (socket: WebSocket, request: unknown) => void {
  const call = mockWss.on.mock.calls.find((c: unknown[]) => c[0] === 'connection');
  if (!call) throw new Error('connection handler not registered');
  return call[1] as (socket: WebSocket, request: unknown) => void;
}

/**
 * Given a mock socket that went through handleConnection, extract the
 * handler registered for the given event name.
 */
function getSocketHandler(socket: WebSocket, event: string): (...args: unknown[]) => void {
  const onCalls = (socket.on as ReturnType<typeof vi.fn>).mock.calls;
  const call = onCalls.find((c: unknown[]) => c[0] === event);
  if (!call) throw new Error(`${event} handler not registered on socket`);
  return call[1] as (...args: unknown[]) => void;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WSGateway', () => {
  let WSGateway: typeof import('./server.js').WSGateway;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset mock defaults
    mockSessionManager.count = 0;
    mockSessionManager.create.mockReturnValue({ id: 'session-1' });
    mockSessionManager.send.mockReturnValue(true);
    mockSessionManager.consumeRateLimit.mockReturnValue(true);
    mockSessionManager.broadcast.mockReturnValue(3);
    mockSessionManager.cleanup.mockReturnValue(0);
    mockClientHandler.has.mockReturnValue(true);
    mockClientHandler.process.mockReturnValue(Promise.resolve());
    mockWss.on.mockClear();
    mockWss.clients.clear();
    mockWss.close.mockImplementation((cb?: (err?: Error) => void) => cb?.());
    delete process.env.API_KEYS;

    // Restore channel service defaults
    mockChannelServiceInst.connect.mockResolvedValue(undefined);
    mockChannelServiceInst.disconnect.mockResolvedValue(undefined);
    mockChannelServiceInst.send.mockResolvedValue('msg-1');
    mockChannelServiceInst.getChannel.mockReturnValue({
      getPlatform: () => 'test-platform',
      getStatus: () => 'connected',
    });
    mockChannelServiceInst.listChannels.mockReturnValue([]);

    // Re-import to get a fresh module
    const mod = await import('./server.js');
    WSGateway = mod.WSGateway;

    // Clear auth rate limiter state between tests
    mod.resetAuthRateLimit();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.API_KEYS;
  });

  // =========================================================================
  // Constructor & Config
  // =========================================================================
  describe('constructor', () => {
    it('uses default config when none provided', () => {
      const gw = new WSGateway();
      expect(gw).toBeDefined();
      expect(gw.connectionCount).toBe(0);
    });

    it('merges custom config with defaults', () => {
      const gw = new WSGateway({ port: 9999, maxConnections: 5 });
      expect(gw).toBeDefined();
      // Custom maxConnections = 5, so when count >= 5, connections rejected
      mockSessionManager.count = 5;
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      handler(socket, createMockRequest('/'));

      expect(socket.close).toHaveBeenCalledWith(1013, 'Maximum connections reached');
    });
  });

  // =========================================================================
  // validateWsToken (tested through handleConnection)
  // =========================================================================
  describe('validateWsToken (via handleConnection)', () => {
    it('allows connection when no API_KEYS configured', () => {
      delete process.env.API_KEYS;
      const gw = new WSGateway();
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/?token=anything');

      handler(socket, request);

      expect(mockSessionManager.create).toHaveBeenCalledWith(socket);
      expect(socket.close).not.toHaveBeenCalled();
    });

    it('rejects connection when API_KEYS set but no token', () => {
      process.env.API_KEYS = 'secret-key-1,secret-key-2';
      const gw = new WSGateway();
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/');

      handler(socket, request);

      expect(socket.close).toHaveBeenCalledWith(1008, 'Authentication required');
      expect(mockSessionManager.create).not.toHaveBeenCalled();
    });

    it('accepts connection with valid token', () => {
      process.env.API_KEYS = 'key-alpha,key-beta';
      const gw = new WSGateway();
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/?token=key-beta');

      handler(socket, request);

      expect(mockSessionManager.create).toHaveBeenCalledWith(socket);
      expect(socket.close).not.toHaveBeenCalled();
    });

    it('rejects connection with invalid token', () => {
      process.env.API_KEYS = 'key-alpha,key-beta';
      const gw = new WSGateway();
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/?token=wrong-key');

      handler(socket, request);

      expect(socket.close).toHaveBeenCalledWith(1008, 'Authentication required');
      expect(mockSessionManager.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // isOriginAllowed (tested through handleConnection)
  // =========================================================================
  describe('isOriginAllowed (via handleConnection)', () => {
    it('allows any origin when no restrictions configured', () => {
      const gw = new WSGateway({ allowedOrigins: [] });
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/', {
        origin: 'http://evil.example.com',
      });

      handler(socket, request);

      expect(mockSessionManager.create).toHaveBeenCalled();
      expect(socket.close).not.toHaveBeenCalled();
    });

    it('rejects connection when origin not in allowedOrigins', () => {
      const gw = new WSGateway({
        allowedOrigins: ['http://localhost:5173'],
      });
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/', {
        origin: 'http://evil.example.com',
      });

      handler(socket, request);

      expect(socket.close).toHaveBeenCalledWith(1008, 'Origin not allowed');
      expect(mockSessionManager.create).not.toHaveBeenCalled();
    });

    it('accepts connection when origin matches allowedOrigins', () => {
      const gw = new WSGateway({
        allowedOrigins: ['http://localhost:5173', 'http://localhost:3000'],
      });
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/', {
        origin: 'http://localhost:3000',
      });

      handler(socket, request);

      expect(mockSessionManager.create).toHaveBeenCalled();
      expect(socket.close).not.toHaveBeenCalled();
    });

    it('rejects when restrictions configured but no origin header', () => {
      const gw = new WSGateway({
        allowedOrigins: ['http://localhost:5173'],
      });
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      // No origin header
      const request = createMockRequest('/');

      handler(socket, request);

      expect(socket.close).toHaveBeenCalledWith(1008, 'Origin not allowed');
    });
  });

  // =========================================================================
  // handleConnection
  // =========================================================================
  describe('handleConnection', () => {
    it('rejects when max connections reached (closes with 1013)', () => {
      mockSessionManager.count = 100;
      const gw = new WSGateway({ maxConnections: 100 });
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/');

      handler(socket, request);

      expect(socket.close).toHaveBeenCalledWith(1013, 'Maximum connections reached');
      expect(mockSessionManager.create).not.toHaveBeenCalled();
    });

    it('creates session and sends connection:ready on success', () => {
      const gw = new WSGateway();
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/');

      handler(socket, request);

      expect(mockSessionManager.create).toHaveBeenCalledWith(socket);
      expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'connection:ready', {
        sessionId: 'session-1',
      });
    });

    it('sets up message, close, error, pong handlers on socket', () => {
      const gw = new WSGateway();
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/');

      handler(socket, request);

      const onCalls = (socket.on as ReturnType<typeof vi.fn>).mock.calls;
      const events = onCalls.map((c: unknown[]) => c[0]);

      expect(events).toContain('message');
      expect(events).toContain('close');
      expect(events).toContain('error');
      expect(events).toContain('pong');
    });

    it('close handler removes session by socket', () => {
      const gw = new WSGateway();
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/');
      handler(socket, request);

      const closeHandler = getSocketHandler(socket, 'close');
      closeHandler(1000, Buffer.from('normal'));

      expect(mockSessionManager.removeBySocket).toHaveBeenCalledWith(socket);
    });

    it('pong handler touches session', () => {
      const gw = new WSGateway();
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/');
      handler(socket, request);

      const pongHandler = getSocketHandler(socket, 'pong');
      pongHandler();

      expect(mockSessionManager.touch).toHaveBeenCalledWith('session-1');
    });
  });

  // =========================================================================
  // handleMessage
  // =========================================================================
  describe('handleMessage (via socket message handler)', () => {
    function setupAndGetMessageHandler(): (data: RawData) => void {
      const gw = new WSGateway();
      gw.start();

      const connectionHandler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/');
      connectionHandler(socket, request);

      return getSocketHandler(socket, 'message') as (data: RawData) => void;
    }

    it('rate limits when tokens exhausted (sends RATE_LIMITED error)', () => {
      mockSessionManager.consumeRateLimit.mockReturnValue(false);
      const messageHandler = setupAndGetMessageHandler();

      messageHandler(
        Buffer.from(JSON.stringify({ type: 'chat:send', payload: { content: 'hi' } }))
      );

      expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'connection:error', {
        code: 'RATE_LIMITED',
        message: 'Too many messages, slow down',
      });
    });

    it('sends PARSE_ERROR on invalid JSON', () => {
      const messageHandler = setupAndGetMessageHandler();

      messageHandler(Buffer.from('not valid json!!!'));

      expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'connection:error', {
        code: 'PARSE_ERROR',
        message: 'Invalid JSON message',
      });
    });

    it('sends INVALID_MESSAGE when type is missing', () => {
      const messageHandler = setupAndGetMessageHandler();

      messageHandler(Buffer.from(JSON.stringify({ payload: { content: 'hi' } })));

      expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'connection:error', {
        code: 'INVALID_MESSAGE',
        message: 'Message must have a type',
      });
    });

    it('sends INVALID_MESSAGE when type is not a string', () => {
      const messageHandler = setupAndGetMessageHandler();

      messageHandler(Buffer.from(JSON.stringify({ type: 123, payload: {} })));

      expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'connection:error', {
        code: 'INVALID_MESSAGE',
        message: 'Message must have a type',
      });
    });

    it('sends UNKNOWN_EVENT for invalid event types', () => {
      const messageHandler = setupAndGetMessageHandler();

      messageHandler(
        Buffer.from(
          JSON.stringify({
            type: 'invalid:event',
            payload: {},
          })
        )
      );

      expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'connection:error', {
        code: 'UNKNOWN_EVENT',
        message: 'Unknown event type',
      });
    });

    it('processes valid events through clientHandler', () => {
      const messageHandler = setupAndGetMessageHandler();

      const payload = { content: 'hello' };
      messageHandler(Buffer.from(JSON.stringify({ type: 'chat:send', payload })));

      expect(mockClientHandler.has).toHaveBeenCalledWith('chat:send');
      expect(mockClientHandler.process).toHaveBeenCalledWith('chat:send', payload, 'session-1');
    });

    it('touches session on valid message', () => {
      const messageHandler = setupAndGetMessageHandler();

      // Clear any prior calls from connection setup
      mockSessionManager.touch.mockClear();

      messageHandler(
        Buffer.from(JSON.stringify({ type: 'chat:send', payload: { content: 'hi' } }))
      );

      expect(mockSessionManager.touch).toHaveBeenCalledWith('session-1');
    });

    it('does not process when clientHandler has no handler', () => {
      mockClientHandler.has.mockReturnValue(false);
      const messageHandler = setupAndGetMessageHandler();

      messageHandler(
        Buffer.from(JSON.stringify({ type: 'chat:send', payload: { content: 'hi' } }))
      );

      expect(mockClientHandler.process).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // start / stop
  // =========================================================================
  describe('start', () => {
    it('creates WebSocketServer and sets up server', () => {
      const gw = new WSGateway();
      gw.start();

      // Verify setupServer was called (connection + error handlers registered)
      const registeredEvents = mockWss.on.mock.calls.map((c: unknown[]) => c[0]);
      expect(registeredEvents).toContain('connection');
      expect(registeredEvents).toContain('error');
    });

    it('throws if already running', () => {
      const gw = new WSGateway();
      gw.start();

      expect(() => gw.start()).toThrow('WebSocket server already running');
    });

    it('registers connection and error handlers on wss', () => {
      const gw = new WSGateway();
      gw.start();

      const registeredEvents = mockWss.on.mock.calls.map((c: unknown[]) => c[0]);
      expect(registeredEvents).toContain('connection');
      expect(registeredEvents).toContain('error');
    });

    it('starts heartbeat and cleanup timers', () => {
      const gw = new WSGateway({
        heartbeatInterval: 5000,
        sessionTimeout: 10000,
      });
      gw.start();

      // Trigger heartbeat -- add a socket to clients set for verification
      const mockSocket = createMockSocket();
      mockWss.clients.add(mockSocket as WebSocket);

      vi.advanceTimersByTime(5000);

      expect(mockSocket.ping).toHaveBeenCalled();

      // Trigger cleanup (sessionTimeout / 2 = 5000ms)
      vi.advanceTimersByTime(5000);

      expect(mockSessionManager.cleanup).toHaveBeenCalledWith(10000);

      mockWss.clients.delete(mockSocket as WebSocket);
    });
  });

  describe('stop', () => {
    it('clears timers and closes server', async () => {
      const gw = new WSGateway();
      gw.start();

      await gw.stop();

      expect(mockWss.close).toHaveBeenCalled();
    });

    it('resolves even if no server running', async () => {
      const gw = new WSGateway();
      // Never started
      await expect(gw.stop()).resolves.toBeUndefined();
    });

    it('closes all connected clients on stop', async () => {
      const gw = new WSGateway();
      gw.start();

      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      mockWss.clients.add(socket1 as WebSocket);
      mockWss.clients.add(socket2 as WebSocket);

      await gw.stop();

      expect(socket1.close).toHaveBeenCalledWith(1001, 'Server shutting down');
      expect(socket2.close).toHaveBeenCalledWith(1001, 'Server shutting down');

      mockWss.clients.clear();
    });

    it('rejects if wss.close returns an error', async () => {
      const gw = new WSGateway();
      gw.start();

      const closeError = new Error('close failed');
      mockWss.close.mockImplementation((cb?: (err?: Error) => void) => cb?.(closeError));

      await expect(gw.stop()).rejects.toThrow('close failed');

      // Reset for other tests
      mockWss.close.mockImplementation((cb?: (err?: Error) => void) => cb?.());
    });

    it('does not fire heartbeat after stop', async () => {
      const gw = new WSGateway({ heartbeatInterval: 1000 });
      gw.start();

      const mockSocket = createMockSocket();
      mockWss.clients.add(mockSocket as WebSocket);

      await gw.stop();

      // Clear any pings from before stop
      (mockSocket.ping as ReturnType<typeof vi.fn>).mockClear();

      // Advance past heartbeat interval
      vi.advanceTimersByTime(2000);

      expect(mockSocket.ping).not.toHaveBeenCalled();

      mockWss.clients.clear();
    });
  });

  // =========================================================================
  // attachToServer
  // =========================================================================
  describe('attachToServer', () => {
    it('creates a noServer WebSocketServer and registers upgrade handler', () => {
      const gw = new WSGateway();
      const mockHttpServer = {
        on: vi.fn(),
        removeListener: vi.fn(),
      };

      gw.attachToServer(mockHttpServer as unknown as import('node:http').Server);

      expect(mockHttpServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
      // Also sets up connection/error handlers on wss
      const registeredEvents = mockWss.on.mock.calls.map((c: unknown[]) => c[0]);
      expect(registeredEvents).toContain('connection');
    });

    it('throws if already running', () => {
      const gw = new WSGateway();
      gw.start();

      const mockHttpServer = { on: vi.fn(), removeListener: vi.fn() };
      expect(() =>
        gw.attachToServer(mockHttpServer as unknown as import('node:http').Server)
      ).toThrow('WebSocket server already running');
    });

    it('removes upgrade handler on stop', async () => {
      const gw = new WSGateway();
      const mockHttpServer = {
        on: vi.fn(),
        removeListener: vi.fn(),
      };

      gw.attachToServer(mockHttpServer as unknown as import('node:http').Server);

      await gw.stop();

      expect(mockHttpServer.removeListener).toHaveBeenCalledWith('upgrade', expect.any(Function));
    });
  });

  // =========================================================================
  // broadcast / send / connectionCount
  // =========================================================================
  describe('broadcast', () => {
    it('delegates to sessionManager.broadcast', () => {
      const gw = new WSGateway();
      const payload = { sessionId: 'test-session' };

      const count = gw.broadcast('connection:ready', payload);

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith('connection:ready', payload);
      expect(count).toBe(3);
    });
  });

  describe('send', () => {
    it('delegates to sessionManager.send', () => {
      const gw = new WSGateway();
      const payload = { sessionId: 'test-session' };

      const result = gw.send('sess-1', 'connection:ready', payload);

      expect(mockSessionManager.send).toHaveBeenCalledWith('sess-1', 'connection:ready', payload);
      expect(result).toBe(true);
    });
  });

  describe('connectionCount', () => {
    it('returns sessionManager.count', () => {
      mockSessionManager.count = 42;
      const gw = new WSGateway();

      expect(gw.connectionCount).toBe(42);
    });
  });

  // =========================================================================
  // heartbeat
  // =========================================================================
  describe('heartbeat', () => {
    it('pings only sockets with readyState 1', () => {
      const gw = new WSGateway({ heartbeatInterval: 1000 });
      gw.start();

      const openSocket = createMockSocket(1);
      const closedSocket = createMockSocket(3);
      mockWss.clients.add(openSocket as WebSocket);
      mockWss.clients.add(closedSocket as WebSocket);

      vi.advanceTimersByTime(1000);

      expect(openSocket.ping).toHaveBeenCalled();
      expect(closedSocket.ping).not.toHaveBeenCalled();

      mockWss.clients.clear();
    });
  });

  // =========================================================================
  // VALID_CLIENT_EVENTS coverage
  // =========================================================================
  describe('VALID_CLIENT_EVENTS (via handleMessage)', () => {
    function setupAndGetMessageHandler(): (data: RawData) => void {
      const gw = new WSGateway();
      gw.start();

      const connectionHandler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/');
      connectionHandler(socket, request);

      return getSocketHandler(socket, 'message') as (data: RawData) => void;
    }

    const validEvents = [
      'chat:send',
      'chat:stop',
      'chat:retry',
      'channel:connect',
      'channel:disconnect',
      'channel:subscribe',
      'channel:unsubscribe',
      'channel:send',
      'channel:list',
      'workspace:create',
      'workspace:switch',
      'workspace:delete',
      'workspace:list',
      'agent:configure',
      'agent:stop',
      'tool:cancel',
      'session:ping',
      'session:pong',
    ];

    it.each(validEvents)('accepts %s as a valid event type', (eventType) => {
      const messageHandler = setupAndGetMessageHandler();

      // Clear prior send calls from connection:ready
      mockSessionManager.send.mockClear();

      messageHandler(Buffer.from(JSON.stringify({ type: eventType, payload: {} })));

      // Should not get an UNKNOWN_EVENT error
      const errorCalls = mockSessionManager.send.mock.calls.filter(
        (c: unknown[]) =>
          c[1] === 'connection:error' && (c[2] as { code: string }).code === 'UNKNOWN_EVENT'
      );
      expect(errorCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // setupClientHandlers (tested via handler registration and invocation)
  // =========================================================================
  describe('setupClientHandlers', () => {
    it('registers handlers for all expected event types', () => {
      const _gw = new WSGateway();

      // clientHandler.handle is called once per event type in the constructor
      const registeredTypes = mockClientHandler.handle.mock.calls.map((call: unknown[]) => call[0]);

      expect(registeredTypes).toContain('chat:send');
      expect(registeredTypes).toContain('chat:stop');
      expect(registeredTypes).toContain('chat:retry');
      expect(registeredTypes).toContain('channel:connect');
      expect(registeredTypes).toContain('channel:disconnect');
      expect(registeredTypes).toContain('channel:subscribe');
      expect(registeredTypes).toContain('channel:unsubscribe');
      expect(registeredTypes).toContain('channel:send');
      expect(registeredTypes).toContain('channel:list');
      expect(registeredTypes).toContain('workspace:create');
      expect(registeredTypes).toContain('workspace:switch');
      expect(registeredTypes).toContain('workspace:delete');
      expect(registeredTypes).toContain('workspace:list');
      expect(registeredTypes).toContain('agent:configure');
      expect(registeredTypes).toContain('agent:stop');
      expect(registeredTypes).toContain('tool:cancel');
      expect(registeredTypes).toContain('session:ping');
      expect(registeredTypes).toContain('session:pong');
    });

    /**
     * Helper to extract a registered handler function for a given event type
     */
    function getRegisteredHandler(
      eventType: string
    ): (data: unknown, sessionId?: string) => Promise<void> {
      const call = mockClientHandler.handle.mock.calls.find((c: unknown[]) => c[0] === eventType);
      if (!call) throw new Error(`No handler registered for ${eventType}`);
      return call[1] as (data: unknown, sessionId?: string) => Promise<void>;
    }

    describe('chat:stop handler', () => {
      it('sends system notification when sessionId is present', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('chat:stop');

        await handler({}, 'session-1');

        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'system:notification', {
          type: 'info',
          message: 'Chat stopped',
        });
      });

      it('does nothing when sessionId is absent', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('chat:stop');

        mockSessionManager.send.mockClear();
        await handler({}, undefined);

        expect(mockSessionManager.send).not.toHaveBeenCalled();
      });
    });

    describe('chat:retry handler', () => {
      it('sends retry notification', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('chat:retry');

        await handler({}, 'session-1');

        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'system:notification', {
          type: 'info',
          message: 'Retrying message...',
        });
      });
    });

    describe('channel:subscribe handler', () => {
      it('subscribes session to channel and sends success notification', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('channel:subscribe');
        mockSessionManager.subscribeToChannel.mockReturnValue(true);

        await handler({ channelId: 'ch-1' }, 'session-1');

        expect(mockSessionManager.subscribeToChannel).toHaveBeenCalledWith('session-1', 'ch-1');
        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'system:notification', {
          type: 'success',
          message: 'Subscribed to channel ch-1',
        });
      });

      it('sends error notification when subscribe fails', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('channel:subscribe');
        mockSessionManager.subscribeToChannel.mockReturnValue(false);

        await handler({ channelId: 'ch-1' }, 'session-1');

        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'system:notification', {
          type: 'error',
          message: 'Failed to subscribe',
        });
      });
    });

    describe('channel:unsubscribe handler', () => {
      it('unsubscribes session from channel', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('channel:unsubscribe');
        mockSessionManager.unsubscribeFromChannel.mockReturnValue(true);

        await handler({ channelId: 'ch-1' }, 'session-1');

        expect(mockSessionManager.unsubscribeFromChannel).toHaveBeenCalledWith('session-1', 'ch-1');
        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'system:notification', {
          type: 'success',
          message: 'Unsubscribed from channel ch-1',
        });
      });

      it('sends error notification when unsubscribe fails', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('channel:unsubscribe');
        mockSessionManager.unsubscribeFromChannel.mockReturnValue(false);

        await handler({ channelId: 'ch-1' }, 'session-1');

        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'system:notification', {
          type: 'error',
          message: 'Failed to unsubscribe',
        });
      });
    });

    describe('workspace:create handler', () => {
      it('sends workspace:created event', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('workspace:create');

        await handler({ name: 'My Workspace', channels: ['ch-1'] }, 'session-1');

        expect(mockSessionManager.send).toHaveBeenCalledWith(
          'session-1',
          'workspace:created',
          expect.objectContaining({
            workspace: expect.objectContaining({
              name: 'My Workspace',
              channels: ['ch-1'],
            }),
          })
        );
      });

      it('defaults channels to empty array', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('workspace:create');

        await handler({ name: 'Bare Workspace' }, 'session-1');

        expect(mockSessionManager.send).toHaveBeenCalledWith(
          'session-1',
          'workspace:created',
          expect.objectContaining({
            workspace: expect.objectContaining({
              channels: [], // data.channels defaults to empty array
            }),
          })
        );
      });
    });

    describe('workspace:switch handler', () => {
      it('sets metadata and sends notification', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('workspace:switch');

        await handler({ workspaceId: 'ws-1' }, 'session-1');

        expect(mockSessionManager.setMetadata).toHaveBeenCalledWith(
          'session-1',
          'currentWorkspace',
          'ws-1'
        );
        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'system:notification', {
          type: 'success',
          message: 'Switched to workspace ws-1',
        });
      });
    });

    describe('workspace:delete handler', () => {
      it('sends workspace:deleted event', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('workspace:delete');

        await handler({ workspaceId: 'ws-1' }, 'session-1');

        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'workspace:deleted', {
          workspaceId: 'ws-1',
        });
      });
    });

    describe('workspace:list handler', () => {
      it('sends notification with workspace list', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('workspace:list');

        await handler({}, 'session-1');

        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'system:notification', {
          type: 'info',
          message: 'Workspaces: []',
        });
      });
    });

    describe('agent:configure handler', () => {
      it('sets metadata and sends agent state', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('agent:configure');
        const config = { provider: 'openai', model: 'gpt-4o' };

        await handler(config, 'session-1');

        expect(mockSessionManager.setMetadata).toHaveBeenCalledWith(
          'session-1',
          'agentConfig',
          config
        );
        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'agent:state', {
          agentId: 'default',
          state: 'idle',
        });
      });
    });

    describe('agent:stop handler', () => {
      it('sends agent idle state', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('agent:stop');

        await handler({}, 'session-1');

        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'agent:state', {
          agentId: 'default',
          state: 'idle',
        });
      });
    });

    describe('tool:cancel handler', () => {
      it('sends tool:end event with cancellation', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('tool:cancel');

        await handler({ toolId: 'tool-abc' }, 'session-1');

        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'tool:end', {
          sessionId: 'session-1',
          toolId: 'tool-abc',
          result: null,
          error: 'Cancelled by user',
        });
      });
    });

    describe('session:ping handler', () => {
      it('sends connection:ping back', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('session:ping');

        await handler({}, 'session-1');

        expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'connection:ping', {
          timestamp: expect.any(Number),
        });
      });
    });

    describe('session:pong handler', () => {
      it('does not error on pong', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('session:pong');

        // Should not throw
        await expect(handler({ timestamp: 1234 })).resolves.toBeUndefined();
      });
    });
  });

  // =========================================================================
  // attachToServer upgrade handler
  // =========================================================================
  describe('attachToServer upgrade handler', () => {
    function setupGatewayWithUpgrade(): {
      gw: InstanceType<typeof WSGateway>;
      upgradeHandler: (...args: unknown[]) => void;
      mockHttpServer: { on: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
    } {
      const gw = new WSGateway({ path: '/ws' });
      const mockHttpServer = { on: vi.fn(), removeListener: vi.fn() };
      gw.attachToServer(mockHttpServer as unknown as import('node:http').Server);

      const upgradeCall = mockHttpServer.on.mock.calls.find((c: unknown[]) => c[0] === 'upgrade');
      const upgradeHandler = upgradeCall![1] as (...args: unknown[]) => void;

      return { gw, upgradeHandler, mockHttpServer };
    }

    it('handles upgrade for matching path', () => {
      const { upgradeHandler } = setupGatewayWithUpgrade();
      const mockSocket = { write: vi.fn(), destroy: vi.fn() };
      const request = {
        url: '/ws',
        headers: { host: 'localhost' },
        socket: { remoteAddress: '127.0.0.1' },
      };
      const head = Buffer.from('');

      mockWss.handleUpgrade.mockImplementation(
        (_req: unknown, _sock: unknown, _head: unknown, cb: (ws: unknown) => void) => {
          cb({});
        }
      );

      upgradeHandler(request, mockSocket, head);

      expect(mockWss.handleUpgrade).toHaveBeenCalled();
      expect(mockWss.emit).toHaveBeenCalledWith('connection', expect.anything(), request);
    });

    it('destroys socket for non-matching path', () => {
      const { upgradeHandler } = setupGatewayWithUpgrade();
      const mockSocket = { write: vi.fn(), destroy: vi.fn() };
      const request = {
        url: '/other-path',
        headers: { host: 'localhost' },
        socket: { remoteAddress: '127.0.0.1' },
      };
      const head = Buffer.from('');

      upgradeHandler(request, mockSocket, head);

      expect(mockSocket.destroy).toHaveBeenCalled();
      expect(mockWss.handleUpgrade).not.toHaveBeenCalled();
    });

    it('rejects upgrade when token is invalid and API_KEYS are set', () => {
      process.env.API_KEYS = 'valid-key';
      const { upgradeHandler } = setupGatewayWithUpgrade();
      const mockSocket = { write: vi.fn(), destroy: vi.fn() };
      const request = {
        url: '/ws?token=wrong-key',
        headers: { host: 'localhost' },
        socket: { remoteAddress: '127.0.0.1' },
      };
      const head = Buffer.from('');

      upgradeHandler(request, mockSocket, head);

      expect(mockSocket.write).toHaveBeenCalledWith('HTTP/1.1 401 Unauthorized\r\n\r\n');
      expect(mockSocket.destroy).toHaveBeenCalled();
      expect(mockWss.handleUpgrade).not.toHaveBeenCalled();
    });

    it('allows upgrade when valid token is provided', () => {
      process.env.API_KEYS = 'valid-key';
      const { upgradeHandler } = setupGatewayWithUpgrade();
      const mockSocket = { write: vi.fn(), destroy: vi.fn() };
      const request = {
        url: '/ws?token=valid-key',
        headers: { host: 'localhost' },
        socket: { remoteAddress: '127.0.0.1' },
      };
      const head = Buffer.from('');

      mockWss.handleUpgrade.mockImplementation(
        (_req: unknown, _sock: unknown, _head: unknown, cb: (ws: unknown) => void) => {
          cb({});
        }
      );

      upgradeHandler(request, mockSocket, head);

      expect(mockWss.handleUpgrade).toHaveBeenCalled();
      expect(mockSocket.write).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // handleMessage - handler error catching
  // =========================================================================
  describe('handleMessage handler error', () => {
    it('sends HANDLER_ERROR when clientHandler.process rejects', async () => {
      mockClientHandler.process.mockReturnValue(Promise.reject(new Error('Handler boom')));

      const gw = new WSGateway();
      gw.start();

      const connectionHandler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/');
      connectionHandler(socket, request);

      const messageHandler = getSocketHandler(socket, 'message') as (data: RawData) => void;
      mockSessionManager.send.mockClear();

      messageHandler(
        Buffer.from(JSON.stringify({ type: 'chat:send', payload: { content: 'hi' } }))
      );

      // The error is caught asynchronously, so we need to wait
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'connection:error', {
        code: 'HANDLER_ERROR',
        message: 'Failed to process event',
      });
    });
  });

  // =========================================================================
  // heartbeat with no wss (edge case)
  // =========================================================================
  describe('heartbeat edge cases', () => {
    it('skips heartbeat when wss is null (after stop)', async () => {
      const gw = new WSGateway({ heartbeatInterval: 1000 });
      gw.start();
      await gw.stop();

      // Should not throw when timer fires after stop
      vi.advanceTimersByTime(2000);
    });
  });

  // =========================================================================
  // socket error handler
  // =========================================================================
  describe('socket error handler', () => {
    it('handles socket error without crashing', () => {
      const gw = new WSGateway();
      gw.start();

      const handler = getConnectionHandler();
      const socket = createMockSocket();
      const request = createMockRequest('/');
      handler(socket, request);

      const errorHandler = getSocketHandler(socket, 'error');

      // Should not throw
      expect(() => errorHandler(new Error('socket error'))).not.toThrow();
    });
  });

  // =========================================================================
  // cleanup timer
  // =========================================================================
  describe('cleanup timer', () => {
    it('logs when stale sessions are cleaned up', () => {
      mockSessionManager.cleanup.mockReturnValue(3);
      const gw = new WSGateway({
        heartbeatInterval: 10000,
        sessionTimeout: 9000,
      });
      gw.start();

      // Cleanup interval = min(sessionTimeout / 3, 60000) = 3000
      vi.advanceTimersByTime(3000);

      expect(mockSessionManager.cleanup).toHaveBeenCalledWith(9000);
    });

    it('does not log when no sessions cleaned', () => {
      mockSessionManager.cleanup.mockReturnValue(0);
      const gw = new WSGateway({
        heartbeatInterval: 10000,
        sessionTimeout: 9000,
      });
      gw.start();

      vi.advanceTimersByTime(3000);

      // Still called, but returns 0
      expect(mockSessionManager.cleanup).toHaveBeenCalledWith(9000);
    });
  });

  // =========================================================================
  // isAuthRateLimited via handleConnection (standalone mode)
  // =========================================================================
  describe('isAuthRateLimited via handleConnection', () => {
    it('closes socket with 1008 Rate limited after 10 connections from same IP', () => {
      const gw = new WSGateway();
      gw.start();
      const handler = getConnectionHandler();

      // 10 successful connections from same IP fill the bucket
      for (let i = 0; i < 10; i++) {
        handler(createMockSocket(), createMockRequest('/', {}, '10.1.1.1'));
      }

      // 11th connection should be rate limited
      const socket = createMockSocket();
      handler(socket, createMockRequest('/', {}, '10.1.1.1'));

      expect(socket.close).toHaveBeenCalledWith(1008, 'Rate limited');
    });
  });

  // =========================================================================
  // isAuthRateLimited via attachToServer upgrade handler
  // =========================================================================
  describe('isAuthRateLimited via upgrade handler', () => {
    it('sends 429 and destroys socket when IP is rate limited', () => {
      const gw = new WSGateway({ path: '/ws' });
      const mockHttpServer = { on: vi.fn(), removeListener: vi.fn() };
      gw.attachToServer(mockHttpServer as unknown as import('node:http').Server);

      const upgradeCall = mockHttpServer.on.mock.calls.find((c: unknown[]) => c[0] === 'upgrade');
      const upgradeHandler = upgradeCall![1] as (...args: unknown[]) => void;

      const makeReq = () => ({
        url: '/ws',
        headers: { host: 'localhost' },
        socket: { remoteAddress: '10.1.1.2' },
      });

      // Fill rate limit bucket for this IP (10 calls)
      for (let i = 0; i < 10; i++) {
        upgradeHandler(makeReq(), { write: vi.fn(), destroy: vi.fn() }, Buffer.from(''));
      }

      // 11th is rate limited
      const rateLimitedSocket = { write: vi.fn(), destroy: vi.fn() };
      upgradeHandler(makeReq(), rateLimitedSocket, Buffer.from(''));

      expect(rateLimitedSocket.write).toHaveBeenCalledWith(
        'HTTP/1.1 429 Too Many Requests\r\n\r\n'
      );
      expect(rateLimitedSocket.destroy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // startEventBridge + setupLegacyEventForwarding
  // =========================================================================
  describe('startEventBridge', () => {
    it('starts EventBusBridge and registers legacy event handlers', () => {
      const gw = new WSGateway();
      gw.startEventBridge();

      expect(mockEventBridgeInst.start).toHaveBeenCalled();
      expect(mockEventSystem.onPattern).toHaveBeenCalled();
      expect(mockEventSystem.on).toHaveBeenCalled();
      expect(mockEventSystem.onAny).toHaveBeenCalled();
    });

    it('returns the same bridge on repeated calls (idempotent)', () => {
      const gw = new WSGateway();
      const bridge1 = gw.startEventBridge();
      const bridge2 = gw.startEventBridge();

      expect(bridge1).toBe(bridge2);
      expect(mockEventBridgeInst.start).toHaveBeenCalledTimes(1);
    });

    it('stops bridge and clears legacyUnsubs on stop()', async () => {
      const gw = new WSGateway();
      gw.start();
      gw.startEventBridge();

      await gw.stop();

      expect(mockEventBridgeInst.stop).toHaveBeenCalled();
    });
  });

  describe('setupLegacyEventForwarding', () => {
    function getPatternCb(pattern: string): (event: unknown) => void {
      const call = (mockEventSystem.onPattern as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === pattern
      );
      if (!call) throw new Error(`No onPattern callback for ${pattern}`);
      return call[1] as (event: unknown) => void;
    }
    function getOnCb(eventName: string): (event: unknown) => void {
      const call = (mockEventSystem.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === eventName
      );
      if (!call) throw new Error(`No on callback for ${eventName}`);
      return call[1] as (event: unknown) => void;
    }
    function getAnyCb(eventName: string): (event: unknown) => void {
      const call = (mockEventSystem.onAny as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === eventName
      );
      if (!call) throw new Error(`No onAny callback for ${eventName}`);
      return call[1] as (event: unknown) => void;
    }

    it('forwards trigger.success as trigger:executed with success status', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('trigger.*');

      cb({
        type: 'trigger.success',
        data: { triggerId: 't-1', triggerName: 'nightly', durationMs: 100 },
      });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'trigger:executed',
        expect.objectContaining({ triggerId: 't-1', status: 'success' })
      );
    });

    it('forwards trigger.failed as trigger:executed with failure status', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('trigger.*');

      cb({
        type: 'trigger.failed',
        data: { triggerId: 't-2', triggerName: 'daily', durationMs: 50, error: 'Timeout' },
      });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'trigger:executed',
        expect.objectContaining({ status: 'failure', error: 'Timeout' })
      );
    });

    it('ignores non-success/failed trigger events', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('trigger.*');
      mockSessionManager.broadcast.mockClear();

      cb({ type: 'trigger.created', data: {} });

      const triggerCalls = (
        mockSessionManager.broadcast as ReturnType<typeof vi.fn>
      ).mock.calls.filter((c: unknown[]) => c[0] === 'trigger:executed');
      expect(triggerCalls).toHaveLength(0);
    });

    it('forwards pulse.started as pulse:activity', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('pulse.*');

      cb({ type: 'pulse.started', data: { pulseId: 'p-1', stage: 'init' } });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'pulse:activity',
        expect.objectContaining({ status: 'started', pulseId: 'p-1' })
      );
    });

    it('forwards pulse.stage with stage field', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('pulse.*');

      cb({ type: 'pulse.stage', data: { stage: 'processing', pulseId: 'p-2' } });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'pulse:activity',
        expect.objectContaining({ status: 'stage', stage: 'processing' })
      );
    });

    it('forwards pulse.completed as pulse:activity', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('pulse.*');

      cb({ type: 'pulse.completed', data: { pulseId: 'p-3' } });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'pulse:activity',
        expect.objectContaining({ status: 'completed' })
      );
    });

    it('forwards unknown pulse type using event type as status', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('pulse.*');

      cb({ type: 'pulse.custom', data: { pulseId: null } });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'pulse:activity',
        expect.objectContaining({ status: 'pulse.custom' })
      );
    });

    it('forwards gateway.system.notification as system:notification', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getOnCb('gateway.system.notification');
      const notif = { type: 'info', message: 'Hello' };

      cb({ type: 'gateway.system.notification', data: notif });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith('system:notification', notif);
    });

    it('forwards gateway.data.changed as data:changed', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getAnyCb('gateway.data.changed');
      const payload = { entity: 'memory', id: 'm-1' };

      cb({ type: 'gateway.data.changed', data: payload });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith('data:changed', payload);
    });

    it('forwards background-agent.update as background-agent:update', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getAnyCb('background-agent.update');
      const payload = { agentId: 'bg-1', status: 'running' };

      cb({ type: 'background-agent.update', data: payload });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith('background-agent:update', payload);
    });

    it('forwards subagent.spawned as subagent:spawned', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getAnyCb('subagent.spawned');

      cb({ type: 'subagent.spawned', data: { subagentId: 'sa-1' } });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'subagent:spawned',
        expect.objectContaining({ subagentId: 'sa-1' })
      );
    });

    it('forwards subagent.progress as subagent:progress', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getAnyCb('subagent.progress');

      cb({ type: 'subagent.progress', data: { subagentId: 'sa-1', progress: 50 } });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'subagent:progress',
        expect.objectContaining({ progress: 50 })
      );
    });

    it('forwards subagent.completed as subagent:completed', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getAnyCb('subagent.completed');

      cb({ type: 'subagent.completed', data: { subagentId: 'sa-1' } });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'subagent:completed',
        expect.objectContaining({ subagentId: 'sa-1' })
      );
    });

    it('forwards orchestra.started as orchestra:started', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getAnyCb('orchestra.started');

      cb({ type: 'orchestra.started', data: { orchestraId: 'o-1' } });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'orchestra:started',
        expect.objectContaining({ orchestraId: 'o-1' })
      );
    });

    it('forwards orchestra.task.complete as orchestra:task:complete', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getAnyCb('orchestra.task.complete');

      cb({ type: 'orchestra.task.complete', data: { taskId: 'task-1' } });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'orchestra:task:complete',
        expect.objectContaining({ taskId: 'task-1' })
      );
    });

    it('forwards orchestra.completed as orchestra:completed', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getAnyCb('orchestra.completed');

      cb({ type: 'orchestra.completed', data: { orchestraId: 'o-1' } });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'orchestra:completed',
        expect.objectContaining({ orchestraId: 'o-1' })
      );
    });

    it('forwards channel.user.pending as channel:user:pending', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('channel.user.*');

      cb({
        type: 'channel.user.pending',
        data: {
          channelPluginId: 'tg-1',
          platform: 'telegram',
          platformUserId: 'u-1',
          displayName: 'Alice',
        },
      });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'channel:user:pending',
        expect.objectContaining({ channelId: 'tg-1', platform: 'telegram', platformUserId: 'u-1' })
      );
    });

    it('forwards channel.user.blocked as channel:user:blocked', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('channel.user.*');

      cb({
        type: 'channel.user.blocked',
        data: { channelPluginId: 'tg-1', platform: 'telegram', platformUserId: 'u-1' },
      });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'channel:user:blocked',
        expect.objectContaining({ platform: 'telegram', platformUserId: 'u-1' })
      );
    });

    it('forwards channel.user.unblocked as channel:user:unblocked', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('channel.user.*');

      cb({
        type: 'channel.user.unblocked',
        data: { channelPluginId: 'tg-1', platform: 'telegram', platformUserId: 'u-1' },
      });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'channel:user:unblocked',
        expect.objectContaining({ platform: 'telegram' })
      );
    });

    it('forwards channel.user.verified as channel:user:verified', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('channel.user.*');

      cb({
        type: 'channel.user.verified',
        data: {
          platform: 'telegram',
          platformUserId: 'u-1',
          ownpilotUserId: 'op-1',
          verificationMethod: 'pin',
        },
      });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'channel:user:verified',
        expect.objectContaining({
          platform: 'telegram',
          ownpilotUserId: 'op-1',
          verificationMethod: 'pin',
        })
      );
    });

    it('forwards channel.user.first_seen as channel:user:first_seen', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('channel.user.*');

      cb({
        type: 'channel.user.first_seen',
        data: {
          channelPluginId: 'tg-1',
          platform: 'telegram',
          user: { platformUserId: 'u-new', displayName: 'Bob' },
        },
      });

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'channel:user:first_seen',
        expect.objectContaining({ platform: 'telegram', platformUserId: 'u-new' })
      );
    });

    it('ignores unknown channel.user.* event types', () => {
      const gw = new WSGateway();
      gw.startEventBridge();
      const cb = getPatternCb('channel.user.*');
      mockSessionManager.broadcast.mockClear();

      cb({ type: 'channel.user.custom', data: {} });

      const channelUserCalls = (
        mockSessionManager.broadcast as ReturnType<typeof vi.fn>
      ).mock.calls.filter((c: unknown[]) => String(c[0]).startsWith('channel:user:'));
      expect(channelUserCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // chat:send handler
  // =========================================================================
  describe('chat:send handler', () => {
    function getRegisteredHandler(
      eventType: string
    ): (data: unknown, sessionId?: string) => Promise<void> {
      const call = mockClientHandler.handle.mock.calls.find((c: unknown[]) => c[0] === eventType);
      if (!call) throw new Error(`No handler registered for ${eventType}`);
      return call[1] as (data: unknown, sessionId?: string) => Promise<void>;
    }

    it('sends demo response chunks when isDemoMode returns true', async () => {
      const agentsMod = await import('../routes/agents.js');
      (agentsMod.getOrCreateDefaultAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
        chat: vi.fn(),
      });
      (agentsMod.isDemoMode as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('chat:send');

      const handlerPromise = handler({ content: 'hello' }, 'session-1');
      await vi.advanceTimersByTimeAsync(10000);
      await handlerPromise;

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'chat:stream:start',
        expect.anything()
      );
      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'chat:stream:chunk',
        expect.anything()
      );
      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'chat:stream:end',
        expect.anything()
      );
      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'chat:message',
        expect.anything()
      );
    });

    it('escapes HTML in demo mode content (covers escapeHtml)', async () => {
      const agentsMod = await import('../routes/agents.js');
      (agentsMod.getOrCreateDefaultAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
        chat: vi.fn(),
      });
      (agentsMod.isDemoMode as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('chat:send');

      const handlerPromise = handler({ content: '<script>alert("xss")</script>' }, 'session-1');
      await vi.advanceTimersByTimeAsync(10000);
      await handlerPromise;

      const streamEndCall = (mockSessionManager.send as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[1] === 'chat:stream:end'
      );
      const fullContent = (streamEndCall![2] as { fullContent: string }).fullContent;
      expect(fullContent).not.toContain('<script>');
      expect(fullContent).toContain('&lt;script&gt;');
    });

    it('does nothing in demo mode when sessionId is undefined', async () => {
      const agentsMod = await import('../routes/agents.js');
      (agentsMod.getOrCreateDefaultAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
        chat: vi.fn(),
      });
      (agentsMod.isDemoMode as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('chat:send');

      const handlerPromise = handler({ content: 'test' }, undefined);
      await vi.advanceTimersByTimeAsync(5000);
      await handlerPromise;

      const streamStartCalls = (
        mockSessionManager.send as ReturnType<typeof vi.fn>
      ).mock.calls.filter((c: unknown[]) => c[1] === 'chat:stream:start');
      expect(streamStartCalls).toHaveLength(0);
    });

    it('processes with real agent and sends stream:end with final content', async () => {
      const agentsMod = await import('../routes/agents.js');
      const mockAgent = {
        chat: vi.fn().mockResolvedValue({ ok: true, value: { content: 'AI response' } }),
      };
      (agentsMod.getOrCreateDefaultAgent as ReturnType<typeof vi.fn>).mockResolvedValue(mockAgent);
      (agentsMod.isDemoMode as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('chat:send');

      await handler({ content: 'Hello AI' }, 'session-1');

      expect(mockAgent.chat).toHaveBeenCalledWith(
        'Hello AI',
        expect.objectContaining({ stream: true })
      );
      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'chat:stream:end',
        expect.objectContaining({ fullContent: 'AI response' })
      );
      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'chat:message',
        expect.anything()
      );
    });

    it('sends stream chunks via onChunk in real agent mode', async () => {
      const agentsMod = await import('../routes/agents.js');
      const mockAgent = {
        chat: vi
          .fn()
          .mockImplementation(async (_c: string, opts: { onChunk: (c: unknown) => void }) => {
            opts.onChunk({ content: 'chunk1' });
            opts.onChunk({ content: 'chunk2' });
            return { ok: false };
          }),
      };
      (agentsMod.getOrCreateDefaultAgent as ReturnType<typeof vi.fn>).mockResolvedValue(mockAgent);
      (agentsMod.isDemoMode as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('chat:send');

      await handler({ content: 'test' }, 'session-1');

      const chunkCalls = (mockSessionManager.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => c[1] === 'chat:stream:chunk'
      );
      expect(chunkCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('sends tool:start events when onChunk delivers toolCalls', async () => {
      const agentsMod = await import('../routes/agents.js');
      const mockAgent = {
        chat: vi
          .fn()
          .mockImplementation(async (_c: string, opts: { onChunk: (c: unknown) => void }) => {
            opts.onChunk({ toolCalls: [{ id: 'tc-1', name: 'search_files' }] });
            return { ok: false };
          }),
      };
      (agentsMod.getOrCreateDefaultAgent as ReturnType<typeof vi.fn>).mockResolvedValue(mockAgent);
      (agentsMod.isDemoMode as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('chat:send');

      await handler({ content: 'find files' }, 'session-1');

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'tool:start',
        expect.objectContaining({
          tool: expect.objectContaining({ id: 'tc-1', name: 'search_files' }),
        })
      );
    });

    it('sends chat:error on exception', async () => {
      const agentsMod = await import('../routes/agents.js');
      (agentsMod.getOrCreateDefaultAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Agent failure')
      );
      (agentsMod.isDemoMode as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('chat:send');

      await handler({ content: 'test' }, 'session-1');

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'chat:error',
        expect.objectContaining({ error: 'Agent failure' })
      );
    });

    it('does not send chat:error when sessionId is missing on exception', async () => {
      const agentsMod = await import('../routes/agents.js');
      (agentsMod.getOrCreateDefaultAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('boom')
      );
      (agentsMod.isDemoMode as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('chat:send');

      mockSessionManager.send.mockClear();
      await handler({ content: 'test' }, undefined);

      const errorCalls = (mockSessionManager.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => c[1] === 'chat:error'
      );
      expect(errorCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // channel:connect handler
  // =========================================================================
  describe('channel:connect handler', () => {
    function getRegisteredHandler(
      eventType: string
    ): (data: unknown, sessionId?: string) => Promise<void> {
      const call = mockClientHandler.handle.mock.calls.find((c: unknown[]) => c[0] === eventType);
      if (!call) throw new Error(`No handler for ${eventType}`);
      return call[1] as (data: unknown, sessionId?: string) => Promise<void>;
    }

    it('connects channel and sends channel:connected on success', async () => {
      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:connect');

      await handler({ type: 'telegram', config: { id: 'tg-1', name: 'My Telegram' } }, 'session-1');

      expect(mockChannelServiceInst.connect).toHaveBeenCalledWith('tg-1');
      expect(mockSessionManager.subscribeToChannel).toHaveBeenCalledWith('session-1', 'tg-1');
      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'channel:connected',
        expect.objectContaining({
          channel: expect.objectContaining({ id: 'tg-1', type: 'test-platform' }),
        })
      );
    });

    it('generates channel ID when not provided in config', async () => {
      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:connect');

      await handler({ type: 'slack', config: {} }, 'session-1');

      expect(mockChannelServiceInst.connect).toHaveBeenCalledWith(
        expect.stringContaining('slack-')
      );
    });

    it('sends channel:status error when getChannel returns null', async () => {
      mockChannelServiceInst.getChannel.mockReturnValue(null);

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:connect');

      await handler({ type: 'telegram', config: { id: 'tg-missing' } }, 'session-1');

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'channel:status',
        expect.objectContaining({ status: 'error' })
      );
    });

    it('sends channel:status error when connect() throws', async () => {
      mockChannelServiceInst.connect.mockRejectedValue(new Error('Connection refused'));

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:connect');

      await handler({ type: 'telegram', config: { id: 'tg-1' } }, 'session-1');

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'channel:status',
        expect.objectContaining({ status: 'error' })
      );
    });

    it('does not send channel:connected when sessionId is undefined', async () => {
      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:connect');

      mockSessionManager.send.mockClear();
      await handler({ type: 'telegram', config: { id: 'tg-1' } }, undefined);

      const connectedCalls = (
        mockSessionManager.send as ReturnType<typeof vi.fn>
      ).mock.calls.filter((c: unknown[]) => c[1] === 'channel:connected');
      expect(connectedCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // channel:disconnect handler
  // =========================================================================
  describe('channel:disconnect handler', () => {
    function getRegisteredHandler(
      eventType: string
    ): (data: unknown, sessionId?: string) => Promise<void> {
      const call = mockClientHandler.handle.mock.calls.find((c: unknown[]) => c[0] === eventType);
      if (!call) throw new Error(`No handler for ${eventType}`);
      return call[1] as (data: unknown, sessionId?: string) => Promise<void>;
    }

    it('disconnects channel and sends channel:disconnected', async () => {
      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:disconnect');

      await handler({ channelId: 'tg-1' }, 'session-1');

      expect(mockChannelServiceInst.disconnect).toHaveBeenCalledWith('tg-1');
      expect(mockSessionManager.unsubscribeFromChannel).toHaveBeenCalledWith('session-1', 'tg-1');
      expect(mockSessionManager.send).toHaveBeenCalledWith('session-1', 'channel:disconnected', {
        channelId: 'tg-1',
        reason: 'User requested disconnect',
      });
    });

    it('sends system:notification error when disconnect() throws', async () => {
      mockChannelServiceInst.disconnect.mockRejectedValue(new Error('Disconnect failed'));

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:disconnect');

      await handler({ channelId: 'tg-1' }, 'session-1');

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'system:notification',
        expect.objectContaining({ type: 'error' })
      );
    });

    it('does not send when sessionId is undefined', async () => {
      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:disconnect');

      mockSessionManager.send.mockClear();
      await handler({ channelId: 'tg-1' }, undefined);

      expect(mockSessionManager.send).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // channel:send handler
  // =========================================================================
  describe('channel:send handler', () => {
    function getRegisteredHandler(
      eventType: string
    ): (data: unknown, sessionId?: string) => Promise<void> {
      const call = mockClientHandler.handle.mock.calls.find((c: unknown[]) => c[0] === eventType);
      if (!call) throw new Error(`No handler for ${eventType}`);
      return call[1] as (data: unknown, sessionId?: string) => Promise<void>;
    }

    it('sends message and emits channel:message:sent', async () => {
      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:send');

      await handler(
        { message: { channelId: 'tg-1', content: 'Hi there', replyToId: null } },
        'session-1'
      );

      expect(mockChannelServiceInst.send).toHaveBeenCalledWith(
        'tg-1',
        expect.objectContaining({ text: 'Hi there' })
      );
      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'channel:message:sent',
        expect.objectContaining({ channelId: 'tg-1', messageId: 'msg-1' })
      );
    });

    it('parses legacy adapterId:chatId format (platformChatId = part after colon)', async () => {
      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:send');

      await handler({ message: { channelId: 'tg:chat123', content: 'Hello' } }, 'session-1');

      expect(mockChannelServiceInst.send).toHaveBeenCalledWith(
        'tg:chat123',
        expect.objectContaining({ platformChatId: 'chat123' })
      );
    });

    it('sends channel:message:error on service failure', async () => {
      mockChannelServiceInst.send.mockRejectedValue(new Error('Send failed'));

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:send');

      await handler({ message: { channelId: 'tg-1', content: 'test' } }, 'session-1');

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'channel:message:error',
        expect.objectContaining({ channelId: 'tg-1' })
      );
    });
  });

  // =========================================================================
  // channel:list handler
  // =========================================================================
  describe('channel:list handler', () => {
    function getRegisteredHandler(
      eventType: string
    ): (data: unknown, sessionId?: string) => Promise<void> {
      const call = mockClientHandler.handle.mock.calls.find((c: unknown[]) => c[0] === eventType);
      if (!call) throw new Error(`No handler for ${eventType}`);
      return call[1] as (data: unknown, sessionId?: string) => Promise<void>;
    }

    it('sends channel list via system:notification with summary', async () => {
      mockChannelServiceInst.listChannels.mockReturnValue([
        { pluginId: 'tg-1', platform: 'telegram', name: 'Telegram', status: 'connected' },
      ]);

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:list');

      await handler({}, 'session-1');

      const notifCall = (mockSessionManager.send as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[1] === 'system:notification'
      );
      expect(notifCall).toBeDefined();
      const msg = JSON.parse((notifCall![2] as { message: string }).message);
      expect(msg.channels).toHaveLength(1);
      expect(msg.summary.total).toBe(1);
      expect(msg.summary.connected).toBe(1);
    });

    it('sends channel:connected for each channel in the list', async () => {
      mockChannelServiceInst.listChannels.mockReturnValue([
        { pluginId: 'tg-1', platform: 'telegram', name: 'Telegram', status: 'connected' },
        { pluginId: 'wa-1', platform: 'whatsapp', name: 'WhatsApp', status: 'disconnected' },
      ]);

      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:list');

      await handler({}, 'session-1');

      const connectedCalls = (
        mockSessionManager.send as ReturnType<typeof vi.fn>
      ).mock.calls.filter((c: unknown[]) => c[1] === 'channel:connected');
      expect(connectedCalls).toHaveLength(2);
    });

    it('does nothing when sessionId is undefined', async () => {
      const _gw = new WSGateway();
      const handler = getRegisteredHandler('channel:list');

      mockSessionManager.send.mockClear();
      await handler({}, undefined);

      expect(mockSessionManager.send).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // coding-agent handlers
  // =========================================================================
  describe('coding-agent handlers', () => {
    function getRegisteredHandler(
      eventType: string
    ): (data: unknown, sessionId?: string) => Promise<void> {
      const call = mockClientHandler.handle.mock.calls.find((c: unknown[]) => c[0] === eventType);
      if (!call) throw new Error(`No handler for ${eventType}`);
      return call[1] as (data: unknown, sessionId?: string) => Promise<void>;
    }

    beforeEach(() => {
      mockSessionManager.get.mockReturnValue({ userId: 'user-1' });
    });

    describe('coding-agent:input', () => {
      it('writes to coding agent session', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('coding-agent:input');

        await handler({ sessionId: 'ca-1', data: 'ls -la\n' }, 'ws-session-1');

        expect(mockCodingAgentSessions.writeToSession).toHaveBeenCalledWith(
          'ca-1',
          'user-1',
          'ls -la\n'
        );
      });

      it('returns early when wsSessionId is undefined', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('coding-agent:input');

        await handler({ sessionId: 'ca-1', data: 'ls' }, undefined);

        expect(mockCodingAgentSessions.writeToSession).not.toHaveBeenCalled();
      });

      it('uses default userId when session not found', async () => {
        mockSessionManager.get.mockReturnValue(null);

        const _gw = new WSGateway();
        const handler = getRegisteredHandler('coding-agent:input');

        await handler({ sessionId: 'ca-1', data: 'pwd' }, 'ws-session-1');

        expect(mockCodingAgentSessions.writeToSession).toHaveBeenCalledWith(
          'ca-1',
          'default',
          'pwd'
        );
      });
    });

    describe('coding-agent:resize', () => {
      it('resizes coding agent session', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('coding-agent:resize');

        await handler({ sessionId: 'ca-1', cols: 120, rows: 30 }, 'ws-session-1');

        expect(mockCodingAgentSessions.resizeSession).toHaveBeenCalledWith(
          'ca-1',
          'user-1',
          120,
          30
        );
      });

      it('returns early when wsSessionId is undefined', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('coding-agent:resize');

        await handler({ sessionId: 'ca-1', cols: 80, rows: 24 }, undefined);

        expect(mockCodingAgentSessions.resizeSession).not.toHaveBeenCalled();
      });
    });

    describe('coding-agent:subscribe', () => {
      it('subscribes to coding agent session', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('coding-agent:subscribe');

        await handler({ sessionId: 'ca-1' }, 'ws-session-1');

        expect(mockCodingAgentSessions.subscribe).toHaveBeenCalledWith(
          'ca-1',
          'ws-session-1',
          'user-1'
        );
      });

      it('returns early when wsSessionId is undefined', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('coding-agent:subscribe');

        await handler({ sessionId: 'ca-1' }, undefined);

        expect(mockCodingAgentSessions.subscribe).not.toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // event:subscribe / event:unsubscribe / event:publish handlers
  // =========================================================================
  describe('event bridge client handlers', () => {
    function getRegisteredHandler(
      eventType: string
    ): (data: unknown, sessionId?: string) => Promise<void> {
      const call = mockClientHandler.handle.mock.calls.find((c: unknown[]) => c[0] === eventType);
      if (!call) throw new Error(`No handler for ${eventType}`);
      return call[1] as (data: unknown, sessionId?: string) => Promise<void>;
    }

    describe('event:subscribe', () => {
      it('calls eventBridge.subscribe when bridge is initialized', async () => {
        const gw = new WSGateway();
        gw.startEventBridge();
        const handler = getRegisteredHandler('event:subscribe');

        await handler({ pattern: 'trigger.*' }, 'ws-session-1');

        expect(mockEventBridgeInst.subscribe).toHaveBeenCalledWith('ws-session-1', 'trigger.*');
      });

      it('returns early when no eventBridge', async () => {
        const _gw = new WSGateway(); // bridge not started
        const handler = getRegisteredHandler('event:subscribe');

        await handler({ pattern: 'trigger.*' }, 'ws-session-1');

        expect(mockEventBridgeInst.subscribe).not.toHaveBeenCalled();
      });

      it('returns early when wsSessionId is undefined', async () => {
        const gw = new WSGateway();
        gw.startEventBridge();
        const handler = getRegisteredHandler('event:subscribe');

        await handler({ pattern: 'trigger.*' }, undefined);

        expect(mockEventBridgeInst.subscribe).not.toHaveBeenCalled();
      });
    });

    describe('event:unsubscribe', () => {
      it('calls eventBridge.unsubscribe when bridge is initialized', async () => {
        const gw = new WSGateway();
        gw.startEventBridge();
        const handler = getRegisteredHandler('event:unsubscribe');

        await handler({ pattern: 'trigger.*' }, 'ws-session-1');

        expect(mockEventBridgeInst.unsubscribe).toHaveBeenCalledWith('ws-session-1', 'trigger.*');
      });

      it('returns early when no eventBridge', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('event:unsubscribe');

        await handler({ pattern: 'trigger.*' }, 'ws-session-1');

        expect(mockEventBridgeInst.unsubscribe).not.toHaveBeenCalled();
      });
    });

    describe('event:publish', () => {
      it('calls eventBridge.publish when bridge is initialized', async () => {
        const gw = new WSGateway();
        gw.startEventBridge();
        const handler = getRegisteredHandler('event:publish');

        await handler({ type: 'custom.event', data: { x: 1 } }, 'ws-session-1');

        expect(mockEventBridgeInst.publish).toHaveBeenCalledWith('ws-session-1', 'custom.event', {
          x: 1,
        });
      });

      it('returns early when no eventBridge', async () => {
        const _gw = new WSGateway();
        const handler = getRegisteredHandler('event:publish');

        await handler({ type: 'custom.event', data: {} }, 'ws-session-1');

        expect(mockEventBridgeInst.publish).not.toHaveBeenCalled();
      });
    });
  });
});
