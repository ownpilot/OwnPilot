import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// HOISTED MOCKS
// =============================================================================

const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogDebug = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());

const mockSetRequestHandler = vi.hoisted(() => vi.fn());
const mockServerConnect = vi.hoisted(() => vi.fn());

const mockTransportHandleRequest = vi.hoisted(() => vi.fn());
const mockTransportClose = vi.hoisted(() => vi.fn());

const mockGetAllTools = vi.hoisted(() => vi.fn());
const mockExecute = vi.hoisted(() => vi.fn());

/** Tracks all transport constructor calls for assertions */
const transportConstructorCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

// =============================================================================
// MOCKS — use regular `function` for constructors (arrow functions cannot be
// invoked with `new`).
// =============================================================================

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn(function () {
    return {
      setRequestHandler: mockSetRequestHandler,
      connect: mockServerConnect,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  CallToolRequestSchema: 'CallToolRequestSchema',
}));

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: vi.fn(function (opts: Record<string, unknown>) {
    transportConstructorCalls.push(opts);
    return {
      handleRequest: mockTransportHandleRequest,
      close: mockTransportClose,
    };
  }),
}));

vi.mock('@ownpilot/core', () => ({
  getBaseName: (name: string) => {
    const dotIndex = name.indexOf('.');
    return dotIndex >= 0 ? name.slice(dotIndex + 1) : name;
  },
}));

vi.mock('./tool-executor.js', () => ({
  getSharedToolRegistry: () => ({
    getAllTools: mockGetAllTools,
    execute: mockExecute,
  }),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: mockLogInfo,
    debug: mockLogDebug,
    warn: mockLogWarn,
    error: mockLogError,
  }),
}));

// =============================================================================
// IMPORT UNDER TEST (after mocks)
// =============================================================================

const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
const { WebStandardStreamableHTTPServerTransport } = await import(
  '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
);
const { handleMcpRequest, invalidateMcpServer } = await import(
  './mcp-server-service.js'
);

// =============================================================================
// HELPERS
// =============================================================================

function makeRequest(method: string, sessionId?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return new Request('http://localhost/mcp', { method, headers });
}

function makeToolDef(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
) {
  return {
    definition: {
      name,
      description,
      parameters: { properties, required },
    },
    executor: vi.fn(),
  };
}

/** Extract the tools/list handler registered on the mock Server */
function getListHandler(): ((...args: unknown[]) => unknown) | undefined {
  const call = mockSetRequestHandler.mock.calls.find(
    (c: unknown[]) => c[0] === 'ListToolsRequestSchema',
  );
  return call?.[1];
}

/** Extract the tools/call handler registered on the mock Server */
function getCallHandler(): ((...args: unknown[]) => unknown) | undefined {
  const call = mockSetRequestHandler.mock.calls.find(
    (c: unknown[]) => c[0] === 'CallToolRequestSchema',
  );
  return call?.[1];
}

/**
 * Make a POST request to trigger lazy server initialization so that
 * setRequestHandler calls are recorded and can be extracted via
 * getListHandler / getCallHandler.
 */
async function ensureServerInitialized(): Promise<void> {
  mockTransportHandleRequest.mockResolvedValueOnce(new Response('ok'));
  await handleMcpRequest(makeRequest('POST'));
}

// =============================================================================
// SETUP
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  transportConstructorCalls.length = 0;
  invalidateMcpServer();

  // Defaults
  mockTransportHandleRequest.mockResolvedValue(new Response('ok'));
  mockTransportClose.mockResolvedValue(undefined);
  mockServerConnect.mockResolvedValue(undefined);
  mockGetAllTools.mockReturnValue([]);
});

// =============================================================================
// handleMcpRequest — POST
// =============================================================================

