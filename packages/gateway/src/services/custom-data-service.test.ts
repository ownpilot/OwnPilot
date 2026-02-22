/**
 * CustomDataService Tests
 *
 * Tests for business logic, validation, event emission,
 * protection enforcement, and delegation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomDataService, CustomDataServiceError } from './custom-data-service.js';
import type { CustomTableSchema, CustomDataRecord } from '../db/repositories/custom-data.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEmit = vi.fn();
vi.mock('@ownpilot/core', () => ({
  getEventBus: () => ({ emit: mockEmit }),
  createEvent: vi.fn((type: string, category: string, source: string, data: unknown) => ({
    type,
    category,
    source,
    data,
    timestamp: new Date().toISOString(),
  })),
  EventTypes: {
    RESOURCE_CREATED: 'resource.created',
    RESOURCE_UPDATED: 'resource.updated',
    RESOURCE_DELETED: 'resource.deleted',
  },
}));

const mockRepo = {
  createTable: vi.fn(),
  getTable: vi.fn(),
  listTables: vi.fn(),
  getTablesByPlugin: vi.fn(),
  updateTable: vi.fn(),
  deleteTable: vi.fn(),
  ensurePluginTable: vi.fn(),
  deletePluginTables: vi.fn(),
  addRecord: vi.fn(),
  insertRecord: vi.fn(),
  getRecord: vi.fn(),
  listRecords: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  searchRecords: vi.fn(),
  getTableStats: vi.fn(),
  listTablesWithCounts: vi.fn(),
  transaction: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
};

vi.mock('../db/repositories/custom-data.js', () => ({
  CustomDataRepository: vi.fn(),
  createCustomDataRepository: () => mockRepo,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeTable(overrides: Partial<CustomTableSchema> = {}): CustomTableSchema {
  return {
    id: 'tbl-1',
    name: 'contacts',
    displayName: 'Contacts',
    description: 'Address book',
    columns: [
      { name: 'name', type: 'text', required: true },
      { name: 'email', type: 'text' },
    ],
    isProtected: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeRecord(overrides: Partial<CustomDataRecord> = {}): CustomDataRecord {
  return {
    id: 'rec-1',
    tableId: 'tbl-1',
    data: { name: 'Alice', email: 'alice@example.com' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CustomDataService', () => {
  let service: CustomDataService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CustomDataService();
  });

  // ========================================================================
  // Table Operations
  // ========================================================================

  describe('createTable', () => {
    it('creates a table and emits resource.created', async () => {
      const table = fakeTable();
      mockRepo.createTable.mockResolvedValue(table);

      const result = await service.createTable(
        'contacts',
        'Contacts',
        [{ name: 'name', type: 'text' }],
        'Address book'
      );

      expect(result).toBe(table);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.created',
          data: { resourceType: 'custom_table', id: 'tbl-1' },
        })
      );
    });

    it('throws VALIDATION_ERROR when name is empty', async () => {
      await expect(service.createTable('', 'X', [{ name: 'c', type: 'text' }])).rejects.toThrow(
        /Table name is required/
      );
      expect(mockRepo.createTable).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR when columns are empty', async () => {
      await expect(service.createTable('t', 'T', [])).rejects.toThrow(/At least one column/);
    });
  });

  describe('deleteTable', () => {
    it('deletes unprotected table and emits event', async () => {
      const table = fakeTable();
      mockRepo.getTable.mockResolvedValue(table);
      mockRepo.deleteTable.mockResolvedValue(true);

      const result = await service.deleteTable('contacts');

      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.deleted',
          data: { resourceType: 'custom_table', id: 'tbl-1' },
        })
      );
    });

    it('throws PROTECTED when table is protected', async () => {
      const table = fakeTable({ isProtected: true, ownerPluginId: 'gmail' });
      mockRepo.getTable.mockResolvedValue(table);

      await expect(service.deleteTable('contacts')).rejects.toThrow(/protected by plugin/);

      const error = await service.deleteTable('contacts').catch((e) => e);
      expect(error).toBeInstanceOf(CustomDataServiceError);
      expect(error.code).toBe('PROTECTED');
    });

    it('allows force-delete of protected table', async () => {
      const table = fakeTable({ isProtected: true, ownerPluginId: 'gmail' });
      mockRepo.getTable.mockResolvedValue(table);
      mockRepo.deleteTable.mockResolvedValue(true);

      const result = await service.deleteTable('contacts', { force: true });
      expect(result).toBe(true);
    });

    it('returns false when table not found', async () => {
      mockRepo.getTable.mockResolvedValue(null);
      const result = await service.deleteTable('missing');
      expect(result).toBe(false);
    });
  });

  describe('listTablesWithStats', () => {
    it('attaches record count to each table', async () => {
      mockRepo.listTablesWithCounts.mockResolvedValue([
        { ...fakeTable(), recordCount: 10 },
        { ...fakeTable({ id: 'tbl-2', name: 'orders' }), recordCount: 25 },
      ]);

      const result = await service.listTablesWithStats();

      expect(result).toHaveLength(2);
      expect(result[0]!.stats.recordCount).toBe(10);
      expect(result[1]!.stats.recordCount).toBe(25);
      expect(mockRepo.listTablesWithCounts).toHaveBeenCalled();
    });

    it('filters by pluginId when provided', async () => {
      mockRepo.getTablesByPlugin.mockResolvedValue([fakeTable()]);
      mockRepo.getTableStats.mockResolvedValue({ recordCount: 5 });

      const result = await service.listTablesWithStats({ pluginId: 'gmail' });

      expect(result).toHaveLength(1);
      expect(mockRepo.getTablesByPlugin).toHaveBeenCalledWith('gmail');
      expect(mockRepo.listTablesWithCounts).not.toHaveBeenCalled();
    });

    it('returns zero count when no records exist', async () => {
      mockRepo.listTablesWithCounts.mockResolvedValue([{ ...fakeTable(), recordCount: 0 }]);

      const result = await service.listTablesWithStats();
      expect(result[0]!.stats.recordCount).toBe(0);
    });
  });

  // ========================================================================
  // Record Operations
  // ========================================================================

  describe('addRecord', () => {
    it('adds record and emits resource.created', async () => {
      const record = fakeRecord();
      mockRepo.addRecord.mockResolvedValue(record);

      const result = await service.addRecord('contacts', { name: 'Alice' });

      expect(result).toBe(record);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.created',
          data: { resourceType: 'custom_record', id: 'rec-1' },
        })
      );
    });
  });

  describe('batchAddRecords', () => {
    it('adds multiple records using insertRecord with pre-resolved table', async () => {
      const table = fakeTable();
      mockRepo.getTable.mockResolvedValue(table);
      mockRepo.insertRecord
        .mockResolvedValueOnce(fakeRecord({ id: 'r1' }))
        .mockResolvedValueOnce(fakeRecord({ id: 'r2' }));

      const result = await service.batchAddRecords('contacts', [
        { name: 'Alice' },
        { name: 'Bob' },
      ]);

      expect(result).toHaveLength(2);
      expect(mockRepo.insertRecord).toHaveBeenCalledTimes(2);
      // Verify table is resolved once and passed to each insertRecord call
      expect(mockRepo.getTable).toHaveBeenCalledTimes(1);
      expect(mockRepo.insertRecord).toHaveBeenCalledWith(table, { name: 'Alice' });
      expect(mockRepo.insertRecord).toHaveBeenCalledWith(table, { name: 'Bob' });
    });

    it('throws NOT_FOUND when table does not exist', async () => {
      mockRepo.getTable.mockResolvedValue(null);

      await expect(service.batchAddRecords('missing', [{ name: 'Alice' }])).rejects.toThrow(
        /Table not found/
      );
    });
  });

  describe('updateRecord', () => {
    it('updates record and emits resource.updated', async () => {
      const updated = fakeRecord({ data: { name: 'Bob' } });
      mockRepo.updateRecord.mockResolvedValue(updated);

      const result = await service.updateRecord('rec-1', { name: 'Bob' });

      expect(result).toBe(updated);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.updated',
          data: expect.objectContaining({ resourceType: 'custom_record', id: 'rec-1' }),
        })
      );
    });

    it('does not emit when record not found', async () => {
      mockRepo.updateRecord.mockResolvedValue(null);
      const result = await service.updateRecord('missing', { name: 'x' });
      expect(result).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('deleteRecord', () => {
    it('deletes record and emits resource.deleted', async () => {
      mockRepo.deleteRecord.mockResolvedValue(true);

      const result = await service.deleteRecord('rec-1');

      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.deleted',
          data: { resourceType: 'custom_record', id: 'rec-1' },
        })
      );
    });

    it('does not emit when record not found', async () => {
      mockRepo.deleteRecord.mockResolvedValue(false);
      const result = await service.deleteRecord('missing');
      expect(result).toBe(false);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Queries & Delegation
  // ========================================================================

  describe('delegation methods', () => {
    it('getTable delegates to repo', async () => {
      mockRepo.getTable.mockResolvedValue(fakeTable());
      const result = await service.getTable('contacts');
      expect(result).not.toBeNull();
      expect(mockRepo.getTable).toHaveBeenCalledWith('contacts');
    });

    it('listTables delegates to repo', async () => {
      mockRepo.listTables.mockResolvedValue([]);
      await service.listTables();
      expect(mockRepo.listTables).toHaveBeenCalled();
    });

    it('searchRecords delegates to repo', async () => {
      mockRepo.searchRecords.mockResolvedValue([]);
      await service.searchRecords('contacts', 'alice', { limit: 10 });
      expect(mockRepo.searchRecords).toHaveBeenCalledWith('contacts', 'alice', { limit: 10 });
    });

    it('ensurePluginTable delegates to repo', async () => {
      const table = fakeTable({ isProtected: true, ownerPluginId: 'gmail' });
      mockRepo.ensurePluginTable.mockResolvedValue(table);

      const result = await service.ensurePluginTable('gmail', 'gmail_emails', 'Gmail Emails', [
        { name: 'subject', type: 'text' },
      ]);
      expect(result).toBe(table);
    });

    it('deletePluginTables delegates to repo', async () => {
      mockRepo.deletePluginTables.mockResolvedValue(3);
      const result = await service.deletePluginTables('gmail');
      expect(result).toBe(3);
    });

    it('getTableStats delegates to repo', async () => {
      mockRepo.getTableStats.mockResolvedValue({ recordCount: 42 });
      const result = await service.getTableStats('contacts');
      expect(result).toEqual({ recordCount: 42 });
    });
  });
});
