/**
 * Custom Data Routes Tests
 *
 * Integration tests for the custom data API endpoints.
 * Mocks CustomDataService to test table/record CRUD and response formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
      expect(mockCustomDataService.listTablesWithStats).toHaveBeenCalledWith({ pluginId: 'plugin-1' });
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

      await app.request('/custom-data/tables/books/records?filter=' + encodeURIComponent('{"genre":"fiction"}'));

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
});
