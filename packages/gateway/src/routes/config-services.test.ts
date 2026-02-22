/**
 * Config Services Routes Tests
 *
 * Integration tests for the config services API endpoints.
 * Mocks configServicesRepo to test service/entry CRUD and secret masking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockConfigServicesRepo = {
  list: vi.fn(() => []),
  getByName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getEntries: vi.fn(() => []),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  setDefaultEntry: vi.fn(),
  getStats: vi.fn(async () => ({ totalServices: 5, totalEntries: 12, byCategory: {} })),
  isAvailable: vi.fn(() => false),
};

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: mockConfigServicesRepo,
}));

// Import after mocks
const { configServicesRoutes } = await import('./config-services.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/config-services', configServicesRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleService = {
  name: 'gmail',
  displayName: 'Gmail',
  category: 'email',
  description: 'Gmail SMTP',
  configSchema: [
    { name: 'email', type: 'text', label: 'Email' },
    { name: 'app_password', type: 'secret', label: 'App Password' },
  ],
  requiredBy: ['send_email'],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const sampleEntry = {
  id: 'entry-1',
  serviceName: 'gmail',
  label: 'Personal',
  isDefault: true,
  data: { email: 'user@gmail.com', app_password: 'supersecretpassword123' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Config Services Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // GET /config-services
  // ========================================================================

  describe('GET /config-services', () => {
    it('returns list of services with sanitized entries', async () => {
      mockConfigServicesRepo.list.mockReturnValue([sampleService]);
      mockConfigServicesRepo.getEntries.mockReturnValue([sampleEntry]);

      const res = await app.request('/config-services');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.services).toHaveLength(1);
      expect(json.data.count).toBe(1);
      // Secret should be masked
      const entry = json.data.services[0].entries[0];
      expect(entry.data.app_password).not.toBe('supersecretpassword123');
      expect(entry.hasSecrets).toBe(true);
      expect(entry.secretFields).toContain('app_password');
    });

    it('filters by category', async () => {
      mockConfigServicesRepo.list.mockReturnValue([]);

      await app.request('/config-services?category=email');

      expect(mockConfigServicesRepo.list).toHaveBeenCalledWith('email');
    });
  });

  // ========================================================================
  // GET /config-services/stats
  // ========================================================================

  describe('GET /config-services/stats', () => {
    it('returns statistics', async () => {
      const res = await app.request('/config-services/stats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.totalServices).toBe(5);
    });
  });

  // ========================================================================
  // GET /config-services/categories
  // ========================================================================

  describe('GET /config-services/categories', () => {
    it('returns unique categories', async () => {
      mockConfigServicesRepo.list.mockReturnValue([
        { ...sampleService, category: 'email' },
        { ...sampleService, name: 'telegram', category: 'chat' },
        { ...sampleService, name: 'teams', category: 'chat' },
      ]);

      const res = await app.request('/config-services/categories');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.categories).toEqual(['chat', 'email']);
    });
  });

  // ========================================================================
  // GET /config-services/needed
  // ========================================================================

  describe('GET /config-services/needed', () => {
    it('returns unconfigured services needed by tools', async () => {
      mockConfigServicesRepo.list.mockReturnValue([sampleService]);
      mockConfigServicesRepo.isAvailable.mockReturnValue(false);
      mockConfigServicesRepo.getEntries.mockReturnValue([]);

      const res = await app.request('/config-services/needed');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.services).toHaveLength(1);
    });

    it('excludes already-configured services', async () => {
      mockConfigServicesRepo.list.mockReturnValue([sampleService]);
      mockConfigServicesRepo.isAvailable.mockReturnValue(true);

      const res = await app.request('/config-services/needed');

      const json = await res.json();
      expect(json.data.services).toHaveLength(0);
    });
  });

  // ========================================================================
  // GET /config-services/:name
  // ========================================================================

  describe('GET /config-services/:name', () => {
    it('returns single service with entries', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(sampleService);
      mockConfigServicesRepo.getEntries.mockReturnValue([sampleEntry]);

      const res = await app.request('/config-services/gmail');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.name).toBe('gmail');
      expect(json.data.entries).toHaveLength(1);
    });

    it('returns 404 when not found', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(null);

      const res = await app.request('/config-services/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /config-services
  // ========================================================================

  describe('POST /config-services', () => {
    it('creates a new service', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(null);
      mockConfigServicesRepo.create.mockResolvedValue(sampleService);
      mockConfigServicesRepo.getEntries.mockReturnValue([]);

      const res = await app.request('/config-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'gmail',
          displayName: 'Gmail',
          category: 'email',
          configSchema: [],
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.name).toBe('gmail');
    });

    it('returns 400 for missing required fields', async () => {
      const res = await app.request('/config-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid name format', async () => {
      const res = await app.request('/config-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Invalid-Name!',
          displayName: 'Test',
          category: 'test',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate name', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(sampleService);

      const res = await app.request('/config-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'gmail',
          displayName: 'Gmail',
          category: 'email',
        }),
      });

      expect(res.status).toBe(409);
    });
  });

  // ========================================================================
  // PUT /config-services/:name
  // ========================================================================

  describe('PUT /config-services/:name', () => {
    it('updates a service', async () => {
      mockConfigServicesRepo.update.mockResolvedValue({
        ...sampleService,
        displayName: 'Updated Gmail',
      });
      mockConfigServicesRepo.getEntries.mockReturnValue([]);

      const res = await app.request('/config-services/gmail', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated Gmail' }),
      });

      expect(res.status).toBe(200);
    });

    it('returns 404 when not found', async () => {
      mockConfigServicesRepo.update.mockResolvedValue(null);

      const res = await app.request('/config-services/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /config-services/:name
  // ========================================================================

  describe('DELETE /config-services/:name', () => {
    it('deletes a service', async () => {
      mockConfigServicesRepo.delete.mockResolvedValue(true);

      const res = await app.request('/config-services/gmail', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });

    it('returns 404 when not found', async () => {
      mockConfigServicesRepo.delete.mockResolvedValue(false);

      const res = await app.request('/config-services/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /config-services/:name/entries
  // ========================================================================

  describe('GET /config-services/:name/entries', () => {
    it('returns entries with masked secrets', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(sampleService);
      mockConfigServicesRepo.getEntries.mockReturnValue([sampleEntry]);

      const res = await app.request('/config-services/gmail/entries');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.entries).toHaveLength(1);
      expect(json.data.count).toBe(1);
      // Verify secret masking
      const entry = json.data.entries[0];
      expect(entry.data.email).toBe('user@gmail.com'); // not a secret
      expect(entry.data.app_password).not.toBe('supersecretpassword123');
    });

    it('returns 404 when service not found', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(null);

      const res = await app.request('/config-services/nonexistent/entries');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /config-services/:name/entries
  // ========================================================================

  describe('POST /config-services/:name/entries', () => {
    it('creates an entry', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(sampleService);
      mockConfigServicesRepo.createEntry.mockResolvedValue(sampleEntry);

      const res = await app.request('/config-services/gmail/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Personal',
          data: { email: 'user@gmail.com', app_password: 'secret123' },
        }),
      });

      expect(res.status).toBe(201);
    });

    it('returns 404 when service not found', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(null);

      const res = await app.request('/config-services/nonexistent/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Test', data: {} }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PUT /config-services/:name/entries/:entryId
  // ========================================================================

  describe('PUT /config-services/:name/entries/:entryId', () => {
    it('updates an entry and preserves masked secrets', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(sampleService);
      mockConfigServicesRepo.getEntries.mockReturnValue([sampleEntry]);
      mockConfigServicesRepo.updateEntry.mockResolvedValue({
        ...sampleEntry,
        data: { email: 'new@gmail.com', app_password: 'supersecretpassword123' },
      });

      const res = await app.request('/config-services/gmail/entries/entry-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: { email: 'new@gmail.com', app_password: 'supe...d123' }, // masked value
        }),
      });

      expect(res.status).toBe(200);
      // The masked value should have been replaced with the original
      const updateCall = mockConfigServicesRepo.updateEntry.mock.calls[0];
      expect(updateCall[1].data.app_password).toBe('supersecretpassword123');
    });

    it('returns 404 when entry not found', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(sampleService);
      mockConfigServicesRepo.getEntries.mockReturnValue([]);
      mockConfigServicesRepo.updateEntry.mockResolvedValue(null);

      const res = await app.request('/config-services/gmail/entries/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { email: 'test@test.com' } }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /config-services/:name/entries/:entryId
  // ========================================================================

  describe('DELETE /config-services/:name/entries/:entryId', () => {
    it('deletes an entry', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(sampleService);
      mockConfigServicesRepo.deleteEntry.mockResolvedValue(true);

      const res = await app.request('/config-services/gmail/entries/entry-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });

    it('returns 404 when service not found', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(null);

      const res = await app.request('/config-services/nonexistent/entries/entry-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when entry not found', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(sampleService);
      mockConfigServicesRepo.deleteEntry.mockResolvedValue(false);

      const res = await app.request('/config-services/gmail/entries/nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PUT /config-services/:name/entries/:entryId/default
  // ========================================================================

  describe('PUT /config-services/:name/entries/:entryId/default', () => {
    it('sets entry as default', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(sampleService);
      mockConfigServicesRepo.getEntries
        .mockReturnValueOnce([sampleEntry]) // verify entry exists
        .mockReturnValueOnce([{ ...sampleEntry, isDefault: true }]); // after setDefault

      const res = await app.request('/config-services/gmail/entries/entry-1/default', {
        method: 'PUT',
      });

      expect(res.status).toBe(200);
      expect(mockConfigServicesRepo.setDefaultEntry).toHaveBeenCalledWith('gmail', 'entry-1');
    });

    it('returns 404 when service not found', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(null);

      const res = await app.request('/config-services/nonexistent/entries/entry-1/default', {
        method: 'PUT',
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when entry not found', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(sampleService);
      mockConfigServicesRepo.getEntries.mockReturnValue([]);

      const res = await app.request('/config-services/gmail/entries/nonexistent/default', {
        method: 'PUT',
      });

      expect(res.status).toBe(404);
    });
  });
});