describe('handleMcpRequest — POST', () => {
  it('creates a new transport for POST without session', async () => {
    await handleMcpRequest(makeRequest('POST'));
    expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalledTimes(1);
  });

  it('passes sessionIdGenerator callback to transport constructor', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    expect(opts).toHaveProperty('sessionIdGenerator');
    expect(typeof opts.sessionIdGenerator).toBe('function');
  });

  it('sessionIdGenerator returns a UUID-format string', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    const uuid = (opts.sessionIdGenerator as () => string)();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('connects the server to the new transport', async () => {
    await handleMcpRequest(makeRequest('POST'));
    expect(mockServerConnect).toHaveBeenCalledTimes(1);
  });

  it('calls transport.handleRequest with the original request', async () => {
    const req = makeRequest('POST');
    await handleMcpRequest(req);
    expect(mockTransportHandleRequest).toHaveBeenCalledWith(req);
  });

  it('returns the response from transport.handleRequest', async () => {
    const expected = new Response('test-body', { status: 201 });
    mockTransportHandleRequest.mockResolvedValueOnce(expected);
    const res = await handleMcpRequest(makeRequest('POST'));
    expect(res).toBe(expected);
  });

  it('reuses existing transport for POST with known session ID', async () => {
    // First POST — creates transport
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;

    // Simulate session initialization
    (opts.onsessioninitialized as (s: string) => void)('session-123');

    // Second POST with that session ID — should NOT create a new transport
    mockTransportHandleRequest.mockResolvedValueOnce(new Response('reused'));
    const res = await handleMcpRequest(makeRequest('POST', 'session-123'));
    const body = await res.text();
    expect(body).toBe('reused');
    expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalledTimes(1);
  });

  it('does not call server.connect when reusing an existing session', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('s1');

    mockServerConnect.mockClear();
    await handleMcpRequest(makeRequest('POST', 's1'));
    expect(mockServerConnect).not.toHaveBeenCalled();
  });

  it('creates a new transport for POST with unknown session ID', async () => {
    const res = await handleMcpRequest(makeRequest('POST', 'unknown-session'));
    expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalledTimes(1);
    expect(res).toBeDefined();
  });

  it('onsessioninitialized stores transport in sessions map', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('sid-abc');

    // Verify by making a GET with that session — should delegate to transport
    mockTransportHandleRequest.mockResolvedValueOnce(new Response('found'));
    const res = await handleMcpRequest(makeRequest('GET', 'sid-abc'));
    const body = await res.text();
    expect(body).toBe('found');
  });

  it('onsessionclosed removes transport from sessions map', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('sid-to-close');
    (opts.onsessionclosed as (s: string) => void)('sid-to-close');

    // DELETE with that closed session should return 404
    const res = await handleMcpRequest(makeRequest('DELETE', 'sid-to-close'));
    expect(res.status).toBe(404);
  });

  it('passes onsessioninitialized and onsessionclosed callbacks', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    expect(typeof opts.onsessioninitialized).toBe('function');
    expect(typeof opts.onsessionclosed).toBe('function');
  });
});

// =============================================================================
// handleMcpRequest — GET
// =============================================================================

describe('handleMcpRequest — GET', () => {
  it('delegates to existing transport when session found', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('get-sid');

    const expected = new Response('sse-stream');
    mockTransportHandleRequest.mockResolvedValueOnce(expected);

    const res = await handleMcpRequest(makeRequest('GET', 'get-sid'));
    expect(res).toBe(expected);
  });

  it('calls transport.handleRequest with the GET request', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('get-sid2');

    mockTransportHandleRequest.mockClear();
    const req = makeRequest('GET', 'get-sid2');
    await handleMcpRequest(req);
    expect(mockTransportHandleRequest).toHaveBeenCalledWith(req);
  });

  it('falls through to 405 for GET without session ID', async () => {
    const res = await handleMcpRequest(makeRequest('GET'));
    expect(res.status).toBe(405);
  });

  it('falls through to 405 for GET with unknown session ID', async () => {
    const res = await handleMcpRequest(makeRequest('GET', 'nonexistent'));
    expect(res.status).toBe(405);
  });
});

// =============================================================================
// handleMcpRequest — DELETE
// =============================================================================

