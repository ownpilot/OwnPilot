/**
 * Custom Data Routes Tests
 *
 * Integration tests for the custom data API endpoints.
 * Mocks CustomDataService to test table/record CRUD and response formatting.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCustomDataService = {
  listTablesWithStats: vi.fn(async () => []),
  createTable: vi.fn(),
  getTable: vi.fn(),
  getTableStats: vi.fn(),
  updateTable: vi.fn(),
  deleteTable: vi.fn(),
  listRecords: vi.fn(async () => ({ records: [], total: 0 })),
  addRecord: vi.fn(),
  searchRecords: vi.fn(async () => []),
  getRecord: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  batchAddRecords: vi.fn(),
};

vi.mock('../services/custom-data-service.js', () => ({
  getCustomDataService: () => mockCustomDataService,
  CustomDataServiceError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn((token: { name: string }) => {
        const services: Record<string, unknown> = { database: mockCustomDataService };
        return services[token.name];
      }),
    })),
  };
});

// Import after mocks
const { customDataRoutes } = await import('./custom-data.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/custom-data', customDataRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Custom Data Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // GET /custom-data/tables
  // ========================================================================

  describe('GET /custom-data/tables', () => {
    it('returns list of tables', async () => {
      mockCustomDataService.listTablesWithStats.mockResolvedValue([
        { name: 'books', displayName: 'Books', columns: [], recordCount: 10 },
      ]);

      const res = await app.request('/custom-data/tables');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
    });
  });

  // ========================================================================
  // GET /custom-data/tables/by-plugin/:pluginId
  // ========================================================================

  describe('GET /custom-data/tables/by-plugin/:pluginId', () => {
    it('returns tables owned by a plugin', async () => {
      mockCustomDataService.listTablesWithStats.mockResolvedValue([
        { name: 'plugin_data', displayName: 'Plugin Data', columns: [] },
      ]);

      const res = await app.request('/custom-data/tables/by-plugin/plugin-1');

      expect(res.status).toBe(200);
      expect(mockCustomDataService.listTablesWithStats).toHaveBeenCalledWith({
        pluginId: 'plugin-1',
      });
    });
  });

  // ========================================================================
  // POST /custom-data/tables
  // ========================================================================

  describe('POST /custom-data/tables', () => {
    it('creates a table', async () => {
      mockCustomDataService.createTable.mockResolvedValue({
        id: 'tbl-1',
        name: 'books',
        displayName: 'Books',
        columns: [{ name: 'title', type: 'text' }],
      });

      const res = await app.request('/custom-data/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'books',
          displayName: 'Books',
          columns: [{ name: 'title', type: 'text' }],
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('books');
    });

    it('returns 400 on validation error', async () => {
      const { CustomDataServiceError } = await import('../services/custom-data-service.js');
      mockCustomDataService.createTable.mockRejectedValue(
        new CustomDataServiceError('Invalid columns', 'VALIDATION_ERROR')
      );

      const res = await app.request('/custom-data/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'bad',
          displayName: 'Bad',
          columns: [],
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /custom-data/tables/:table
  // ========================================================================

  describe('GET /custom-data/tables/:table', () => {
    it('returns table details with stats', async () => {
      mockCustomDataService.getTable.mockResolvedValue({
        id: 'tbl-1',
        name: 'books',
        displayName: 'Books',
        columns: [{ name: 'title', type: 'text' }],
      });
      mockCustomDataService.getTableStats.mockResolvedValue({ recordCount: 5 });

      const res = await app.request('/custom-data/tables/books');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('books');
      expect(json.data.stats.recordCount).toBe(5);
    });

    it('returns 404 when table not found', async () => {
      mockCustomDataService.getTable.mockResolvedValue(null);

      const res = await app.request('/custom-data/tables/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PUT /custom-data/tables/:table
  // ========================================================================

  describe('PUT /custom-data/tables/:table', () => {
    it('updates table schema', async () => {
      mockCustomDataService.updateTable.mockResolvedValue({
        id: 'tbl-1',
        displayName: 'Updated Books',
      });

      const res = await app.request('/custom-data/tables/books', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated Books' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.displayName).toBe('Updated Books');
    });

    it('returns 404 when table not found', async () => {
      mockCustomDataService.updateTable.mockResolvedValue(null);

      const res = await app.request('/custom-data/tables/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /custom-data/tables/:table
  // ========================================================================

  describe('DELETE /custom-data/tables/:table', () => {
    it('deletes a table', async () => {
      mockCustomDataService.deleteTable.mockResolvedValue(true);

      const res = await app.request('/custom-data/tables/books', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });

    it('returns 404 when table not found', async () => {
      mockCustomDataService.deleteTable.mockResolvedValue(false);

      const res = await app.request('/custom-data/tables/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });

    it('returns 403 for protected tables', async () => {
      const { CustomDataServiceError } = await import('../services/custom-data-service.js');
      mockCustomDataService.deleteTable.mockRejectedValue(
        new CustomDataServiceError('Table is protected', 'PROTECTED')
      );

      const res = await app.request('/custom-data/tables/system_table', { method: 'DELETE' });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('PROTECTED');
    });
  });

  // ========================================================================
  // GET /custom-data/tables/:table/records
  // ========================================================================

  describe('GET /custom-data/tables/:table/records', () => {
    it('returns paginated records', async () => {
      mockCustomDataService.listRecords.mockResolvedValue({
        records: [{ id: 'r1', data: { title: 'Book 1' } }],
        total: 10,
      });

      const res = await app.request('/custom-data/tables/books/records?limit=5&offset=0');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.records).toHaveLength(1);
      expect(json.data.total).toBe(10);
      expect(json.data.hasMore).toBe(true);
    });

    it('parses filter parameter', async () => {
      mockCustomDataService.listRecords.mockResolvedValue({ records: [], total: 0 });

      await app.request(
        '/custom-data/tables/books/records?filter=' + encodeURIComponent('{"genre":"fiction"}')
      );

      expect(mockCustomDataService.listRecords).toHaveBeenCalledWith('books', {
        limit: 50,
        offset: 0,
        filter: { genre: 'fiction' },
      });
    });
  });

  // ========================================================================
  // POST /custom-data/tables/:table/records
  // ========================================================================

  describe('POST /custom-data/tables/:table/records', () => {
    it('adds a record', async () => {
      mockCustomDataService.addRecord.mockResolvedValue({
        id: 'r1',
        data: { title: 'New Book' },
      });

      const res = await app.request('/custom-data/tables/books/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { title: 'New Book' } }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 400 when data is missing', async () => {
      const res = await app.request('/custom-data/tables/books/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /custom-data/tables/:table/search
  // ========================================================================

  describe('GET /custom-data/tables/:table/search', () => {
    it('searches records', async () => {
      mockCustomDataService.searchRecords.mockResolvedValue([
        { id: 'r1', data: { title: 'Match' } },
      ]);

      const res = await app.request('/custom-data/tables/books/search?q=match');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
    });

    it('returns 400 without query', async () => {
      const res = await app.request('/custom-data/tables/books/search');

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /custom-data/records/:id
  // ========================================================================

  describe('GET /custom-data/records/:id', () => {
    it('returns record by id', async () => {
      mockCustomDataService.getRecord.mockResolvedValue({
        id: 'r1',
        data: { title: 'Book 1' },
      });

      const res = await app.request('/custom-data/records/r1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('r1');
    });

    it('returns 404 when record not found', async () => {
      mockCustomDataService.getRecord.mockResolvedValue(null);

      const res = await app.request('/custom-data/records/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PUT /custom-data/records/:id
  // ========================================================================

  describe('PUT /custom-data/records/:id', () => {
    it('updates a record', async () => {
      mockCustomDataService.updateRecord.mockResolvedValue({
        id: 'r1',
        data: { title: 'Updated' },
      });

      const res = await app.request('/custom-data/records/r1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { title: 'Updated' } }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.data.title).toBe('Updated');
    });

    it('returns 404 when record not found', async () => {
      mockCustomDataService.updateRecord.mockResolvedValue(null);

      const res = await app.request('/custom-data/records/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { title: 'Updated' } }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 when data is missing', async () => {
      const res = await app.request('/custom-data/records/r1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // DELETE /custom-data/records/:id
  // ========================================================================

  describe('DELETE /custom-data/records/:id', () => {
    it('deletes a record', async () => {
      mockCustomDataService.deleteRecord.mockResolvedValue(true);

      const res = await app.request('/custom-data/records/r1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });

    it('returns 404 when record not found', async () => {
      mockCustomDataService.deleteRecord.mockResolvedValue(false);

      const res = await app.request('/custom-data/records/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /custom-data/tables — non-validation error path
  // ========================================================================

  describe('POST /custom-data/tables - generic error', () => {
    it('returns 400 with CREATE_FAILED code on non-validation errors', async () => {
      mockCustomDataService.createTable.mockRejectedValue(new Error('DB connection lost'));

      const res = await app.request('/custom-data/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test_table',
          displayName: 'Test',
          columns: [{ name: 'col1', type: 'text' }],
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('CREATE_FAILED');
    });
  });

  // ========================================================================
  // DELETE /custom-data/tables — non-CustomDataServiceError rethrow
  // ========================================================================

  describe('DELETE /custom-data/tables/:table - unexpected error', () => {
    it('rethrows non-CustomDataServiceError errors', async () => {
      mockCustomDataService.deleteTable.mockRejectedValue(new Error('Unexpected DB error'));

      const res = await app.request('/custom-data/tables/some-table', { method: 'DELETE' });

      // The error handler should catch the rethrown error
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // GET /custom-data/tables/:table/records — error paths
  // ========================================================================

  describe('GET /custom-data/tables/:table/records - errors', () => {
    it('returns 400 for invalid JSON in filter parameter', async () => {
      const res = await app.request('/custom-data/tables/books/records?filter=not-valid-json');

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 when listRecords throws', async () => {
      mockCustomDataService.listRecords.mockRejectedValue(new Error('Query failed'));

      const res = await app.request('/custom-data/tables/books/records');

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('LIST_FAILED');
    });

    it('returns hasMore=false when all records fit', async () => {
      mockCustomDataService.listRecords.mockResolvedValue({
        records: [{ id: 'r1', data: { x: 1 } }],
        total: 1,
      });

      const res = await app.request('/custom-data/tables/books/records');
      const json = await res.json();

      expect(json.data.hasMore).toBe(false);
    });
  });

  // ========================================================================
  // POST /custom-data/tables/:table/records — error paths
  // ========================================================================

  describe('POST /custom-data/tables/:table/records - errors', () => {
    it('returns 400 when data is an array', async () => {
      const res = await app.request('/custom-data/tables/books/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [1, 2, 3] }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('expected record, received array');
    });

    it('returns 400 when addRecord throws', async () => {
      mockCustomDataService.addRecord.mockRejectedValue(new Error('Insert failed'));

      const res = await app.request('/custom-data/tables/books/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { title: 'Test' } }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('ADD_FAILED');
    });
  });

  // ========================================================================
  // GET /custom-data/tables/:table/search — error paths
  // ========================================================================

  describe('GET /custom-data/tables/:table/search - errors', () => {
    it('returns 400 when searchRecords throws', async () => {
      mockCustomDataService.searchRecords.mockRejectedValue(new Error('Search failed'));

      const res = await app.request('/custom-data/tables/books/search?q=test');

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('SEARCH_FAILED');
    });
  });

  // ========================================================================
  // PUT /custom-data/records/:id — error paths
  // ========================================================================

  describe('PUT /custom-data/records/:id - errors', () => {
    it('returns 400 when data is an array', async () => {
      const res = await app.request('/custom-data/records/r1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [1, 2] }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when updateRecord throws', async () => {
      mockCustomDataService.updateRecord.mockRejectedValue(new Error('Update failed'));

      const res = await app.request('/custom-data/records/r1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { title: 'Changed' } }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('UPDATE_FAILED');
    });
  });
});

// ===========================================================================
// executeCustomDataTool tests
// ===========================================================================

describe('executeCustomDataTool', () => {
  let executeCustomDataTool: (
    toolName: string,
    args: Record<string, unknown>,
    userId: string
  ) => Promise<{ success: boolean; result?: unknown; error?: string }>;

  beforeAll(async () => {
    const mod = await import('./custom-data.js');
    executeCustomDataTool = mod.executeCustomDataTool;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create_custom_table', () => {
    it('creates a table and returns success', async () => {
      mockCustomDataService.createTable.mockResolvedValue({
        id: 'tbl-1',
        displayName: 'Books',
        columns: [{ name: 'title', type: 'text' }],
      });

      const result = await executeCustomDataTool('create_custom_table', {
        name: 'books',
        displayName: 'Books',
        columns: [{ name: 'title', type: 'text' }],
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('Books');
    });
  });

  describe('list_custom_tables', () => {
    it('returns empty message when no tables', async () => {
      mockCustomDataService.listTablesWithStats.mockResolvedValue([]);

      const result = await executeCustomDataTool('list_custom_tables', {});

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('No custom tables');
    });

    it('returns table summaries when tables exist', async () => {
      mockCustomDataService.listTablesWithStats.mockResolvedValue([
        {
          name: 'books',
          displayName: 'Books',
          description: 'Book collection',
          columns: [{ name: 'title', type: 'text' }],
          stats: { recordCount: 5 },
          ownerPluginId: null,
          isProtected: false,
        },
      ]);

      const result = await executeCustomDataTool('list_custom_tables', {});

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('1 custom table');
      expect(result.result.tables).toHaveLength(1);
      expect(result.result.tables[0].recordCount).toBe(5);
    });
  });

  describe('describe_custom_table', () => {
    it('returns table description with stats', async () => {
      mockCustomDataService.getTable.mockResolvedValue({
        id: 'tbl-1',
        displayName: 'Books',
        columns: [
          { name: 'title', type: 'text' },
          { name: 'author', type: 'text' },
        ],
      });
      mockCustomDataService.getTableStats.mockResolvedValue({ recordCount: 10 });

      const result = await executeCustomDataTool('describe_custom_table', { table: 'tbl-1' });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('2 columns');
      expect(result.result.message).toContain('10 records');
    });

    it('returns error when table not found', async () => {
      mockCustomDataService.getTable.mockResolvedValue(null);

      const result = await executeCustomDataTool('describe_custom_table', { table: 'bad-id' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('delete_custom_table', () => {
    it('returns error when confirm is false', async () => {
      const result = await executeCustomDataTool('delete_custom_table', {
        table: 'tbl-1',
        confirm: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('confirm');
    });

    it('returns error when table not found', async () => {
      mockCustomDataService.getTable.mockResolvedValue(null);

      const result = await executeCustomDataTool('delete_custom_table', {
        table: 'nonexistent',
        confirm: true,
      });

      expect(result.success).toBe(false);
    });

    it('deletes table successfully', async () => {
      mockCustomDataService.getTable.mockResolvedValue({
        id: 'tbl-1',
        displayName: 'Books',
      });
      mockCustomDataService.deleteTable.mockResolvedValue(true);

      const result = await executeCustomDataTool('delete_custom_table', {
        table: 'tbl-1',
        confirm: true,
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('Deleted');
    });
  });

  describe('add_custom_record', () => {
    it('adds a record successfully', async () => {
      mockCustomDataService.addRecord.mockResolvedValue({
        id: 'r1',
        data: { title: 'Book' },
      });
      mockCustomDataService.getTable.mockResolvedValue({
        displayName: 'Books',
      });

      const result = await executeCustomDataTool('add_custom_record', {
        table: 'tbl-1',
        data: { title: 'Book' },
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toContain('Books');
    });
  });

  describe('batch_add_custom_records', () => {
    it('returns error when records is not an array', async () => {
      const result = await executeCustomDataTool('batch_add_custom_records', {
        table: 'tbl-1',
        records: 'not-array',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('array');
    });

    it('batch adds records successfully', async () => {
      mockCustomDataService.batchAddRecords.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
      mockCustomDataService.getTable.mockResolvedValue({ displayName: 'Books' });

      const result = await executeCustomDataTool('batch_add_custom_records', {
        table: 'tbl-1',
        records: [{ title: 'A' }, { title: 'B' }],
      });

      expect(result.success).toBe(true);
      expect(result.result.count).toBe(2);
    });
  });

  describe('list_custom_records', () => {
    it('lists records with pagination info', async () => {
      mockCustomDataService.listRecords.mockResolvedValue({
        records: [{ id: 'r1', data: { title: 'X' }, createdAt: '2024-01-01' }],
        total: 5,
      });
      mockCustomDataService.getTable.mockResolvedValue({ displayName: 'Books' });

      const result = await executeCustomDataTool('list_custom_records', {
        table: 'tbl-1',
        limit: 1,
        offset: 0,
      });

      expect(result.success).toBe(true);
      expect(result.result.total).toBe(5);
      expect(result.result.hasMore).toBe(true);
    });
  });

  describe('search_custom_records', () => {
    it('searches records and returns results', async () => {
      mockCustomDataService.searchRecords.mockResolvedValue([
        { id: 'r1', data: { title: 'Match' }, createdAt: '2024-01-01' },
      ]);
      mockCustomDataService.getTable.mockResolvedValue({ displayName: 'Books' });

      const result = await executeCustomDataTool('search_custom_records', {
        table: 'tbl-1',
        query: 'match',
      });

      expect(result.success).toBe(true);
      expect(result.result.records).toHaveLength(1);
    });
  });

  describe('get_custom_record', () => {
    it('returns record when found', async () => {
      mockCustomDataService.getRecord.mockResolvedValue({
        id: 'r1',
        data: { title: 'Book' },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      });

      const result = await executeCustomDataTool('get_custom_record', { recordId: 'r1' });

      expect(result.success).toBe(true);
      expect(result.result.record.id).toBe('r1');
    });

    it('returns error when record not found', async () => {
      mockCustomDataService.getRecord.mockResolvedValue(null);

      const result = await executeCustomDataTool('get_custom_record', { recordId: 'bad' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('update_custom_record', () => {
    it('updates record and returns success', async () => {
      mockCustomDataService.updateRecord.mockResolvedValue({
        id: 'r1',
        data: { title: 'Updated' },
        updatedAt: '2024-01-02',
      });

      const result = await executeCustomDataTool('update_custom_record', {
        recordId: 'r1',
        data: { title: 'Updated' },
      });

      expect(result.success).toBe(true);
      expect(result.result.message).toBe('Record updated.');
    });

    it('returns error when record not found', async () => {
      mockCustomDataService.updateRecord.mockResolvedValue(null);

      const result = await executeCustomDataTool('update_custom_record', {
        recordId: 'bad',
        data: { title: 'X' },
      });

      expect(result.success).toBe(false);
    });
  });

  describe('delete_custom_record', () => {
    it('deletes record successfully', async () => {
      mockCustomDataService.deleteRecord.mockResolvedValue(true);

      const result = await executeCustomDataTool('delete_custom_record', { recordId: 'r1' });

      expect(result.success).toBe(true);
      expect(result.result.message).toBe('Record deleted.');
    });

    it('returns error when record not found', async () => {
      mockCustomDataService.deleteRecord.mockResolvedValue(false);

      const result = await executeCustomDataTool('delete_custom_record', { recordId: 'bad' });

      expect(result.success).toBe(false);
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown toolId', async () => {
      const result = await executeCustomDataTool('nonexistent_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });

  describe('error handling', () => {
    it('catches CustomDataServiceError and returns message', async () => {
      const { CustomDataServiceError } = await import('../services/custom-data-service.js');
      mockCustomDataService.createTable.mockRejectedValue(
        new CustomDataServiceError('Duplicate name', 'VALIDATION_ERROR')
      );

      const result = await executeCustomDataTool('create_custom_table', {
        name: 'dup',
        displayName: 'Dup',
        columns: [{ name: 'x', type: 'text' }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Duplicate name');
    });

    it('catches generic errors and returns message', async () => {
      mockCustomDataService.createTable.mockRejectedValue(new Error('Generic error'));

      const result = await executeCustomDataTool('create_custom_table', {
        name: 'err',
        displayName: 'Err',
        columns: [{ name: 'x', type: 'text' }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Generic error');
    });
  });
});
