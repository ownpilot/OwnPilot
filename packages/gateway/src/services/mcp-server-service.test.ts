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
const mockServerClose = vi.hoisted(() => vi.fn());

const mockTransportHandleRequest = vi.hoisted(() => vi.fn());
const mockTransportClose = vi.hoisted(() => vi.fn());

const mockExecuteSearchTools = vi.hoisted(() => vi.fn());
const mockExecuteGetToolHelp = vi.hoisted(() => vi.fn());
const mockExecuteUseTool = vi.hoisted(() => vi.fn());
const mockExecuteBatchUseTool = vi.hoisted(() => vi.fn());

const mockEmitMcpToolEvent = vi.hoisted(() => vi.fn());

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
      close: mockServerClose,
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

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
  };
});

vi.mock('./tool-executor.js', () => ({
  getSharedToolRegistry: () => ({}),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: mockLogInfo,
    debug: mockLogDebug,
    warn: mockLogWarn,
    error: mockLogError,
  }),
}));

vi.mock('../mcp/mcp-events.js', () => ({
  emitMcpToolEvent: mockEmitMcpToolEvent,
}));

vi.mock('../tools/agent-tool-registry.js', () => ({
  executeSearchTools: mockExecuteSearchTools,
  executeGetToolHelp: mockExecuteGetToolHelp,
  executeUseTool: mockExecuteUseTool,
  executeBatchUseTool: mockExecuteBatchUseTool,
}));

// =============================================================================
// IMPORT UNDER TEST (after mocks)
// =============================================================================

const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
const { WebStandardStreamableHTTPServerTransport } =
  await import('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js');
const { handleMcpRequest, invalidateMcpServer } = await import('./mcp-server-service.js');

// =============================================================================
// HELPERS
// =============================================================================

function makeRequest(method: string, sessionId?: string, queryParams?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const url = queryParams ? `http://localhost/mcp?${queryParams}` : 'http://localhost/mcp';
  return new Request(url, { method, headers });
}

/** Extract the tools/list handler registered on the mock Server */
function getListHandler(): ((...args: unknown[]) => unknown) | undefined {
  const call = mockSetRequestHandler.mock.calls.find(
    (c: unknown[]) => c[0] === 'ListToolsRequestSchema'
  );
  return call?.[1];
}

/** Extract the tools/call handler registered on the mock Server */
function getCallHandler(): ((...args: unknown[]) => unknown) | undefined {
  const call = mockSetRequestHandler.mock.calls.find(
    (c: unknown[]) => c[0] === 'CallToolRequestSchema'
  );
  return call?.[1];
}

/**
 * Make a POST request to trigger server creation so that
 * setRequestHandler calls are recorded and can be extracted via
 * getListHandler / getCallHandler.
 */
