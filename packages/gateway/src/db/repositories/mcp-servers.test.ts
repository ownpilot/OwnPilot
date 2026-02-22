/**
 * MCP Servers Repository Tests
 *
 * Unit tests for McpServersRepository CRUD, status management,
 * JSON parsing, and singleton initialization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter: {
  [K in keyof DatabaseAdapter]: ReturnType<typeof vi.fn>;
} = {
  type: 'postgres' as unknown as ReturnType<typeof vi.fn>,
  isConnected: vi.fn().mockReturnValue(true),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ changes: 0 }),
  exec: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  now: vi.fn().mockReturnValue('NOW()'),
  date: vi.fn(),
  dateSubtract: vi.fn(),
  placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
  boolean: vi.fn().mockImplementation((v: boolean) => v),
  parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue(mockAdapter),
  getAdapterSync: vi.fn().mockReturnValue(mockAdapter),
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: vi.fn().mockReturnValue('generated-uuid') };
});

const { getMcpServersRepo, initializeMcpServersRepo } = await import('./mcp-servers.js');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mcp-1',
    user_id: 'default',
    name: 'test-server',
    display_name: 'Test Server',
    transport: 'stdio',
    command: '/usr/bin/node',
    args: '["server.js"]',
    env: '{"NODE_ENV":"production"}',
    url: null,
    headers: '{}',
    enabled: true,
    auto_connect: true,
    status: 'disconnected',
    error_message: null,
    tool_count: 0,
    metadata: '{}',
    created_at: '2024-06-01T12:00:00Z',
    updated_at: '2024-06-01T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpServersRepository', () => {
  let repo: ReturnType<typeof getMcpServersRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = getMcpServersRepo();
  });

  // =========================================================================
  // getAll
  // =========================================================================

  describe('getAll', () => {
    it('should return all servers for the user', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ id: 'mcp-1' }),
        makeRow({ id: 'mcp-2', name: 'second-server', display_name: 'Second' }),
      ]);

      const result = await repo.getAll();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('mcp-1');
      expect(result[1]!.id).toBe('mcp-2');
    });

    it('should return empty array when no servers', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getAll();

      expect(result).toEqual([]);
    });

    it('should query by user_id and order by display_name', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll('user-42');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id');
      expect(sql).toContain('ORDER BY display_name');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-42']);
    });

    it('should default userId to "default"', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getAll();

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['default']);
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe('getById', () => {
    it('should return a server when found', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow()]);

      const result = await repo.getById('mcp-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('mcp-1');
      expect(result!.name).toBe('test-server');
      expect(result!.displayName).toBe('Test Server');
    });

    it('should return null when not found', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getById('nonexistent');

      expect(result).toBeNull();
    });

    it('should query by id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getById('mcp-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('id = ?');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['mcp-1']);
    });
  });

  // =========================================================================
  // getByName
  // =========================================================================

  describe('getByName', () => {
    it('should return a server when found by name', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow()]);

      const result = await repo.getByName('test-server');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('test-server');
    });

    it('should return null when name not found', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getByName('unknown-server');

      expect(result).toBeNull();
    });

    it('should query by name and user_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByName('test-server', 'user-42');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('name = ?');
      expect(sql).toContain('user_id = ?');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['test-server', 'user-42']);
    });
  });

  // =========================================================================
  // getEnabled
  // =========================================================================

  describe('getEnabled', () => {
    it('should return enabled and auto-connect servers', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow()]);

      const result = await repo.getEnabled();

      expect(result).toHaveLength(1);
    });

    it('should filter by enabled and auto_connect', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getEnabled();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('enabled = TRUE');
      expect(sql).toContain('auto_connect = TRUE');
    });
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a server and return it', async () => {
      const row = makeRow({ id: 'generated-uuid' });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.query.mockResolvedValueOnce([row]);

      const result = await repo.create({
        name: 'test-server',
        displayName: 'Test Server',
        transport: 'stdio',
        command: '/usr/bin/node',
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.id).toBe('generated-uuid');
      expect(result.name).toBe('test-server');
    });

    it('should serialize args, env, and headers as JSON', async () => {
      const row = makeRow({ id: 'generated-uuid' });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.query.mockResolvedValueOnce([row]);

      await repo.create({
        name: 'srv',
        displayName: 'Srv',
        transport: 'stdio',
        args: ['--port', '3000'],
        env: { KEY: 'val' },
        headers: { Authorization: 'Bearer xyz' },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[6]).toBe('["--port","3000"]');   // args
      expect(params[7]).toBe('{"KEY":"val"}');        // env
      expect(params[9]).toBe('{"Authorization":"Bearer xyz"}'); // headers
    });

    it('should default enabled and autoConnect to true', async () => {
      const row = makeRow({ id: 'generated-uuid' });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.query.mockResolvedValueOnce([row]);

      await repo.create({
        name: 'srv',
        displayName: 'Srv',
        transport: 'stdio',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[10]).toBe(true);  // enabled !== false → true
      expect(params[11]).toBe(true);  // autoConnect !== false → true
    });

    it('should default userId to "default"', async () => {
      const row = makeRow({ id: 'generated-uuid' });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.query.mockResolvedValueOnce([row]);

      await repo.create({
        name: 'srv',
        displayName: 'Srv',
        transport: 'stdio',
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[1]).toBe('default');
    });

    it('should throw when getById returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.query.mockResolvedValueOnce([]); // getById returns null

      await expect(
        repo.create({ name: 'srv', displayName: 'Srv', transport: 'stdio' }),
      ).rejects.toThrow('Failed to create MCP server record');
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update fields and return the updated server', async () => {
      const original = makeRow();
      const updated = makeRow({ display_name: 'Updated Server' });

      // getById (existing check)
      mockAdapter.query.mockResolvedValueOnce([original]);
      // execute update
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // getById (return updated)
      mockAdapter.query.mockResolvedValueOnce([updated]);

      const result = await repo.update('mcp-1', { displayName: 'Updated Server' });

      expect(result).not.toBeNull();
      expect(result!.displayName).toBe('Updated Server');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return null when server does not exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]); // getById returns null

      const result = await repo.update('nonexistent', { name: 'new' });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return existing when no fields to update', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow()]);

      const result = await repo.update('mcp-1', {});

      expect(result).not.toBeNull();
      expect(result!.id).toBe('mcp-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should serialize JSON fields on update', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow()]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.query.mockResolvedValueOnce([makeRow()]);

      await repo.update('mcp-1', {
        args: ['--verbose'],
        env: { DEBUG: 'true' },
        headers: { 'X-Custom': 'header' },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain('["--verbose"]');
      expect(params).toContain('{"DEBUG":"true"}');
      expect(params).toContain('{"X-Custom":"header"}');
    });

    it('should serialize metadata JSON on update', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow()]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.query.mockResolvedValueOnce([makeRow()]);

      await repo.update('mcp-1', {
        metadata: { toolSettings: { my_tool: { workflowUsable: false } } },
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('metadata = ?');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain(JSON.stringify({ toolSettings: { my_tool: { workflowUsable: false } } }));
    });

    it('should build dynamic SET clause for partial updates', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow()]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.query.mockResolvedValueOnce([makeRow({ transport: 'sse', url: 'http://localhost:3000' })]);

      await repo.update('mcp-1', { transport: 'sse', url: 'http://localhost:3000' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('transport = ?');
      expect(sql).toContain('url = ?');
      expect(sql).toContain('updated_at = ?');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('mcp-1')).toBe(true);
    });

    it('should return false when server not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('nonexistent')).toBe(false);
    });

    it('should use correct SQL', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('mcp-1');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM mcp_servers');
      expect(sql).toContain('id = ?');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['mcp-1']);
    });
  });

  // =========================================================================
  // updateStatus
  // =========================================================================

  describe('updateStatus', () => {
    it('should update status and updated_at', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('mcp-1', 'connected');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('status = ?');
      expect(sql).toContain('updated_at = ?');
      expect(sql).toContain('WHERE id = ?');
    });

    it('should include error_message when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('mcp-1', 'error', 'Connection refused');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('error_message = ?');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain('Connection refused');
    });

    it('should include tool_count when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('mcp-1', 'connected', undefined, 5);

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('tool_count = ?');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain(5);
    });

    it('should include both error_message and tool_count when provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('mcp-1', 'error', 'Timeout', 3);

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('error_message = ?');
      expect(sql).toContain('tool_count = ?');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toContain('Timeout');
      expect(params).toContain(3);
    });

    it('should set error_message to null for empty string', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('mcp-1', 'connected', '');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      // errorMessage || null — empty string becomes null
      expect(params).toContain(null);
    });

    it('should not include error_message when undefined', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateStatus('mcp-1', 'disconnected');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).not.toContain('error_message');
    });
  });

  // =========================================================================
  // JSON parsing (rowToRecord)
  // =========================================================================

  describe('JSON parsing', () => {
    it('should parse args from JSON string', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ args: '["--port","3000","--verbose"]' }),
      ]);

      const result = await repo.getById('mcp-1');

      expect(result!.args).toEqual(['--port', '3000', '--verbose']);
    });

    it('should parse env from JSON string', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ env: '{"NODE_ENV":"production","DEBUG":"*"}' }),
      ]);

      const result = await repo.getById('mcp-1');

      expect(result!.env).toEqual({ NODE_ENV: 'production', DEBUG: '*' });
    });

    it('should parse headers from JSON string', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ headers: '{"Authorization":"Bearer token"}' }),
      ]);

      const result = await repo.getById('mcp-1');

      expect(result!.headers).toEqual({ Authorization: 'Bearer token' });
    });

    it('should parse metadata from JSON string', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ metadata: '{"version":"1.0","features":["a","b"]}' }),
      ]);

      const result = await repo.getById('mcp-1');

      expect(result!.metadata).toEqual({ version: '1.0', features: ['a', 'b'] });
    });

    it('should fallback to defaults for null JSON fields', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ args: null, env: null, headers: null, metadata: null }),
      ]);

      const result = await repo.getById('mcp-1');

      expect(result!.args).toEqual([]);
      expect(result!.env).toEqual({});
      expect(result!.headers).toEqual({});
      expect(result!.metadata).toEqual({});
    });

    it('should fallback to defaults for invalid JSON strings', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ args: 'bad-json', env: '{invalid', headers: 'nope', metadata: '[broken' }),
      ]);

      const result = await repo.getById('mcp-1');

      expect(result!.args).toEqual([]);
      expect(result!.env).toEqual({});
      expect(result!.headers).toEqual({});
      expect(result!.metadata).toEqual({});
    });

    it('should handle already-parsed JSON (PostgreSQL JSONB)', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({
          args: ['a', 'b'],
          env: { K: 'V' },
          headers: { H: 'val' },
          metadata: { x: 1 },
        }),
      ]);

      const result = await repo.getById('mcp-1');

      expect(result!.args).toEqual(['a', 'b']);
      expect(result!.env).toEqual({ K: 'V' });
      expect(result!.headers).toEqual({ H: 'val' });
      expect(result!.metadata).toEqual({ x: 1 });
    });
  });

  // =========================================================================
  // Boolean coercion
  // =========================================================================

  describe('Boolean coercion', () => {
    it('should coerce numeric enabled/auto_connect to boolean', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ enabled: 1, auto_connect: 0 }),
      ]);

      const result = await repo.getById('mcp-1');

      expect(result!.enabled).toBe(true);
      expect(result!.autoConnect).toBe(false);
    });

    it('should handle boolean enabled/auto_connect directly', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ enabled: false, auto_connect: true }),
      ]);

      const result = await repo.getById('mcp-1');

      expect(result!.enabled).toBe(false);
      expect(result!.autoConnect).toBe(true);
    });
  });

  // =========================================================================
  // Field mapping
  // =========================================================================

  describe('field mapping', () => {
    it('should map command to optional string', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow({ command: null })]);

      const result = await repo.getById('mcp-1');

      expect(result!.command).toBeUndefined();
    });

    it('should map url to optional string', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ url: 'http://localhost:3000/sse' }),
      ]);

      const result = await repo.getById('mcp-1');

      expect(result!.url).toBe('http://localhost:3000/sse');
    });

    it('should map error_message to optional string', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeRow({ error_message: 'Connection timeout' }),
      ]);

      const result = await repo.getById('mcp-1');

      expect(result!.errorMessage).toBe('Connection timeout');
    });

    it('should map null error_message to undefined', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeRow({ error_message: null })]);

      const result = await repo.getById('mcp-1');

      expect(result!.errorMessage).toBeUndefined();
    });
  });

  // =========================================================================
  // Singleton + Initialization
  // =========================================================================

  describe('getMcpServersRepo', () => {
    it('should return the same instance on multiple calls', () => {
      const a = getMcpServersRepo();
      const b = getMcpServersRepo();
      expect(a).toBe(b);
    });
  });

  describe('initializeMcpServersRepo', () => {
    it('should call getAll to verify table exists', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await initializeMcpServersRepo();

      expect(mockAdapter.query).toHaveBeenCalled();
    });

    it('should not throw when getAll fails', async () => {
      mockAdapter.query.mockRejectedValueOnce(new Error('table not found'));

      await expect(initializeMcpServersRepo()).resolves.toBeUndefined();
    });
  });
});
