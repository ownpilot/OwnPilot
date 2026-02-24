/**
 * Custom Tools Repository Tests
 *
 * Unit tests for CustomToolsRepository: CRUD, status management, usage tracking,
 * JSON serialization, filtering, and approval workflow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

import { CustomToolsRepository } from './custom-tools.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeToolRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool_abc123',
    user_id: 'user-1',
    name: 'my_tool',
    description: 'A test tool',
    parameters: '{"type":"object","properties":{"input":{"type":"string"}},"required":["input"]}',
    code: 'return input;',
    category: null,
    status: 'active',
    permissions: '[]',
    requires_approval: false,
    created_by: 'user',
    version: 1,
    usage_count: 0,
    last_used_at: null,
    created_at: NOW,
    updated_at: NOW,
    metadata: null,
    required_api_keys: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CustomToolsRepository', () => {
  let repo: CustomToolsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new CustomToolsRepository('user-1');
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a tool and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      const result = await repo.create({
        name: 'my_tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        },
        code: 'return input;',
      });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.name).toBe('my_tool');
      expect(result.description).toBe('A test tool');
      expect(result.status).toBe('active');
      expect(result.createdBy).toBe('user');
      expect(result.version).toBe(1);
      expect(result.usageCount).toBe(0);
    });

    it('should serialize parameters as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      const params = { type: 'object' as const, properties: { x: { type: 'number' } } };
      await repo.create({
        name: 'test',
        description: 'Test',
        parameters: params,
        code: 'return x;',
      });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[4]).toBe(JSON.stringify(params));
    });

    it('should serialize permissions as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeToolRow({ permissions: '["network","database"]' })
      );

      await repo.create({
        name: 'test',
        description: 'Test',
        parameters: { type: 'object', properties: {} },
        code: 'return 1;',
        permissions: ['network', 'database'],
      });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[8]).toBe('["network","database"]');
    });

    it('should set status to pending_approval for LLM-created tools with dangerous permissions', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeToolRow({ status: 'pending_approval', created_by: 'llm' })
      );

      await repo.create({
        name: 'danger_tool',
        description: 'Runs shell',
        parameters: { type: 'object', properties: {} },
        code: 'exec("ls")',
        permissions: ['shell'],
        createdBy: 'llm',
      });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[7]).toBe('pending_approval');
    });

    it('should set status to active for LLM-created tools without dangerous permissions', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeToolRow({ status: 'active', created_by: 'llm' })
      );

      await repo.create({
        name: 'safe_tool',
        description: 'Network only',
        parameters: { type: 'object', properties: {} },
        code: 'fetch("url")',
        permissions: ['network'],
        createdBy: 'llm',
      });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[7]).toBe('active');
    });

    it('should set status to active for user-created tools even with dangerous permissions', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ permissions: '["shell"]' }));

      await repo.create({
        name: 'user_shell',
        description: 'User shell tool',
        parameters: { type: 'object', properties: {} },
        code: 'exec("ls")',
        permissions: ['shell'],
        createdBy: 'user',
      });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[7]).toBe('active');
    });

    it('should serialize metadata as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ metadata: '{"tag":"v1"}' }));

      await repo.create({
        name: 'test',
        description: 'Test',
        parameters: { type: 'object', properties: {} },
        code: 'return 1;',
        metadata: { tag: 'v1' },
      });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[11]).toBe('{"tag":"v1"}');
    });

    it('should serialize requiredApiKeys as JSON', async () => {
      const apiKeys = [{ name: 'OPENAI_KEY', displayName: 'OpenAI API Key' }];
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeToolRow({ required_api_keys: JSON.stringify(apiKeys) })
      );

      await repo.create({
        name: 'test',
        description: 'Test',
        parameters: { type: 'object', properties: {} },
        code: 'return 1;',
        requiredApiKeys: apiKeys,
      });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[12]).toBe(JSON.stringify(apiKeys));
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.create({
          name: 'test',
          description: 'Test',
          parameters: { type: 'object', properties: {} },
          code: 'return 1;',
        })
      ).rejects.toThrow('Failed to create custom tool');
    });

    it('should default category to null and permissions to empty array', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      await repo.create({
        name: 'test',
        description: 'Test',
        parameters: { type: 'object', properties: {} },
        code: 'return 1;',
      });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[6]).toBeNull(); // category
      expect(executeParams[8]).toBe('[]'); // permissions
      expect(executeParams[9]).toBe(false); // requiresApproval
      expect(executeParams[10]).toBe('user'); // createdBy
    });

    it('should detect filesystem as dangerous permission for LLM tools', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ status: 'pending_approval' }));

      await repo.create({
        name: 'fs_tool',
        description: 'File tool',
        parameters: { type: 'object', properties: {} },
        code: 'readFile("x")',
        permissions: ['filesystem'],
        createdBy: 'llm',
      });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[7]).toBe('pending_approval');
    });

    it('should detect email as dangerous permission for LLM tools', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ status: 'pending_approval' }));

      await repo.create({
        name: 'email_tool',
        description: 'Email tool',
        parameters: { type: 'object', properties: {} },
        code: 'sendEmail()',
        permissions: ['email'],
        createdBy: 'llm',
      });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[7]).toBe('pending_approval');
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return a tool when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      const result = await repo.get('tool_abc123');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('tool_abc123');
      expect(result!.name).toBe('my_tool');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.get('missing')).toBeNull();
    });

    it('should parse JSON fields correctly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeToolRow({
          parameters: '{"type":"object","properties":{"x":{"type":"number"}}}',
          permissions: '["network","database"]',
          metadata: '{"version":"2.0"}',
          required_api_keys: '[{"name":"API_KEY"}]',
        })
      );

      const result = await repo.get('tool_abc123');

      expect(result!.parameters).toEqual({ type: 'object', properties: { x: { type: 'number' } } });
      expect(result!.permissions).toEqual(['network', 'database']);
      expect(result!.metadata).toEqual({ version: '2.0' });
      expect(result!.requiredApiKeys).toEqual([{ name: 'API_KEY' }]);
    });

    it('should parse dates correctly', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeToolRow({ last_used_at: '2025-01-10T08:00:00.000Z' })
      );

      const result = await repo.get('tool_abc123');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
      expect(result!.lastUsedAt).toBeInstanceOf(Date);
    });

    it('should leave lastUsedAt undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      const result = await repo.get('tool_abc123');

      expect(result!.lastUsedAt).toBeUndefined();
    });

    it('should leave metadata undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      const result = await repo.get('tool_abc123');

      expect(result!.metadata).toBeUndefined();
    });

    it('should leave requiredApiKeys undefined when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      const result = await repo.get('tool_abc123');

      expect(result!.requiredApiKeys).toBeUndefined();
    });

    it('should convert category null to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      const result = await repo.get('tool_abc123');

      expect(result!.category).toBeUndefined();
    });

    it('should scope query to user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.get('tool_abc123');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['tool_abc123', 'user-1']);
    });
  });

  // =========================================================================
  // getByName
  // =========================================================================

  describe('getByName', () => {
    it('should query by name and user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      const result = await repo.getByName('my_tool');

      expect(result).not.toBeNull();
      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('name = $1');
      expect(sql).toContain('user_id = $2');
    });

    it('should return null for unknown name', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getByName('unknown')).toBeNull();
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no tools', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.list()).toEqual([]);
    });

    it('should return mapped tools', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeToolRow({ id: 'tool_1' }),
        makeToolRow({ id: 'tool_2', name: 'second_tool' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('tool_1');
      expect(result[1]!.name).toBe('second_tool');
    });

    it('should filter by status', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ status: 'active' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('status = $2');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('active');
    });

    it('should filter by category', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ category: 'utilities' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('category = $');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('utilities');
    });

    it('should filter by createdBy', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ createdBy: 'llm' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('created_by = $');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('llm');
    });

    it('should apply limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 10, offset: 20 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('should order by updated_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY updated_at DESC');
    });

    it('should combine multiple filters', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ status: 'active', category: 'utils', createdBy: 'user' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('status = $2');
      expect(sql).toContain('category = $3');
      expect(sql).toContain('created_by = $4');
    });

    it('should not add LIMIT/OFFSET when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).not.toContain('LIMIT');
      expect(sql).not.toContain('OFFSET');
    });
  });

  // =========================================================================
  // getActiveTools
  // =========================================================================

  describe('getActiveTools', () => {
    it('should delegate to list with status=active', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getActiveTools();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('status = $2');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('active');
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update fields and return the updated tool', async () => {
      // get existing
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      // get updated
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ name: 'updated_tool' }));

      const result = await repo.update('tool_abc123', { name: 'updated_tool' });

      expect(result!.name).toBe('updated_tool');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return null when tool does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.update('missing', { name: 'x' });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return existing when no changes provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      const result = await repo.update('tool_abc123', {});

      expect(result!.id).toBe('tool_abc123');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should increment version on code change', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ version: 2 }));

      await repo.update('tool_abc123', { code: 'new code' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('version = version + 1');
    });

    it('should increment version on parameters change', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ version: 2 }));

      await repo.update('tool_abc123', {
        parameters: { type: 'object', properties: { y: { type: 'string' } } },
      });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('version = version + 1');
    });

    it('should not increment version for non-code changes', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ description: 'updated desc' }));

      await repo.update('tool_abc123', { description: 'updated desc' });

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).not.toContain('version = version + 1');
    });

    it('should serialize parameters as JSON on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      const newParams = { type: 'object' as const, properties: { z: { type: 'boolean' } } };
      await repo.update('tool_abc123', { parameters: newParams });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[0]).toBe(JSON.stringify(newParams));
    });

    it('should serialize permissions as JSON on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      await repo.update('tool_abc123', { permissions: ['network', 'shell'] });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[0]).toBe('["network","shell"]');
    });

    it('should serialize metadata as JSON on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      await repo.update('tool_abc123', { metadata: { v: 2 } });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[0]).toBe('{"v":2}');
    });

    it('should return existing when requiredApiKeys is undefined (no-op)', async () => {
      // get existing -- only 1 queryOne consumed since updates.length === 0
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());

      const result = await repo.update('tool_abc123', { requiredApiKeys: undefined });

      // requiredApiKeys is undefined, so the if block is not entered
      expect(result!.id).toBe('tool_abc123');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should update multiple fields at once', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeToolRow({ name: 'new_name', description: 'new desc', category: 'new_cat' })
      );

      const result = await repo.update('tool_abc123', {
        name: 'new_name',
        description: 'new desc',
        category: 'new_cat',
      });

      expect(result!.name).toBe('new_name');
      expect(result!.description).toBe('new desc');
      expect(result!.category).toBe('new_cat');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('tool_abc123')).toBe(true);
    });

    it('should return false when tool not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('missing')).toBe(false);
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('tool_abc123');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $2');
      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['tool_abc123', 'user-1']);
    });
  });

  // =========================================================================
  // enable / disable
  // =========================================================================

  describe('enable', () => {
    it('should set status to active', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ status: 'active' }));

      const result = await repo.enable('tool_abc123');

      expect(result!.status).toBe('active');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain("status = 'active'");
    });
  });

  describe('disable', () => {
    it('should set status to disabled', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ status: 'disabled' }));

      const result = await repo.disable('tool_abc123');

      expect(result!.status).toBe('disabled');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain("status = 'disabled'");
    });
  });

  // =========================================================================
  // approve / reject
  // =========================================================================

  describe('approve', () => {
    it('should set status to active for pending tools', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ status: 'active' }));

      const result = await repo.approve('tool_abc123');

      expect(result!.status).toBe('active');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain("status = 'active'");
      expect(sql).toContain("status = 'pending_approval'");
    });
  });

  describe('reject', () => {
    it('should set status to rejected for pending tools', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeToolRow({ status: 'rejected' }));

      const result = await repo.reject('tool_abc123');

      expect(result!.status).toBe('rejected');
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain("status = 'rejected'");
      expect(sql).toContain("status = 'pending_approval'");
    });
  });

  // =========================================================================
  // recordUsage
  // =========================================================================

  describe('recordUsage', () => {
    it('should increment usage_count and set last_used_at', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.recordUsage('tool_abc123');

      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('usage_count = usage_count + 1');
      expect(sql).toContain('last_used_at = NOW()');
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.recordUsage('tool_abc123');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['tool_abc123', 'user-1']);
    });
  });

  // =========================================================================
  // getPendingApproval
  // =========================================================================

  describe('getPendingApproval', () => {
    it('should delegate to list with status=pending_approval', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getPendingApproval();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('status = $2');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('pending_approval');
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe('getStats', () => {
    it('should return aggregated statistics', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        total: '10',
        active: '6',
        disabled: '2',
        pending: '1',
        by_llm: '3',
        by_user: '7',
        total_usage: '42',
      });

      const stats = await repo.getStats();

      expect(stats.total).toBe(10);
      expect(stats.active).toBe(6);
      expect(stats.disabled).toBe(2);
      expect(stats.pendingApproval).toBe(1);
      expect(stats.createdByLLM).toBe(3);
      expect(stats.createdByUser).toBe(7);
      expect(stats.totalUsage).toBe(42);
    });

    it('should return zeros when no data', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const stats = await repo.getStats();

      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.disabled).toBe(0);
      expect(stats.pendingApproval).toBe(0);
      expect(stats.createdByLLM).toBe(0);
      expect(stats.createdByUser).toBe(0);
      expect(stats.totalUsage).toBe(0);
    });

    it('should scope to user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getStats();

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('user_id = $1');
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['user-1']);
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createCustomToolsRepo', () => {
    it('should be importable and return CustomToolsRepository instance', async () => {
      const { createCustomToolsRepo } = await import('./custom-tools.js');
      const r = createCustomToolsRepo('u1');
      expect(r).toBeInstanceOf(CustomToolsRepository);
    });

    it('should default to "default" userId', async () => {
      const { createCustomToolsRepo } = await import('./custom-tools.js');
      const r = createCustomToolsRepo();
      expect(r).toBeInstanceOf(CustomToolsRepository);
    });
  });
});