describe('handleMcpRequest — DELETE', () => {
  it('delegates to existing transport when session found', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('del-sid');

    const expected = new Response('deleted');
    mockTransportHandleRequest.mockResolvedValueOnce(expected);

    const res = await handleMcpRequest(makeRequest('DELETE', 'del-sid'));
    expect(res).toBe(expected);
  });

  it('returns 404 JSON when no session header present', async () => {
    const res = await handleMcpRequest(makeRequest('DELETE'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Session not found' });
  });

  it('returns 404 with Content-Type application/json', async () => {
    const res = await handleMcpRequest(makeRequest('DELETE'));
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('returns 404 when session ID header is present but unknown', async () => {
    const res = await handleMcpRequest(
      makeRequest('DELETE', 'no-such-session'),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Session not found' });
  });

  it('calls transport.handleRequest with the DELETE request', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('del-sid2');

    mockTransportHandleRequest.mockClear();
    const req = makeRequest('DELETE', 'del-sid2');
    await handleMcpRequest(req);
    expect(mockTransportHandleRequest).toHaveBeenCalledWith(req);
  });
});

// =============================================================================
// handleMcpRequest — Unsupported methods
// =============================================================================

describe('handleMcpRequest — unsupported methods', () => {
  it('returns 405 for PUT', async () => {
    const res = await handleMcpRequest(makeRequest('PUT'));
    expect(res.status).toBe(405);
  });

  it('returns 405 for PATCH', async () => {
    const res = await handleMcpRequest(makeRequest('PATCH'));
    expect(res.status).toBe(405);
  });

  it('returns error message in response body', async () => {
    const res = await handleMcpRequest(makeRequest('PUT'));
    const body = await res.json();
    expect(body).toEqual({ error: 'Method not allowed' });
  });

  it('sets Allow header to GET, POST, DELETE', async () => {
    const res = await handleMcpRequest(makeRequest('PUT'));
    expect(res.headers.get('Allow')).toBe('GET, POST, DELETE');
  });

  it('sets Content-Type to application/json', async () => {
    const res = await handleMcpRequest(makeRequest('PATCH'));
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });
});

// =============================================================================
// Lazy MCP server singleton
// =============================================================================

describe('lazy MCP server singleton', () => {
  it('creates server only once across multiple POST requests', async () => {
    await handleMcpRequest(makeRequest('POST'));
    await handleMcpRequest(makeRequest('POST'));
    await handleMcpRequest(makeRequest('POST'));
    expect(Server).toHaveBeenCalledTimes(1);
  });

  it('passes correct name and version to Server constructor', async () => {
    await handleMcpRequest(makeRequest('POST'));
    expect(Server).toHaveBeenCalledWith(
      { name: 'OwnPilot', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
  });

  it('creates new server after invalidateMcpServer', async () => {
    await handleMcpRequest(makeRequest('POST'));
    expect(Server).toHaveBeenCalledTimes(1);

    invalidateMcpServer();
    vi.mocked(Server).mockClear();

    await handleMcpRequest(makeRequest('POST'));
    expect(Server).toHaveBeenCalledTimes(1);
  });

  it('registers both list and call request handlers', async () => {
    await handleMcpRequest(makeRequest('POST'));
    expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
    expect(mockSetRequestHandler).toHaveBeenCalledWith(
      'ListToolsRequestSchema',
      expect.any(Function),
    );
    expect(mockSetRequestHandler).toHaveBeenCalledWith(
      'CallToolRequestSchema',
      expect.any(Function),
    );
  });

  it('logs initialization message', async () => {
    await handleMcpRequest(makeRequest('POST'));
    expect(mockLogInfo).toHaveBeenCalledWith('MCP Server initialized');
  });
});

// =============================================================================
// tools/list handler
// =============================================================================

describe('tools/list handler', () => {
  it('returns empty tools array when registry has no tools', async () => {
    mockGetAllTools.mockReturnValue([]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = await handler();
    expect(result).toEqual({ tools: [] });
  });

  it('maps tool definition names using getBaseName', async () => {
    mockGetAllTools.mockReturnValue([
      makeToolDef('core.search_files', 'Search files'),
    ]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as { tools: Array<{ name: string }> };
    expect(result.tools[0]!.name).toBe('search_files');
  });

  it('strips first namespace segment from qualified names', async () => {
    mockGetAllTools.mockReturnValue([
      makeToolDef('plugin.telegram.send_message', 'Send a message'),
    ]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as { tools: Array<{ name: string }> };
    expect(result.tools[0]!.name).toBe('telegram.send_message');
  });

  it('preserves unqualified names (no dot)', async () => {
    mockGetAllTools.mockReturnValue([
      makeToolDef('simple_tool', 'A simple tool'),
    ]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as { tools: Array<{ name: string }> };
    expect(result.tools[0]!.name).toBe('simple_tool');
  });

  it('includes description in output', async () => {
    mockGetAllTools.mockReturnValue([
      makeToolDef('core.read_file', 'Read a file from disk'),
    ]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as {
      tools: Array<{ description: string }>;
    };
    expect(result.tools[0]!.description).toBe('Read a file from disk');
  });

  it('wraps properties in inputSchema with type: object', async () => {
    mockGetAllTools.mockReturnValue([
      makeToolDef('core.tool1', 'desc', { path: { type: 'string' } }),
    ]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as {
      tools: Array<{ inputSchema: { type: string } }>;
    };
    expect(result.tools[0]!.inputSchema.type).toBe('object');
  });

  it('maps parameters.properties to inputSchema.properties', async () => {
    const props = {
      path: { type: 'string' },
      recursive: { type: 'boolean' },
    };
    mockGetAllTools.mockReturnValue([makeToolDef('core.tool1', 'desc', props)]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as {
      tools: Array<{
        inputSchema: { properties: Record<string, unknown> };
      }>;
    };
    expect(result.tools[0]!.inputSchema.properties).toEqual(props);
  });

  it('includes required array when non-empty', async () => {
    mockGetAllTools.mockReturnValue([
      makeToolDef(
        'core.tool1',
        'desc',
        { path: { type: 'string' } },
        ['path'],
      ),
    ]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as {
      tools: Array<{ inputSchema: { required?: string[] } }>;
    };
    expect(result.tools[0]!.inputSchema.required).toEqual(['path']);
  });

  it('omits required field when required array is empty', async () => {
    mockGetAllTools.mockReturnValue([
      makeToolDef('core.tool1', 'desc', { path: { type: 'string' } }, []),
    ]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as {
      tools: Array<{ inputSchema: Record<string, unknown> }>;
    };
    expect(result.tools[0]!.inputSchema).not.toHaveProperty('required');
  });

  it('defaults properties to empty object when undefined', async () => {
    mockGetAllTools.mockReturnValue([
      {
        definition: {
          name: 'core.no_params',
          description: 'No params tool',
          parameters: { properties: undefined, required: [] },
        },
        executor: vi.fn(),
      },
    ]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as {
      tools: Array<{
        inputSchema: { properties: Record<string, unknown> };
      }>;
    };
    expect(result.tools[0]!.inputSchema.properties).toEqual({});
  });

  it('maps multiple tools correctly', async () => {
    mockGetAllTools.mockReturnValue([
      makeToolDef('core.tool_a', 'Tool A'),
      makeToolDef('core.tool_b', 'Tool B'),
      makeToolDef('custom.tool_c', 'Tool C'),
    ]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as { tools: Array<{ name: string }> };
    expect(result.tools).toHaveLength(3);
    expect(result.tools.map((t) => t.name)).toEqual([
      'tool_a',
      'tool_b',
      'tool_c',
    ]);
  });

  it('spreads required array (no mutation of original)', async () => {
    const required = ['path', 'encoding'];
    mockGetAllTools.mockReturnValue([
      makeToolDef('core.tool1', 'desc', {}, required),
    ]);
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as {
      tools: Array<{ inputSchema: { required: string[] } }>;
    };
    const returned = result.tools[0]!.inputSchema.required;
    expect(returned).toEqual(required);
    // Should be a copy, not the same reference
    expect(returned).not.toBe(required);
  });
});

// =============================================================================
// tools/call handler
// =============================================================================

describe('tools/call handler', () => {
  it('resolves base name to qualified name and executes', async () => {
    mockGetAllTools.mockReturnValue([
      makeToolDef('core.search_files', 'Search files'),
    ]);
    mockExecute.mockResolvedValue('search results');
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    await handler({
      params: { name: 'search_files', arguments: { query: 'test' } },
    });

    expect(mockExecute).toHaveBeenCalledWith(
      'core.search_files',
      { query: 'test' },
      { userId: 'default', conversationId: 'mcp-session' },
    );
  });

  it('returns text content on string result', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.tool1', 'desc')]);
    mockExecute.mockResolvedValue('hello world');
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'tool1', arguments: {} },
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(result.content).toEqual([{ type: 'text', text: 'hello world' }]);
    expect(result).not.toHaveProperty('isError');
  });

  it('returns stringified JSON for plain object results', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.tool1', 'desc')]);
    const obj = { count: 42, items: ['a', 'b'] };
    mockExecute.mockResolvedValue(obj);
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'tool1', arguments: {} },
    })) as { content: Array<{ type: string; text: string }> };
    expect(result.content[0]!.text).toBe(JSON.stringify(obj, null, 2));
  });

  it('extracts .content from result objects that have a content property', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.tool1', 'desc')]);
    mockExecute.mockResolvedValue({
      content: 'extracted content',
      meta: 'ignored',
    });
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'tool1', arguments: {} },
    })) as { content: Array<{ type: string; text: string }> };
    expect(result.content[0]!.text).toBe('extracted content');
  });

  it('converts non-string content property via String()', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.tool1', 'desc')]);
    mockExecute.mockResolvedValue({ content: 12345 });
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'tool1', arguments: {} },
    })) as { content: Array<{ type: string; text: string }> };
    expect(result.content[0]!.text).toBe('12345');
  });

  it('returns isError true for unknown tool name', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.known', 'desc')]);
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'nonexistent', arguments: {} },
    })) as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Unknown tool: nonexistent');
  });

  it('does not call execute for unknown tool', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.known', 'desc')]);
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    await handler({ params: { name: 'nonexistent', arguments: {} } });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('catches execution errors and returns isError true', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.failing', 'desc')]);
    mockExecute.mockRejectedValue(new Error('execution failed'));
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'failing', arguments: {} },
    })) as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Error: execution failed');
  });

  it('handles non-Error thrown values', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.failing', 'desc')]);
    mockExecute.mockRejectedValue('string error');
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'failing', arguments: {} },
    })) as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Error: string error');
  });

  it('uses empty object when arguments is undefined', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.tool1', 'desc')]);
    mockExecute.mockResolvedValue('ok');
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    await handler({ params: { name: 'tool1', arguments: undefined } });

    expect(mockExecute).toHaveBeenCalledWith(
      'core.tool1',
      {},
      { userId: 'default', conversationId: 'mcp-session' },
    );
  });

  it('handles null result from execute', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.tool1', 'desc')]);
    mockExecute.mockResolvedValue(null);
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'tool1', arguments: {} },
    })) as { content: Array<{ type: string; text: string }> };
    // null is not a string, not truthy with 'content', → JSON.stringify(null) → 'null'
    expect(result.content[0]!.text).toBe('null');
  });

  it('handles numeric result from execute', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.tool1', 'desc')]);
    mockExecute.mockResolvedValue(42);
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'tool1', arguments: {} },
    })) as { content: Array<{ type: string; text: string }> };
    // 42 is not a string, not an object → JSON.stringify(42) → '42'
    expect(result.content[0]!.text).toBe('42');
  });

  it('handles empty string result from execute', async () => {
    mockGetAllTools.mockReturnValue([makeToolDef('core.tool1', 'desc')]);
    mockExecute.mockResolvedValue('');
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'tool1', arguments: {} },
    })) as { content: Array<{ type: string; text: string }> };
    // '' is a string (typeof === 'string') → returned directly
    expect(result.content[0]!.text).toBe('');
  });
});

