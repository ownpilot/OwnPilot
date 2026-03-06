/**
 * CLI Providers Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRepo, mockExecFileSync } = vi.hoisted(() => ({
  mockRepo: {
    list: vi.fn(async () => []),
    getByName: vi.fn(async () => null),
    getById: vi.fn(async () => null),
    create: vi.fn(async () => null),
    update: vi.fn(async () => null),
    delete: vi.fn(async () => false),
  },
  mockExecFileSync: vi.fn(),
}));

vi.mock('../db/repositories/cli-providers.js', () => ({
  cliProvidersRepo: mockRepo,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, execFileSync: mockExecFileSync };
});

const { cliProvidersRoutes } = await import('./cli-providers.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/cli-providers', cliProvidersRoutes);
  app.onError(errorHandler);
  return app;
}

const sampleProvider = {
  id: 'prov-1',
  name: 'prettier',
  displayName: 'Prettier',
  binary: 'prettier',
  description: 'Code formatter',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI Providers Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.list.mockResolvedValue([sampleProvider]);
    mockRepo.getByName.mockResolvedValue(null);
    mockRepo.getById.mockResolvedValue(sampleProvider);
    mockRepo.create.mockResolvedValue(sampleProvider);
    mockRepo.update.mockResolvedValue(sampleProvider);
    mockRepo.delete.mockResolvedValue(true);
    app = createApp();
  });

  // ========================================================================
  // GET /
  // ========================================================================

  describe('GET /cli-providers', () => {
    it('returns list of providers', async () => {
      const res = await app.request('/cli-providers');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(mockRepo.list).toHaveBeenCalledWith('user-1');
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.list.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/cli-providers');
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /
  // ========================================================================

  describe('POST /cli-providers', () => {
    const validBody = {
      name: 'eslint',
      display_name: 'ESLint',
      binary: 'eslint',
    };

    it('creates provider and returns 201', async () => {
      const res = await app.request('/cli-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(201);
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.request('/cli-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: 'ESLint', binary: 'eslint' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when display_name is missing', async () => {
      const res = await app.request('/cli-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'eslint', binary: 'eslint' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when binary is missing', async () => {
      const res = await app.request('/cli-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'eslint', display_name: 'ESLint' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid name format', async () => {
      const res = await app.request('/cli-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Tool!', display_name: 'My Tool', binary: 'mytool' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 409 when provider already exists', async () => {
      mockRepo.getByName.mockResolvedValueOnce(sampleProvider);
      const res = await app.request('/cli-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(409);
    });

    it('returns 500 when repo.create throws', async () => {
      mockRepo.create.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/cli-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(500);
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/cli-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // PUT /:id
  // ========================================================================

  describe('PUT /cli-providers/:id', () => {
    it('updates provider and returns it', async () => {
      const res = await app.request('/cli-providers/prov-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: 'Prettier v2' }),
      });
      expect(res.status).toBe(200);
    });

    it('returns 404 when provider not found', async () => {
      mockRepo.update.mockResolvedValueOnce(null);
      const res = await app.request('/cli-providers/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: 'x' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.update.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/cli-providers/prov-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: 'x' }),
      });
      expect(res.status).toBe(500);
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/cli-providers/prov-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // DELETE /:id
  // ========================================================================

  describe('DELETE /cli-providers/:id', () => {
    it('deletes provider and returns deleted: true', async () => {
      const res = await app.request('/cli-providers/prov-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted).toBe(true);
    });

    it('returns 404 when provider not found', async () => {
      mockRepo.delete.mockResolvedValueOnce(false);
      const res = await app.request('/cli-providers/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.delete.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/cli-providers/prov-1', { method: 'DELETE' });
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /:id/test
  // ========================================================================

  describe('POST /cli-providers/:id/test', () => {
    it('returns installed: true and version when binary found', async () => {
      mockExecFileSync
        .mockReturnValueOnce(Buffer.from('/usr/bin/prettier')) // where/which
        .mockReturnValueOnce('2.8.0\n'); // --version

      const res = await app.request('/cli-providers/prov-1/test', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.installed).toBe(true);
      expect(json.data.version).toBe('2.8.0');
    });

    it('returns installed: false when binary not found', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const res = await app.request('/cli-providers/prov-1/test', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.installed).toBe(false);
    });

    it('returns installed: true with undefined version when --version fails', async () => {
      mockExecFileSync
        .mockReturnValueOnce(Buffer.from('/usr/bin/prettier')) // where/which succeeds
        .mockImplementationOnce(() => {
          throw new Error('no --version');
        }); // --version fails

      const res = await app.request('/cli-providers/prov-1/test', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.installed).toBe(true);
      expect(json.data.version).toBeUndefined();
    });

    it('returns 404 when provider not found', async () => {
      mockRepo.getById.mockResolvedValueOnce(null);
      const res = await app.request('/cli-providers/nonexistent/test', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 500 when repo throws', async () => {
      mockRepo.getById.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/cli-providers/prov-1/test', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });
});