async function ensureServerInitialized(queryParams?: string): Promise<void> {
  mockSetRequestHandler.mockClear();
  mockTransportHandleRequest.mockResolvedValueOnce(new Response('ok'));
  await handleMcpRequest(makeRequest('POST', undefined, queryParams));
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
  mockServerClose.mockResolvedValue(undefined);
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
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
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

  it('returns 400 for GET without session ID', async () => {
    const res = await handleMcpRequest(makeRequest('GET'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('session');
  });

  it('returns 400 for GET with unknown session ID', async () => {
    const res = await handleMcpRequest(makeRequest('GET', 'nonexistent'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('session');
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
    const res = await handleMcpRequest(makeRequest('DELETE', 'no-such-session'));
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
// MCP server per session
// =============================================================================

describe('MCP server per session', () => {
  it('creates a new server for each new session', async () => {
    await handleMcpRequest(makeRequest('POST'));
    await handleMcpRequest(makeRequest('POST'));
    await handleMcpRequest(makeRequest('POST'));
    expect(Server).toHaveBeenCalledTimes(3);
  });

  it('passes correct name and version to Server constructor', async () => {
    await handleMcpRequest(makeRequest('POST'));
    expect(Server).toHaveBeenCalledWith(
      { name: 'OwnPilot', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
  });

  it('reuses existing server for POST with known session ID', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('reuse-sid');

    vi.mocked(Server).mockClear();
    await handleMcpRequest(makeRequest('POST', 'reuse-sid'));
    expect(Server).not.toHaveBeenCalled();
  });

  it('registers both list and call request handlers on each server', async () => {
    await handleMcpRequest(makeRequest('POST'));
    expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
    expect(mockSetRequestHandler).toHaveBeenCalledWith(
      'ListToolsRequestSchema',
      expect.any(Function)
    );
    expect(mockSetRequestHandler).toHaveBeenCalledWith(
      'CallToolRequestSchema',
      expect.any(Function)
    );
  });
});

// =============================================================================
// tools/list handler — 4 meta-tools
// =============================================================================

describe('tools/list handler', () => {
  it('returns exactly 4 meta-tools', async () => {
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as { tools: Array<{ name: string }> };
    expect(result.tools).toHaveLength(4);
  });

  it('returns the correct meta-tool names', async () => {
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name);
    expect(names).toEqual(['search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool']);
  });

  it('includes descriptions for all meta-tools', async () => {
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as { tools: Array<{ name: string; description: string }> };
    for (const tool of result.tools) {
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
    }
  });

  it('each meta-tool has inputSchema with type: object', async () => {
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as {
      tools: Array<{ inputSchema: { type: string; properties: Record<string, unknown> } }>;
    };
    for (const tool of result.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('search_tools has query parameter', async () => {
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as {
      tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }>;
    };
    const searchTool = result.tools.find((t) => t.name === 'search_tools')!;
    expect(searchTool.inputSchema.properties).toHaveProperty('query');
  });

  it('use_tool has tool_name parameter', async () => {
    await ensureServerInitialized();
    const handler = getListHandler()!;

    const result = (await handler()) as {
      tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }>;
    };
    const useTool = result.tools.find((t) => t.name === 'use_tool')!;
    expect(useTool.inputSchema.properties).toHaveProperty('tool_name');
  });

  it('returns static list (does not depend on registry)', async () => {
    await ensureServerInitialized();
    const handler = getListHandler()!;

    // Call twice — should return same result
    const result1 = (await handler()) as { tools: Array<{ name: string }> };
    const result2 = (await handler()) as { tools: Array<{ name: string }> };
    expect(result1.tools.map((t) => t.name)).toEqual(result2.tools.map((t) => t.name));
  });
});

// =============================================================================
// tools/call handler — routes to shared executors
// =============================================================================

describe('tools/call handler', () => {
  it('routes search_tools to executeSearchTools', async () => {
    mockExecuteSearchTools.mockResolvedValue({ content: 'found tools' });
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'search_tools', arguments: { query: 'file' } },
    })) as { content: Array<{ type: string; text: string }> };

    expect(mockExecuteSearchTools).toHaveBeenCalledWith(
      expect.anything(), // registry
      { query: 'file' }
    );
    expect(result.content[0]!.text).toBe('found tools');
  });

  it('routes get_tool_help to executeGetToolHelp', async () => {
    mockExecuteGetToolHelp.mockResolvedValue({ content: 'tool help text' });
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'get_tool_help', arguments: { tool_name: 'core.read_file' } },
    })) as { content: Array<{ type: string; text: string }> };

    expect(mockExecuteGetToolHelp).toHaveBeenCalledWith(
      expect.anything(),
      { tool_name: 'core.read_file' }
    );
    expect(result.content[0]!.text).toBe('tool help text');
  });

  it('routes use_tool to executeUseTool with context', async () => {
    mockExecuteUseTool.mockResolvedValue({ content: 'tool result' });
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const args = { tool_name: 'core.list_tasks', arguments: { status: 'pending' } };
    const result = (await handler({
      params: { name: 'use_tool', arguments: args },
    })) as { content: Array<{ type: string; text: string }> };

    expect(mockExecuteUseTool).toHaveBeenCalledWith(
      expect.anything(),
      args,
      expect.objectContaining({ userId: 'default', conversationId: 'mcp-session' })
    );
    expect(result.content[0]!.text).toBe('tool result');
  });

  it('routes batch_use_tool to executeBatchUseTool with context', async () => {
    mockExecuteBatchUseTool.mockResolvedValue({ content: 'batch results' });
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const args = { calls: [{ tool_name: 'core.a', arguments: {} }] };
    const result = (await handler({
      params: { name: 'batch_use_tool', arguments: args },
    })) as { content: Array<{ type: string; text: string }> };

    expect(mockExecuteBatchUseTool).toHaveBeenCalledWith(
      expect.anything(),
      args,
      expect.objectContaining({ userId: 'default', conversationId: 'mcp-session' })
    );
    expect(result.content[0]!.text).toBe('batch results');
  });

  it('returns isError true for unknown tool name', async () => {
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'nonexistent', arguments: {} },
    })) as { content: Array<{ type: string; text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Unknown tool: nonexistent');
    expect(result.content[0]!.text).toContain('search_tools');
  });

  it('does not call any executor for unknown tool', async () => {
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    await handler({ params: { name: 'nonexistent', arguments: {} } });

    expect(mockExecuteSearchTools).not.toHaveBeenCalled();
    expect(mockExecuteGetToolHelp).not.toHaveBeenCalled();
    expect(mockExecuteUseTool).not.toHaveBeenCalled();
    expect(mockExecuteBatchUseTool).not.toHaveBeenCalled();
  });

  it('catches execution errors and returns isError true', async () => {
    mockExecuteUseTool.mockRejectedValue(new Error('execution failed'));
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'use_tool', arguments: { tool_name: 'core.failing' } },
    })) as { content: Array<{ type: string; text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Error: execution failed');
  });

  it('handles non-Error thrown values', async () => {
    mockExecuteSearchTools.mockRejectedValue('string error');
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'search_tools', arguments: { query: 'test' } },
    })) as { content: Array<{ type: string; text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Error: string error');
  });

  it('uses empty object when arguments is undefined', async () => {
    mockExecuteSearchTools.mockResolvedValue({ content: 'ok' });
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    await handler({ params: { name: 'search_tools', arguments: undefined } });

    expect(mockExecuteSearchTools).toHaveBeenCalledWith(
      expect.anything(),
      {}
    );
  });

  it('JSON-stringifies object content from executor result', async () => {
    const obj = { count: 42, items: ['a', 'b'] };
    mockExecuteSearchTools.mockResolvedValue({ content: obj });
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'search_tools', arguments: { query: 'all' } },
    })) as { content: Array<{ type: string; text: string }> };

    expect(result.content[0]!.text).toBe(JSON.stringify(obj, null, 2));
  });

  it('passes string content through directly', async () => {
    mockExecuteGetToolHelp.mockResolvedValue({ content: 'help text here' });
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'get_tool_help', arguments: { tool_name: 'core.x' } },
    })) as { content: Array<{ type: string; text: string }> };

    expect(result.content[0]!.text).toBe('help text here');
  });

  it('propagates isError from executor result', async () => {
    mockExecuteUseTool.mockResolvedValue({ content: 'Tool not found', isError: true });
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    const result = (await handler({
      params: { name: 'use_tool', arguments: { tool_name: 'core.missing' } },
    })) as { content: Array<{ type: string; text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Tool not found');
  });
});

