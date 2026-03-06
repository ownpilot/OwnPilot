/**
 * Skills Routes Tests
 *
 * Integration tests for:
 *   GET /search          — npm skill search
 *   GET /featured        — top npm packages (empty query)
 *   POST /install-npm    — install from npm
 *   GET /permissions     — list all available permissions
 *   GET /permissions/:id — get extension permissions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSearch = vi.fn();
const mockInstall = vi.fn();
const mockGetPackageInfo = vi.fn();
const mockCheckForUpdate = vi.fn(async () => ({ hasUpdate: false, latestVersion: '1.0.0' }));

vi.mock('../services/skill-npm-installer.js', () => ({
  getNpmInstaller: vi.fn(() => ({
    search: mockSearch,
    install: mockInstall,
    getPackageInfo: mockGetPackageInfo,
    checkForUpdate: mockCheckForUpdate,
  })),
}));

const mockExtService = {
  install: vi.fn(),
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
  getAll: vi.fn(() => []),
  getById: vi.fn(),
  updateSettings: vi.fn(),
};

vi.mock('../db/repositories/extensions.js', () => ({
  extensionsRepo: mockExtensionsRepo,
}));

vi.mock('../services/extension-permissions.js', () => ({
  getAllPermissions: vi.fn(() => ['network', 'filesystem']),
  getPermissionDescription: vi.fn((p: string) => `${p} access`),
  getPermissionSensitivity: vi.fn(() => 'medium'),
}));

const { skillsRoutes } = await import('./skills.js');

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
  app.route('/skills', skillsRoutes);
  app.onError(errorHandler);
  return app;
}

const sampleResults = {
  packages: [
    { name: 'ownpilot-pdf-skill', version: '1.0.0', description: 'PDF processing' },
    { name: 'ownpilot-web-skill', version: '2.0.0', description: 'Web browsing' },
  ],
  total: 2,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Skills Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue(sampleResults);
    mockCheckForUpdate.mockResolvedValue({ hasUpdate: false, latestVersion: '1.0.0' });
    app = createApp();
  });

  // =========================================================================
  // GET /search
  // =========================================================================

  describe('GET /search', () => {
    it('returns search results', async () => {
      const res = await app.request('/skills/search?q=pdf');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.packages).toHaveLength(2);
      expect(mockSearch).toHaveBeenCalledWith('pdf', 20);
    });

    it('passes limit query parameter (capped at 50)', async () => {
      await app.request('/skills/search?q=test&limit=10');
      expect(mockSearch).toHaveBeenCalledWith('test', 10);
    });

    it('caps limit at 50', async () => {
      await app.request('/skills/search?q=test&limit=999');
      expect(mockSearch).toHaveBeenCalledWith('test', 50);
    });

    it('uses empty string when q is omitted', async () => {
      await app.request('/skills/search');
      expect(mockSearch).toHaveBeenCalledWith('', 20);
    });

    it('returns 500 when search throws', async () => {
      mockSearch.mockRejectedValue(new Error('npm registry unreachable'));
      const res = await app.request('/skills/search?q=pdf');
      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // GET /featured
  // =========================================================================

  describe('GET /featured', () => {
    it('returns featured packages (always searches with empty query)', async () => {
      const res = await app.request('/skills/featured');

      expect(res.status).toBe(200);
      expect(mockSearch).toHaveBeenCalledWith('', 20);
    });

    it('respects limit param', async () => {
      await app.request('/skills/featured?limit=5');
      expect(mockSearch).toHaveBeenCalledWith('', 5);
    });

    it('caps limit at 50', async () => {
      await app.request('/skills/featured?limit=100');
      expect(mockSearch).toHaveBeenCalledWith('', 50);
    });

    it('returns 500 when search throws', async () => {
      mockSearch.mockRejectedValue(new Error('network error'));
      const res = await app.request('/skills/featured');
      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // POST /install-npm
  // =========================================================================

  describe('POST /install-npm', () => {
    it('installs a package successfully', async () => {
      mockInstall.mockResolvedValue({ success: true, id: 'ext-abc', name: 'ownpilot-pdf-skill' });

      const res = await app.request('/skills/install-npm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: 'ownpilot-pdf-skill' }),
      });

      expect(res.status).toBe(201);
      expect(mockInstall).toHaveBeenCalledWith('ownpilot-pdf-skill', USER_ID, mockExtService);
    });

    it('returns 400 when packageName is missing', async () => {
      const res = await app.request('/skills/install-npm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      expect(mockInstall).not.toHaveBeenCalled();
    });

    it('returns 500 when install fails', async () => {
      mockInstall.mockResolvedValue({ success: false, error: 'Package not found' });

      const res = await app.request('/skills/install-npm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: 'nonexistent-skill' }),
      });

      expect(res.status).toBe(500);
    });

    it('returns 500 when installer throws', async () => {
      mockInstall.mockRejectedValue(new Error('network timeout'));

      const res = await app.request('/skills/install-npm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: 'some-skill' }),
      });

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // GET /permissions
  // =========================================================================

  describe('GET /permissions', () => {
    it('returns all available permissions', async () => {
      const res = await app.request('/skills/permissions');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.permissions).toHaveLength(2);
      expect(json.data.permissions[0].name).toBe('network');
      expect(json.data.permissions[0].description).toBe('network access');
    });
  });

  // =========================================================================
  // GET /permissions/:id
  // =========================================================================

  describe('GET /permissions/:id', () => {
    const makeExtRecord = (overrides: Record<string, unknown> = {}) => ({
      id: 'ext-1',
      userId: USER_ID,
      manifest: { permissions: { required: ['network'], optional: [] } },
      settings: { grantedPermissions: ['network'] },
      ...overrides,
    });

    it('returns declared and granted permissions', async () => {
      mockExtensionsRepo.getById.mockReturnValue(makeExtRecord());

      const res = await app.request('/skills/permissions/ext-1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.declared.required).toContain('network');
      expect(json.data.granted).toContain('network');
    });

    it('returns 404 when extension not found', async () => {
      mockExtensionsRepo.getById.mockReturnValue(undefined);

      const res = await app.request('/skills/permissions/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 404 when extension belongs to different user', async () => {
      mockExtensionsRepo.getById.mockReturnValue(makeExtRecord({ userId: 'other-user' }));

      const res = await app.request('/skills/permissions/ext-1');
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // GET /npm/:name
  // =========================================================================

  describe('GET /npm/:name', () => {
    it('returns package info for given name', async () => {
      mockGetPackageInfo.mockResolvedValueOnce({
        name: '@agentskills/weather',
        version: '1.2.0',
        description: 'Weather skill',
      });

      const res = await app.request('/skills/npm/%40agentskills%2Fweather');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.name).toBe('@agentskills/weather');
    });

    it('returns 500 when getPackageInfo throws', async () => {
      mockGetPackageInfo.mockRejectedValueOnce(new Error('not found'));
      const res = await app.request('/skills/npm/bad-pkg');
      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // POST /permissions/:id
  // =========================================================================

  describe('POST /permissions/:id', () => {
    const makeExtRecord = (overrides: Record<string, unknown> = {}) => ({
      id: 'ext-1',
      userId: USER_ID,
      manifest: {},
      settings: {},
      ...overrides,
    });

    it('stores granted permissions and returns them', async () => {
      mockExtensionsRepo.getById.mockReturnValue(makeExtRecord());
      mockExtensionsRepo.updateSettings.mockResolvedValue(undefined);

      const res = await app.request('/skills/permissions/ext-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantedPermissions: ['network', 'filesystem'] }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.grantedPermissions).toEqual(['network', 'filesystem']);
      expect(mockExtensionsRepo.updateSettings).toHaveBeenCalledWith(
        'ext-1',
        expect.objectContaining({ grantedPermissions: ['network', 'filesystem'] })
      );
    });

    it('returns 400 when grantedPermissions is not an array', async () => {
      mockExtensionsRepo.getById.mockReturnValue(makeExtRecord());

      const res = await app.request('/skills/permissions/ext-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantedPermissions: 'network' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when extension not found', async () => {
      mockExtensionsRepo.getById.mockReturnValue(undefined);

      const res = await app.request('/skills/permissions/ext-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantedPermissions: [] }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when extension belongs to different user', async () => {
      mockExtensionsRepo.getById.mockReturnValue(makeExtRecord({ userId: 'other-user' }));

      const res = await app.request('/skills/permissions/ext-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantedPermissions: [] }),
      });

      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // POST /check-updates
  // =========================================================================

  describe('POST /check-updates', () => {
    const makeExtWithNpm = (overrides: Record<string, unknown> = {}) => ({
      id: 'ext-npm',
      userId: USER_ID,
      name: 'My Skill',
      manifest: { npm_package: 'ownpilot-pdf-skill', npm_version: '1.0.0' },
      settings: {},
      ...overrides,
    });

    it('returns empty updates when no extensions match', async () => {
      mockExtensionsRepo.getAll.mockReturnValue([]);

      const res = await app.request('/skills/check-updates', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.updates).toEqual([]);
    });

    it('returns empty updates when extensions have no npm fields', async () => {
      mockExtensionsRepo.getAll.mockReturnValue([
        { id: 'ext-1', userId: USER_ID, name: 'Local Skill', manifest: {}, settings: {} },
      ]);

      const res = await app.request('/skills/check-updates', { method: 'POST' });
      const json = await res.json();
      expect(json.data.updates).toEqual([]);
      expect(mockCheckForUpdate).not.toHaveBeenCalled();
    });

    it('returns updates when hasUpdate is true', async () => {
      mockExtensionsRepo.getAll.mockReturnValue([makeExtWithNpm()]);
      mockCheckForUpdate.mockResolvedValueOnce({ hasUpdate: true, latestVersion: '2.0.0' });

      const res = await app.request('/skills/check-updates', { method: 'POST' });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.updates).toHaveLength(1);
      expect(json.data.updates[0]).toMatchObject({
        id: 'ext-npm',
        name: 'My Skill',
        current: '1.0.0',
        latest: '2.0.0',
      });
    });

    it('skips extensions with no update', async () => {
      mockExtensionsRepo.getAll.mockReturnValue([makeExtWithNpm()]);
      mockCheckForUpdate.mockResolvedValueOnce({ hasUpdate: false, latestVersion: '1.0.0' });

      const res = await app.request('/skills/check-updates', { method: 'POST' });
      const json = await res.json();
      expect(json.data.updates).toHaveLength(0);
    });

    it('reads npm_package/npm_version from settings fallback', async () => {
      mockExtensionsRepo.getAll.mockReturnValue([
        {
          id: 'ext-2',
          userId: USER_ID,
          name: 'Fallback Skill',
          manifest: {},
          settings: { npmPackage: 'pkg-b', npmVersion: '0.5.0' },
        },
      ]);
      mockCheckForUpdate.mockResolvedValueOnce({ hasUpdate: true, latestVersion: '1.0.0' });

      const res = await app.request('/skills/check-updates', { method: 'POST' });
      const json = await res.json();
      expect(json.data.updates).toHaveLength(1);
      expect(mockCheckForUpdate).toHaveBeenCalledWith('pkg-b', '0.5.0');
    });

    it('returns 500 when check throws', async () => {
      mockExtensionsRepo.getAll.mockReturnValue([makeExtWithNpm()]);
      mockCheckForUpdate.mockRejectedValueOnce(new Error('registry timeout'));

      const res = await app.request('/skills/check-updates', { method: 'POST' });
      expect(res.status).toBe(500);
    });

    it('filters out extensions from other users', async () => {
      mockExtensionsRepo.getAll.mockReturnValue([makeExtWithNpm({ userId: 'other-user' })]);
      mockCheckForUpdate.mockResolvedValue({ hasUpdate: true, latestVersion: '9.9.9' });

      const res = await app.request('/skills/check-updates', { method: 'POST' });
      const json = await res.json();
      expect(json.data.updates).toHaveLength(0);
      expect(mockCheckForUpdate).not.toHaveBeenCalled();
    });
  });
});
