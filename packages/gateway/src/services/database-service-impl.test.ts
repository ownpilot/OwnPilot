/**
 * DatabaseServiceImpl Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseServiceImpl } from './database-service-impl.js';

// Mock the gateway CustomDataService
const mockDataService = {
  createTable: vi.fn(),
  getTable: vi.fn(),
  listTables: vi.fn(),
  getTablesByPlugin: vi.fn(),
  listTablesWithStats: vi.fn(),
  updateTable: vi.fn(),
  deleteTable: vi.fn(),
  ensurePluginTable: vi.fn(),
  deletePluginTables: vi.fn(),
  addRecord: vi.fn(),
  batchAddRecords: vi.fn(),
  getRecord: vi.fn(),
  listRecords: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  searchRecords: vi.fn(),
  getTableStats: vi.fn(),
};

vi.mock('./custom-data-service.js', () => ({
  getCustomDataService: () => mockDataService,
}));

const sampleTable = {
  id: 'tbl-1',
  name: 'users',
  displayName: 'Users',
  description: 'User table',
  columns: [{ name: 'name', type: 'text', required: true }],
  isProtected: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const sampleRecord = {
  id: 'rec-1',
  tableId: 'tbl-1',
  data: { name: 'Alice' },
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('DatabaseServiceImpl', () => {
  let service: DatabaseServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DatabaseServiceImpl();
  });

  // ---- Table operations ----

  describe('createTable', () => {
    it('creates a table', async () => {
      mockDataService.createTable.mockResolvedValue(sampleTable);

      const result = await service.createTable(
        'users',
        'Users',
        [{ name: 'name', type: 'text', required: true }],
        'User table',
      );

      expect(result.id).toBe('tbl-1');
      expect(result.name).toBe('users');
      expect(result.displayName).toBe('Users');
      expect(mockDataService.createTable).toHaveBeenCalled();
    });

    it('passes options to underlying service', async () => {
      mockDataService.createTable.mockResolvedValue({
        ...sampleTable,
        ownerPluginId: 'plugin-1',
        isProtected: true,
      });

      await service.createTable('users', 'Users', [], undefined, {
        ownerPluginId: 'plugin-1',
        isProtected: true,
      });

      expect(mockDataService.createTable).toHaveBeenCalledWith(
        'users',
        'Users',
        [],
        undefined,
        { ownerPluginId: 'plugin-1', isProtected: true },
      );
    });
  });

  describe('getTable', () => {
    it('returns table by name or ID', async () => {
      mockDataService.getTable.mockResolvedValue(sampleTable);

      const result = await service.getTable('users');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('users');
    });

    it('returns null for not found', async () => {
      mockDataService.getTable.mockResolvedValue(null);
      expect(await service.getTable('nonexistent')).toBeNull();
    });
  });

  describe('listTables', () => {
    it('lists all tables when no filter', async () => {
      mockDataService.listTables.mockResolvedValue([sampleTable]);

      const result = await service.listTables();
      expect(result).toHaveLength(1);
      expect(mockDataService.listTables).toHaveBeenCalled();
    });

    it('filters by pluginId', async () => {
      mockDataService.getTablesByPlugin.mockResolvedValue([sampleTable]);

      const result = await service.listTables({ pluginId: 'plugin-1' });
      expect(result).toHaveLength(1);
      expect(mockDataService.getTablesByPlugin).toHaveBeenCalledWith('plugin-1');
    });
  });

  describe('listTablesWithStats', () => {
    it('returns tables with stats', async () => {
      mockDataService.listTablesWithStats.mockResolvedValue([
        { ...sampleTable, recordCount: 42 },
      ]);

      const result = await service.listTablesWithStats();
      expect(result).toHaveLength(1);
      expect(result[0].stats.recordCount).toBe(42);
    });
  });

  describe('updateTable', () => {
    it('updates table metadata', async () => {
      mockDataService.updateTable.mockResolvedValue({
        ...sampleTable,
        displayName: 'Updated Users',
      });

      const result = await service.updateTable('users', { displayName: 'Updated Users' });
      expect(result).not.toBeNull();
      expect(result!.displayName).toBe('Updated Users');
    });

    it('returns null for not found', async () => {
      mockDataService.updateTable.mockResolvedValue(null);
      expect(await service.updateTable('nonexistent', {})).toBeNull();
    });
  });

  describe('deleteTable', () => {
    it('deletes a table', async () => {
      mockDataService.deleteTable.mockResolvedValue(true);
      expect(await service.deleteTable('users')).toBe(true);
    });

    it('returns false for not found', async () => {
      mockDataService.deleteTable.mockResolvedValue(false);
      expect(await service.deleteTable('nonexistent')).toBe(false);
    });

    it('passes force option', async () => {
      mockDataService.deleteTable.mockResolvedValue(true);
      await service.deleteTable('protected-table', { force: true });
      expect(mockDataService.deleteTable).toHaveBeenCalledWith('protected-table', { force: true });
    });
  });

  // ---- Plugin table operations ----

  describe('ensurePluginTable', () => {
    it('creates or returns existing plugin table', async () => {
      mockDataService.ensurePluginTable.mockResolvedValue({
        ...sampleTable,
        ownerPluginId: 'plugin-1',
      });

      const result = await service.ensurePluginTable(
        'plugin-1',
        'users',
        'Users',
        [{ name: 'name', type: 'text' }],
      );

      expect(result.ownerPluginId).toBe('plugin-1');
      expect(mockDataService.ensurePluginTable).toHaveBeenCalledWith(
        'plugin-1',
        'users',
        'Users',
        [{ name: 'name', type: 'text' }],
        undefined,
      );
    });
  });

  describe('getTablesByPlugin', () => {
    it('returns tables for a plugin', async () => {
      mockDataService.getTablesByPlugin.mockResolvedValue([sampleTable]);

      const result = await service.getTablesByPlugin('plugin-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('deletePluginTables', () => {
    it('returns count of deleted tables', async () => {
      mockDataService.deletePluginTables.mockResolvedValue(3);
      expect(await service.deletePluginTables('plugin-1')).toBe(3);
    });
  });

  // ---- Record operations ----

  describe('addRecord', () => {
    it('adds a record', async () => {
      mockDataService.addRecord.mockResolvedValue(sampleRecord);

      const result = await service.addRecord('users', { name: 'Alice' });
      expect(result.id).toBe('rec-1');
      expect(result.data.name).toBe('Alice');
    });
  });

  describe('batchAddRecords', () => {
    it('batch adds records', async () => {
      mockDataService.batchAddRecords.mockResolvedValue([
        sampleRecord,
        { ...sampleRecord, id: 'rec-2', data: { name: 'Bob' } },
      ]);

      const result = await service.batchAddRecords('users', [
        { name: 'Alice' },
        { name: 'Bob' },
      ]);

      expect(result).toHaveLength(2);
    });
  });

  describe('getRecord', () => {
    it('returns a record by ID', async () => {
      mockDataService.getRecord.mockResolvedValue(sampleRecord);

      const result = await service.getRecord('rec-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('rec-1');
    });

    it('returns null for not found', async () => {
      mockDataService.getRecord.mockResolvedValue(null);
      expect(await service.getRecord('nonexistent')).toBeNull();
    });
  });

  describe('listRecords', () => {
    it('returns paginated records', async () => {
      mockDataService.listRecords.mockResolvedValue({
        records: [sampleRecord],
        total: 1,
      });

      const result = await service.listRecords('users', { limit: 10, offset: 0 });
      expect(result.records).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('updateRecord', () => {
    it('updates a record', async () => {
      mockDataService.updateRecord.mockResolvedValue({
        ...sampleRecord,
        data: { name: 'Alice Updated' },
      });

      const result = await service.updateRecord('rec-1', { name: 'Alice Updated' });
      expect(result).not.toBeNull();
      expect(result!.data.name).toBe('Alice Updated');
    });

    it('returns null for not found', async () => {
      mockDataService.updateRecord.mockResolvedValue(null);
      expect(await service.updateRecord('nonexistent', {})).toBeNull();
    });
  });

  describe('deleteRecord', () => {
    it('deletes a record', async () => {
      mockDataService.deleteRecord.mockResolvedValue(true);
      expect(await service.deleteRecord('rec-1')).toBe(true);
    });
  });

  describe('searchRecords', () => {
    it('searches records by text query', async () => {
      mockDataService.searchRecords.mockResolvedValue([sampleRecord]);

      const result = await service.searchRecords('users', 'Alice', { limit: 5 });
      expect(result).toHaveLength(1);
      expect(mockDataService.searchRecords).toHaveBeenCalledWith('users', 'Alice', { limit: 5 });
    });
  });

  describe('getTableStats', () => {
    it('returns table statistics', async () => {
      mockDataService.getTableStats.mockResolvedValue({
        recordCount: 42,
        firstRecord: '2024-01-01',
        lastRecord: '2024-06-01',
      });

      const result = await service.getTableStats('users');
      expect(result).not.toBeNull();
      expect(result!.recordCount).toBe(42);
    });

    it('returns null for not found', async () => {
      mockDataService.getTableStats.mockResolvedValue(null);
      expect(await service.getTableStats('nonexistent')).toBeNull();
    });
  });
});
