/**
 * Model Configs Routes Tests
 *
 * Integration tests for the AI model configs API endpoints.
 * Mocks modelConfigsRepo, localProvidersRepo, core provider functions, and settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockModelConfigsRepo = {
  listModels: vi.fn(async () => []),
  getDisabledModelIds: vi.fn(async () => new Set<string>()),
  getProvider: vi.fn(async () => null),
  getCustomModels: vi.fn(async () => []),
  listProviders: vi.fn(async () => []),
  upsertModel: vi.fn(async (input: Record<string, unknown>) => input),
  upsertProvider: vi.fn(async (input: Record<string, unknown>) => input),
  updateProvider: vi.fn(async (_uid: string, _pid: string, body: Record<string, unknown>) => body),
  deleteProvider: vi.fn(async () => true),
  toggleProvider: vi.fn(async () => true),
  deleteModel: vi.fn(async () => true),
  fullReset: vi.fn(async () => ({ providerConfigs: 3, modelConfigs: 10, customProviders: 2 })),
};

const mockLocalProvidersRepo = {
  listProviders: vi.fn(async () => []),
  listModels: vi.fn(async () => []),
};

vi.mock('../db/repositories/index.js', () => ({
  modelConfigsRepo: mockModelConfigsRepo,
  localProvidersRepo: mockLocalProvidersRepo,
}));

const builtinOpenai = {
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  docsUrl: 'https://platform.openai.com/docs',
  models: [
    { id: 'gpt-4', name: 'GPT-4', capabilities: ['chat'], inputPrice: 30, outputPrice: 60, contextWindow: 8192, maxOutput: 4096 },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', capabilities: ['chat'], inputPrice: 0.5, outputPrice: 1.5, contextWindow: 16384, maxOutput: 4096 },
  ],
};

const builtinAnthropic = {
  id: 'anthropic',
  name: 'Anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  docsUrl: 'https://docs.anthropic.com',
  models: [
    { id: 'claude-3-opus', name: 'Claude 3 Opus', capabilities: ['chat', 'vision'], inputPrice: 15, outputPrice: 75, contextWindow: 200000, maxOutput: 4096 },
  ],
};

const aggregatorOpenRouter = {
  id: 'openrouter',
  name: 'OpenRouter',
  type: 'openai_compatible',
  apiBase: 'https://openrouter.ai/api/v1',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  description: 'AI model aggregator',
  docsUrl: 'https://openrouter.ai/docs',
  defaultModels: [
    { id: 'meta-llama/llama-3', name: 'Llama 3', capabilities: ['chat'], pricingInput: 0.5, pricingOutput: 0.5, contextWindow: 8192, maxOutput: 4096 },
  ],
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getAllProviderConfigs: vi.fn(() => [builtinOpenai, builtinAnthropic]),
    getProviderConfig: vi.fn((id: string) => {
      if (id === 'openai') return builtinOpenai;
      if (id === 'anthropic') return builtinAnthropic;
      return null;
    }),
    getAllAggregatorProviders: vi.fn(() => [aggregatorOpenRouter]),
    getAggregatorProvider: vi.fn((id: string) => {
      if (id === 'openrouter') return aggregatorOpenRouter;
      return null;
    }),
    isAggregatorProvider: vi.fn((id: string) => id === 'openrouter'),
  };
});

vi.mock('./settings.js', () => ({
  hasApiKey: vi.fn(async (providerId: string) => providerId === 'openai'),
  getApiKey: vi.fn(async () => null),
  getConfiguredProviderIds: vi.fn(async () => new Set(['openai'])),
}));

// Import after mocks
const { modelConfigsRoutes } = await import('./model-configs.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/models', modelConfigsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Model Configs Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementations
    mockModelConfigsRepo.listModels.mockResolvedValue([]);
    mockModelConfigsRepo.getDisabledModelIds.mockResolvedValue(new Set<string>());
    mockModelConfigsRepo.getProvider.mockResolvedValue(null);
    mockModelConfigsRepo.getCustomModels.mockResolvedValue([]);
    mockModelConfigsRepo.listProviders.mockResolvedValue([]);
    mockLocalProvidersRepo.listProviders.mockResolvedValue([]);
    mockLocalProvidersRepo.listModels.mockResolvedValue([]);
    app = createApp();
  });

  // ========================================================================
  // GET /models - Merged model list
  // ========================================================================

  describe('GET /models', () => {
    it('returns merged models from all sources', async () => {
      const res = await app.request('/models');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      // Should include builtin models (openai 2 + anthropic 1 = 3)
      expect(json.data.length).toBeGreaterThanOrEqual(3);
    });

    it('includes isConfigured flag based on API key', async () => {
      const res = await app.request('/models');
      const json = await res.json();

      const openaiModel = json.data.find((m: { providerId: string }) => m.providerId === 'openai');
      const anthropicModel = json.data.find((m: { providerId: string }) => m.providerId === 'anthropic');

      expect(openaiModel.isConfigured).toBe(true);   // hasApiKey returns true for openai
      expect(anthropicModel.isConfigured).toBe(false); // hasApiKey returns false for anthropic
    });

    it('filters by provider', async () => {
      const res = await app.request('/models?provider=openai');
      const json = await res.json();

      expect(json.data.every((m: { providerId: string }) => m.providerId === 'openai')).toBe(true);
      expect(json.data.length).toBe(2);
    });

    it('filters by capability', async () => {
      const res = await app.request('/models?capability=vision');
      const json = await res.json();

      expect(json.data.every((m: { capabilities: string[] }) => m.capabilities.includes('vision'))).toBe(true);
    });

    it('includes user config overrides', async () => {
      mockModelConfigsRepo.listModels.mockResolvedValue([
        { providerId: 'openai', modelId: 'gpt-4', displayName: 'Custom GPT-4', capabilities: ['chat', 'code'], pricingInput: 25, pricingOutput: 50 },
      ]);

      const res = await app.request('/models');
      const json = await res.json();
      const gpt4 = json.data.find((m: { modelId: string }) => m.modelId === 'gpt-4');

      expect(gpt4.displayName).toBe('Custom GPT-4');
      expect(gpt4.hasOverride).toBe(true);
    });

    it('respects disabled model IDs', async () => {
      mockModelConfigsRepo.getDisabledModelIds.mockResolvedValue(new Set(['openai/gpt-4']));

      const res = await app.request('/models?enabled=true');
      const json = await res.json();

      expect(json.data.find((m: { modelId: string }) => m.modelId === 'gpt-4')).toBeUndefined();
    });

    it('includes aggregator models when user has enabled the provider', async () => {
      mockModelConfigsRepo.getProvider.mockImplementation(async (_uid: string, pid: string) => {
        if (pid === 'openrouter') return { isEnabled: true };
        return null;
      });

      const res = await app.request('/models');
      const json = await res.json();
      const llama = json.data.find((m: { modelId: string }) => m.modelId === 'meta-llama/llama-3');

      expect(llama).toBeDefined();
      expect(llama.source).toBe('aggregator');
    });

    it('includes custom models', async () => {
      mockModelConfigsRepo.getCustomModels.mockResolvedValue([
        {
          providerId: 'custom-provider',
          modelId: 'my-model',
          displayName: 'My Custom Model',
          capabilities: ['chat'],
          isEnabled: true,
        },
      ]);

      const res = await app.request('/models');
      const json = await res.json();
      const custom = json.data.find((m: { modelId: string }) => m.modelId === 'my-model');

      expect(custom).toBeDefined();
      expect(custom.source).toBe('custom');
      expect(custom.isCustom).toBe(true);
    });

    it('includes local provider models', async () => {
      mockLocalProvidersRepo.listProviders.mockResolvedValue([
        { id: 'ollama', name: 'Ollama', isEnabled: true, baseUrl: 'http://localhost:11434' },
      ]);
      mockLocalProvidersRepo.listModels.mockResolvedValue([
        { modelId: 'llama2', displayName: 'Llama 2', isEnabled: true, capabilities: ['chat'], contextWindow: 4096, maxOutput: 2048 },
      ]);

      const res = await app.request('/models');
      const json = await res.json();
      const local = json.data.find((m: { modelId: string }) => m.modelId === 'llama2');

      expect(local).toBeDefined();
      expect(local.source).toBe('local');
      expect(local.isConfigured).toBe(true);
    });
  });

  // ========================================================================
  // POST /models - Create custom model
  // ========================================================================

  describe('POST /models', () => {
    it('creates a custom model', async () => {
      mockModelConfigsRepo.upsertModel.mockResolvedValue({
        providerId: 'openai',
        modelId: 'custom-model',
        isCustom: true,
      });

      const res = await app.request('/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'openai', modelId: 'custom-model', displayName: 'Custom' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.isCustom).toBe(true);
    });

    it('returns 400 when provider or model ID missing', async () => {
      const res = await app.request('/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'openai' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // GET /models/providers/list - Merged provider list
  // ========================================================================

  describe('GET /models/providers/list', () => {
    it('returns merged providers from all sources', async () => {
      const res = await app.request('/models/providers/list');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      // Builtin (openai, anthropic) + aggregator (openrouter)
      expect(json.data.length).toBeGreaterThanOrEqual(3);
    });

    it('filters by type', async () => {
      const res = await app.request('/models/providers/list?type=builtin');
      const json = await res.json();

      expect(json.data.every((p: { type: string }) => p.type === 'builtin')).toBe(true);
    });

    it('includes custom providers', async () => {
      mockModelConfigsRepo.listProviders.mockResolvedValue([
        { providerId: 'my-local', displayName: 'My Provider', isEnabled: true, apiBaseUrl: 'http://localhost:8080' },
      ]);

      const res = await app.request('/models/providers/list');
      const json = await res.json();
      const custom = json.data.find((p: { id: string }) => p.id === 'my-local');

      expect(custom).toBeDefined();
      expect(custom.type).toBe('custom');
    });

    it('includes local providers', async () => {
      mockLocalProvidersRepo.listProviders.mockResolvedValue([
        { id: 'ollama', name: 'Ollama', isEnabled: true, baseUrl: 'http://localhost:11434' },
      ]);
      mockLocalProvidersRepo.listModels.mockResolvedValue([
        { modelId: 'llama2', isEnabled: true },
      ]);

      const res = await app.request('/models/providers/list');
      const json = await res.json();
      const local = json.data.find((p: { id: string }) => p.id === 'ollama');

      expect(local).toBeDefined();
      expect(local.type).toBe('local');
      expect(local.modelCount).toBe(1);
    });
  });

  // ========================================================================
  // GET /models/providers/available - Available providers
  // ========================================================================

  describe('GET /models/providers/available', () => {
    it('returns available providers with counts', async () => {
      const res = await app.request('/models/providers/available');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(3);
    });

    it('includes isConfigured flag based on API key', async () => {
      const res = await app.request('/models/providers/available');
      const json = await res.json();

      const openai = json.data.find((p: { id: string }) => p.id === 'openai');
      const anthropic = json.data.find((p: { id: string }) => p.id === 'anthropic');

      expect(openai.isConfigured).toBe(true);
      expect(anthropic.isConfigured).toBe(false);
    });
  });

  // ========================================================================
  // GET /models/providers/:id - Get single provider
  // ========================================================================

  describe('GET /models/providers/:id', () => {
    it('returns provider with models', async () => {
      const res = await app.request('/models/providers/openai');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('openai');
      expect(json.data.models).toBeDefined();
      expect(json.data.models.length).toBeGreaterThanOrEqual(2);
    });

    it('returns 404 for unknown provider', async () => {
      const res = await app.request('/models/providers/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /models/providers - Create custom provider
  // ========================================================================

  describe('POST /models/providers', () => {
    it('creates a custom provider', async () => {
      mockModelConfigsRepo.upsertProvider.mockResolvedValue({
        providerId: 'my-api',
        displayName: 'My API',
        isEnabled: true,
      });

      const res = await app.request('/models/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'my-api', displayName: 'My API' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 400 when required fields missing', async () => {
      const res = await app.request('/models/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'test' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // PUT /models/providers/:id - Update provider
  // ========================================================================

  describe('PUT /models/providers/:id', () => {
    it('updates an existing provider', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValue({
        providerId: 'my-api',
        displayName: 'My API',
        isEnabled: true,
      });
      mockModelConfigsRepo.updateProvider.mockResolvedValue({
        providerId: 'my-api',
        displayName: 'Updated API',
      });

      const res = await app.request('/models/providers/my-api', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated API' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('creates config for aggregator if not existing', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValue(null);

      const res = await app.request('/models/providers/openrouter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: true }),
      });

      expect(res.status).toBe(200);
      expect(mockModelConfigsRepo.upsertProvider).toHaveBeenCalled();
    });

    it('returns 404 for unknown non-aggregator provider', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValue(null);

      const res = await app.request('/models/providers/unknown', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Test' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /models/providers/:id - Delete custom provider
  // ========================================================================

  describe('DELETE /models/providers/:id', () => {
    it('deletes a custom provider', async () => {
      const res = await app.request('/models/providers/my-custom', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 400 for built-in provider', async () => {
      const res = await app.request('/models/providers/openai', { method: 'DELETE' });

      expect(res.status).toBe(400);
    });

    it('returns 404 when provider not found', async () => {
      mockModelConfigsRepo.deleteProvider.mockResolvedValue(false);

      const res = await app.request('/models/providers/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PATCH /models/providers/:id/toggle - Toggle provider enabled
  // ========================================================================

  describe('PATCH /models/providers/:id/toggle', () => {
    it('toggles built-in provider', async () => {
      const res = await app.request('/models/providers/openai/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.enabled).toBe(false);
      expect(mockModelConfigsRepo.upsertProvider).toHaveBeenCalled();
    });

    it('toggles aggregator provider', async () => {
      const res = await app.request('/models/providers/openrouter/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(200);
      expect(mockModelConfigsRepo.upsertProvider).toHaveBeenCalled();
    });

    it('toggles custom provider', async () => {
      const res = await app.request('/models/providers/my-custom/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      expect(mockModelConfigsRepo.toggleProvider).toHaveBeenCalledWith('default', 'my-custom', false);
    });

    it('returns 400 for non-boolean enabled', async () => {
      const res = await app.request('/models/providers/openai/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 'yes' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when custom provider not found', async () => {
      mockModelConfigsRepo.toggleProvider.mockResolvedValue(false);

      const res = await app.request('/models/providers/unknown-custom/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // GET /models/capabilities/list - List capabilities
  // ========================================================================

  describe('GET /models/capabilities/list', () => {
    it('returns list of capabilities', async () => {
      const res = await app.request('/models/capabilities/list');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(5);
      expect(json.data.find((c: { id: string }) => c.id === 'chat')).toBeDefined();
      expect(json.data.find((c: { id: string }) => c.id === 'vision')).toBeDefined();
    });
  });

  // ========================================================================
  // GET /models/:provider - List models for provider
  // ========================================================================

  describe('GET /models/:provider', () => {
    it('returns models for a specific provider', async () => {
      const res = await app.request('/models/openai');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.every((m: { providerId: string }) => m.providerId === 'openai')).toBe(true);
      expect(json.data.length).toBe(2);
    });

    it('returns empty list for unknown provider', async () => {
      const res = await app.request('/models/nonexistent');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.length).toBe(0);
    });
  });

  // ========================================================================
  // GET /models/:provider/:model - Get single model
  // ========================================================================

  describe('GET /models/:provider/:model', () => {
    it('returns single model', async () => {
      const res = await app.request('/models/openai/gpt-4');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.modelId).toBe('gpt-4');
      expect(json.data.providerId).toBe('openai');
    });

    it('returns 404 for unknown model', async () => {
      const res = await app.request('/models/openai/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PUT /models/:provider/:model - Update model config
  // ========================================================================

  describe('PUT /models/:provider/:model', () => {
    it('updates model config', async () => {
      mockModelConfigsRepo.upsertModel.mockResolvedValue({
        providerId: 'openai',
        modelId: 'gpt-4',
        displayName: 'Custom GPT-4',
      });

      const res = await app.request('/models/openai/gpt-4', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Custom GPT-4' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 404 for unknown model', async () => {
      const res = await app.request('/models/openai/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Test' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /models/:provider/:model - Delete model
  // ========================================================================

  describe('DELETE /models/:provider/:model', () => {
    it('deletes a custom model', async () => {
      mockModelConfigsRepo.getCustomModels.mockResolvedValue([
        { providerId: 'custom', modelId: 'my-model', isEnabled: true, isCustom: true, capabilities: ['chat'] },
      ]);

      // Need the model to be in custom source to avoid "cannot delete builtin" error
      // Since getCustomModels returns it, it will appear as source=custom
      // But we also need it to not appear in builtin list, so use a different provider
      const res = await app.request('/models/custom/my-model', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('returns 404 for unknown model', async () => {
      const res = await app.request('/models/unknown/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });

    it('returns 400 for builtin model without override', async () => {
      // gpt-4 is builtin and has no override (listModels returns empty)
      const res = await app.request('/models/openai/gpt-4', { method: 'DELETE' });

      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // PATCH /models/:provider/:model/toggle - Toggle model enabled
  // ========================================================================

  describe('PATCH /models/:provider/:model/toggle', () => {
    it('toggles model enabled state', async () => {
      const res = await app.request('/models/openai/gpt-4/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.enabled).toBe(false);
      expect(mockModelConfigsRepo.upsertModel).toHaveBeenCalled();
    });

    it('returns 400 for non-boolean enabled', async () => {
      const res = await app.request('/models/openai/gpt-4/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 'yes' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown model', async () => {
      const res = await app.request('/models/openai/nonexistent/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(404);
    });
  });
});
