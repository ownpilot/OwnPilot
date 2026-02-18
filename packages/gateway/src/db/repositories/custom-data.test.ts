/**
 * Custom Data Repository Tests
 *
 * Unit tests for CustomDataRepository: table CRUD, record CRUD,
 * validation, JSON serialization, filtering, search, and plugin support.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = {
  type: 'postgres' as const,
  isConnected: () => true,
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ changes: 1 })),
  transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  exec: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  now: () => 'NOW()',
  date: (col: string) => `DATE(${col})`,
  dateSubtract: (col: string, n: number, u: string) => `${col} - INTERVAL '${n} ${u}'`,
  placeholder: (i: number) => `$${i}`,
  boolean: (v: boolean) => v,
  parseBoolean: (v: unknown) => Boolean(v),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

vi.mock('../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { CustomDataRepository } from './custom-data.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeSchemaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'table_123_abc',
    name: 'contacts',
    display_name: 'Contacts',
    description: null,
    columns: '[{"name":"email","type":"text","required":true},{"name":"age","type":"number"}]',
    owner_plugin_id: null,
    is_protected: false,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeRecordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec_123_abc',
    table_id: 'table_123_abc',
    data: '{"email":"test@example.com","age":30}',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CustomDataRepository', () => {
  let repo: CustomDataRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new CustomDataRepository();
  });

  // =========================================================================
  // createTable
  // =========================================================================

  describe('createTable', () => {
    it('should create a table and return the schema', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const columns = [
        { name: 'email', type: 'text' as const, required: true },
        { name: 'age', type: 'number' as const },
      ];
      const result = await repo.createTable('contacts', 'Contacts', columns, 'A contacts table');

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.name).toBe('contacts');
      expect(result.displayName).toBe('Contacts');
      expect(result.description).toBe('A contacts table');
      expect(result.columns).toEqual(columns);
      expect(result.isProtected).toBe(false);
    });

    it('should sanitize table name to lowercase with underscores', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.createTable('My Table Name!', 'My Table', []);

      expect(result.name).toBe('my_table_name_');
    });

    it('should serialize columns as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const columns = [{ name: 'field1', type: 'text' as const }];
      await repo.createTable('test', 'Test', columns);

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[4]).toBe(JSON.stringify(columns));
    });

    it('should throw for invalid column names', async () => {
      await expect(
        repo.createTable('test', 'Test', [{ name: 'bad-name', type: 'text' }]),
      ).rejects.toThrow('Invalid column name: bad-name');
    });

    it('should throw for column names with spaces', async () => {
      await expect(
        repo.createTable('test', 'Test', [{ name: 'bad name', type: 'text' }]),
      ).rejects.toThrow('Invalid column name: bad name');
    });

    it('should allow column names with underscores and alphanumeric', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.createTable('test', 'Test', [
        { name: 'field_1', type: 'text' },
        { name: 'MyField2', type: 'number' },
      ]);

      expect(result.columns).toHaveLength(2);
    });

    it('should set ownerPluginId and isProtected from options', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.createTable('test', 'Test', [], undefined, {
        ownerPluginId: 'plugin-1',
        isProtected: true,
      });

      expect(result.ownerPluginId).toBe('plugin-1');
      expect(result.isProtected).toBe(true);
    });

    it('should default ownerPluginId to undefined and isProtected to false', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.createTable('test', 'Test', []);

      expect(result.ownerPluginId).toBeUndefined();
      expect(result.isProtected).toBe(false);
    });

    it('should set description to null when not provided', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.createTable('test', 'Test', []);

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[3]).toBeNull(); // description
    });
  });

  // =========================================================================
  // getTable
  // =========================================================================

  describe('getTable', () => {
    it('should return a table when found by ID', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());

      const result = await repo.getTable('table_123_abc');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('table_123_abc');
      expect(result!.name).toBe('contacts');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getTable('missing')).toBeNull();
    });

    it('should parse columns JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());

      const result = await repo.getTable('table_123_abc');

      expect(result!.columns).toEqual([
        { name: 'email', type: 'text', required: true },
        { name: 'age', type: 'number' },
      ]);
    });

    it('should query by id OR name', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await repo.getTable('contacts');

      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('id = $1 OR name = $1');
    });

    it('should convert null description to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());

      const result = await repo.getTable('table_123_abc');

      expect(result!.description).toBeUndefined();
    });

    it('should convert null ownerPluginId to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());

      const result = await repo.getTable('table_123_abc');

      expect(result!.ownerPluginId).toBeUndefined();
    });

    it('should parse isProtected as boolean', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow({ is_protected: true }));

      const result = await repo.getTable('table_123_abc');

      expect(result!.isProtected).toBe(true);
    });

    it('should handle description when provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow({ description: 'My table' }));

      const result = await repo.getTable('table_123_abc');

      expect(result!.description).toBe('My table');
    });
  });

  // =========================================================================
  // listTables
  // =========================================================================

  describe('listTables', () => {
    it('should return empty array when no tables', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.listTables()).toEqual([]);
    });

    it('should return mapped tables', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeSchemaRow({ id: 'table_1' }),
        makeSchemaRow({ id: 'table_2', name: 'products' }),
      ]);

      const result = await repo.listTables();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('table_1');
      expect(result[1]!.name).toBe('products');
    });

    it('should order by display_name', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listTables();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY display_name');
    });
  });

  // =========================================================================
  // getTablesByPlugin
  // =========================================================================

  describe('getTablesByPlugin', () => {
    it('should return tables owned by the plugin', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeSchemaRow({ owner_plugin_id: 'plugin-1' }),
      ]);

      const result = await repo.getTablesByPlugin('plugin-1');

      expect(result).toHaveLength(1);
    });

    it('should filter by owner_plugin_id', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getTablesByPlugin('plugin-1');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('owner_plugin_id = $1');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['plugin-1']);
    });

    it('should return empty array when no tables for plugin', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getTablesByPlugin('none')).toEqual([]);
    });
  });

  // =========================================================================
  // updateTable
  // =========================================================================

  describe('updateTable', () => {
    it('should update and return the table', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.updateTable('contacts', { displayName: 'Updated Contacts' });

      expect(result).not.toBeNull();
      expect(result!.displayName).toBe('Updated Contacts');
    });

    it('should return null when table does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.updateTable('missing', { displayName: 'X' });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should preserve existing fields when not updated', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow({ description: 'Original' }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.updateTable('contacts', { displayName: 'New' });

      expect(result!.description).toBe('Original');
    });

    it('should serialize columns as JSON on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const newColumns = [{ name: 'name', type: 'text' as const }];
      await repo.updateTable('contacts', { columns: newColumns });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(executeParams[2]).toBe(JSON.stringify(newColumns));
    });

    it('should update description', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.updateTable('contacts', { description: 'New description' });

      expect(result!.description).toBe('New description');
    });
  });

  // =========================================================================
  // deleteTable
  // =========================================================================

  describe('deleteTable', () => {
    it('should delete records and schema for a table', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 5 }); // delete records
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 }); // delete schema

      const result = await repo.deleteTable('contacts');

      expect(result).toBe(true);
      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
    });

    it('should return false when table not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.deleteTable('missing')).toBe(false);
    });

    it('should throw for protected tables without force', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSchemaRow({ is_protected: true, owner_plugin_id: 'plugin-1' }),
      );

      await expect(repo.deleteTable('contacts')).rejects.toThrow('is protected');
    });

    it('should allow deleting protected tables with force=true', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSchemaRow({ is_protected: true, owner_plugin_id: 'plugin-1' }),
      );
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.deleteTable('contacts', { force: true });

      expect(result).toBe(true);
    });

    it('should delete records before schema', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 3 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.deleteTable('contacts');

      const firstDeleteSql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(firstDeleteSql).toContain('custom_data_records');
      const secondDeleteSql = mockAdapter.execute.mock.calls[1]![0] as string;
      expect(secondDeleteSql).toContain('custom_table_schemas');
    });
  });

  // =========================================================================
  // deletePluginTables
  // =========================================================================

  describe('deletePluginTables', () => {
    it('should delete all tables owned by a plugin', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeSchemaRow({ id: 'table_1' }),
        makeSchemaRow({ id: 'table_2' }),
      ]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 5 }); // delete records
      mockAdapter.execute.mockResolvedValueOnce({ changes: 2 }); // delete schemas

      const count = await repo.deletePluginTables('plugin-1');

      expect(count).toBe(2);
      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when plugin has no tables', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const count = await repo.deletePluginTables('plugin-none');

      expect(count).toBe(0);
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should use IN clause with table IDs', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeSchemaRow({ id: 'table_a' }),
        makeSchemaRow({ id: 'table_b' }),
      ]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 2 });

      await repo.deletePluginTables('plugin-1');

      const recordDeleteSql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(recordDeleteSql).toContain('IN ($1, $2)');
      const schemaDeleteSql = mockAdapter.execute.mock.calls[1]![0] as string;
      expect(schemaDeleteSql).toContain('IN ($1, $2)');
    });
  });

  // =========================================================================
  // ensurePluginTable
  // =========================================================================

  describe('ensurePluginTable', () => {
    it('should return existing table if it exists', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSchemaRow({ owner_plugin_id: 'plugin-1' }),
      );

      const result = await repo.ensurePluginTable(
        'plugin-1',
        'contacts',
        'Contacts',
        [{ name: 'email', type: 'text' }],
      );

      expect(result.id).toBe('table_123_abc');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should create table if it does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null); // getTable returns null
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 }); // createTable

      const result = await repo.ensurePluginTable(
        'plugin-1',
        'new_table',
        'New Table',
        [{ name: 'field1', type: 'text' }],
        'Description',
      );

      expect(result.name).toBe('new_table');
      expect(result.isProtected).toBe(true);
      expect(result.ownerPluginId).toBe('plugin-1');
    });

    it('should throw if table is owned by a different plugin', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSchemaRow({ owner_plugin_id: 'plugin-other' }),
      );

      await expect(
        repo.ensurePluginTable('plugin-1', 'contacts', 'Contacts', []),
      ).rejects.toThrow('is owned by plugin "plugin-other"');
    });

    it('should return existing table when owned by same plugin', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeSchemaRow({ owner_plugin_id: 'plugin-1' }),
      );

      const result = await repo.ensurePluginTable('plugin-1', 'contacts', 'Contacts', []);

      expect(result.id).toBe('table_123_abc');
    });

    it('should return existing table when ownerPluginId is null (no ownership conflict)', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow()); // ownerPluginId is null

      const result = await repo.ensurePluginTable('plugin-1', 'contacts', 'Contacts', []);

      expect(result.id).toBe('table_123_abc');
    });
  });

  // =========================================================================
  // addRecord
  // =========================================================================

  describe('addRecord', () => {
    it('should add a record and return it', async () => {
      // getTable
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      // INSERT
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.addRecord('contacts', { email: 'test@example.com', age: 30 });

      expect(result.data).toEqual({ email: 'test@example.com', age: 30 });
      expect(result.tableId).toBe('table_123_abc');
    });

    it('should throw when table not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(
        repo.addRecord('missing', { email: 'test@example.com' }),
      ).rejects.toThrow('Table not found: missing');
    });

    it('should throw when required field is missing', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());

      await expect(
        repo.addRecord('contacts', { age: 25 }), // missing required 'email'
      ).rejects.toThrow('Missing required field: email');
    });

    it('should throw when required field is null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());

      await expect(
        repo.addRecord('contacts', { email: null, age: 25 }),
      ).rejects.toThrow('Missing required field: email');
    });

    it('should apply default values for missing fields', async () => {
      const columnsWithDefaults = JSON.stringify([
        { name: 'email', type: 'text', required: true },
        { name: 'status', type: 'text', defaultValue: 'active' },
      ]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow({ columns: columnsWithDefaults }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.addRecord('contacts', { email: 'test@example.com' });

      expect(result.data.status).toBe('active');
    });

    it('should serialize data as JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.addRecord('contacts', { email: 'test@example.com', age: 30 });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      const data = JSON.parse(executeParams[2] as string);
      expect(data.email).toBe('test@example.com');
      expect(data.age).toBe(30);
    });

    it('should only include columns defined in the schema', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.addRecord('contacts', {
        email: 'test@example.com',
        age: 30,
        unknown_field: 'value',
      });

      // unknown_field is not in the schema columns, so not included in processedData
      expect(result.data).toEqual({ email: 'test@example.com', age: 30 });
    });
  });

  // =========================================================================
  // getRecord
  // =========================================================================

  describe('getRecord', () => {
    it('should return a record when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRecordRow());

      const result = await repo.getRecord('rec_123_abc');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('rec_123_abc');
      expect(result!.tableId).toBe('table_123_abc');
      expect(result!.data).toEqual({ email: 'test@example.com', age: 30 });
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getRecord('missing')).toBeNull();
    });

    it('should parse data JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeRecordRow({ data: '{"name":"John","active":true}' }),
      );

      const result = await repo.getRecord('rec_123_abc');

      expect(result!.data).toEqual({ name: 'John', active: true });
    });
  });

  // =========================================================================
  // listRecords
  // =========================================================================

  describe('listRecords', () => {
    it('should return records and total count', async () => {
      // getTable
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      // COUNT
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '2' });
      // SELECT records
      mockAdapter.query.mockResolvedValueOnce([
        makeRecordRow({ id: 'rec_1' }),
        makeRecordRow({ id: 'rec_2' }),
      ]);

      const result = await repo.listRecords('contacts');

      expect(result.records).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should throw when table not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.listRecords('missing')).rejects.toThrow('Table not found: missing');
    });

    it('should apply limit and offset', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '100' });
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listRecords('contacts', { limit: 10, offset: 20 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });

    it('should default to limit=100, offset=0', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listRecords('contacts');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(100);
      expect(params).toContain(0);
    });

    it('should order by created_at DESC', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listRecords('contacts');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should apply in-memory filter', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '2' });
      mockAdapter.query.mockResolvedValueOnce([
        makeRecordRow({ id: 'rec_1', data: '{"email":"a@b.com","age":25}' }),
        makeRecordRow({ id: 'rec_2', data: '{"email":"c@d.com","age":30}' }),
      ]);

      const result = await repo.listRecords('contacts', { filter: { age: 30 } });

      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.data.age).toBe(30);
    });

    it('should return total as 0 when no count result', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listRecords('contacts');

      expect(result.total).toBe(0);
    });

    it('should return empty records with filter that matches nothing', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '1' });
      mockAdapter.query.mockResolvedValueOnce([
        makeRecordRow({ data: '{"email":"a@b.com","age":25}' }),
      ]);

      const result = await repo.listRecords('contacts', { filter: { age: 99 } });

      expect(result.records).toHaveLength(0);
    });
  });

  // =========================================================================
  // updateRecord
  // =========================================================================

  describe('updateRecord', () => {
    it('should merge data and return updated record', async () => {
      // getRecord
      mockAdapter.queryOne.mockResolvedValueOnce(makeRecordRow());
      // getTable
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      // execute
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.updateRecord('rec_123_abc', { age: 35 });

      expect(result).not.toBeNull();
      expect(result!.data.email).toBe('test@example.com'); // preserved
      expect(result!.data.age).toBe(35); // updated
    });

    it('should return null when record does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.updateRecord('missing', { age: 30 });

      expect(result).toBeNull();
    });

    it('should return null when table not found for record', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRecordRow());
      mockAdapter.queryOne.mockResolvedValueOnce(null); // getTable returns null

      const result = await repo.updateRecord('rec_123_abc', { age: 30 });

      expect(result).toBeNull();
    });

    it('should throw when required field is removed', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRecordRow());
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());

      await expect(
        repo.updateRecord('rec_123_abc', { email: null }),
      ).rejects.toThrow('Missing required field: email');
    });

    it('should serialize merged data as JSON', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeRecordRow());
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.updateRecord('rec_123_abc', { age: 40 });

      const executeParams = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      const data = JSON.parse(executeParams[0] as string);
      expect(data.email).toBe('test@example.com');
      expect(data.age).toBe(40);
    });
  });

  // =========================================================================
  // deleteRecord
  // =========================================================================

  describe('deleteRecord', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.deleteRecord('rec_123_abc')).toBe(true);
    });

    it('should return false when record not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.deleteRecord('missing')).toBe(false);
    });
  });

  // =========================================================================
  // searchRecords
  // =========================================================================

  describe('searchRecords', () => {
    it('should search records by JSON data text', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.query.mockResolvedValueOnce([makeRecordRow()]);

      const result = await repo.searchRecords('contacts', 'test@example');

      expect(result).toHaveLength(1);
    });

    it('should throw when table not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.searchRecords('missing', 'query')).rejects.toThrow('Table not found: missing');
    });

    it('should apply limit', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.searchRecords('contacts', 'test', { limit: 10 });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(10);
    });

    it('should default limit to 50', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.searchRecords('contacts', 'test');

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain(50);
    });

    it('should use LIKE on data cast', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.searchRecords('contacts', 'test');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LOWER(data::text) LIKE');
    });

    it('should return empty array when no matches', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.searchRecords('contacts', 'nonexistent');

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getTableStats
  // =========================================================================

  describe('getTableStats', () => {
    it('should return statistics for a table', async () => {
      // getTable
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      // COUNT
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '42' });
      // first record
      mockAdapter.queryOne.mockResolvedValueOnce({ created_at: '2025-01-01T00:00:00.000Z' });
      // last record
      mockAdapter.queryOne.mockResolvedValueOnce({ created_at: '2025-01-15T00:00:00.000Z' });

      const result = await repo.getTableStats('contacts');

      expect(result).not.toBeNull();
      expect(result!.recordCount).toBe(42);
      expect(result!.firstRecord).toBe('2025-01-01T00:00:00.000Z');
      expect(result!.lastRecord).toBe('2025-01-15T00:00:00.000Z');
    });

    it('should return null when table not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getTableStats('missing')).toBeNull();
    });

    it('should return 0 recordCount when no records', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '0' });
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getTableStats('contacts');

      expect(result!.recordCount).toBe(0);
      expect(result!.firstRecord).toBeUndefined();
      expect(result!.lastRecord).toBeUndefined();
    });

    it('should handle null count result', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeSchemaRow());
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getTableStats('contacts');

      expect(result!.recordCount).toBe(0);
    });
  });

  // =========================================================================
  // listTablesWithCounts
  // =========================================================================

  describe('listTablesWithCounts', () => {
    it('should return tables with record counts', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { ...makeSchemaRow({ id: 'tbl-1', name: 'contacts' }), record_count: '10' },
        { ...makeSchemaRow({ id: 'tbl-2', name: 'orders' }), record_count: '25' },
      ]);

      const result = await repo.listTablesWithCounts();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('tbl-1');
      expect(result[0]!.recordCount).toBe(10);
      expect(result[1]!.id).toBe('tbl-2');
      expect(result[1]!.recordCount).toBe(25);
    });

    it('should return empty array when no tables exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.listTablesWithCounts()).toEqual([]);
    });

    it('should use LEFT JOIN with GROUP BY in SQL', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listTablesWithCounts();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LEFT JOIN');
      expect(sql).toContain('GROUP BY');
      expect(sql).toContain('COUNT');
    });

    it('should return 0 count for tables with no records', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { ...makeSchemaRow(), record_count: '0' },
      ]);

      const result = await repo.listTablesWithCounts();

      expect(result[0]!.recordCount).toBe(0);
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createCustomDataRepository', () => {
    it('should be importable and return CustomDataRepository instance', async () => {
      const { createCustomDataRepository } = await import('./custom-data.js');
      const r = createCustomDataRepository();
      expect(r).toBeInstanceOf(CustomDataRepository);
    });
  });

  describe('getCustomDataRepository alias', () => {
    it('should be importable and return CustomDataRepository instance', async () => {
      const { getCustomDataRepository } = await import('./custom-data.js');
      const r = getCustomDataRepository();
      expect(r).toBeInstanceOf(CustomDataRepository);
    });
  });
});
