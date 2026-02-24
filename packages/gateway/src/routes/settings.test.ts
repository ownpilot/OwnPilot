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

    it('getApiKey returns undefined when no key exists', async () => {
      const { getApiKey } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce(null);

      const result = await getApiKey('unknown');

      expect(result).toBeUndefined();
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

    it('loadApiKeysToEnvironment skips providers with empty sanitized name', async () => {
      const { loadApiKeysToEnvironment } = await import('./settings.js');

      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        { key: 'api_key:!!!', value: 'key-for-weird-provider' },
      ]);

      await loadApiKeysToEnvironment();

      // !!!  sanitized = '' -> should be skipped
      // No env var should be set for empty sanitized name
    });
  });

  // ========================================================================
  // getDefaultProvider
  // ========================================================================

  describe('getDefaultProvider', () => {
    it('returns saved provider if it has an API key', async () => {
      const { getDefaultProvider } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce('openai');
      mockLocalProvidersRepo.getProvider.mockResolvedValueOnce(null);
      mockSettingsRepo.has.mockResolvedValueOnce(true); // hasApiKey

      const result = await getDefaultProvider();

      expect(result).toBe('openai');
    });

    it('returns saved provider if it is a local enabled provider', async () => {
      const { getDefaultProvider } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce('ollama');
      mockLocalProvidersRepo.getProvider.mockResolvedValueOnce({ id: 'ollama', isEnabled: true });

      const result = await getDefaultProvider();

      expect(result).toBe('ollama');
    });

    it('falls back to default local provider', async () => {
      const { getDefaultProvider } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce(null); // no saved provider
      mockLocalProvidersRepo.getDefault.mockResolvedValueOnce({
        id: 'ollama-local',
        isEnabled: true,
      });

      const result = await getDefaultProvider();

      expect(result).toBe('ollama-local');
    });

    it('falls back to first configured remote provider', async () => {
      const { getDefaultProvider } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce(null);
      mockLocalProvidersRepo.getDefault.mockResolvedValueOnce(null);
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        { key: 'api_key:anthropic', value: 'sk-xxx' },
      ]);

      const result = await getDefaultProvider();

      expect(result).toBe('anthropic');
    });

    it('returns null when no providers configured', async () => {
      const { getDefaultProvider } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce(null);
      mockLocalProvidersRepo.getDefault.mockResolvedValueOnce(null);
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([]);

      const result = await getDefaultProvider();

      expect(result).toBeNull();
    });

    it('skips saved provider when disabled local and no API key', async () => {
      const { getDefaultProvider } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce('ollama');
      mockLocalProvidersRepo.getProvider.mockResolvedValueOnce({ id: 'ollama', isEnabled: false });
      mockSettingsRepo.has.mockResolvedValueOnce(false); // no API key
      mockLocalProvidersRepo.getDefault.mockResolvedValueOnce(null);
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([]);

      const result = await getDefaultProvider();

      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // setDefaultProvider / setDefaultModel
  // ========================================================================

  describe('setDefaultProvider', () => {
    it('sets the provider in settings repo', async () => {
      const { setDefaultProvider } = await import('./settings.js');
      await setDefaultProvider('anthropic');

      expect(mockSettingsRepo.set).toHaveBeenCalledWith('default_ai_provider', 'anthropic');
    });
  });

  describe('setDefaultModel', () => {
    it('sets the model in settings repo', async () => {
      const { setDefaultModel } = await import('./settings.js');
      await setDefaultModel('gpt-4o');

      expect(mockSettingsRepo.set).toHaveBeenCalledWith('default_ai_model', 'gpt-4o');
    });
  });

  // ========================================================================
  // getDefaultModel
  // ========================================================================

  describe('getDefaultModel', () => {
    it('returns saved model when present', async () => {
      const { getDefaultModel } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce('claude-3-opus');

      const result = await getDefaultModel();

      expect(result).toBe('claude-3-opus');
    });

    it('falls back to provider default when no saved model', async () => {
      const { getDefaultModel } = await import('./settings.js');
      mockSettingsRepo.get
        .mockResolvedValueOnce(null) // no saved model
        .mockResolvedValueOnce('openai'); // default provider lookup
      mockLocalProvidersRepo.getProvider.mockResolvedValueOnce(null);
      mockSettingsRepo.has.mockResolvedValueOnce(true); // hasApiKey

      const result = await getDefaultModel();

      expect(result).toBe('gpt-4'); // from mock getDefaultModelForProvider
    });

    it('returns null when no provider and no saved model', async () => {
      const { getDefaultModel } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce(null); // no saved model
      // getDefaultProvider returns null:
      mockSettingsRepo.get.mockResolvedValueOnce(null);
      mockLocalProvidersRepo.getDefault.mockResolvedValueOnce(null);
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([]);

      const result = await getDefaultModel();

      expect(result).toBeNull();
    });

    it('uses explicit provider parameter', async () => {
      const { getDefaultModel } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce(null); // no saved model

      const result = await getDefaultModel('anthropic');

      expect(result).toBe('gpt-4'); // from the mock getDefaultModelForProvider
    });
  });

  // ========================================================================
  // resolveProviderAndModel
  // ========================================================================

  describe('resolveProviderAndModel', () => {
    it('resolves "default" provider and model', async () => {
      const { resolveProviderAndModel } = await import('./settings.js');
      // getDefaultProvider:
      mockSettingsRepo.get.mockResolvedValueOnce('openai');
      mockLocalProvidersRepo.getProvider.mockResolvedValueOnce(null);
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      // getDefaultModel:
      mockSettingsRepo.get.mockResolvedValueOnce('gpt-4o');

      const result = await resolveProviderAndModel('default', 'default');

      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
    });

    it('passes through non-default values', async () => {
      const { resolveProviderAndModel } = await import('./settings.js');

      const result = await resolveProviderAndModel('anthropic', 'claude-3');

      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-3');
    });
  });

  // ========================================================================
  // isDemoModeFromSettings
  // ========================================================================

  describe('isDemoModeFromSettings', () => {
    it('returns false when API keys exist', async () => {
      const { isDemoModeFromSettings } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([{ key: 'api_key:openai', value: 'key' }]);

      const result = await isDemoModeFromSettings();

      expect(result).toBe(false);
    });

    it('returns false when local providers are enabled', async () => {
      const { isDemoModeFromSettings } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([]);
      mockLocalProvidersRepo.listProviders.mockResolvedValueOnce([
        { id: 'ollama', isEnabled: true },
      ]);

      const result = await isDemoModeFromSettings();

      expect(result).toBe(false);
    });

    it('returns true when nothing is configured', async () => {
      const { isDemoModeFromSettings } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([]);
      mockLocalProvidersRepo.listProviders.mockResolvedValueOnce([]);

      const result = await isDemoModeFromSettings();

      expect(result).toBe(true);
    });

    it('returns true when only disabled local providers exist', async () => {
      const { isDemoModeFromSettings } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([]);
      mockLocalProvidersRepo.listProviders.mockResolvedValueOnce([
        { id: 'ollama', isEnabled: false },
      ]);

      const result = await isDemoModeFromSettings();

      expect(result).toBe(true);
    });
  });

  // ========================================================================
  // getApiKeySource
  // ========================================================================

  describe('getApiKeySource', () => {
    it('returns "database" when key exists', async () => {
      const { getApiKeySource } = await import('./settings.js');
      mockSettingsRepo.has.mockResolvedValueOnce(true);

      const result = await getApiKeySource('openai');

      expect(result).toBe('database');
    });

    it('returns null when key does not exist', async () => {
      const { getApiKeySource } = await import('./settings.js');
      mockSettingsRepo.has.mockResolvedValueOnce(false);

      const result = await getApiKeySource('unknown');

      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // Sandbox settings utility functions
  // ========================================================================

  describe('getSandboxSettings', () => {
    it('returns defaults when no saved settings', async () => {
      const { getSandboxSettings } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([]);

      const settings = await getSandboxSettings();

      expect(settings.enabled).toBe(false);
      expect(settings.defaultMemoryMB).toBe(512);
    });

    it('overrides boolean settings from saved values', async () => {
      const { getSandboxSettings } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        { key: 'sandbox:enabled', value: 'true' },
      ]);

      const settings = await getSandboxSettings();

      expect(settings.enabled).toBe(true);
    });

    it('overrides number settings from saved values', async () => {
      const { getSandboxSettings } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        { key: 'sandbox:defaultMemoryMB', value: '1024' },
      ]);

      const settings = await getSandboxSettings();

      expect(settings.defaultMemoryMB).toBe(1024);
    });

    it('overrides string settings from saved values', async () => {
      const { getSandboxSettings } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        { key: 'sandbox:pythonImage', value: 'python:3.12' },
      ]);

      const settings = await getSandboxSettings();

      expect(settings.pythonImage).toBe('python:3.12');
    });

    it('overrides array settings from saved JSON', async () => {
      const { getSandboxSettings } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        { key: 'sandbox:allowedImages', value: '["ubuntu:22.04","python:3.11"]' },
      ]);

      const settings = await getSandboxSettings();

      expect(settings.allowedImages).toEqual(['ubuntu:22.04', 'python:3.11']);
    });

    it('keeps default for invalid JSON in array settings', async () => {
      const { getSandboxSettings } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        { key: 'sandbox:allowedImages', value: 'not-json' },
      ]);

      const settings = await getSandboxSettings();

      expect(settings.allowedImages).toEqual([]); // default
    });

    it('keeps default for non-array JSON in array settings', async () => {
      const { getSandboxSettings } = await import('./settings.js');
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        { key: 'sandbox:allowedImages', value: '"just-a-string"' },
      ]);

      const settings = await getSandboxSettings();

      expect(settings.allowedImages).toEqual([]);
    });
  });

  describe('setSandboxSetting', () => {
    it('stores array values as JSON', async () => {
      const { setSandboxSetting } = await import('./settings.js');
      await setSandboxSetting('allowedImages', ['ubuntu:22.04']);

      expect(mockSettingsRepo.set).toHaveBeenCalledWith(
        'sandbox:allowedImages',
        '["ubuntu:22.04"]'
      );
    });

    it('stores non-array values as strings', async () => {
      const { setSandboxSetting } = await import('./settings.js');
      await setSandboxSetting('enabled', true);

      expect(mockSettingsRepo.set).toHaveBeenCalledWith('sandbox:enabled', 'true');
    });
  });

  describe('isSandboxEnabled', () => {
    it('returns true when enabled setting is "true"', async () => {
      const { isSandboxEnabled } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce('true');

      const result = await isSandboxEnabled();

      expect(result).toBe(true);
    });

    it('returns false when enabled setting is not "true"', async () => {
      const { isSandboxEnabled } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce('false');

      const result = await isSandboxEnabled();

      expect(result).toBe(false);
    });

    it('returns false when enabled setting is null', async () => {
      const { isSandboxEnabled } = await import('./settings.js');
      mockSettingsRepo.get.mockResolvedValueOnce(null);

      const result = await isSandboxEnabled();

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // POST /settings/default-model — model name too long
  // ========================================================================

  describe('POST /settings/default-model - validation', () => {
    it('returns 400 when model name is too long', async () => {
      const res = await app.request('/settings/default-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'a'.repeat(129) }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('too long');
    });
  });

  // ========================================================================
  // POST /settings/api-keys — validation
  // ========================================================================

  describe('POST /settings/api-keys - validation', () => {
    it('returns 400 when provider name is too long', async () => {
      const res = await app.request('/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'x'.repeat(65), apiKey: 'key' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('too long');
    });
  });

  // ========================================================================
  // POST /settings/sandbox — number validation
  // ========================================================================

  describe('POST /settings/sandbox - numeric validation', () => {
    it('returns 400 for non-number numeric fields', async () => {
      const res = await app.request('/settings/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultMemoryMB: 'not-a-number' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('must be a number');
    });

    it('returns 500 when getSandboxSettings throws', async () => {
      // Make the GET endpoint fail by having getByPrefix throw
      mockSettingsRepo.getByPrefix.mockRejectedValueOnce(new Error('DB error'));

      const res = await app.request('/settings/sandbox');

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /settings/sandbox/enable — error path
  // ========================================================================

  describe('POST /settings/sandbox/enable - error', () => {
    it('returns 500 when setSandboxSetting throws', async () => {
      mockSettingsRepo.set.mockRejectedValueOnce(new Error('DB write error'));

      const res = await app.request('/settings/sandbox/enable', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /settings/sandbox/disable — error path
  // ========================================================================

  describe('POST /settings/sandbox/disable - error', () => {
    it('returns 500 when setSandboxSetting throws', async () => {
      mockSettingsRepo.set.mockRejectedValueOnce(new Error('DB write error'));

      const res = await app.request('/settings/sandbox/disable', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // POST /settings/sandbox — error path
  // ========================================================================

  describe('POST /settings/sandbox - error', () => {
    it('returns 500 when internal error occurs', async () => {
      mockSettingsRepo.set.mockRejectedValueOnce(new Error('DB fail'));

      const res = await app.request('/settings/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ========================================================================
  // GET /settings/sandbox — status message paths
  // ========================================================================

  describe('GET /settings/sandbox - status messages', () => {
    it('shows disabled message when sandbox is disabled but docker available', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValue([]);

      const res = await app.request('/settings/sandbox');
      const json = await res.json();

      expect(json.data.status.message).toContain('disabled');
    });

    it('shows enabled+ready message when sandbox is enabled', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValue([{ key: 'sandbox:enabled', value: 'true' }]);

      const res = await app.request('/settings/sandbox');
      const json = await res.json();

      expect(json.data.status.enabled).toBe(true);
      expect(json.data.status.ready).toBe(true);
      expect(json.data.status.message).toContain('enabled and ready');
    });

    it('shows docker unavailable message', async () => {
      const { isDockerAvailable } = await import('@ownpilot/core');
      vi.mocked(isDockerAvailable).mockResolvedValueOnce(false);
      mockSettingsRepo.getByPrefix.mockResolvedValue([]);

      const res = await app.request('/settings/sandbox');
      const json = await res.json();

      expect(json.data.status.message).toContain('Docker is not available');
      expect(json.data.status.ready).toBe(false);
    });
  });

  // ========================================================================
  // Tool Groups routes
  // ========================================================================

  describe('GET /settings/tool-groups', () => {
    it('returns tool groups with default enabled state', async () => {
      mockSettingsRepo.get.mockReturnValue(null); // no saved groups -> uses defaults

      const res = await app.request('/settings/tool-groups');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.groups).toBeInstanceOf(Array);
      expect(json.data.enabledGroupIds).toBeInstanceOf(Array);
    });
  });

  describe('PUT /settings/tool-groups', () => {
    it('returns 400 when enabledGroupIds is not an array', async () => {
      const res = await app.request('/settings/tool-groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledGroupIds: 'not-an-array' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for unknown tool group IDs', async () => {
      const res = await app.request('/settings/tool-groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledGroupIds: ['nonexistent_group_xyz'] }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Unknown tool group');
    });
  });

  // ========================================================================
  // getEnabledToolGroupIds
  // ========================================================================

  describe('getEnabledToolGroupIds', () => {
    it('returns saved groups when available', async () => {
      const { getEnabledToolGroupIds } = await import('./settings.js');
      mockSettingsRepo.get.mockReturnValue(['core', 'memory']);

      const result = getEnabledToolGroupIds();

      expect(result).toEqual(['core', 'memory']);
    });

    it('returns defaults when no saved groups', async () => {
      const { getEnabledToolGroupIds } = await import('./settings.js');
      mockSettingsRepo.get.mockReturnValue(null);

      const result = getEnabledToolGroupIds();

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
