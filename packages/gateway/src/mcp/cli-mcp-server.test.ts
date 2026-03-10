/**
 * CLI MCP Server Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the MCP SDK
const mockSetRequestHandler = vi.fn();
const mockConnect = vi.fn();
const mockClose = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(function () {
    return {
      setRequestHandler: mockSetRequestHandler,
      connect: mockConnect,
      close: mockClose,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: Symbol('ListToolsRequestSchema'),
  CallToolRequestSchema: Symbol('CallToolRequestSchema'),
}));

import { createServer, callOwnPilotTool, TOOLS } from './cli-mcp-server.js';

// =============================================================================
// Tool Definitions
// =============================================================================

describe('TOOLS', () => {
  it('should expose exactly 4 meta-tools', () => {
    expect(TOOLS).toHaveLength(4);
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(['search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool']);
  });

  it('should have valid input schemas', () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description).toBeTruthy();
    }
  });

  it('search_tools should require query', () => {
    const searchTool = TOOLS.find((t) => t.name === 'search_tools')!;
    expect(searchTool.inputSchema.required).toContain('query');
  });

  it('use_tool should require tool_name and arguments', () => {
    const useTool = TOOLS.find((t) => t.name === 'use_tool')!;
    expect(useTool.inputSchema.required).toEqual(['tool_name', 'arguments']);
  });

  it('batch_use_tool should require calls', () => {
    const batchTool = TOOLS.find((t) => t.name === 'batch_use_tool')!;
    expect(batchTool.inputSchema.required).toEqual(['calls']);
  });
});

// =============================================================================
// createServer
// =============================================================================

describe('createServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create server and register handlers', () => {
    createServer();
    // Server constructor was called with correct params
    expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
  });

  it('should register ListTools and CallTool handlers separately', () => {
    vi.clearAllMocks();
    createServer();
    // ListToolsRequestSchema + CallToolRequestSchema
    expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// callOwnPilotTool
// =============================================================================

describe('callOwnPilotTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call OwnPilot API and return result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: { content: 'Found 5 tools', isError: false },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await callOwnPilotTool('search_tools', { query: 'email' });

    expect(result.content).toBe('Found 5 tools');
    expect(result.isError).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/mcp/tool-call'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tool_name: 'search_tools', arguments: { query: 'email' } }),
      })
    );

    vi.unstubAllGlobals();
  });

  it('should handle API errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await callOwnPilotTool('use_tool', { tool_name: 'core.xxx', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('500');

    vi.unstubAllGlobals();
  });

  it('should handle connection errors', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await callOwnPilotTool('search_tools', { query: 'test' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('ECONNREFUSED');

    vi.unstubAllGlobals();
  });

  it('should handle API response with error field', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: { message: 'Tool not found' },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await callOwnPilotTool('use_tool', { tool_name: 'nonexistent', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toBe('Tool not found');

    vi.unstubAllGlobals();
  });
});