// =============================================================================
// invalidateMcpServer
// =============================================================================

describe('invalidateMcpServer', () => {
  it('clears the cached server so next request creates a new one', async () => {
    await handleMcpRequest(makeRequest('POST'));
    expect(Server).toHaveBeenCalledTimes(1);

    invalidateMcpServer();
    vi.mocked(Server).mockClear();

    await handleMcpRequest(makeRequest('POST'));
    expect(Server).toHaveBeenCalledTimes(1);
  });

  it('closes all transport sessions', async () => {
    // Create two sessions
    await handleMcpRequest(makeRequest('POST'));
    const opts1 = transportConstructorCalls[0]!;
    (opts1.onsessioninitialized as (s: string) => void)('s1');

    await handleMcpRequest(makeRequest('POST'));
    const opts2 = transportConstructorCalls[1]!;
    (opts2.onsessioninitialized as (s: string) => void)('s2');

    mockTransportClose.mockClear();
    invalidateMcpServer();

    expect(mockTransportClose).toHaveBeenCalledTimes(2);
  });

  it('clears sessions map so subsequent lookups fail', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('invalidated-sid');

    invalidateMcpServer();

    const res = await handleMcpRequest(
      makeRequest('DELETE', 'invalidated-sid'),
    );
    expect(res.status).toBe(404);
  });

  it('handles transport.close rejection gracefully', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('err-sid');

    mockTransportClose.mockRejectedValue(new Error('close failed'));

    // Should not throw synchronously
    expect(() => invalidateMcpServer()).not.toThrow();
  });

  it('is safe to call when no server or sessions exist', () => {
    expect(() => invalidateMcpServer()).not.toThrow();
  });

  it('is safe to call multiple times in succession', async () => {
    await handleMcpRequest(makeRequest('POST'));
    invalidateMcpServer();
    expect(() => invalidateMcpServer()).not.toThrow();
  });
});