// =============================================================================
// MCP tool events (correlationId tracking)
// =============================================================================

describe('MCP tool events', () => {
  it('emits tool_start and tool_end events when correlationId is present', async () => {
    mockExecuteSearchTools.mockResolvedValue({ content: 'results' });
    await ensureServerInitialized('correlationId=test-corr');
    const handler = getCallHandler()!;

    await handler({
      params: { name: 'search_tools', arguments: { query: 'test' } },
    });

    expect(mockEmitMcpToolEvent).toHaveBeenCalledTimes(2);

    const startCall = mockEmitMcpToolEvent.mock.calls[0]![0];
    expect(startCall.type).toBe('tool_start');
    expect(startCall.correlationId).toBe('test-corr');
    expect(startCall.toolName).toBe('search_tools');

    const endCall = mockEmitMcpToolEvent.mock.calls[1]![0];
    expect(endCall.type).toBe('tool_end');
    expect(endCall.correlationId).toBe('test-corr');
    expect(endCall.result.success).toBe(true);
  });

  it('does not emit events when no correlationId', async () => {
    mockExecuteSearchTools.mockResolvedValue({ content: 'results' });
    await ensureServerInitialized();
    const handler = getCallHandler()!;

    await handler({
      params: { name: 'search_tools', arguments: { query: 'test' } },
    });

    expect(mockEmitMcpToolEvent).not.toHaveBeenCalled();
  });

  it('emits tool_end with success:false on error', async () => {
    mockExecuteUseTool.mockRejectedValue(new Error('boom'));
    await ensureServerInitialized('correlationId=err-corr');
    const handler = getCallHandler()!;

    await handler({
      params: { name: 'use_tool', arguments: { tool_name: 'core.x' } },
    });

    const endCall = mockEmitMcpToolEvent.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).type === 'tool_end'
    )![0] as Record<string, unknown>;
    expect((endCall.result as Record<string, unknown>).success).toBe(false);
  });
});

