/**
 * Profile Routes Tests
 *
 * Integration tests for the user profile API endpoints.
 * Mocks getPersonalMemoryStore and getMemoryInjector from core.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStore = {
  getProfile: vi.fn(async () => ({ name: 'Test User', categories: {} })),
  getProfileSummary: vi.fn(async () => 'User is a developer based in Istanbul.'),
  getCategory: vi.fn(async () => [{ key: 'name', value: 'Test', confidence: 1.0 }]),
  set: vi.fn(async () => ({ key: 'name', value: 'Test', category: 'identity' })),
  delete: vi.fn(async () => true),
  search: vi.fn(async () => [{ key: 'name', value: 'Test', category: 'identity' }]),
  importData: vi.fn(async (entries: unknown[]) => (entries as unknown[]).length),
  exportData: vi.fn(async () => [{ category: 'identity', key: 'name', value: 'Test' }]),
};

const mockInjector = { invalidateCache: vi.fn() };

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getPersonalMemoryStore: vi.fn(async () => mockStore),
    getMemoryInjector: vi.fn(() => mockInjector),
  };
});

// Import after mocks
const { profileRoutes } = await import('./profile.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/profile', profileRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Profile Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /profile', () => {
    it('returns user profile', async () => {
      const res = await app.request('/profile');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Test User');
    });
  });

  describe('GET /profile/summary', () => {
    it('returns profile summary', async () => {
      const res = await app.request('/profile/summary');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.summary).toContain('developer');
    });
  });

  describe('GET /profile/category/:category', () => {
    it('returns entries for a category', async () => {
      const res = await app.request('/profile/category/identity');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.category).toBe('identity');
      expect(json.data.entries).toHaveLength(1);
    });
  });

  describe('POST /profile/data', () => {
    it('creates a personal data entry', async () => {
      const res = await app.request('/profile/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'identity', key: 'name', value: 'Test' }),
      });

      expect(res.status).toBe(201);
      expect(mockInjector.invalidateCache).toHaveBeenCalled();
    });

    it('returns 400 when required fields missing', async () => {
      const res = await app.request('/profile/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'identity' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /profile/data', () => {
    it('deletes a personal data entry', async () => {
      const res = await app.request('/profile/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'identity', key: 'name' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });

    it('returns 400 when required fields missing', async () => {
      const res = await app.request('/profile/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'identity' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /profile/search', () => {
    it('searches personal data', async () => {
      const res = await app.request('/profile/search?q=test');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.results).toHaveLength(1);
    });

    it('returns 400 when query missing', async () => {
      const res = await app.request('/profile/search');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /profile/import', () => {
    it('imports personal data', async () => {
      const res = await app.request('/profile/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [{ category: 'identity', key: 'name', value: 'Test' }] }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.imported).toBe(1);
    });

    it('returns 400 when entries is not an array', async () => {
      const res = await app.request('/profile/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: 'invalid' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /profile/export', () => {
    it('exports all personal data', async () => {
      const res = await app.request('/profile/export');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.entries).toHaveLength(1);
      expect(json.data.count).toBe(1);
    });
  });

  describe('POST /profile/quick', () => {
    it('sets multiple profile fields at once', async () => {
      const res = await app.request('/profile/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', location: 'Istanbul', timezone: 'Europe/Istanbul' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.updated).toBe(3);
    });
  });

  describe('GET /profile/categories', () => {
    it('returns available categories', async () => {
      const res = await app.request('/profile/categories');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.identity).toBeDefined();
      expect(json.data.location).toBeDefined();
      expect(json.data.communication).toBeDefined();
    });
  });
});
