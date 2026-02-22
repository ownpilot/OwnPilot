/**
 * Extensions Routes Tests
 *
 * Integration tests for the extensions API endpoints.
 * Mocks the ExtensionService, validateManifest, AI provider, and settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleManifest = {
  id: 'test-ext',
  name: 'Test Extension',
  version: '1.0.0',
  description: 'A test extension',
  category: 'utilities',
  icon: '🔧',
  author: { name: 'Test Author' },
  tags: ['test'],
  tools: [
    {
      name: 'test_tool',
      description: 'A test tool',
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
      code: 'return { content: { result: args.input } };',
    },
  ],
  keywords: ['test'],
};

const sampleRecord = {
  id: 'test-ext',
  userId: 'default',
  name: 'Test Extension',
  version: '1.0.0',
  description: 'A test extension',
  category: 'utilities',
  icon: '🔧',
  authorName: 'Test Author',
  manifest: sampleManifest,
  status: 'enabled' as const,
  sourcePath: '/path/to/extension.json',
  settings: {},
  toolCount: 1,
  triggerCount: 0,
  installedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockService = {
  getAll: vi.fn(() => [sampleRecord]),
  getById: vi.fn((id: string) => (id === 'test-ext' ? sampleRecord : null)),
  installFromManifest: vi.fn(async () => sampleRecord),
  install: vi.fn(async () => sampleRecord),
  uninstall: vi.fn(async (id: string) => id === 'test-ext'),
  enable: vi.fn(async (id: string) =>
    id === 'test-ext' ? { ...sampleRecord, status: 'enabled' } : null
  ),
  disable: vi.fn(async (id: string) =>
    id === 'test-ext' ? { ...sampleRecord, status: 'disabled' } : null
  ),
  reload: vi.fn(async (id: string) => (id === 'test-ext' ? sampleRecord : null)),
  scanDirectory: vi.fn(async () => ({ installed: 2, errors: [] })),
};

const mockComplete = vi.fn();

vi.mock('../services/extension-service.js', () => ({
  getExtensionService: () => mockService,
  ExtensionError: class ExtensionError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = 'ExtensionError';
    }
  },
}));

vi.mock('../services/extension-types.js', () => ({
  validateManifest: vi.fn(() => ({ valid: true, errors: [] })),
}));

vi.mock('@ownpilot/core', () => ({
  createProvider: vi.fn(() => ({ complete: mockComplete })),
  getProviderConfig: vi.fn(() => null),
  getLog: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('./settings.js', () => ({
  resolveProviderAndModel: vi.fn(async () => ({ provider: 'openai', model: 'gpt-4' })),
  getApiKey: vi.fn(async () => 'test-key'),
}));

vi.mock('../db/repositories/index.js', () => ({
  localProvidersRepo: {
    getProvider: vi.fn(async () => null),
  },
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

// Import after mocks
const { extensionsRoutes } = await import('./extensions.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp(userId = 'default') {
  const app = new Hono();
  // Set userId in context before routes (simulates auth middleware)
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    return next();
  });
  app.route('/extensions', extensionsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Extensions Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService.getAll.mockReturnValue([sampleRecord]);
    mockService.getById.mockImplementation((id: string) =>
      id === 'test-ext' ? sampleRecord : null
    );
    mockService.installFromManifest.mockResolvedValue(sampleRecord);
    mockService.install.mockResolvedValue(sampleRecord);
    mockService.uninstall.mockImplementation(async (id: string) => id === 'test-ext');
    mockService.enable.mockImplementation(async (id: string) =>
      id === 'test-ext' ? { ...sampleRecord, status: 'enabled' } : null
    );
    mockService.disable.mockImplementation(async (id: string) =>
      id === 'test-ext' ? { ...sampleRecord, status: 'disabled' } : null
    );
    mockService.reload.mockImplementation(async (id: string) =>
      id === 'test-ext' ? sampleRecord : null
    );
    mockService.scanDirectory.mockResolvedValue({ installed: 2, errors: [] });
    app = createApp();
  });

  // ========================================================================
  // GET / - List
  // ========================================================================

  describe('GET /extensions', () => {
    it('returns all packages', async () => {
      const res = await app.request('/extensions');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.packages).toHaveLength(1);
      expect(json.data.packages[0].id).toBe('test-ext');
      expect(json.data.total).toBe(1);
    });

    it('filters by status', async () => {
      const res = await app.request('/extensions?status=disabled');
      const json = await res.json();

      expect(json.data.packages).toHaveLength(0);
      expect(json.data.total).toBe(0);
    });

    it('filters by category', async () => {
      const res = await app.request('/extensions?category=utilities');
      const json = await res.json();

      expect(json.data.packages).toHaveLength(1);
    });

    it('filters by non-matching category', async () => {
      const res = await app.request('/extensions?category=developer');
      const json = await res.json();

      expect(json.data.packages).toHaveLength(0);
    });
  });

  // ========================================================================
  // POST / - Install from inline manifest
  // ========================================================================

  describe('POST /extensions', () => {
    it('installs from inline manifest', async () => {
      const res = await app.request('/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: sampleManifest }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.package.id).toBe('test-ext');
      expect(json.data.message).toContain('installed');
      expect(mockService.installFromManifest).toHaveBeenCalled();
    });

    it('returns 400 when manifest is missing', async () => {
      const res = await app.request('/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('returns 400 for invalid body', async () => {
      const res = await app.request('/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when service throws ExtensionError', async () => {
      const { ExtensionError } = await import('../services/extension-service.js');
      mockService.installFromManifest.mockRejectedValue(
        new ExtensionError('Invalid', 'VALIDATION_ERROR')
      );

      const res = await app.request('/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: sampleManifest }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 for unexpected errors', async () => {
      mockService.installFromManifest.mockRejectedValue(new Error('DB down'));

      const res = await app.request('/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: sampleManifest }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /install - Install from path
  // ========================================================================

  describe('POST /extensions/install', () => {
    it('installs from file path', async () => {
      const res = await app.request('/extensions/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/path/to/extension.json' }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.package.id).toBe('test-ext');
      expect(mockService.install).toHaveBeenCalledWith('/path/to/extension.json', 'default');
    });

    it('returns 400 when path is missing', async () => {
      const res = await app.request('/extensions/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when path is not a string', async () => {
      const res = await app.request('/extensions/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 123 }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // POST /scan - Scan directory
  // ========================================================================

  describe('POST /extensions/scan', () => {
    it('scans default directory', async () => {
      const res = await app.request('/extensions/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.installed).toBe(2);
      expect(json.data.errors).toHaveLength(0);
    });

    it('scans custom directory', async () => {
      const res = await app.request('/extensions/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: '/custom/dir' }),
      });

      expect(res.status).toBe(200);
      expect(mockService.scanDirectory).toHaveBeenCalledWith('/custom/dir', 'default');
    });

    it('returns 500 on scan failure', async () => {
      mockService.scanDirectory.mockRejectedValue(new Error('Permission denied'));

      const res = await app.request('/extensions/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /generate - AI generation
  // ========================================================================

  describe('POST /extensions/generate', () => {
    it('generates manifest from description', async () => {
      const generatedManifest = JSON.stringify(sampleManifest);
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: generatedManifest },
      });

      const res = await app.request('/extensions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a math helper extension' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.manifest).toBeDefined();
      expect(json.data.validation).toBeDefined();
    });

    it('handles markdown code blocks in AI response', async () => {
      const generatedManifest = '```json\n' + JSON.stringify(sampleManifest) + '\n```';
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: generatedManifest },
      });

      const res = await app.request('/extensions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a math helper extension' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.manifest.id).toBe('test-ext');
    });

    it('returns 400 when description is missing', async () => {
      const res = await app.request('/extensions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for empty description', async () => {
      const res = await app.request('/extensions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: '   ' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 when AI returns invalid JSON', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: 'not valid json at all' },
      });

      const res = await app.request('/extensions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create something' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('invalid JSON');
    });

    it('returns 500 when AI returns empty response', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: '' },
      });

      const res = await app.request('/extensions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create something' }),
      });

      expect(res.status).toBe(500);
    });

    it('returns 500 when AI call fails', async () => {
      mockComplete.mockResolvedValue({
        ok: false,
        error: { message: 'Rate limit exceeded' },
      });

      const res = await app.request('/extensions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create something' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('AI generation failed');
    });

    it('returns 400 when no provider configured', async () => {
      const { resolveProviderAndModel } = await import('./settings.js');
      vi.mocked(resolveProviderAndModel).mockResolvedValueOnce({ provider: '', model: '' });

      const res = await app.request('/extensions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create something' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('provider');
    });

    it('returns 400 when API key not configured', async () => {
      const { getApiKey } = await import('./settings.js');
      vi.mocked(getApiKey).mockResolvedValueOnce(undefined as unknown as string);

      const res = await app.request('/extensions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create something' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /:id - Get by ID
  // ========================================================================

  describe('GET /extensions/:id', () => {
    it('returns package details', async () => {
      const res = await app.request('/extensions/test-ext');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.package.id).toBe('test-ext');
      expect(json.data.package.name).toBe('Test Extension');
    });

    it('returns 404 for unknown package', async () => {
      const res = await app.request('/extensions/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /:id - Uninstall
  // ========================================================================

  describe('DELETE /extensions/:id', () => {
    it('uninstalls a package', async () => {
      const res = await app.request('/extensions/test-ext', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('uninstalled');
      expect(mockService.uninstall).toHaveBeenCalledWith('test-ext', 'default');
    });

    it('returns 404 for unknown package', async () => {
      const res = await app.request('/extensions/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /:id/enable
  // ========================================================================

  describe('POST /extensions/:id/enable', () => {
    it('enables a package', async () => {
      const res = await app.request('/extensions/test-ext/enable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.package.status).toBe('enabled');
      expect(json.data.message).toContain('enabled');
    });

    it('returns 404 for unknown package', async () => {
      const res = await app.request('/extensions/nonexistent/enable', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('returns 500 when enable throws', async () => {
      mockService.enable.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/extensions/test-ext/enable', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /:id/disable
  // ========================================================================

  describe('POST /extensions/:id/disable', () => {
    it('disables a package', async () => {
      const res = await app.request('/extensions/test-ext/disable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.package.status).toBe('disabled');
      expect(json.data.message).toContain('disabled');
    });

    it('returns 404 for unknown package', async () => {
      const res = await app.request('/extensions/nonexistent/disable', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('returns 500 when disable throws', async () => {
      mockService.disable.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/extensions/test-ext/disable', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /:id/reload
  // ========================================================================

  describe('POST /extensions/:id/reload', () => {
    it('reloads a package from disk', async () => {
      const res = await app.request('/extensions/test-ext/reload', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.package.id).toBe('test-ext');
      expect(json.data.message).toContain('reloaded');
    });

    it('returns 404 for unknown package', async () => {
      const res = await app.request('/extensions/nonexistent/reload', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('returns 400 for ExtensionError', async () => {
      const { ExtensionError } = await import('../services/extension-service.js');
      mockService.reload.mockRejectedValue(new ExtensionError('No source path', 'IO_ERROR'));

      const res = await app.request('/extensions/test-ext/reload', { method: 'POST' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('source path');
    });

    it('returns 500 for unexpected errors', async () => {
      mockService.reload.mockRejectedValue(new Error('FS error'));

      const res = await app.request('/extensions/test-ext/reload', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // Multi-tenant isolation
  // ========================================================================

  describe('Multi-tenant isolation', () => {
    it('GET / only returns extensions belonging to the requesting user', async () => {
      const otherUserRecord = { ...sampleRecord, id: 'other-ext', userId: 'user-2' };
      mockService.getAll.mockReturnValue([sampleRecord, otherUserRecord]);

      // Default user should only see their own extension
      const res = await app.request('/extensions');
      const json = await res.json();
      expect(json.data.packages).toHaveLength(1);
      expect(json.data.packages[0].id).toBe('test-ext');
      expect(json.data.total).toBe(1);
    });

    it('GET / as different user sees only their extensions', async () => {
      const otherUserRecord = { ...sampleRecord, id: 'other-ext', userId: 'user-2' };
      mockService.getAll.mockReturnValue([sampleRecord, otherUserRecord]);

      const user2App = createApp('user-2');
      const res = await user2App.request('/extensions');
      const json = await res.json();
      expect(json.data.packages).toHaveLength(1);
      expect(json.data.packages[0].id).toBe('other-ext');
    });

    it("GET /:id returns 404 for another user's extension", async () => {
      const user2App = createApp('user-2');
      const res = await user2App.request('/extensions/test-ext');
      expect(res.status).toBe(404);
    });

    it('GET /:id returns 200 for own extension', async () => {
      const res = await app.request('/extensions/test-ext');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.package.id).toBe('test-ext');
    });
  });
});
