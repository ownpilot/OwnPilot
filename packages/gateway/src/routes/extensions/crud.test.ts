/**
 * Extensions CRUD Routes Tests
 *
 * Integration tests for:
 *   GET /         — list extensions (format/status/category filters)
 *   GET /:id      — get single extension
 *   DELETE /:id   — uninstall extension
 *   PATCH /:id    — update metadata (name, description, version)
 *   POST /:id/enable, /:id/disable, /:id/reload
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

const mockExtService = {
  getAll: vi.fn(),
  getById: vi.fn(),
  installFromManifest: vi.fn(),
  uninstall: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  reload: vi.fn(),
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn(() => mockExtService),
    })),
  };
});

const mockExtensionsRepo = {
  getById: vi.fn(),
  upsert: vi.fn(),
};

vi.mock('../../db/repositories/extensions.js', () => ({
  extensionsRepo: mockExtensionsRepo,
}));

const { crudRoutes } = await import('./crud.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', USER_ID);
    await next();
  });
  app.route('/ext', crudRoutes);
  app.onError(errorHandler);
  return app;
}

const makeExt = (overrides: Record<string, unknown> = {}) => ({
  id: 'ext-1',
  userId: USER_ID,
  name: 'My Extension',
  description: 'Does stuff',
  version: '1.0.0',
  status: 'enabled',
  category: 'utilities',
  format: 'ownpilot',
  icon: null,
  authorName: null,
  manifest: { format: 'ownpilot', name: 'My Extension', tools: [] },
  sourcePath: null,
  settings: {},
  toolCount: 0,
  triggerCount: 0,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Extensions CRUD Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtService.getAll.mockReturnValue([makeExt()]);
    mockExtService.getById.mockReturnValue(makeExt());
    mockExtService.uninstall.mockResolvedValue(null); // falsy default → 404 unless overridden
    mockExtService.enable.mockResolvedValue(makeExt({ status: 'enabled' }));
    mockExtService.disable.mockResolvedValue(makeExt({ status: 'disabled' }));
    mockExtensionsRepo.getById.mockReturnValue(makeExt());
    mockExtensionsRepo.upsert.mockResolvedValue(undefined);
    app = createApp();
  });

  // =========================================================================
  // GET /
  // =========================================================================

  describe('GET /', () => {
    it('returns all extensions for the user', async () => {
      const res = await app.request('/ext');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.packages).toHaveLength(1);
      expect(json.data.total).toBe(1);
    });

    it('filters by status query param', async () => {
      mockExtService.getAll.mockReturnValue([
        makeExt({ status: 'enabled' }),
        makeExt({ id: 'ext-2', status: 'disabled' }),
      ]);

      const res = await app.request('/ext?status=enabled');
      const json = await res.json();
      expect(json.data.packages).toHaveLength(1);
      expect(json.data.packages[0].status).toBe('enabled');
    });

    it('filters by format query param', async () => {
      mockExtService.getAll.mockReturnValue([
        makeExt({ format: 'ownpilot', manifest: { format: 'ownpilot', tools: [] } }),
        makeExt({
          id: 'ext-2',
          format: 'agentskills',
          manifest: { format: 'agentskills', tools: [] },
        }),
      ]);

      const res = await app.request('/ext?format=agentskills');
      const json = await res.json();
      expect(json.data.packages).toHaveLength(1);
    });

    it('excludes extensions belonging to other users', async () => {
      mockExtService.getAll.mockReturnValue([
        makeExt(),
        makeExt({ id: 'ext-other', userId: 'other-user' }),
      ]);

      const res = await app.request('/ext');
      const json = await res.json();
      expect(json.data.packages).toHaveLength(1);
    });
  });

  // =========================================================================
  // GET /:id
  // =========================================================================

  describe('GET /:id', () => {
    it('returns 200 with the extension', async () => {
      const res = await app.request('/ext/ext-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.package.id).toBe('ext-1');
    });

    it('returns 404 when not found', async () => {
      mockExtService.getById.mockReturnValue(undefined);
      const res = await app.request('/ext/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 404 when extension belongs to different user', async () => {
      mockExtService.getById.mockReturnValue(makeExt({ userId: 'other-user' }));
      const res = await app.request('/ext/ext-1');
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // DELETE /:id
  // =========================================================================

  describe('DELETE /:id', () => {
    it('uninstalls the extension and returns 200', async () => {
      mockExtService.uninstall.mockResolvedValue(true);
      const res = await app.request('/ext/ext-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(mockExtService.uninstall).toHaveBeenCalledWith('ext-1', USER_ID);
    });

    it('returns 404 when not found', async () => {
      mockExtService.getById.mockReturnValue(undefined);
      const res = await app.request('/ext/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // PATCH /:id — update metadata
  // =========================================================================

  describe('PATCH /:id', () => {
    /** Helper: set up mocks for a successful PATCH */
    function setupPatchSuccess(updatedExt = makeExt()) {
      mockExtensionsRepo.getById.mockReturnValue(makeExt());
      mockExtensionsRepo.upsert.mockResolvedValue(undefined);
      // First getById = ownership check, second = return updated pkg
      mockExtService.getById.mockReturnValueOnce(makeExt()).mockReturnValueOnce(updatedExt);
    }

    it('updates name and returns 200', async () => {
      setupPatchSuccess(makeExt({ name: 'Updated Name' }));

      const res = await app.request('/ext/ext-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      expect(res.status).toBe(200);
      expect(mockExtensionsRepo.upsert).toHaveBeenCalled();
      const upsertArg = mockExtensionsRepo.upsert.mock.calls[0][0] as Record<string, unknown>;
      expect(upsertArg.name).toBe('Updated Name');
    });

    it('updates description', async () => {
      setupPatchSuccess();

      const res = await app.request('/ext/ext-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'New description' }),
      });

      expect(res.status).toBe(200);
      const upsertArg = mockExtensionsRepo.upsert.mock.calls[0][0] as Record<string, unknown>;
      expect(upsertArg.description).toBe('New description');
    });

    it('updates version', async () => {
      setupPatchSuccess();

      const res = await app.request('/ext/ext-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: '2.0.0' }),
      });

      expect(res.status).toBe(200);
      const upsertArg = mockExtensionsRepo.upsert.mock.calls[0][0] as Record<string, unknown>;
      expect(upsertArg.version).toBe('2.0.0');
    });

    it('propagates name into manifest.name', async () => {
      setupPatchSuccess();

      await app.request('/ext/ext-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });

      const upsertArg = mockExtensionsRepo.upsert.mock.calls[0][0] as Record<string, unknown>;
      expect((upsertArg.manifest as Record<string, unknown>).name).toBe('New Name');
    });

    it('returns 400 when no valid fields provided', async () => {
      const res = await app.request('/ext/ext-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unknownField: 'value' }),
      });

      expect(res.status).toBe(400);
      expect(mockExtensionsRepo.upsert).not.toHaveBeenCalled();
    });

    it('returns 404 when extension not found in service', async () => {
      mockExtService.getById.mockReturnValue(undefined);

      const res = await app.request('/ext/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when extension belongs to different user', async () => {
      mockExtService.getById.mockReturnValue(makeExt({ userId: 'other-user' }));

      const res = await app.request('/ext/ext-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when repo record not found', async () => {
      // Service check passes, but repo lookup returns null
      mockExtensionsRepo.getById.mockReturnValue(undefined);

      const res = await app.request('/ext/ext-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // POST /:id/enable
  // =========================================================================

  describe('POST /:id/enable', () => {
    it('enables the extension', async () => {
      const res = await app.request('/ext/ext-1/enable', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(mockExtService.enable).toHaveBeenCalledWith('ext-1', USER_ID);
    });
  });

  // =========================================================================
  // POST /:id/disable
  // =========================================================================

  describe('POST /:id/disable', () => {
    it('disables the extension', async () => {
      const res = await app.request('/ext/ext-1/disable', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(mockExtService.disable).toHaveBeenCalledWith('ext-1', USER_ID);
    });
  });
});
