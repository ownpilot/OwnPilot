/**
 * Settings Routes Tests
 *
 * Integration tests for the settings API endpoints.
 * Mocks settingsRepo, localProvidersRepo, and core utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSettingsRepo = {
  get: vi.fn(),
  set: vi.fn(),
  has: vi.fn(),
  delete: vi.fn(),
  getByPrefix: vi.fn(async () => []),
};

const mockLocalProvidersRepo = {
  listProviders: vi.fn(async () => []),
  getProvider: vi.fn(),
  getDefault: vi.fn(),
};

vi.mock('../db/repositories/index.js', () => ({
  settingsRepo: null as unknown, // replaced in beforeEach
  localProvidersRepo: null as unknown,
}));

// Patch mock objects onto the module
import * as repoModule from '../db/repositories/index.js';
(repoModule as Record<string, unknown>).settingsRepo = mockSettingsRepo;
(repoModule as Record<string, unknown>).localProvidersRepo = mockLocalProvidersRepo;

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getAvailableProviders: vi.fn(() => [
      { id: 'openai', name: 'OpenAI' },
      { id: 'anthropic', name: 'Anthropic' },
    ]),
    getDefaultModelForProvider: vi.fn(() => ({ id: 'gpt-4' })),
    DEFAULT_SANDBOX_SETTINGS: {
      enabled: false,
      basePath: '/tmp/sandbox',
      defaultMemoryMB: 512,
      defaultCpuCores: 1,
      defaultTimeoutMs: 30000,
      defaultNetwork: 'none',
      maxWorkspacesPerUser: 5,
      maxStoragePerUserGB: 10,
      allowedImages: [],
      pythonImage: 'python:3.11',
      nodeImage: 'node:20',
      shellImage: 'ubuntu:22.04',
    },
    isDockerAvailable: vi.fn(async () => true),
  };
});

vi.mock('../paths/index.js', () => ({
  getDataDirectoryInfo: vi.fn(() => ({
    root: '/data',
    database: '/data/db',
    workspace: '/data/workspace',
    credentials: '/data/credentials',
    platform: 'linux',
    isDefaultLocation: true,
  })),
}));

vi.mock('../paths/migration.js', () => ({
  getMigrationStatus: vi.fn(() => ({
    needsMigration: false,
    legacyPath: null,
    legacyFiles: [],
  })),
}));

// Import after mocks
const { settingsRoutes } = await import('./settings.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/settings', settingsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Settings Routes', () => {
  let app: Hono;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  afterEach(() => {
    // Restore env vars that tests may have modified
    process.env = { ...originalEnv };
  });

  // ========================================================================
  // GET /settings
  // ========================================================================

  describe('GET /settings', () => {
    it('returns settings overview', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValue([{ key: 'api_key:openai', value: 'sk-xxx' }]);
      mockLocalProvidersRepo.listProviders.mockResolvedValue([
        { id: 'ollama', name: 'Ollama', isEnabled: true },
      ]);
      mockSettingsRepo.get
        .mockResolvedValueOnce('openai') // default provider
        .mockResolvedValueOnce('gpt-4'); // default model

      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.configuredProviders).toContain('openai');
      expect(json.data.configuredProviders).toContain('ollama');
      expect(json.data.demoMode).toBe(false);
      expect(json.data.availableProviders).toHaveLength(2);
    });

    it('returns demoMode false when only local provider is enabled', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValue([]);
      mockLocalProvidersRepo.listProviders.mockResolvedValue([{ id: 'ollama', isEnabled: true }]);
      mockSettingsRepo.get.mockResolvedValue(null);

      const res = await app.request('/settings');
      const body = await res.json();
      expect(body.data.demoMode).toBe(false);
    });

    it('returns demoMode true when no providers configured', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValue([]);
      mockLocalProvidersRepo.listProviders.mockResolvedValue([]);
      mockSettingsRepo.get.mockResolvedValue(null);

      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.demoMode).toBe(true);
    });
  });

  // ========================================================================
  // GET /settings/data-info
  // ========================================================================

  describe('GET /settings/data-info', () => {
    it('returns data directory information', async () => {
      const res = await app.request('/settings/data-info');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.dataDirectory).toBe('/data');
      expect(json.data.migration.needsMigration).toBe(false);
    });
  });

  // ========================================================================
  // POST /settings/default-provider
  // ========================================================================

  describe('POST /settings/default-provider', () => {
    it('sets default provider', async () => {
      const res = await app.request('/settings/default-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.defaultProvider).toBe('anthropic');
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('default_ai_provider', 'anthropic');
    });

    it('returns 400 when provider is missing', async () => {
      const res = await app.request('/settings/default-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when provider name is too long', async () => {
      const res = await app.request('/settings/default-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'a'.repeat(65) }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('too long');
    });
  });

  // ========================================================================
  // POST /settings/default-model
  // ========================================================================

  describe('POST /settings/default-model', () => {
    it('sets default model', async () => {
      const res = await app.request('/settings/default-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-3-opus' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.defaultModel).toBe('claude-3-opus');
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('default_ai_model', 'claude-3-opus');
    });

    it('returns 400 when model is missing', async () => {
      const res = await app.request('/settings/default-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // POST /settings/api-keys
  // ========================================================================

  describe('POST /settings/api-keys', () => {
    it('stores API key and sets env var', async () => {
      const res = await app.request('/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', apiKey: 'sk-test123' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.provider).toBe('openai');
      expect(json.data.configured).toBe(true);
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:openai', 'sk-test123');
      expect(process.env.OPENAI_API_KEY).toBe('sk-test123');
    });

    it('returns 400 when provider or apiKey is missing', async () => {
      const res = await app.request('/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // DELETE /settings/api-keys/:provider
  // ========================================================================

  describe('DELETE /settings/api-keys/:provider', () => {
    it('removes API key and env var', async () => {
      process.env.OPENAI_API_KEY = 'sk-old';

      const res = await app.request('/settings/api-keys/openai', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.provider).toBe('openai');
      expect(json.data.configured).toBe(false);
      expect(mockSettingsRepo.delete).toHaveBeenCalledWith('api_key:openai');
      expect(process.env.OPENAI_API_KEY).toBeUndefined();
    });
  });

  // ========================================================================
  // GET /settings/sandbox
  // ========================================================================

  describe('GET /settings/sandbox', () => {
    it('returns sandbox settings with Docker status', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValue([]);

      const res = await app.request('/settings/sandbox');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.dockerAvailable).toBe(true);
      expect(json.data.settings).toBeDefined();
      expect(json.data.status).toBeDefined();
    });
  });

  // ========================================================================
  // POST /settings/sandbox
  // ========================================================================

  describe('POST /settings/sandbox', () => {
    it('updates sandbox settings', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValue([]);

      const res = await app.request('/settings/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, defaultMemoryMB: 1024 }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.updated).toContain('enabled');
      expect(json.data.updated).toContain('defaultMemoryMB');
    });

    it('returns 400 for invalid value type', async () => {
      const res = await app.request('/settings/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 'not-a-boolean' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_VALUE');
    });
  });

  // ========================================================================
  // POST /settings/sandbox/enable & disable
  // ========================================================================

  describe('POST /settings/sandbox/enable', () => {
    it('enables sandbox when Docker is available', async () => {
      const res = await app.request('/settings/sandbox/enable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.enabled).toBe(true);
    });

    it('returns 400 when Docker is unavailable', async () => {
      const { isDockerAvailable } = await import('@ownpilot/core');
      vi.mocked(isDockerAvailable).mockResolvedValueOnce(false);

      const res = await app.request('/settings/sandbox/enable', { method: 'POST' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('DOCKER_UNAVAILABLE');
    });
  });

  describe('POST /settings/sandbox/disable', () => {
    it('disables sandbox', async () => {
      const res = await app.request('/settings/sandbox/disable', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.enabled).toBe(false);
    });
  });

  describe('POST /settings/sandbox', () => {
    it('updates sandbox settings', async () => {
      const res = await app.request('/settings/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          defaultMemoryMB: 1024,
          defaultTimeoutMs: 60000,
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.updated).toContain('enabled');
      expect(json.data.updated).toContain('defaultMemoryMB');
      expect(json.data.updated).toContain('defaultTimeoutMs');
    });

    it('returns 400 for invalid defaultNetwork value', async () => {
      const res = await app.request('/settings/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultNetwork: 'invalid-network',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('defaultNetwork must be one of');
    });

    it('returns 400 for invalid allowedImages type', async () => {
      const res = await app.request('/settings/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowedImages: 'not-an-array',
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('must be an array');
    });

    it('ignores invalid sandbox setting keys', async () => {
      const res = await app.request('/settings/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invalidKey: 'some-value',
          enabled: true,
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.updated).not.toContain('invalidKey');
      expect(json.data.updated).toContain('enabled');
    });
  });

  describe('Utility Functions', () => {
    it('should test hasApiKey', async () => {
      const { hasApiKey } = await import('./settings.js');
      mockSettingsRepo.has.mockResolvedValueOnce(true);

      const result = await hasApiKey('openai');

      expect(result).toBe(true);
      expect(mockSettingsRepo.has).toHaveBeenCalledWith('api_key:openai');
    });

    it('should test getApiKey', async () => {
      const { getApiKey } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce('secret-key');

      const result = await getApiKey('anthropic');

      expect(result).toBe('secret-key');
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('api_key:anthropic');
    });

    it('should test getConfiguredProviderIds', async () => {
      const { getConfiguredProviderIds } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        { key: 'api_key:openai', value: 'key1' },
        { key: 'api_key:anthropic', value: 'key2' },
      ]);

      const result = await getConfiguredProviderIds();

      expect(result).toContain('openai');
      expect(result).toContain('anthropic');
    });

    it('should test loadApiKeysToEnvironment', async () => {
      const { loadApiKeysToEnvironment } = await import('./settings.js');
      const originalEnv = process.env.OPENAI_API_KEY;

      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        { key: 'api_key:openai', value: 'loaded-key' },
      ]);

      await loadApiKeysToEnvironment();

      expect(process.env.OPENAI_API_KEY).toBe('loaded-key');
      process.env.OPENAI_API_KEY = originalEnv;
    });
  });
});
