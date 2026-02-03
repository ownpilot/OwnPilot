/**
 * Plugins Routes Tests
 *
 * Integration tests for the plugins API endpoints.
 * Mocks the plugin registry, pluginsRepo, and configServicesRepo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const samplePlugin = {
  manifest: {
    id: 'plugin-test',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    author: { name: 'Test Author' },
    capabilities: ['tools'] as string[],
    permissions: ['network', 'storage'] as string[],
    category: 'utility',
    icon: 'wrench',
    docs: 'https://example.com/docs',
    pluginConfigSchema: [
      { name: 'apiUrl', type: 'text', label: 'API URL' },
    ],
    defaultConfig: { apiUrl: 'http://localhost' },
    requiredServices: [
      { name: 'gmail', displayName: 'Gmail', category: 'email' },
    ],
  },
  status: 'enabled' as const,
  config: {
    grantedPermissions: ['network'] as string[],
    installedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    settings: { apiUrl: 'http://localhost:3000' },
  },
  tools: new Map([
    ['search', { definition: { name: 'search', description: 'Search things', parameters: {} } }],
    ['fetch', { definition: { name: 'fetch', description: 'Fetch data', parameters: {} } }],
  ]),
  handlers: [
    { name: 'onMessage', description: 'Handle messages', priority: 1 },
  ],
  lifecycle: {
    onConfigChange: vi.fn(),
  },
};

const mockPluginRegistry = {
  getAll: vi.fn(() => [samplePlugin]),
  get: vi.fn((id: string) => (id === 'plugin-test' ? samplePlugin : null)),
  getAllTools: vi.fn(() => [
    { pluginId: 'plugin-test', definition: { name: 'search', description: 'Search things', parameters: {} } },
  ]),
  enable: vi.fn(async (id: string) => id === 'plugin-test'),
  disable: vi.fn(async (id: string) => id === 'plugin-test'),
  unregister: vi.fn(async () => true),
};

const mockPluginsRepo = {
  updateStatus: vi.fn(),
  updatePermissions: vi.fn(),
  updateSettings: vi.fn(),
};

const mockConfigServicesRepo = {
  getEntries: vi.fn(() => []),
  getByName: vi.fn(() => null),
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getDefaultPluginRegistry: vi.fn(async () => mockPluginRegistry),
  };
});

vi.mock('../db/repositories/plugins.js', () => ({
  pluginsRepo: mockPluginsRepo,
}));

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: mockConfigServicesRepo,
}));

// Import after mocks
const { pluginsRoutes } = await import('./plugins.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/plugins', pluginsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plugins Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPluginRegistry.getAll.mockReturnValue([samplePlugin]);
    mockPluginRegistry.get.mockImplementation((id: string) => (id === 'plugin-test' ? samplePlugin : null));
    mockPluginRegistry.enable.mockImplementation(async (id: string) => id === 'plugin-test');
    mockPluginRegistry.disable.mockImplementation(async (id: string) => id === 'plugin-test');
    mockConfigServicesRepo.getEntries.mockReturnValue([]);
    mockConfigServicesRepo.getByName.mockReturnValue(null);
    // Reset mutable in-memory state
    samplePlugin.config.settings = { apiUrl: 'http://localhost:3000' };
    samplePlugin.config.grantedPermissions = ['network'] as string[];
    app = createApp();
  });

  // ========================================================================
  // GET /plugins
  // ========================================================================

  describe('GET /plugins', () => {
    it('returns list of plugins', async () => {
      const res = await app.request('/plugins');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe('plugin-test');
      expect(json.data[0].toolCount).toBe(2);
    });

    it('filters by status', async () => {
      const res = await app.request('/plugins?status=disabled');
      const json = await res.json();

      expect(json.data).toHaveLength(0); // samplePlugin is enabled
    });

    it('filters by capability', async () => {
      const res = await app.request('/plugins?capability=tools');
      const json = await res.json();

      expect(json.data).toHaveLength(1);
    });
  });

  // ========================================================================
  // GET /plugins/stats
  // ========================================================================

  describe('GET /plugins/stats', () => {
    it('returns plugin statistics', async () => {
      const res = await app.request('/plugins/stats');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.total).toBe(1);
      expect(json.data.enabled).toBe(1);
      expect(json.data.totalTools).toBe(2);
      expect(json.data.totalHandlers).toBe(1);
    });
  });

  // ========================================================================
  // GET /plugins/tools
  // ========================================================================

  describe('GET /plugins/tools', () => {
    it('returns all tools from plugins', async () => {
      const res = await app.request('/plugins/tools');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].pluginId).toBe('plugin-test');
      expect(json.data[0].name).toBe('search');
    });
  });

  // ========================================================================
  // GET /plugins/meta/capabilities & /plugins/meta/permissions
  // ========================================================================

  describe('GET /plugins/meta/capabilities', () => {
    it('returns available capabilities', async () => {
      const res = await app.request('/plugins/meta/capabilities');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.tools).toBeDefined();
      expect(json.data.handlers).toBeDefined();
    });
  });

  describe('GET /plugins/meta/permissions', () => {
    it('returns available permissions', async () => {
      const res = await app.request('/plugins/meta/permissions');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.network).toBeDefined();
      expect(json.data.storage).toBeDefined();
    });
  });

  // ========================================================================
  // GET /plugins/:id
  // ========================================================================

  describe('GET /plugins/:id', () => {
    it('returns plugin details with tools and handlers', async () => {
      const res = await app.request('/plugins/plugin-test');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('plugin-test');
      expect(json.data.toolsDetailed).toHaveLength(2);
      expect(json.data.handlersInfo).toHaveLength(1);
    });

    it('returns 404 for unknown plugin', async () => {
      const res = await app.request('/plugins/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /plugins/:id/enable & disable
  // ========================================================================

  describe('POST /plugins/:id/enable', () => {
    it('enables a plugin', async () => {
      const res = await app.request('/plugins/plugin-test/enable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('enabled');
      expect(mockPluginsRepo.updateStatus).toHaveBeenCalledWith('plugin-test', 'enabled');
    });

    it('returns 404 for unknown plugin', async () => {
      const res = await app.request('/plugins/nonexistent/enable', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /plugins/:id/disable', () => {
    it('disables a plugin', async () => {
      const res = await app.request('/plugins/plugin-test/disable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('disabled');
      expect(mockPluginsRepo.updateStatus).toHaveBeenCalledWith('plugin-test', 'disabled');
    });
  });

  // ========================================================================
  // PUT /plugins/:id/config
  // ========================================================================

  describe('PUT /plugins/:id/config', () => {
    it('updates plugin configuration', async () => {
      const res = await app.request('/plugins/plugin-test/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { apiUrl: 'http://new-api.com' } }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.settings.apiUrl).toBe('http://new-api.com');
      expect(samplePlugin.lifecycle.onConfigChange).toHaveBeenCalled();
    });

    it('returns 404 for unknown plugin', async () => {
      const res = await app.request('/plugins/nonexistent/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: {} }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /plugins/:id/permissions
  // ========================================================================

  describe('POST /plugins/:id/permissions', () => {
    it('grants permissions to plugin', async () => {
      const res = await app.request('/plugins/plugin-test/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: ['network', 'storage'] }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.grantedPermissions).toEqual(['network', 'storage']);
      expect(mockPluginsRepo.updatePermissions).toHaveBeenCalled();
    });

    it('returns 400 for unrequested permission', async () => {
      const res = await app.request('/plugins/plugin-test/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: ['email'] }), // not in manifest.permissions
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /plugins/:id/settings & PUT /plugins/:id/settings
  // ========================================================================

  describe('GET /plugins/:id/settings', () => {
    it('returns plugin settings schema and values', async () => {
      const res = await app.request('/plugins/plugin-test/settings');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pluginId).toBe('plugin-test');
      expect(json.data.pluginConfigSchema).toHaveLength(1);
      expect(json.data.settings.apiUrl).toBe('http://localhost:3000');
    });

    it('returns 404 for unknown plugin', async () => {
      const res = await app.request('/plugins/nonexistent/settings');

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /plugins/:id/settings', () => {
    it('updates plugin settings', async () => {
      const res = await app.request('/plugins/plugin-test/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { apiUrl: 'http://updated.com' } }),
      });

      expect(res.status).toBe(200);
      expect(mockPluginsRepo.updateSettings).toHaveBeenCalled();
    });

    it('returns 400 when settings missing', async () => {
      const res = await app.request('/plugins/plugin-test/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /plugins/:id/required-services
  // ========================================================================

  describe('GET /plugins/:id/required-services', () => {
    it('returns required services status', async () => {
      const res = await app.request('/plugins/plugin-test/required-services');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pluginId).toBe('plugin-test');
      expect(json.data.services).toHaveLength(1);
      expect(json.data.services[0].name).toBe('gmail');
      expect(json.data.services[0].isConfigured).toBe(false);
      expect(json.data.allConfigured).toBe(false);
    });

    it('shows configured when entries exist', async () => {
      mockConfigServicesRepo.getEntries.mockReturnValue([{ id: 'entry-1' }]);
      mockConfigServicesRepo.getByName.mockReturnValue({ name: 'gmail' });

      const res = await app.request('/plugins/plugin-test/required-services');
      const json = await res.json();

      expect(json.data.services[0].isConfigured).toBe(true);
      expect(json.data.allConfigured).toBe(true);
    });
  });

  // ========================================================================
  // DELETE /plugins/:id
  // ========================================================================

  describe('DELETE /plugins/:id', () => {
    it('uninstalls a plugin', async () => {
      const res = await app.request('/plugins/plugin-test', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('uninstalled');
      expect(mockPluginRegistry.unregister).toHaveBeenCalledWith('plugin-test');
    });

    it('returns 404 for unknown plugin', async () => {
      const res = await app.request('/plugins/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });
});
