/**
 * MCP Routes Tests
 *
 * Integration tests for the MCP API endpoints.
 * Tests both the MCP protocol endpoint and the REST management API for
 * external MCP server connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRepo = {
  getAll: vi.fn(),
  getById: vi.fn(),
  getByName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  updateStatus: vi.fn(),
};

const mockMcpClientService = {
  isConnected: vi.fn().mockReturnValue(false),
  connect: vi.fn(),
  disconnect: vi.fn(),
  getServerTools: vi.fn().mockReturnValue([]),
  refreshToolRegistration: vi.fn(),
};

const mockHandleMcpRequest = vi.fn();

const mockToolRegistry = {
  getAllTools: vi.fn().mockReturnValue([]),
};

vi.mock('../db/repositories/mcp-servers.js', () => ({
  getMcpServersRepo: () => mockRepo,
}));

vi.mock('../services/mcp-server-service.js', () => ({
  handleMcpRequest: mockHandleMcpRequest,
}));

vi.mock('../services/tool-executor.js', () => ({
  getSharedToolRegistry: () => mockToolRegistry,
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

vi.mock('../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@ownpilot/core', () => ({
  getBaseName: vi.fn((name: string) => name.split('.').pop() ?? name),
  getServiceRegistry: () => ({
    get: (token: { key: string }) => {
      if (token.key === 'mcp-client') return mockMcpClientService;
      throw new Error(`Unexpected token: ${token.key}`);
    },
  }),
  Services: { McpClient: { key: 'mcp-client' } },
}));

// Import after mocks
const { mcpRoutes } = await import('./mcp.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp(userId = 'default') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    return next();
  });
  app.use('*', requestId);
  app.route('/mcp', mcpRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleServer = {
  id: 'mcp-1',
  userId: 'default',
  name: 'test-server',
  displayName: 'Test Server',
  transport: 'stdio' as const,
  command: '/usr/bin/node',
  args: ['server.js'],
  env: {},
  headers: {},
  enabled: true,
  autoConnect: true,
  status: 'disconnected' as const,
  toolCount: 0,
  metadata: {},
  createdAt: '2024-06-01T12:00:00Z',
  updatedAt: '2024-06-01T12:00:00Z',
};

const sampleSseServer = {
  ...sampleServer,
  id: 'mcp-2',
  name: 'sse-server',
  displayName: 'SSE Server',
  transport: 'sse' as const,
  command: undefined,
  url: 'http://localhost:3001/sse',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpClientService.isConnected.mockReturnValue(false);
    mockMcpClientService.getServerTools.mockReturnValue([]);
    mockToolRegistry.getAllTools.mockReturnValue([]);
    app = createApp();
  });

  // ========================================================================
  // GET /mcp/serve/info
  // ========================================================================

  describe('GET /mcp/serve/info', () => {
    it('returns server info with empty tools list and config snippets', async () => {
      mockToolRegistry.getAllTools.mockReturnValue([]);

      const res = await app.request('/mcp/serve/info');

      expect(res.status).toBe(200);
      const json = await res.json() as { success: boolean; data: Record<string, unknown> };
      expect(json.success).toBe(true);
      expect(json.data.server).toBeDefined();
      expect((json.data.server as Record<string, unknown>).name).toBe('OwnPilot');
      expect((json.data.server as Record<string, unknown>).protocol).toBe('Streamable HTTP (MCP)');
      expect((json.data.server as Record<string, unknown>).transport).toBe('streamable-http');
      expect((json.data.server as Record<string, unknown>).endpoint).toContain('/api/v1/mcp/serve');
      expect(json.data.tools).toBeDefined();
      expect((json.data.tools as Record<string, unknown>).count).toBe(0);
      expect(Array.isArray((json.data.tools as Record<string, unknown>).items)).toBe(true);
    });

    it('returns exposed tools enriched with base names and categories', async () => {
      mockToolRegistry.getAllTools.mockReturnValue([
        {
          definition: {
            name: 'core.read_file',
            description: 'Read a file',
            category: 'files',
          },
        },
        {
          definition: {
            name: 'custom.my_tool',
            description: 'A custom tool',
            category: 'custom',
          },
        },
      ]);

      const res = await app.request('/mcp/serve/info');
      const json = await res.json() as {
        data: {
          tools: { count: number; items: Array<{ name: string; qualifiedName: string; description: string; category: string }> };
        };
      };

      expect(json.data.tools.count).toBe(2);
      const items = json.data.tools.items;
      expect(items[0]!.name).toBe('read_file');
      expect(items[0]!.qualifiedName).toBe('core.read_file');
      expect(items[0]!.description).toBe('Read a file');
      expect(items[0]!.category).toBe('files');
      expect(items[1]!.name).toBe('my_tool');
      expect(items[1]!.qualifiedName).toBe('custom.my_tool');
    });

    it('returns all four config snippets', async () => {
      const res = await app.request('/mcp/serve/info');
      const json = await res.json() as {
        data: { configSnippets: Record<string, { label: string; description: string; config: unknown }> };
      };

      const snippets = json.data.configSnippets;
      expect(snippets.claude_desktop).toBeDefined();
      expect(snippets.claude_desktop.label).toBe('Claude Desktop');
      expect(snippets.cursor).toBeDefined();
      expect(snippets.cursor.label).toBe('Cursor');
      expect(snippets.claude_code).toBeDefined();
      expect(snippets.claude_code.label).toBe('Claude Code');
      expect(snippets.generic_http).toBeDefined();
      expect(snippets.generic_http.label).toBe('Generic HTTP Client');
    });

    it('uses x-forwarded-proto and x-forwarded-host headers when present', async () => {
      const res = await app.request('/mcp/serve/info', {
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'my.domain.com',
        },
      });

      const json = await res.json() as { data: { server: { endpoint: string } } };
      expect(json.data.server.endpoint).toBe('https://my.domain.com/api/v1/mcp/serve');
    });

    it('returns 500 on registry failure', async () => {
      mockToolRegistry.getAllTools.mockImplementation(() => {
        throw new Error('Registry unavailable');
      });

      const res = await app.request('/mcp/serve/info');

      expect(res.status).toBe(500);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
      expect(json.error.message).toBe('Registry unavailable');
    });
  });

  // ========================================================================
  // GET /mcp
  // ========================================================================

  describe('GET /mcp', () => {
    it('returns enriched server list with live connection status', async () => {
      mockRepo.getAll.mockResolvedValue([sampleServer, sampleSseServer]);
      mockMcpClientService.isConnected.mockImplementation(
        (name: string) => name === 'test-server',
      );

      const res = await app.request('/mcp');

      expect(res.status).toBe(200);
      const json = await res.json() as {
        data: {
          servers: Array<{ id: string; name: string; connected: boolean }>;
          count: number;
        };
      };
      expect(json.data.count).toBe(2);
      expect(json.data.servers).toHaveLength(2);

      const first = json.data.servers.find(s => s.id === 'mcp-1')!;
      expect(first.connected).toBe(true);

      const second = json.data.servers.find(s => s.id === 'mcp-2')!;
      expect(second.connected).toBe(false);
    });

    it('returns empty list when no servers configured', async () => {
      mockRepo.getAll.mockResolvedValue([]);

      const res = await app.request('/mcp');

      expect(res.status).toBe(200);
      const json = await res.json() as { data: { servers: unknown[]; count: number } };
      expect(json.data.servers).toHaveLength(0);
      expect(json.data.count).toBe(0);
    });

    it('returns 500 on repo failure', async () => {
      mockRepo.getAll.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/mcp');

      expect(res.status).toBe(500);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================================================
  // POST /mcp
  // ========================================================================

  describe('POST /mcp', () => {
    it('creates a stdio server and returns 201', async () => {
      mockRepo.getByName.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(sampleServer);

      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-server',
          displayName: 'Test Server',
          transport: 'stdio',
          command: '/usr/bin/node',
          args: ['server.js'],
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json() as { data: typeof sampleServer };
      expect(json.data.id).toBe('mcp-1');
      expect(json.data.name).toBe('test-server');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-server',
          displayName: 'Test Server',
          transport: 'stdio',
          command: '/usr/bin/node',
        }),
      );
    });

    it('creates an SSE server with URL', async () => {
      mockRepo.getByName.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(sampleSseServer);

      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sse-server',
          displayName: 'SSE Server',
          transport: 'sse',
          url: 'http://localhost:3001/sse',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json() as { data: typeof sampleSseServer };
      expect(json.data.transport).toBe('sse');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: 'sse',
          url: 'http://localhost:3001/sse',
        }),
      );
    });

    it('broadcasts creation event via WebSocket', async () => {
      mockRepo.getByName.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(sampleServer);

      const { wsGateway } = await import('../ws/server.js');

      await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-server',
          displayName: 'Test Server',
          transport: 'stdio',
          command: '/usr/bin/node',
        }),
      });

      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'mcp_server',
        action: 'created',
        id: 'mcp-1',
      });
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Test Server',
          transport: 'stdio',
          command: '/usr/bin/node',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('Name is required');
    });

    it('returns 400 when name is blank whitespace', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '   ',
          displayName: 'Test Server',
          transport: 'stdio',
          command: '/usr/bin/node',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when displayName is missing', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-server',
          transport: 'stdio',
          command: '/usr/bin/node',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('Display name is required');
    });

    it('returns 400 when transport is missing', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-server',
          displayName: 'Test Server',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('Transport type is required');
    });

    it('returns 400 for stdio transport without command', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-server',
          displayName: 'Test Server',
          transport: 'stdio',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('Command is required for stdio transport');
    });

    it('returns 400 for SSE transport without URL', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'sse-server',
          displayName: 'SSE Server',
          transport: 'sse',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('URL is required for network transport');
    });

    it('returns 400 for streamable-http transport without URL', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'http-server',
          displayName: 'HTTP Server',
          transport: 'streamable-http',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('URL is required for network transport');
    });

    it('returns 409 for duplicate server name', async () => {
      mockRepo.getByName.mockResolvedValue(sampleServer);

      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-server',
          displayName: 'Test Server',
          transport: 'stdio',
          command: '/usr/bin/node',
        }),
      });

      expect(res.status).toBe(409);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('ALREADY_EXISTS');
      expect(json.error.message).toContain('"test-server"');
      expect(json.error.message).toContain('already exists');
    });

    it('returns 500 on repo failure', async () => {
      mockRepo.getByName.mockResolvedValue(null);
      mockRepo.create.mockRejectedValue(new Error('DB write failed'));

      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-server',
          displayName: 'Test Server',
          transport: 'stdio',
          command: '/usr/bin/node',
        }),
      });

      expect(res.status).toBe(500);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================================================
  // GET /mcp/:id
  // ========================================================================

  describe('GET /mcp/:id', () => {
    it('returns server with live connection status', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(true);

      const res = await app.request('/mcp/mcp-1');

      expect(res.status).toBe(200);
      const json = await res.json() as {
        data: typeof sampleServer & { connected: boolean };
      };
      expect(json.data.id).toBe('mcp-1');
      expect(json.data.name).toBe('test-server');
      expect(json.data.connected).toBe(true);
      expect(mockMcpClientService.isConnected).toHaveBeenCalledWith('test-server');
    });

    it('returns connected: false when server is not connected', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);

      const res = await app.request('/mcp/mcp-1');

      const json = await res.json() as { data: { connected: boolean } };
      expect(json.data.connected).toBe(false);
    });

    it('returns 404 for unknown server id', async () => {
      mockRepo.getById.mockResolvedValue(null);

      const res = await app.request('/mcp/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('MCP server not found');
    });

    it('returns 500 on repo failure', async () => {
      mockRepo.getById.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/mcp/mcp-1');

      expect(res.status).toBe(500);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================================================
  // PUT /mcp/:id
  // ========================================================================

  describe('PUT /mcp/:id', () => {
    it('updates server configuration', async () => {
      const updated = { ...sampleServer, displayName: 'Updated Name' };
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);
      mockRepo.update.mockResolvedValue(updated);

      const res = await app.request('/mcp/mcp-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated Name' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json() as { data: typeof updated };
      expect(json.data.displayName).toBe('Updated Name');
      expect(mockRepo.update).toHaveBeenCalledWith(
        'mcp-1',
        expect.objectContaining({ displayName: 'Updated Name' }),
      );
    });

    it('disconnects before updating when server is currently connected', async () => {
      const updated = { ...sampleServer, command: '/usr/local/bin/node' };
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(true);
      mockRepo.update.mockResolvedValue(updated);

      const res = await app.request('/mcp/mcp-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: '/usr/local/bin/node' }),
      });

      expect(res.status).toBe(200);
      expect(mockMcpClientService.disconnect).toHaveBeenCalledWith('test-server');
      expect(mockRepo.update).toHaveBeenCalled();
    });

    it('skips disconnect when server is not connected', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);
      mockRepo.update.mockResolvedValue(sampleServer);

      await app.request('/mcp/mcp-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated' }),
      });

      expect(mockMcpClientService.disconnect).not.toHaveBeenCalled();
    });

    it('broadcasts update event via WebSocket', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);
      mockRepo.update.mockResolvedValue(sampleServer);

      const { wsGateway } = await import('../ws/server.js');

      await app.request('/mcp/mcp-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated' }),
      });

      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'mcp_server',
        action: 'updated',
        id: 'mcp-1',
      });
    });

    it('returns 404 for unknown server id', async () => {
      mockRepo.getById.mockResolvedValue(null);

      const res = await app.request('/mcp/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Something' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('MCP server not found');
    });

    it('returns 500 on repo failure', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);
      mockRepo.update.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/mcp/mcp-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================================================
  // DELETE /mcp/:id
  // ========================================================================

  describe('DELETE /mcp/:id', () => {
    it('deletes server and returns deleted: true', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);
      mockRepo.delete.mockResolvedValue(true);

      const res = await app.request('/mcp/mcp-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json() as { data: { deleted: boolean } };
      expect(json.data.deleted).toBe(true);
      expect(mockRepo.delete).toHaveBeenCalledWith('mcp-1');
    });

    it('disconnects before deleting when server is currently connected', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(true);
      mockRepo.delete.mockResolvedValue(true);

      const res = await app.request('/mcp/mcp-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      expect(mockMcpClientService.disconnect).toHaveBeenCalledWith('test-server');
      expect(mockRepo.delete).toHaveBeenCalledWith('mcp-1');
    });

    it('skips disconnect when server is not connected', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);
      mockRepo.delete.mockResolvedValue(true);

      await app.request('/mcp/mcp-1', { method: 'DELETE' });

      expect(mockMcpClientService.disconnect).not.toHaveBeenCalled();
    });

    it('broadcasts deletion event via WebSocket', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);
      mockRepo.delete.mockResolvedValue(true);

      const { wsGateway } = await import('../ws/server.js');

      await app.request('/mcp/mcp-1', { method: 'DELETE' });

      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'mcp_server',
        action: 'deleted',
        id: 'mcp-1',
      });
    });

    it('returns 404 for unknown server id', async () => {
      mockRepo.getById.mockResolvedValue(null);

      const res = await app.request('/mcp/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('MCP server not found');
    });

    it('returns 500 on repo failure', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);
      mockRepo.delete.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/mcp/mcp-1', { method: 'DELETE' });

      expect(res.status).toBe(500);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================================================
  // POST /mcp/:id/connect
  // ========================================================================

  describe('POST /mcp/:id/connect', () => {
    it('connects server and returns tool count', async () => {
      const tools = [
        { name: 'tool_one', description: 'Tool one' },
        { name: 'tool_two', description: 'Tool two' },
      ];
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.connect.mockResolvedValue(tools);

      const res = await app.request('/mcp/mcp-1/connect', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json() as { data: { connected: boolean; tools: unknown[]; toolCount: number } };
      expect(json.data.connected).toBe(true);
      expect(json.data.tools).toHaveLength(2);
      expect(json.data.toolCount).toBe(2);
      expect(mockMcpClientService.connect).toHaveBeenCalledWith(sampleServer);
    });

    it('broadcasts update event after connecting', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.connect.mockResolvedValue([]);

      const { wsGateway } = await import('../ws/server.js');

      await app.request('/mcp/mcp-1/connect', { method: 'POST' });

      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'mcp_server',
        action: 'updated',
        id: 'mcp-1',
      });
    });

    it('returns 404 for unknown server id', async () => {
      mockRepo.getById.mockResolvedValue(null);

      const res = await app.request('/mcp/nonexistent/connect', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('MCP server not found');
    });

    it('returns 500 when connect throws', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.connect.mockRejectedValue(new Error('Connection refused'));

      const res = await app.request('/mcp/mcp-1/connect', { method: 'POST' });

      expect(res.status).toBe(500);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
      expect(json.error.message).toContain('Connection refused');
    });

    it('returns 500 with "Failed to connect" fallback when error has no message', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.connect.mockRejectedValue('non-error-thrown');

      const res = await app.request('/mcp/mcp-1/connect', { method: 'POST' });

      expect(res.status).toBe(500);
      const json = await res.json() as { error: { message: string } };
      expect(json.error.message).toBe('Failed to connect');
    });
  });

  // ========================================================================
  // POST /mcp/:id/disconnect
  // ========================================================================

  describe('POST /mcp/:id/disconnect', () => {
    it('disconnects server and returns disconnected: true', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.disconnect.mockResolvedValue(undefined);

      const res = await app.request('/mcp/mcp-1/disconnect', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json() as { data: { disconnected: boolean } };
      expect(json.data.disconnected).toBe(true);
      expect(mockMcpClientService.disconnect).toHaveBeenCalledWith('test-server');
    });

    it('broadcasts update event after disconnecting', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.disconnect.mockResolvedValue(undefined);

      const { wsGateway } = await import('../ws/server.js');

      await app.request('/mcp/mcp-1/disconnect', { method: 'POST' });

      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'mcp_server',
        action: 'updated',
        id: 'mcp-1',
      });
    });

    it('returns 404 for unknown server id', async () => {
      mockRepo.getById.mockResolvedValue(null);

      const res = await app.request('/mcp/nonexistent/disconnect', { method: 'POST' });

      expect(res.status).toBe(404);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('MCP server not found');
    });

    it('returns 500 when disconnect throws', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.disconnect.mockRejectedValue(new Error('Disconnect failed'));

      const res = await app.request('/mcp/mcp-1/disconnect', { method: 'POST' });

      expect(res.status).toBe(500);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================================================
  // GET /mcp/:id/tools
  // ========================================================================

  describe('GET /mcp/:id/tools', () => {
    it('returns tools from a connected server', async () => {
      const tools = [
        { name: 'read_resource', description: 'Read a resource' },
        { name: 'write_resource', description: 'Write a resource' },
      ];
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(true);
      mockMcpClientService.getServerTools.mockReturnValue(tools);

      const res = await app.request('/mcp/mcp-1/tools');

      expect(res.status).toBe(200);
      const json = await res.json() as { data: { tools: unknown[]; count: number } };
      expect(json.data.tools).toHaveLength(2);
      expect(json.data.count).toBe(2);
      expect(mockMcpClientService.getServerTools).toHaveBeenCalledWith('test-server');
    });

    it('returns empty tools list from a connected server with no tools', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(true);
      mockMcpClientService.getServerTools.mockReturnValue([]);

      const res = await app.request('/mcp/mcp-1/tools');

      expect(res.status).toBe(200);
      const json = await res.json() as { data: { tools: unknown[]; count: number } };
      expect(json.data.tools).toHaveLength(0);
      expect(json.data.count).toBe(0);
    });

    it('returns 404 for unknown server id', async () => {
      mockRepo.getById.mockResolvedValue(null);

      const res = await app.request('/mcp/nonexistent/tools');

      expect(res.status).toBe(404);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('MCP server not found');
    });

    it('returns 400 when server is not connected', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);

      const res = await app.request('/mcp/mcp-1/tools');

      expect(res.status).toBe(400);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('BAD_REQUEST');
      expect(json.error.message).toContain('not connected');
      expect(json.error.message).toContain('Connect first');
    });

    it('returns 500 on repo failure', async () => {
      mockRepo.getById.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/mcp/mcp-1/tools');

      expect(res.status).toBe(500);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 404 when userId does not match server owner', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);

      const user2App = createApp('user-2');
      const res = await user2App.request('/mcp/mcp-1/tools');

      expect(res.status).toBe(404);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('MCP server not found');
    });
  });

  // ========================================================================
  // PATCH /mcp/:id/tool-settings
  // ========================================================================

  describe('PATCH /mcp/:id/tool-settings', () => {
    it('updates workflowUsable for a tool and returns result', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockRepo.update.mockResolvedValue({ ...sampleServer, metadata: { toolSettings: { my_tool: { workflowUsable: false } } } });
      mockMcpClientService.isConnected.mockReturnValue(false);

      const res = await app.request('/mcp/mcp-1/tool-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'my_tool', workflowUsable: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json() as { data: { toolName: string; workflowUsable: boolean } };
      expect(json.data.toolName).toBe('my_tool');
      expect(json.data.workflowUsable).toBe(false);
      expect(mockRepo.update).toHaveBeenCalledWith('mcp-1', {
        metadata: expect.objectContaining({
          toolSettings: { my_tool: { workflowUsable: false } },
        }),
      });
    });

    it('merges with existing toolSettings', async () => {
      const serverWithSettings = {
        ...sampleServer,
        metadata: { toolSettings: { existing_tool: { workflowUsable: true } } },
      };
      mockRepo.getById.mockResolvedValue(serverWithSettings);
      mockRepo.update.mockResolvedValue(serverWithSettings);
      mockMcpClientService.isConnected.mockReturnValue(false);

      const res = await app.request('/mcp/mcp-1/tool-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'new_tool', workflowUsable: false }),
      });

      expect(res.status).toBe(200);
      expect(mockRepo.update).toHaveBeenCalledWith('mcp-1', {
        metadata: expect.objectContaining({
          toolSettings: {
            existing_tool: { workflowUsable: true },
            new_tool: { workflowUsable: false },
          },
        }),
      });
    });

    it('calls refreshToolRegistration when server is connected', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockRepo.update.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(true);
      mockMcpClientService.refreshToolRegistration.mockResolvedValue(undefined);

      const res = await app.request('/mcp/mcp-1/tool-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'my_tool', workflowUsable: false }),
      });

      expect(res.status).toBe(200);
      expect(mockMcpClientService.refreshToolRegistration).toHaveBeenCalledWith('test-server');
    });

    it('skips refreshToolRegistration when server is disconnected', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockRepo.update.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);

      await app.request('/mcp/mcp-1/tool-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'my_tool', workflowUsable: true }),
      });

      expect(mockMcpClientService.refreshToolRegistration).not.toHaveBeenCalled();
    });

    it('returns 400 when toolName is missing', async () => {
      const res = await app.request('/mcp/mcp-1/tool-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowUsable: false }),
      });

      expect(res.status).toBe(400);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when workflowUsable is not boolean', async () => {
      const res = await app.request('/mcp/mcp-1/tool-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'my_tool', workflowUsable: 'yes' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 for unknown server id', async () => {
      mockRepo.getById.mockResolvedValue(null);

      const res = await app.request('/mcp/nonexistent/tool-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'my_tool', workflowUsable: false }),
      });

      expect(res.status).toBe(404);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when userId does not match server owner', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);

      const user2App = createApp('user-2');
      const res = await user2App.request('/mcp/mcp-1/tool-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'my_tool', workflowUsable: false }),
      });

      expect(res.status).toBe(404);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('broadcasts update event via WebSocket', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockRepo.update.mockResolvedValue(sampleServer);
      mockMcpClientService.isConnected.mockReturnValue(false);

      const { wsGateway } = await import('../ws/server.js');

      await app.request('/mcp/mcp-1/tool-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'my_tool', workflowUsable: false }),
      });

      expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'mcp_server',
        action: 'updated',
        id: 'mcp-1',
      });
    });

    it('returns 500 on repo failure', async () => {
      mockRepo.getById.mockResolvedValue(sampleServer);
      mockRepo.update.mockRejectedValue(new Error('DB error'));
      mockMcpClientService.isConnected.mockReturnValue(false);

      const res = await app.request('/mcp/mcp-1/tool-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'my_tool', workflowUsable: false }),
      });

      expect(res.status).toBe(500);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