// =============================================================================
// Session management integration
// =============================================================================

describe('session management', () => {
  it('supports multiple concurrent sessions', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts1 = transportConstructorCalls[0]!;
    (opts1.onsessioninitialized as (s: string) => void)('multi-1');

    await handleMcpRequest(makeRequest('POST'));
    const opts2 = transportConstructorCalls[1]!;
    (opts2.onsessioninitialized as (s: string) => void)('multi-2');

    // Both should be accessible via GET
    const r1 = await handleMcpRequest(makeRequest('GET', 'multi-1'));
    expect(r1.status).toBe(200);

    const r2 = await handleMcpRequest(makeRequest('GET', 'multi-2'));
    expect(r2.status).toBe(200);
  });

  it('removing one session does not affect others', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts1 = transportConstructorCalls[0]!;
    (opts1.onsessioninitialized as (s: string) => void)('keep');

    await handleMcpRequest(makeRequest('POST'));
    const opts2 = transportConstructorCalls[1]!;
    (opts2.onsessioninitialized as (s: string) => void)('remove');

    // Remove second session
    (opts2.onsessionclosed as (s: string) => void)('remove');

    // First session still works
    const res = await handleMcpRequest(makeRequest('GET', 'keep'));
    expect(res.status).toBe(200);

    // Second session returns 404
    const res2 = await handleMcpRequest(makeRequest('DELETE', 'remove'));
    expect(res2.status).toBe(404);
  });

  it('POST to a closed session creates a new transport', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('expired');
    (opts.onsessionclosed as (s: string) => void)('expired');

    // POST with the old session ID — sessions.has returns false → new transport
    await handleMcpRequest(makeRequest('POST', 'expired'));
    expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalledTimes(2);
  });
});
