/**
 * Models Routes Tests
 *
 * Integration tests for the models API endpoints.
 * Mocks core provider config functions, hasApiKey, modelConfigsRepo, and localProvidersRepo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const sampleProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  docsUrl: 'https://platform.openai.com/docs',
  features: ['chat', 'streaming', 'tools'],
  models: [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
      maxOutput: 4096,
      inputPrice: 5.0,
      outputPrice: 15.0,
      capabilities: ['chat', 'vision', 'tools'],
      default: true,
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      contextWindow: 128000,
      maxOutput: 4096,
      inputPrice: 0.15,
      outputPrice: 0.6,
      capabilities: ['chat', 'tools'],
      default: false,
    },
  ],
};

const sampleProviderConfig2 = {
  id: 'anthropic',
  name: 'Anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  docsUrl: 'https://docs.anthropic.com',
  features: ['chat', 'streaming'],
  models: [
    {
      id: 'claude-3-opus',
      name: 'Claude 3 Opus',
      contextWindow: 200000,
      maxOutput: 4096,
      inputPrice: 15.0,
      outputPrice: 75.0,
      capabilities: ['chat', 'vision'],
      default: true,
    },
  ],
};

const mockModelConfigsRepo = {
  getDisabledModelIds: vi.fn(async () => new Set<string>()),
};

const mockLocalProvidersRepo = {
  listProviders: vi.fn(async () => []),
  listModels: vi.fn(async () => []),
};

vi.mock('./settings.js', () => ({
  hasApiKey: vi.fn(async (provider: string) => provider === 'openai'),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getAllProviderConfigs: vi.fn(() => [sampleProviderConfig, sampleProviderConfig2]),
    getProviderConfig: vi.fn((id: string) => {
      if (id === 'openai') return sampleProviderConfig;
      if (id === 'anthropic') return sampleProviderConfig2;
      return null;
    }),
    getAvailableProviders: vi.fn(() => ['openai', 'anthropic']),
    syncAllProviders: vi.fn(async () => ({
      synced: ['openai', 'anthropic'],
      failed: [],
      total: 2,
    })),
    syncProviders: vi.fn(async (ids: string[]) => ({
      synced: ids.filter((id) => id !== 'unknown'),
      failed: [],
      notFound: ids.filter((id) => id === 'unknown'),
      total: ids.length,
    })),
    listModelsDevProviders: vi.fn(async () => [
      { id: 'openai', name: 'OpenAI', models: 10 },
      { id: 'anthropic', name: 'Anthropic', models: 5 },
    ]),
    clearConfigCache: vi.fn(),
  };
});

vi.mock('../db/repositories/model-configs.js', () => ({
  modelConfigsRepo: mockModelConfigsRepo,
}));

vi.mock('../db/repositories/index.js', () => ({
  localProvidersRepo: mockLocalProvidersRepo,
}));

// Import after mocks
const { modelsRoutes } = await import('./models.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/models', modelsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Models Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockModelConfigsRepo.getDisabledModelIds.mockResolvedValue(new Set<string>());
    mockLocalProvidersRepo.listProviders.mockResolvedValue([]);
    mockLocalProvidersRepo.listModels.mockResolvedValue([]);
    app = createApp();
  });

  // ========================================================================
  // GET /models
  // ========================================================================

  describe('GET /models', () => {
    it('returns models from configured providers only', async () => {
      const res = await app.request('/models');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      // Only openai has API key; anthropic does not
      expect(json.data.models).toHaveLength(2);
      expect(json.data.models[0].provider).toBe('openai');
      expect(json.data.configuredProviders).toContain('openai');
      expect(json.data.configuredProviders).not.toContain('anthropic');
      expect(json.data.availableProviders).toContain('openai');
      expect(json.data.availableProviders).toContain('anthropic');
    });

    it('filters out disabled models when enabledOnly is true (default)', async () => {
      mockModelConfigsRepo.getDisabledModelIds.mockResolvedValue(new Set(['openai/gpt-4o-mini']));

      const res = await app.request('/models');
      const json = await res.json();

      expect(json.data.models).toHaveLength(1);
      expect(json.data.models[0].id).toBe('gpt-4o');
    });

    it('includes all models when enabledOnly=false', async () => {
      mockModelConfigsRepo.getDisabledModelIds.mockResolvedValue(new Set(['openai/gpt-4o-mini']));

      const res = await app.request('/models?enabledOnly=false');
      const json = await res.json();

      // All openai models included regardless of disabled state
      expect(json.data.models).toHaveLength(2);
    });

    it('includes models from local providers', async () => {
      mockLocalProvidersRepo.listProviders.mockResolvedValue([{ id: 'lmstudio', isEnabled: true }]);
      mockLocalProvidersRepo.listModels.mockResolvedValue([
        {
          modelId: 'llama-3',
          displayName: 'Llama 3',
          isEnabled: true,
          contextWindow: 32768,
          maxOutput: 4096,
          capabilities: ['chat', 'streaming'],
        },
      ]);

      const res = await app.request('/models');
      const json = await res.json();

      // 2 from openai + 1 from lmstudio
      expect(json.data.models).toHaveLength(3);
      expect(json.data.configuredProviders).toContain('lmstudio');
      const localModel = json.data.models.find((m: { id: string }) => m.id === 'llama-3');
      expect(localModel).toBeDefined();
      expect(localModel.provider).toBe('lmstudio');
    });

    it('skips disabled local providers', async () => {
      mockLocalProvidersRepo.listProviders.mockResolvedValue([{ id: 'ollama', isEnabled: false }]);

      const res = await app.request('/models');
      const json = await res.json();

      // Only openai models
      expect(json.data.models).toHaveLength(2);
      expect(json.data.configuredProviders).not.toContain('ollama');
    });
  });

  // ========================================================================
  // GET /models/catalog/all
  // ========================================================================

  describe('GET /models/catalog/all', () => {
    it('returns full catalog without API key check', async () => {
      const res = await app.request('/models/catalog/all');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.openai).toHaveLength(2);
      expect(json.data.anthropic).toHaveLength(1);
    });
  });

  // ========================================================================
  // GET /models/sync/providers
  // ========================================================================

  describe('GET /models/sync/providers', () => {
    it('returns available providers from models.dev', async () => {
      const res = await app.request('/models/sync/providers');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.providers).toHaveLength(2);
      expect(json.data.total).toBe(2);
      expect(json.data.source).toContain('models.dev');
    });

    it('returns 500 on fetch error', async () => {
      const core = await import('@ownpilot/core');
      (core.listModelsDevProviders as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error')
      );

      const res = await app.request('/models/sync/providers');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('FETCH_ERROR');
    });
  });

  // ========================================================================
  // POST /models/sync
  // ========================================================================

  describe('POST /models/sync', () => {
    it('syncs all providers when no providers specified', async () => {
      const res = await app.request('/models/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.synced).toContain('openai');
      expect(json.data.synced).toContain('anthropic');
      expect(json.data.message).toContain('Synced 2 provider(s)');
    });

    it('syncs specific providers', async () => {
      const res = await app.request('/models/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: ['openai'] }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.synced).toContain('openai');
    });

    it('reports not-found providers', async () => {
      const res = await app.request('/models/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: ['openai', 'unknown'] }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.synced).toContain('openai');
      expect(json.data.notFound).toContain('unknown');
    });

    it('returns 500 on sync error', async () => {
      const core = await import('@ownpilot/core');
      (core.syncAllProviders as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Sync failed')
      );

      const res = await app.request('/models/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('SYNC_ERROR');
    });
  });

  // ========================================================================
  // GET /models/:provider
  // ========================================================================

  describe('GET /models/:provider', () => {
    it('returns models for a known provider', async () => {
      const res = await app.request('/models/openai');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.provider).toBe('openai');
      expect(json.data.models).toHaveLength(2);
      expect(json.data.providerName).toBe('OpenAI');
      expect(json.data.features).toContain('chat');
    });

    it('returns 404 for unknown provider', async () => {
      const res = await app.request('/models/nonexistent');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('UNKNOWN_PROVIDER');
    });
  });
});
