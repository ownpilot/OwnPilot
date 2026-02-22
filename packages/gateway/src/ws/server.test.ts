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

vi.mock('@ownpilot/core', () => ({
  getChannelService: vi.fn(),
}));

vi.mock('../routes/agents.js', () => ({
  getOrCreateDefaultAgent: vi.fn(),
  isDemoMode: vi.fn(),
}));

vi.mock('../routes/helpers.js', () => ({
  getErrorMessage: vi.fn((e: unknown) =>
    e instanceof Error ? e.message : 'Unknown error'
  ),
}));

vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
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
  const call = mockWss.on.mock.calls.find(
    (c: unknown[]) => c[0] === 'connection'
  );
  if (!call) throw new Error('connection handler not registered');
  return call[1] as (socket: WebSocket, request: unknown) => void;
}

/**
 * Given a mock socket that went through handleConnection, extract the
 * handler registered for the given event name.
 */
function getSocketHandler(
  socket: WebSocket,
  event: string
): (...args: unknown[]) => void {
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
    mockWss.close.mockImplementation(
      (cb?: (err?: Error) => void) => cb?.()
    );
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

      expect(socket.close).toHaveBeenCalledWith(
        1013,
        'Maximum connections reached'
      );
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

      expect(socket.close).toHaveBeenCalledWith(
        1008,
        'Authentication required'
      );
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

      expect(socket.close).toHaveBeenCalledWith(
        1008,
        'Authentication required'
      );
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

      expect(socket.close).toHaveBeenCalledWith(
        1013,
        'Maximum connections reached'
      );
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
      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'connection:ready',
        { sessionId: 'session-1' }
      );
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
        Buffer.from(
          JSON.stringify({ type: 'chat:send', payload: { content: 'hi' } })
        )
      );

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'connection:error',
        { code: 'RATE_LIMITED', message: 'Too many messages, slow down' }
      );
    });

    it('sends PARSE_ERROR on invalid JSON', () => {
      const messageHandler = setupAndGetMessageHandler();

      messageHandler(Buffer.from('not valid json!!!'));

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'connection:error',
        { code: 'PARSE_ERROR', message: 'Invalid JSON message' }
      );
    });

    it('sends INVALID_MESSAGE when type is missing', () => {
      const messageHandler = setupAndGetMessageHandler();

      messageHandler(
        Buffer.from(JSON.stringify({ payload: { content: 'hi' } }))
      );

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'connection:error',
        { code: 'INVALID_MESSAGE', message: 'Message must have a type' }
      );
    });

    it('sends INVALID_MESSAGE when type is not a string', () => {
      const messageHandler = setupAndGetMessageHandler();

      messageHandler(
        Buffer.from(JSON.stringify({ type: 123, payload: {} }))
      );

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'connection:error',
        { code: 'INVALID_MESSAGE', message: 'Message must have a type' }
      );
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

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'session-1',
        'connection:error',
        { code: 'UNKNOWN_EVENT', message: 'Unknown event type' }
      );
    });

    it('processes valid events through clientHandler', () => {
      const messageHandler = setupAndGetMessageHandler();

      const payload = { content: 'hello' };
      messageHandler(
        Buffer.from(
          JSON.stringify({ type: 'chat:send', payload })
        )
      );

      expect(mockClientHandler.has).toHaveBeenCalledWith('chat:send');
      expect(mockClientHandler.process).toHaveBeenCalledWith(
        'chat:send',
        payload,
        'session-1'
      );
    });

    it('touches session on valid message', () => {
      const messageHandler = setupAndGetMessageHandler();

      // Clear any prior calls from connection setup
      mockSessionManager.touch.mockClear();

      messageHandler(
        Buffer.from(
          JSON.stringify({ type: 'chat:send', payload: { content: 'hi' } })
        )
      );

      expect(mockSessionManager.touch).toHaveBeenCalledWith('session-1');
    });

    it('does not process when clientHandler has no handler', () => {
      mockClientHandler.has.mockReturnValue(false);
      const messageHandler = setupAndGetMessageHandler();

      messageHandler(
        Buffer.from(
          JSON.stringify({ type: 'chat:send', payload: { content: 'hi' } })
        )
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
      const registeredEvents = mockWss.on.mock.calls.map(
        (c: unknown[]) => c[0]
      );
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

      const registeredEvents = mockWss.on.mock.calls.map(
        (c: unknown[]) => c[0]
      );
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

      expect(socket1.close).toHaveBeenCalledWith(
        1001,
        'Server shutting down'
      );
      expect(socket2.close).toHaveBeenCalledWith(
        1001,
        'Server shutting down'
      );

      mockWss.clients.clear();
    });

    it('rejects if wss.close returns an error', async () => {
      const gw = new WSGateway();
      gw.start();

      const closeError = new Error('close failed');
      mockWss.close.mockImplementation(
        (cb?: (err?: Error) => void) => cb?.(closeError)
      );

      await expect(gw.stop()).rejects.toThrow('close failed');

      // Reset for other tests
      mockWss.close.mockImplementation(
        (cb?: (err?: Error) => void) => cb?.()
      );
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

      expect(mockHttpServer.on).toHaveBeenCalledWith(
        'upgrade',
        expect.any(Function)
      );
      // Also sets up connection/error handlers on wss
      const registeredEvents = mockWss.on.mock.calls.map(
        (c: unknown[]) => c[0]
      );
      expect(registeredEvents).toContain('connection');
    });

    it('throws if already running', () => {
      const gw = new WSGateway();
      gw.start();

      const mockHttpServer = { on: vi.fn(), removeListener: vi.fn() };
      expect(() =>
        gw.attachToServer(
          mockHttpServer as unknown as import('node:http').Server
        )
      ).toThrow('WebSocket server already running');
    });

    it('removes upgrade handler on stop', async () => {
      const gw = new WSGateway();
      const mockHttpServer = {
        on: vi.fn(),
        removeListener: vi.fn(),
      };

      gw.attachToServer(
        mockHttpServer as unknown as import('node:http').Server
      );

      await gw.stop();

      expect(mockHttpServer.removeListener).toHaveBeenCalledWith(
        'upgrade',
        expect.any(Function)
      );
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

      expect(mockSessionManager.broadcast).toHaveBeenCalledWith(
        'connection:ready',
        payload
      );
      expect(count).toBe(3);
    });
  });

  describe('send', () => {
    it('delegates to sessionManager.send', () => {
      const gw = new WSGateway();
      const payload = { sessionId: 'test-session' };

      const result = gw.send('sess-1', 'connection:ready', payload);

      expect(mockSessionManager.send).toHaveBeenCalledWith(
        'sess-1',
        'connection:ready',
        payload
      );
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

    it.each(validEvents)(
      'accepts %s as a valid event type',
      (eventType) => {
        const messageHandler = setupAndGetMessageHandler();

        // Clear prior send calls from connection:ready
        mockSessionManager.send.mockClear();

        messageHandler(
          Buffer.from(
            JSON.stringify({ type: eventType, payload: {} })
          )
        );

        // Should not get an UNKNOWN_EVENT error
        const errorCalls = mockSessionManager.send.mock.calls.filter(
          (c: unknown[]) =>
            c[1] === 'connection:error' &&
            (c[2] as { code: string }).code === 'UNKNOWN_EVENT'
        );
        expect(errorCalls).toHaveLength(0);
      }
    );
  });
});
