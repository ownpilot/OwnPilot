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
    getChannelService: vi.fn(),
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

    // Re-import to get a fresh module
    const mod = await import('./server.js');
    WSGateway = mod.WSGateway;
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
      const request = { url: '/ws', headers: { host: 'localhost' } };
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
      const request = { url: '/other-path', headers: { host: 'localhost' } };
      const head = Buffer.from('');

      upgradeHandler(request, mockSocket, head);

      expect(mockSocket.destroy).toHaveBeenCalled();
      expect(mockWss.handleUpgrade).not.toHaveBeenCalled();
    });

    it('rejects upgrade when token is invalid and API_KEYS are set', () => {
      process.env.API_KEYS = 'valid-key';
      const { upgradeHandler } = setupGatewayWithUpgrade();
      const mockSocket = { write: vi.fn(), destroy: vi.fn() };
      const request = { url: '/ws?token=wrong-key', headers: { host: 'localhost' } };
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
      const request = { url: '/ws?token=valid-key', headers: { host: 'localhost' } };
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
});
