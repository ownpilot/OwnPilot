import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServerRecord } from '../db/repositories/mcp-servers.js';

// =============================================================================
// MOCKS
// =============================================================================

const mockClient = {
  connect: vi.fn(),
  listTools: vi.fn().mockResolvedValue({ tools: [] }),
  callTool: vi.fn(),
};

const mockTransport = {
  close: vi.fn(),
};

const mockRepo = {
  updateStatus: vi.fn(),
  getByName: vi.fn(),
  getEnabled: vi.fn().mockResolvedValue([]),
};

const mockRegistry = {
  registerMcpTools: vi.fn(),
  unregisterMcpTools: vi.fn(),
};

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function () {
    return mockClient;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(function () {
    return mockTransport;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn(function () {
    return mockTransport;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(function () {
    return mockTransport;
  }),
}));

vi.mock('../db/repositories/mcp-servers.js', () => ({
  getMcpServersRepo: () => mockRepo,
}));

vi.mock('./tool-executor.js', () => ({
  getSharedToolRegistry: () => mockRegistry,
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Dynamic import AFTER vi.mock calls to get a fresh singleton
const { mcpClientService } = await import('./mcp-client-service.js');

// =============================================================================
// HELPERS
// =============================================================================

function makeServer(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'srv-1',
    userId: 'user-1',
    name: 'test-server',
    displayName: 'Test Server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    url: undefined,
    env: {},
    headers: {},
    enabled: true,
    autoConnect: true,
    status: 'disconnected',
    errorMessage: undefined,
    toolCount: 0,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as McpServerRecord;
}

function makeMcpTools(names: string[]) {
  return names.map((name) => ({
    name,
    description: `Tool ${name}`,
    inputSchema: { type: 'object', properties: {} },
  }));
}

// =============================================================================
// TESTS
// =============================================================================

describe('McpClientService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.listTools.mockResolvedValue({ tools: [] });
    mockClient.callTool.mockResolvedValue(undefined);
    mockTransport.close.mockResolvedValue(undefined);
    mockRepo.updateStatus.mockResolvedValue(undefined);
    mockRepo.getByName.mockResolvedValue(null);
    mockRepo.getEnabled.mockResolvedValue([]);
    await mcpClientService.disconnectAll();
  });

  // ===========================================================================
  // connect()
  // ===========================================================================

  describe('connect()', () => {
    it('connects successfully and returns discovered tools', async () => {
      const tools = makeMcpTools(['read_file', 'write_file']);
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();

      const result = await mcpClientService.connect(server);

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('read_file');
      expect(result[1]!.name).toBe('write_file');
    });

    it('returns empty array when server has no tools', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();

      const result = await mcpClientService.connect(server);

      expect(result).toHaveLength(0);
    });

    it('handles listTools returning undefined tools array', async () => {
      mockClient.listTools.mockResolvedValue({});
      const server = makeServer();

      const result = await mcpClientService.connect(server);

      expect(result).toHaveLength(0);
    });

    it('updates DB status to connecting then connected', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();

      await mcpClientService.connect(server);

      expect(mockRepo.updateStatus).toHaveBeenCalledTimes(2);
      expect(mockRepo.updateStatus).toHaveBeenNthCalledWith(1, 'srv-1', 'connecting');
      expect(mockRepo.updateStatus).toHaveBeenNthCalledWith(2, 'srv-1', 'connected', undefined, 0);
    });

    it('updates DB with correct tool count', async () => {
      const tools = makeMcpTools(['a', 'b', 'c']);
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();

      await mcpClientService.connect(server);

      expect(mockRepo.updateStatus).toHaveBeenNthCalledWith(2, 'srv-1', 'connected', undefined, 3);
    });

    it('registers tools in ToolRegistry with correct definitions', async () => {
      const tools = makeMcpTools(['read_file']);
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();

      await mcpClientService.connect(server);

      expect(mockRegistry.registerMcpTools).toHaveBeenCalledTimes(1);
      const [serverName, toolsMap] = mockRegistry.registerMcpTools.mock.calls[0]!;
      expect(serverName).toBe('test-server');
      expect(toolsMap).toBeInstanceOf(Map);
      expect(toolsMap.size).toBe(1);

      const entry = toolsMap.get('read_file');
      expect(entry).toBeDefined();
      expect(entry.definition.name).toBe('read_file');
      expect(entry.definition.category).toBe('MCP');
      expect(entry.definition.tags).toEqual(['mcp', 'test-server']);
      expect(typeof entry.executor).toBe('function');
    });

    it('tool definition uses fallback description when tool has none', async () => {
      const tools = [{ name: 'no_desc', inputSchema: { type: 'object', properties: {} } }];
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();

      await mcpClientService.connect(server);

      const toolsMap = mockRegistry.registerMcpTools.mock.calls[0]![1] as Map<
        string,
        Record<string, unknown>
      >;
      const entry = toolsMap.get('no_desc');
      expect(entry.definition.description).toBe('Tool from MCP server "test-server"');
    });

    it('tool definition uses fallback parameters when tool has no inputSchema', async () => {
      const tools = [{ name: 'no_schema' }];
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();

      await mcpClientService.connect(server);

      const toolsMap = mockRegistry.registerMcpTools.mock.calls[0]![1] as Map<
        string,
        Record<string, unknown>
      >;
      const entry = toolsMap.get('no_schema');
      expect(entry.definition.parameters).toEqual({ type: 'object', properties: {} });
    });

    it('disconnects existing connection before reconnecting', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();

      // Connect first time
      await mcpClientService.connect(server);
      expect(mcpClientService.isConnected('test-server')).toBe(true);

      // Connect again (should disconnect first)
      mockRepo.getByName.mockResolvedValue(server);
      await mcpClientService.connect(server);

      // unregisterMcpTools called during disconnect
      expect(mockRegistry.unregisterMcpTools).toHaveBeenCalledWith('test-server');
      // transport.close called during disconnect
      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('on error updates DB status to error with message and rethrows', async () => {
      const connectError = new Error('Connection refused');
      mockClient.connect.mockRejectedValue(connectError);
      const server = makeServer();

      await expect(mcpClientService.connect(server)).rejects.toThrow('Connection refused');

      expect(mockRepo.updateStatus).toHaveBeenCalledWith('srv-1', 'error', 'Connection refused');
    });

    it('on non-Error error, converts to string for DB status', async () => {
      mockClient.connect.mockRejectedValue('raw string error');
      const server = makeServer();

      await expect(mcpClientService.connect(server)).rejects.toBe('raw string error');

      expect(mockRepo.updateStatus).toHaveBeenCalledWith('srv-1', 'error', 'raw string error');
    });

    it('marks server as connected after successful connect', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();

      await mcpClientService.connect(server);

      expect(mcpClientService.isConnected('test-server')).toBe(true);
    });

    it('does not mark server as connected on error', async () => {
      mockClient.connect.mockRejectedValue(new Error('fail'));
      const server = makeServer();

      await expect(mcpClientService.connect(server)).rejects.toThrow();

      expect(mcpClientService.isConnected('test-server')).toBe(false);
    });
  });

  // ===========================================================================
  // disconnect()
  // ===========================================================================

  describe('disconnect()', () => {
    it('unregisters tools from registry', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      mockRepo.getByName.mockResolvedValue(server);
      await mcpClientService.disconnect('test-server');

      expect(mockRegistry.unregisterMcpTools).toHaveBeenCalledWith('test-server');
    });

    it('closes transport', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      mockRepo.getByName.mockResolvedValue(server);
      await mcpClientService.disconnect('test-server');

      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('removes from connections map (isConnected returns false)', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);
      expect(mcpClientService.isConnected('test-server')).toBe(true);

      mockRepo.getByName.mockResolvedValue(server);
      await mcpClientService.disconnect('test-server');

      expect(mcpClientService.isConnected('test-server')).toBe(false);
    });

    it('updates DB status to disconnected with toolCount 0', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      mockRepo.getByName.mockResolvedValue(server);
      await mcpClientService.disconnect('test-server');

      expect(mockRepo.updateStatus).toHaveBeenCalledWith('srv-1', 'disconnected', undefined, 0);
    });

    it('does nothing if server not connected (no throw)', async () => {
      await expect(mcpClientService.disconnect('nonexistent')).resolves.toBeUndefined();

      expect(mockRegistry.unregisterMcpTools).not.toHaveBeenCalled();
      expect(mockTransport.close).not.toHaveBeenCalled();
    });

    it('handles transport close error gracefully', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      mockTransport.close.mockRejectedValue(new Error('close failed'));
      mockRepo.getByName.mockResolvedValue(server);

      // Should not throw
      await expect(mcpClientService.disconnect('test-server')).resolves.toBeUndefined();
      // Connection should still be removed
      expect(mcpClientService.isConnected('test-server')).toBe(false);
    });

    it('skips DB update if server not found in DB', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      mockRepo.getByName.mockResolvedValue(null);
      await mcpClientService.disconnect('test-server');

      // updateStatus called for connect (connecting + connected) but NOT for disconnect
      const disconnectCalls = mockRepo.updateStatus.mock.calls.filter(
        (call: unknown[]) => call[1] === 'disconnected'
      );
      expect(disconnectCalls).toHaveLength(0);
    });
  });

  // ===========================================================================
  // disconnectAll()
  // ===========================================================================

  describe('disconnectAll()', () => {
    it('disconnects all connected servers', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server1 = makeServer({ id: 's1', name: 'server-a' });
      const server2 = makeServer({ id: 's2', name: 'server-b' });

      await mcpClientService.connect(server1);
      await mcpClientService.connect(server2);
      expect(mcpClientService.isConnected('server-a')).toBe(true);
      expect(mcpClientService.isConnected('server-b')).toBe(true);

      await mcpClientService.disconnectAll();

      expect(mcpClientService.isConnected('server-a')).toBe(false);
      expect(mcpClientService.isConnected('server-b')).toBe(false);
    });

    it('works when no connections exist', async () => {
      await expect(mcpClientService.disconnectAll()).resolves.toBeUndefined();
    });

    it('does not throw if some disconnections fail', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server1 = makeServer({ id: 's1', name: 'server-a' });
      const server2 = makeServer({ id: 's2', name: 'server-b' });

      await mcpClientService.connect(server1);
      await mcpClientService.connect(server2);

      // Make close fail for one
      mockTransport.close
        .mockRejectedValueOnce(new Error('close fail'))
        .mockResolvedValueOnce(undefined);

      // Uses Promise.allSettled — should not throw
      await expect(mcpClientService.disconnectAll()).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // isConnected()
  // ===========================================================================

  describe('isConnected()', () => {
    it('returns true for connected server', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      expect(mcpClientService.isConnected('test-server')).toBe(true);
    });

    it('returns false for unknown server', () => {
      expect(mcpClientService.isConnected('unknown-server')).toBe(false);
    });
  });

  // ===========================================================================
  // getServerTools()
  // ===========================================================================

  describe('getServerTools()', () => {
    it('returns tools for connected server', async () => {
      const tools = makeMcpTools(['tool_a', 'tool_b']);
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();
      await mcpClientService.connect(server);

      const result = mcpClientService.getServerTools('test-server');

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('tool_a');
      expect(result[1]!.name).toBe('tool_b');
    });

    it('returns empty array for unknown server', () => {
      const result = mcpClientService.getServerTools('nonexistent');

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // callTool()
  // ===========================================================================

  describe('callTool()', () => {
    it('throws if server not connected', async () => {
      await expect(mcpClientService.callTool('nonexistent', 'some_tool', {})).rejects.toThrow(
        'MCP server "nonexistent" is not connected'
      );
    });

    it('calls client.callTool with correct arguments', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      mockClient.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      const args = { path: '/test', mode: 'read' };

      await mcpClientService.callTool('test-server', 'my_tool', args);

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'my_tool',
        arguments: args,
      });
    });

    it('returns text content from single text MCP response', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      mockClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello world' }],
      });

      const result = await mcpClientService.callTool('test-server', 'greet', {});

      expect(result).toBe('Hello world');
    });

    it('returns joined text from multi-text MCP response', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      mockClient.callTool.mockResolvedValue({
        content: [
          { type: 'text', text: 'Line 1' },
          { type: 'text', text: 'Line 2' },
          { type: 'text', text: 'Line 3' },
        ],
      });

      const result = await mcpClientService.callTool('test-server', 'multi', {});

      expect(result).toBe('Line 1\nLine 2\nLine 3');
    });

    it('filters out non-text content types', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      mockClient.callTool.mockResolvedValue({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image', data: 'base64...' },
          { type: 'text', text: 'World' },
        ],
      });

      const result = await mcpClientService.callTool('test-server', 'mixed', {});

      expect(result).toBe('Hello\nWorld');
    });

    it('returns raw result if no content array', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      const rawResult = { data: 'some raw data' };
      mockClient.callTool.mockResolvedValue(rawResult);

      const result = await mcpClientService.callTool('test-server', 'raw', {});

      expect(result).toEqual(rawResult);
    });

    it('returns raw result if content is not an array', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      const rawResult = { content: 'not an array' };
      mockClient.callTool.mockResolvedValue(rawResult);

      const result = await mcpClientService.callTool('test-server', 'oddShape', {});

      expect(result).toEqual(rawResult);
    });

    it('returns empty string when content has only non-text items', async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer();
      await mcpClientService.connect(server);

      mockClient.callTool.mockResolvedValue({
        content: [{ type: 'image', data: 'base64' }],
      });

      const result = await mcpClientService.callTool('test-server', 'img_only', {});

      // No text items → texts = [], texts.join('\n') = ''
      expect(result).toBe('');
    });
  });

  // ===========================================================================
  // autoConnect()
  // ===========================================================================

  describe('autoConnect()', () => {
    it('connects all enabled servers', async () => {
      const server1 = makeServer({ id: 's1', name: 'alpha' });
      const server2 = makeServer({ id: 's2', name: 'beta' });
      mockRepo.getEnabled.mockResolvedValue([server1, server2]);
      mockClient.listTools.mockResolvedValue({ tools: [] });

      await mcpClientService.autoConnect();

      expect(mcpClientService.isConnected('alpha')).toBe(true);
      expect(mcpClientService.isConnected('beta')).toBe(true);
    });

    it('does nothing when no enabled servers', async () => {
      mockRepo.getEnabled.mockResolvedValue([]);

      await mcpClientService.autoConnect();

      expect(mockClient.connect).not.toHaveBeenCalled();
    });

    it('continues even if some connections fail (Promise.allSettled)', async () => {
      const server1 = makeServer({ id: 's1', name: 'good' });
      const server2 = makeServer({ id: 's2', name: 'bad' });
      mockRepo.getEnabled.mockResolvedValue([server1, server2]);

      // First connect succeeds, second fails
      let callCount = 0;
      mockClient.connect.mockImplementation(() => {
        callCount++;
        if (callCount === 2) return Promise.reject(new Error('connection error'));
        return Promise.resolve();
      });
      mockClient.listTools.mockResolvedValue({ tools: [] });

      // Should not throw
      await expect(mcpClientService.autoConnect()).resolves.toBeUndefined();

      // First server connected, second did not
      expect(mcpClientService.isConnected('good')).toBe(true);
      expect(mcpClientService.isConnected('bad')).toBe(false);
    });
  });

  // ===========================================================================
  // getStatus()
  // ===========================================================================

  describe('getStatus()', () => {
    it('returns connected status for connected servers', async () => {
      const tools = makeMcpTools(['tool_x', 'tool_y']);
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer({ name: 'my-server' });

      await mcpClientService.connect(server);

      const status = mcpClientService.getStatus();

      expect(status.size).toBe(1);
      expect(status.get('my-server')).toEqual({ connected: true, toolCount: 2 });
    });

    it('returns status for multiple connected servers', async () => {
      mockClient.listTools
        .mockResolvedValueOnce({ tools: makeMcpTools(['a']) })
        .mockResolvedValueOnce({ tools: makeMcpTools(['b', 'c', 'd']) });

      await mcpClientService.connect(makeServer({ id: 's1', name: 'first' }));
      await mcpClientService.connect(makeServer({ id: 's2', name: 'second' }));

      const status = mcpClientService.getStatus();

      expect(status.size).toBe(2);
      expect(status.get('first')).toEqual({ connected: true, toolCount: 1 });
      expect(status.get('second')).toEqual({ connected: true, toolCount: 3 });
    });

    it('returns empty map when no connections', () => {
      const status = mcpClientService.getStatus();

      expect(status.size).toBe(0);
    });
  });

  // ===========================================================================
  // createTransport (tested indirectly through connect)
  // ===========================================================================

  describe('createTransport (via connect)', () => {
    it('creates StdioClientTransport for stdio type', async () => {
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer({
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'mcp-server'],
        env: { API_KEY: 'test123' },
      });

      await mcpClientService.connect(server);

      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'npx',
          args: ['-y', 'mcp-server'],
          stderr: 'pipe',
        })
      );
      // Verify env includes both process.env and server.env
      const callArgs = vi.mocked(StdioClientTransport).mock.calls[0]![0] as {
        env: Record<string, string>;
      };
      expect(callArgs.env.API_KEY).toBe('test123');
    });

    it('creates SSEClientTransport for sse type', async () => {
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer({
        transport: 'sse',
        url: 'https://example.com/sse',
        headers: { Authorization: 'Bearer token' },
      });

      await mcpClientService.connect(server);

      expect(SSEClientTransport).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          requestInit: { headers: { Authorization: 'Bearer token' } },
        })
      );
      const urlArg = vi.mocked(SSEClientTransport).mock.calls[0]![0] as URL;
      expect(urlArg.href).toBe('https://example.com/sse');
    });

    it('creates StreamableHTTPClientTransport for streamable-http type', async () => {
      const { StreamableHTTPClientTransport } =
        await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      mockClient.listTools.mockResolvedValue({ tools: [] });
      const server = makeServer({
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: { 'X-Api-Key': 'secret' },
      });

      await mcpClientService.connect(server);

      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          requestInit: { headers: { 'X-Api-Key': 'secret' } },
        })
      );
      const urlArg = vi.mocked(StreamableHTTPClientTransport).mock.calls[0]![0] as URL;
      expect(urlArg.href).toBe('https://example.com/mcp');
    });

    it('stdio transport throws without command', async () => {
      const server = makeServer({ transport: 'stdio', command: undefined });

      await expect(mcpClientService.connect(server)).rejects.toThrow(
        'stdio transport requires a command'
      );
    });

    it('SSE transport throws without url', async () => {
      const server = makeServer({ transport: 'sse', url: undefined });

      await expect(mcpClientService.connect(server)).rejects.toThrow(
        'SSE transport requires a URL'
      );
    });

    it('streamable-http transport throws without url', async () => {
      const server = makeServer({ transport: 'streamable-http', url: undefined });

      await expect(mcpClientService.connect(server)).rejects.toThrow(
        'Streamable HTTP transport requires a URL'
      );
    });

    it('unsupported transport type throws', async () => {
      const server = makeServer({ transport: 'grpc' as unknown as McpServerRecord['transport'] });

      await expect(mcpClientService.connect(server)).rejects.toThrow('Unsupported transport: grpc');
    });
  });

  // ===========================================================================
  // registerToolsInRegistry (tested through executor behavior)
  // ===========================================================================

  describe('registered tool executors', () => {
    it('executor returns string content directly', async () => {
      const tools = makeMcpTools(['echo']);
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();
      await mcpClientService.connect(server);

      const toolsMap = mockRegistry.registerMcpTools.mock.calls[0]![1] as Map<
        string,
        Record<string, unknown>
      >;
      const executor = toolsMap.get('echo').executor;

      mockClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'hello' }],
      });

      const result = await executor({ message: 'hello' });

      expect(result).toEqual({ content: 'hello' });
    });

    it('executor JSON-stringifies non-string results', async () => {
      const tools = makeMcpTools(['data']);
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();
      await mcpClientService.connect(server);

      const toolsMap = mockRegistry.registerMcpTools.mock.calls[0]![1] as Map<
        string,
        Record<string, unknown>
      >;
      const executor = toolsMap.get('data').executor;

      mockClient.callTool.mockResolvedValue({ someField: 42 });

      const result = await executor({});

      expect(result.content).toBe(JSON.stringify({ someField: 42 }, null, 2));
    });

    it('executor returns error result on failure', async () => {
      const tools = makeMcpTools(['fail']);
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();
      await mcpClientService.connect(server);

      const toolsMap = mockRegistry.registerMcpTools.mock.calls[0]![1] as Map<
        string,
        Record<string, unknown>
      >;
      const executor = toolsMap.get('fail').executor;

      // callTool will throw because server is disconnected after we manipulate
      // But easier: make callTool reject
      mockClient.callTool.mockRejectedValue(new Error('tool failed'));

      const result = await executor({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('MCP tool error: tool failed');
    });

    it('executor handles non-Error thrown values', async () => {
      const tools = makeMcpTools(['fail2']);
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();
      await mcpClientService.connect(server);

      const toolsMap = mockRegistry.registerMcpTools.mock.calls[0]![1] as Map<
        string,
        Record<string, unknown>
      >;
      const executor = toolsMap.get('fail2').executor;

      mockClient.callTool.mockRejectedValue('string error');

      const result = await executor({});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('MCP tool error: string error');
    });
  });

  // ===========================================================================
  // workflowUsable from server metadata
  // ===========================================================================

  describe('workflowUsable from server metadata', () => {
    it('sets workflowUsable on tool definition from server metadata', async () => {
      const tools = makeMcpTools(['read_file', 'write_file']);
      mockClient.listTools.mockResolvedValue({ tools });

      const server = makeServer({
        metadata: {
          toolSettings: {
            read_file: { workflowUsable: false },
          },
        },
      });

      await mcpClientService.connect(server);

      const toolsMap = mockRegistry.registerMcpTools.mock.calls[0]![1] as Map<
        string,
        { definition: { workflowUsable?: boolean } }
      >;
      expect(toolsMap.get('read_file')!.definition.workflowUsable).toBe(false);
      expect(toolsMap.get('write_file')!.definition.workflowUsable).toBeUndefined();
    });

    it('sets workflowUsable: true when metadata says true', async () => {
      const tools = makeMcpTools(['my_tool']);
      mockClient.listTools.mockResolvedValue({ tools });

      const server = makeServer({
        metadata: {
          toolSettings: {
            my_tool: { workflowUsable: true },
          },
        },
      });

      await mcpClientService.connect(server);

      const toolsMap = mockRegistry.registerMcpTools.mock.calls[0]![1] as Map<
        string,
        { definition: { workflowUsable?: boolean } }
      >;
      expect(toolsMap.get('my_tool')!.definition.workflowUsable).toBe(true);
    });

    it('leaves workflowUsable undefined when no toolSettings in metadata', async () => {
      const tools = makeMcpTools(['plain_tool']);
      mockClient.listTools.mockResolvedValue({ tools });

      const server = makeServer({ metadata: {} });

      await mcpClientService.connect(server);

      const toolsMap = mockRegistry.registerMcpTools.mock.calls[0]![1] as Map<
        string,
        { definition: { workflowUsable?: boolean } }
      >;
      expect(toolsMap.get('plain_tool')!.definition.workflowUsable).toBeUndefined();
    });
  });

  // ===========================================================================
  // refreshToolRegistration()
  // ===========================================================================

  describe('refreshToolRegistration()', () => {
    it('re-registers tools with updated metadata from DB', async () => {
      const tools = makeMcpTools(['tool_a']);
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();

      await mcpClientService.connect(server);
      expect(mockRegistry.registerMcpTools).toHaveBeenCalledTimes(1);

      // Now simulate DB update with new toolSettings
      const updatedServer = makeServer({
        metadata: {
          toolSettings: {
            tool_a: { workflowUsable: false },
          },
        },
      });
      mockRepo.getByName.mockResolvedValue(updatedServer);

      await mcpClientService.refreshToolRegistration('test-server');

      // Should have been called again
      expect(mockRegistry.registerMcpTools).toHaveBeenCalledTimes(2);

      // Verify the second call has updated workflowUsable
      const secondCallToolsMap = mockRegistry.registerMcpTools.mock.calls[1]![1] as Map<
        string,
        { definition: { workflowUsable?: boolean } }
      >;
      expect(secondCallToolsMap.get('tool_a')!.definition.workflowUsable).toBe(false);
    });

    it('does nothing when server is not connected', async () => {
      // Reset counters after beforeEach cleanup
      const getByNameCallsBefore = mockRepo.getByName.mock.calls.length;
      const registerCallsBefore = mockRegistry.registerMcpTools.mock.calls.length;

      await mcpClientService.refreshToolRegistration('nonexistent');

      expect(mockRepo.getByName.mock.calls.length).toBe(getByNameCallsBefore);
      expect(mockRegistry.registerMcpTools.mock.calls.length).toBe(registerCallsBefore);
    });

    it('does nothing when server not found in DB', async () => {
      const tools = makeMcpTools(['tool_a']);
      mockClient.listTools.mockResolvedValue({ tools });
      const server = makeServer();
      await mcpClientService.connect(server);

      mockRepo.getByName.mockResolvedValue(null);

      await mcpClientService.refreshToolRegistration('test-server');

      // Only the initial registration call
      expect(mockRegistry.registerMcpTools).toHaveBeenCalledTimes(1);
    });
  });
});