// =============================================================================
// invalidateMcpServer
// =============================================================================

describe('invalidateMcpServer', () => {
  it('closes all transport and server sessions', async () => {
    // Create two sessions
    await handleMcpRequest(makeRequest('POST'));
    const opts1 = transportConstructorCalls[0]!;
    (opts1.onsessioninitialized as (s: string) => void)('s1');

    await handleMcpRequest(makeRequest('POST'));
    const opts2 = transportConstructorCalls[1]!;
    (opts2.onsessioninitialized as (s: string) => void)('s2');

    mockTransportClose.mockClear();
    mockServerClose.mockClear();
    invalidateMcpServer();

    expect(mockTransportClose).toHaveBeenCalledTimes(2);
    expect(mockServerClose).toHaveBeenCalledTimes(2);
  });

  it('clears sessions map so subsequent lookups fail', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('invalidated-sid');

    invalidateMcpServer();

    const res = await handleMcpRequest(makeRequest('DELETE', 'invalidated-sid'));
    expect(res.status).toBe(404);
  });

  it('handles transport/server close rejection gracefully', async () => {
    await handleMcpRequest(makeRequest('POST'));
    const opts = transportConstructorCalls[0]!;
    (opts.onsessioninitialized as (s: string) => void)('err-sid');

    mockTransportClose.mockRejectedValue(new Error('close failed'));
    mockServerClose.mockRejectedValue(new Error('server close failed'));

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
// Session cleanup timer
// =============================================================================

describe('session cleanup timer', () => {
  it('cleans up stale sessions after SESSION_MAX_AGE_MS (30 min)', async () => {
    vi.useFakeTimers();
    try {
      // Create session — triggers startSessionCleanup → setInterval
      await handleMcpRequest(makeRequest('POST'));
      const opts = transportConstructorCalls[0]!;
      (opts.onsessioninitialized as (s: string) => void)('stale-sid');

      // Advance fake clock past SESSION_MAX_AGE_MS (30min) + one full interval (5min) + 1ms
      await vi.advanceTimersByTimeAsync(35 * 60 * 1000 + 1);

      expect(mockTransportClose).toHaveBeenCalled();
      expect(mockLogInfo).toHaveBeenCalledWith('Cleaned up stale MCP session',
        expect.objectContaining({ sessionId: 'stale-sid' })
      );
    } finally {
      vi.useRealTimers();
      invalidateMcpServer();
    }
  });

  it('does not clean up sessions that are still active (< 30 min)', async () => {
    vi.useFakeTimers();
    try {
      await handleMcpRequest(makeRequest('POST'));
      const opts = transportConstructorCalls[0]!;
      (opts.onsessioninitialized as (s: string) => void)('active-sid');

      // Advance only 10 minutes — well within SESSION_MAX_AGE_MS
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);

      // Transport should NOT have been closed
      expect(mockTransportClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      invalidateMcpServer();
    }
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
