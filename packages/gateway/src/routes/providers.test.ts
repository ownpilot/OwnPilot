/**
 * Providers Routes Tests
 *
 * Integration tests for the providers API endpoints.
 * Mocks core provider config, model configs repo, local providers repo, and settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockModelConfigsRepo = {
  listUserProviderConfigs: vi.fn(async () => []),
  getUserProviderConfig: vi.fn(async () => null),
  upsertUserProviderConfig: vi.fn(),
  deleteUserProviderConfig: vi.fn(async () => true),
  toggleUserProviderConfig: vi.fn(),
};

const mockLocalProvidersRepo = {
  listProviders: vi.fn(async () => []),
  listModels: vi.fn(async () => []),
};

vi.mock('../db/repositories/model-configs.js', () => ({
  modelConfigsRepo: mockModelConfigsRepo,
}));

vi.mock('../db/repositories/index.js', () => ({
  localProvidersRepo: mockLocalProvidersRepo,
}));

vi.mock('./settings.js', () => ({
  hasApiKey: vi.fn(async () => false),
  getApiKeySource: vi.fn(async () => null),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    loadProviderConfig: vi.fn((id: string) => {
      if (id === 'openai') {
        return {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
          docsUrl: 'https://platform.openai.com/docs',
          features: {
            streaming: true,
            toolUse: true,
            vision: true,
            jsonMode: true,
            systemMessage: true,
          },
          models: [
            { id: 'gpt-4', name: 'GPT-4', capabilities: ['chat'] },
            { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', capabilities: ['chat'] },
          ],
        };
      }
      if (id === 'anthropic') {
        return {
          id: 'anthropic',
          name: 'Anthropic',
          type: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKeyEnv: 'ANTHROPIC_API_KEY',
          docsUrl: 'https://docs.anthropic.com',
          features: {
            streaming: true,
            toolUse: true,
            vision: true,
            jsonMode: false,
            systemMessage: true,
          },
          models: [{ id: 'claude-3-opus', name: 'Claude 3 Opus', capabilities: ['chat'] }],
        };
      }
      return null;
    }),
    PROVIDER_IDS: ['openai', 'anthropic'],
  };
});

// Import after mocks
const { providersRoutes } = await import('./providers.js');
const { getApiKeySource, hasApiKey: _hasApiKey } = await import('./settings.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/providers', providersRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Providers Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // GET /providers
  // ========================================================================

  describe('GET /providers', () => {
    it('returns list of providers with categories', async () => {
      const res = await app.request('/providers');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.providers).toBeDefined();
      expect(json.data.categories).toBeDefined();
      expect(json.data.total).toBeGreaterThanOrEqual(2);
    });

    it('includes configured status from API key source', async () => {
      vi.mocked(getApiKeySource).mockResolvedValue('database');

      const res = await app.request('/providers');
      const json = await res.json();
      const openai = json.data.providers.find((p: { id: string }) => p.id === 'openai');

      expect(openai.isConfigured).toBe(true);
      expect(openai.configSource).toBe('database');
    });

    it('includes local providers', async () => {
      mockLocalProvidersRepo.listProviders.mockResolvedValue([
        {
          id: 'ollama-local',
          name: 'Ollama',
          isEnabled: true,
          baseUrl: 'http://localhost:11434',
          providerType: 'ollama',
        },
      ]);
      mockLocalProvidersRepo.listModels.mockResolvedValue([
        { modelId: 'llama2', displayName: 'Llama 2', isEnabled: true },
      ]);

      const res = await app.request('/providers');
      const json = await res.json();
      const ollama = json.data.providers.find((p: { id: string }) => p.id === 'ollama-local');

      expect(ollama).toBeDefined();
      expect(ollama.type).toBe('local');
      expect(ollama.modelCount).toBe(1);
    });

    it('includes user override data', async () => {
      mockModelConfigsRepo.listUserProviderConfigs.mockResolvedValue([
        {
          providerId: 'openai',
          baseUrl: 'https://custom.api/v1',
          isEnabled: true,
          providerType: 'openai',
        },
      ]);

      const res = await app.request('/providers');
      const json = await res.json();
      const openai = json.data.providers.find((p: { id: string }) => p.id === 'openai');

      expect(openai.hasOverride).toBe(true);
      expect(openai.baseUrl).toBe('https://custom.api/v1');
    });
  });

  // ========================================================================
  // GET /providers/categories
  // ========================================================================

  describe('GET /providers/categories', () => {
    it('returns provider categories', async () => {
      const res = await app.request('/providers/categories');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.categories).toBeDefined();
    });
  });

  // ========================================================================
  // GET /providers/:id
  // ========================================================================

  describe('GET /providers/:id', () => {
    it('returns provider config', async () => {
      const res = await app.request('/providers/openai');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('openai');
      expect(json.data.name).toBe('OpenAI');
    });

    it('returns 404 for unknown provider', async () => {
      const res = await app.request('/providers/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('PROVIDER_NOT_FOUND');
    });

    it('includes user override details', async () => {
      mockModelConfigsRepo.getUserProviderConfig.mockResolvedValue({
        baseUrl: 'https://custom.api/v1',
        providerType: 'openai',
        isEnabled: true,
        apiKeyEnv: 'CUSTOM_KEY',
        notes: 'Custom endpoint',
      });

      const res = await app.request('/providers/openai');
      const json = await res.json();

      expect(json.data.hasOverride).toBe(true);
      expect(json.data.userOverride).toBeDefined();
      expect(json.data.userOverride.baseUrl).toBe('https://custom.api/v1');
    });
  });

  // ========================================================================
  // GET /providers/:id/models
  // ========================================================================

  describe('GET /providers/:id/models', () => {
    it('returns models for a provider', async () => {
      const res = await app.request('/providers/openai/models');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.provider).toBe('openai');
      expect(json.data.models).toHaveLength(2);
    });

    it('returns 404 for unknown provider', async () => {
      const res = await app.request('/providers/nonexistent/models');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /providers/:id/config
  // ========================================================================

  describe('GET /providers/:id/config', () => {
    it('returns base and effective config', async () => {
      mockModelConfigsRepo.getUserProviderConfig.mockResolvedValue(null);

      const res = await app.request('/providers/openai/config');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.providerId).toBe('openai');
      expect(json.data.baseConfig).toBeDefined();
      expect(json.data.effectiveConfig).toBeDefined();
      expect(json.data.userOverride).toBeNull();
    });

    it('returns 404 for unknown provider', async () => {
      const res = await app.request('/providers/nonexistent/config');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PUT /providers/:id/config
  // ========================================================================

  describe('PUT /providers/:id/config', () => {
    it('updates provider config override', async () => {
      mockModelConfigsRepo.upsertUserProviderConfig.mockResolvedValue({
        baseUrl: 'https://custom.api/v1',
        providerType: 'openai',
        isEnabled: true,
        apiKeyEnv: null,
        notes: null,
      });

      const res = await app.request('/providers/openai/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: 'https://custom.api/v1' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.userOverride.baseUrl).toBe('https://custom.api/v1');
    });

    it('returns 404 for unknown provider', async () => {
      const res = await app.request('/providers/nonexistent/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: 'https://custom.api/v1' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /providers/:id/config
  // ========================================================================

  describe('DELETE /providers/:id/config', () => {
    it('deletes provider config override', async () => {
      const res = await app.request('/providers/openai/config', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.providerId).toBe('openai');
      expect(json.data.deleted).toBe(true);
    });
  });

  // ========================================================================
  // PATCH /providers/:id/toggle
  // ========================================================================

  describe('PATCH /providers/:id/toggle', () => {
    it('toggles provider enabled state', async () => {
      mockModelConfigsRepo.getUserProviderConfig.mockResolvedValue({ isEnabled: false });

      const res = await app.request('/providers/openai/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.isEnabled).toBe(false);
    });

    it('returns 404 for unknown provider', async () => {
      const res = await app.request('/providers/nonexistent/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 for non-boolean enabled', async () => {
      const res = await app.request('/providers/openai/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 'yes' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /providers/overrides/all
  // ========================================================================

  describe('GET /providers/overrides/all', () => {
    it('returns all user overrides', async () => {
      mockModelConfigsRepo.listUserProviderConfigs.mockResolvedValue([
        { providerId: 'openai', baseUrl: 'https://custom/v1', isEnabled: true },
      ]);

      const res = await app.request('/providers/overrides/all');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.overrides).toHaveLength(1);
      expect(json.data.total).toBe(1);
    });
  });
});
