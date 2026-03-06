/**
 * Artifact Routes Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockService } = vi.hoisted(() => ({
  mockService: {
    listArtifacts: vi.fn(async () => ({ artifacts: [], total: 0 })),
    getArtifact: vi.fn(async () => null),
    createArtifact: vi.fn(async () => null),
    updateArtifact: vi.fn(async () => null),
    deleteArtifact: vi.fn(async () => false),
    togglePin: vi.fn(async () => null),
    refreshBindings: vi.fn(async () => null),
    getVersions: vi.fn(async () => []),
  },
}));

vi.mock('../services/artifact-service.js', () => ({
  getArtifactService: vi.fn(() => mockService),
}));

const { artifactsRoutes } = await import('./artifacts.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/artifacts', artifactsRoutes);
  app.onError(errorHandler);
  return app;
}

const sampleArtifact = {
  id: 'art-1',
  userId: 'user-1',
  type: 'html',
  title: 'My Chart',
  content: '<html>hello</html>',
  pinned: false,
  version: 1,
  dataBindings: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Artifact Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService.listArtifacts.mockResolvedValue({ artifacts: [sampleArtifact], total: 1 });
    mockService.getArtifact.mockResolvedValue(sampleArtifact);
    mockService.createArtifact.mockResolvedValue(sampleArtifact);
    mockService.updateArtifact.mockResolvedValue(sampleArtifact);
    mockService.deleteArtifact.mockResolvedValue(true);
    mockService.togglePin.mockResolvedValue({ ...sampleArtifact, pinned: true });
    mockService.refreshBindings.mockResolvedValue(sampleArtifact);
    mockService.getVersions.mockResolvedValue([
      { version: 1, content: '<html/>', createdAt: '2026-01-01' },
    ]);
    app = createApp();
  });

  // ========================================================================
  // GET /
  // ========================================================================

  describe('GET /artifacts', () => {
    it('returns list of artifacts', async () => {
      const res = await app.request('/artifacts');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.artifacts).toHaveLength(1);
      expect(json.data.total).toBe(1);
    });

    it('passes type filter to service', async () => {
      await app.request('/artifacts?type=html');
      expect(mockService.listArtifacts).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'html' })
      );
    });

    it('passes pinned=true filter to service', async () => {
      await app.request('/artifacts?pinned=true');
      expect(mockService.listArtifacts).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ pinned: true })
      );
    });

    it('passes pinned=false filter to service', async () => {
      await app.request('/artifacts?pinned=false');
      expect(mockService.listArtifacts).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ pinned: false })
      );
    });

    it('passes search filter to service', async () => {
      await app.request('/artifacts?search=hello');
      expect(mockService.listArtifacts).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ search: 'hello' })
      );
    });

    it('passes conversationId filter to service', async () => {
      await app.request('/artifacts?conversationId=conv-1');
      expect(mockService.listArtifacts).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ conversationId: 'conv-1' })
      );
    });

    it('returns 500 when service throws', async () => {
      mockService.listArtifacts.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/artifacts');
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // GET /:id
  // ========================================================================

  describe('GET /artifacts/:id', () => {
    it('returns artifact when found', async () => {
      const res = await app.request('/artifacts/art-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('art-1');
    });

    it('returns 404 when artifact not found', async () => {
      mockService.getArtifact.mockResolvedValueOnce(null);
      const res = await app.request('/artifacts/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 500 when service throws', async () => {
      mockService.getArtifact.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/artifacts/art-1');
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /
  // ========================================================================

  describe('POST /artifacts', () => {
    const validBody = {
      title: 'My HTML',
      type: 'html',
      content: '<html>hello</html>',
    };

    it('creates artifact and returns 201', async () => {
      const res = await app.request('/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.id).toBe('art-1');
    });

    it('returns 400 when title is missing', async () => {
      const res = await app.request('/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'html', content: 'x' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when type is missing', async () => {
      const res = await app.request('/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x', content: 'x' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when content is missing', async () => {
      const res = await app.request('/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x', type: 'html' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid type', async () => {
      const res = await app.request('/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x', type: 'video', content: 'x' }),
      });
      expect(res.status).toBe(400);
    });

    it('accepts all valid types', async () => {
      for (const type of ['html', 'svg', 'markdown', 'form', 'chart', 'react']) {
        const res = await app.request('/artifacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'x', type, content: 'x' }),
        });
        expect(res.status).toBe(201);
      }
    });

    it('returns 500 when service throws', async () => {
      mockService.createArtifact.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // PATCH /:id
  // ========================================================================

  describe('PATCH /artifacts/:id', () => {
    it('updates and returns artifact', async () => {
      const res = await app.request('/artifacts/art-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Title' }),
      });
      expect(res.status).toBe(200);
    });

    it('returns 404 when artifact not found', async () => {
      mockService.updateArtifact.mockResolvedValueOnce(null);
      const res = await app.request('/artifacts/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 500 when service throws', async () => {
      mockService.updateArtifact.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/artifacts/art-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x' }),
      });
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // DELETE /:id
  // ========================================================================

  describe('DELETE /artifacts/:id', () => {
    it('deletes artifact and returns message', async () => {
      const res = await app.request('/artifacts/art-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('deleted');
    });

    it('returns 404 when artifact not found', async () => {
      mockService.deleteArtifact.mockResolvedValueOnce(false);
      const res = await app.request('/artifacts/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    it('returns 500 when service throws', async () => {
      mockService.deleteArtifact.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/artifacts/art-1', { method: 'DELETE' });
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /:id/pin
  // ========================================================================

  describe('POST /artifacts/:id/pin', () => {
    it('toggles pin and returns artifact', async () => {
      const res = await app.request('/artifacts/art-1/pin', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pinned).toBe(true);
    });

    it('returns 404 when artifact not found', async () => {
      mockService.togglePin.mockResolvedValueOnce(null);
      const res = await app.request('/artifacts/nonexistent/pin', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 500 when service throws', async () => {
      mockService.togglePin.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/artifacts/art-1/pin', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /:id/refresh
  // ========================================================================

  describe('POST /artifacts/:id/refresh', () => {
    it('refreshes bindings and returns artifact', async () => {
      const res = await app.request('/artifacts/art-1/refresh', { method: 'POST' });
      expect(res.status).toBe(200);
    });

    it('returns 404 when artifact not found', async () => {
      mockService.refreshBindings.mockResolvedValueOnce(null);
      const res = await app.request('/artifacts/nonexistent/refresh', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 500 when service throws', async () => {
      mockService.refreshBindings.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/artifacts/art-1/refresh', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // GET /:id/versions
  // ========================================================================

  describe('GET /artifacts/:id/versions', () => {
    it('returns version history', async () => {
      const res = await app.request('/artifacts/art-1/versions');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data).toHaveLength(1);
    });

    it('returns 500 when service throws', async () => {
      mockService.getVersions.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/artifacts/art-1/versions');
      expect(res.status).toBe(500);
    });
  });
});
