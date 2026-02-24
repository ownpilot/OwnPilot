/**
 * Provider Routes Tests
 *
 * Integration tests for the model provider API endpoints.
 * Covers the remaining uncovered lines: POST /providers/:id/discover-models,
 * plus edge cases for POST /providers, PUT /providers/:id, DELETE /providers/:id,
 * and PATCH /providers/:id/toggle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

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
  upsertProvider: vi.fn(async (input: Record<string, unknown>) => ({ id: 'test', ...input })),
  updateProvider: vi.fn(async (_uid: string, _pid: string, body: Record<string, unknown>) => body),
  deleteProvider: vi.fn(async () => true),
  toggleProvider: vi.fn(async () => true),
};

const mockLocalProvidersRepo = {
  listProviders: vi.fn(async () => []),
  listModels: vi.fn(async () => []),
};

vi.mock('../../db/repositories/index.js', () => ({
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
    {
      id: 'gpt-4',
      name: 'GPT-4',
      capabilities: ['chat'],
      inputPrice: 30,
      outputPrice: 60,
      contextWindow: 8192,
      maxOutput: 4096,
    },
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
    {
      id: 'meta-llama/llama-3',
      name: 'Llama 3',
      capabilities: ['chat'],
      pricingInput: 0.5,
      pricingOutput: 0.5,
      contextWindow: 8192,
      maxOutput: 4096,
    },
  ],
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getAllProviderConfigs: vi.fn(() => [builtinOpenai]),
    getProviderConfig: vi.fn((id: string) => (id === 'openai' ? builtinOpenai : null)),
    getAllAggregatorProviders: vi.fn(() => [aggregatorOpenRouter]),
    getAggregatorProvider: vi.fn((id: string) =>
      id === 'openrouter' ? aggregatorOpenRouter : null
    ),
    isAggregatorProvider: vi.fn((id: string) => id === 'openrouter'),
  };
});

const mockHasApiKey = vi.fn(async (providerId: string) => providerId === 'openai');
const mockGetApiKey = vi.fn(async () => 'test-api-key');

vi.mock('../settings.js', () => ({
  hasApiKey: (...args: unknown[]) => mockHasApiKey(...(args as [string])),
  getApiKey: (...args: unknown[]) => mockGetApiKey(...(args as [string])),
  getConfiguredProviderIds: vi.fn(async () => new Set(['openai'])),
}));

const mockBroadcast = vi.fn();
vi.mock('../../ws/server.js', () => ({
  wsGateway: { broadcast: mockBroadcast },
}));

// Import after mocks
const { providerRoutes } = await import('./providers.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/prov', providerRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Provider Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
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
  // POST /providers - Create provider (error paths)
  // ========================================================================

  describe('POST /prov/providers', () => {
    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/prov/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when providerId is missing', async () => {
      const res = await app.request('/prov/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Test' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 when displayName is missing', async () => {
      const res = await app.request('/prov/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'test' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 500 when upsertProvider throws', async () => {
      mockModelConfigsRepo.upsertProvider.mockRejectedValueOnce(new Error('DB error'));

      const res = await app.request('/prov/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'my-api', displayName: 'My API' }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('CREATE_FAILED');
    });

    it('creates a provider and broadcasts event', async () => {
      mockModelConfigsRepo.upsertProvider.mockResolvedValueOnce({
        id: 'p1',
        providerId: 'my-api',
        displayName: 'My API',
      });

      const res = await app.request('/prov/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'my-api', displayName: 'My API' }),
      });
      expect(res.status).toBe(200);
      expect(mockBroadcast).toHaveBeenCalledWith(
        'data:changed',
        expect.objectContaining({ entity: 'model_provider', action: 'created' })
      );
    });
  });

  // ========================================================================
  // PUT /providers/:id - Update provider (error paths)
  // ========================================================================

  describe('PUT /prov/providers/:id', () => {
    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/prov/providers/test', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad json',
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 500 when updateProvider throws', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'test',
        displayName: 'Test',
        isEnabled: true,
      });
      mockModelConfigsRepo.updateProvider.mockRejectedValueOnce(new Error('DB error'));

      const res = await app.request('/prov/providers/test', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated' }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('UPDATE_FAILED');
    });

    it('creates config for aggregator with custom fields', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce(null);
      mockModelConfigsRepo.upsertProvider.mockResolvedValueOnce({
        providerId: 'openrouter',
        isEnabled: true,
      });

      const res = await app.request('/prov/providers/openrouter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'My Router',
          apiBaseUrl: 'https://custom.url',
          isEnabled: true,
        }),
      });
      expect(res.status).toBe(200);
      expect(mockModelConfigsRepo.upsertProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'openrouter',
          displayName: 'My Router',
          apiBaseUrl: 'https://custom.url',
        })
      );
    });

    it('uses aggregator defaults when update body omits fields', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce(null);
      mockModelConfigsRepo.upsertProvider.mockResolvedValueOnce({ providerId: 'openrouter' });

      const res = await app.request('/prov/providers/openrouter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      expect(mockModelConfigsRepo.upsertProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'OpenRouter',
          apiBaseUrl: 'https://openrouter.ai/api/v1',
        })
      );
    });
  });

  // ========================================================================
  // PATCH /providers/:id/toggle (error paths)
  // ========================================================================

  describe('PATCH /prov/providers/:id/toggle', () => {
    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/prov/providers/openai/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad',
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 500 when toggle throws', async () => {
      mockModelConfigsRepo.upsertProvider.mockRejectedValueOnce(new Error('DB error'));

      const res = await app.request('/prov/providers/openai/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('TOGGLE_FAILED');
    });

    it('toggles aggregator provider via upsertProvider', async () => {
      const res = await app.request('/prov/providers/openrouter/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(200);
      expect(mockModelConfigsRepo.upsertProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'openrouter',
          isEnabled: true,
          providerType: 'openai_compatible',
        })
      );
    });

    it('toggles non-builtin non-aggregator provider via toggleProvider', async () => {
      const res = await app.request('/prov/providers/my-custom/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(200);
      expect(mockModelConfigsRepo.toggleProvider).toHaveBeenCalledWith(
        'default',
        'my-custom',
        false
      );
    });

    it('returns 404 when custom provider toggle returns false', async () => {
      mockModelConfigsRepo.toggleProvider.mockResolvedValueOnce(false);

      const res = await app.request('/prov/providers/unknown-custom/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(404);
    });

    it('enables builtin provider message', async () => {
      const res = await app.request('/prov/providers/openai/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toBe('Provider enabled');
      expect(json.data.enabled).toBe(true);
    });

    it('disables builtin provider message', async () => {
      const res = await app.request('/prov/providers/openai/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toBe('Provider disabled');
      expect(json.data.enabled).toBe(false);
    });
  });

  // ========================================================================
  // GET /providers/available
  // ========================================================================

  describe('GET /prov/providers/available', () => {
    it('sorts by configured, then enabled, then name', async () => {
      const res = await app.request('/prov/providers/available');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.length).toBeGreaterThanOrEqual(2); // openai + openrouter
      // openai is configured (hasApiKey true), should come first
      expect(json.data[0].id).toBe('openai');
    });

    it('marks user-disabled providers', async () => {
      mockModelConfigsRepo.listProviders.mockResolvedValueOnce([
        { providerId: 'openai', isEnabled: false, displayName: 'OpenAI' },
      ]);

      const res = await app.request('/prov/providers/available');
      const json = await res.json();
      const openai = json.data.find((p: { id: string }) => p.id === 'openai');
      expect(openai.isEnabled).toBe(false);
    });

    it('marks aggregator as enabled when user has enabled it', async () => {
      mockModelConfigsRepo.getProvider.mockImplementation(async (_uid: string, pid: string) => {
        if (pid === 'openrouter') return { isEnabled: true };
        return null;
      });

      const res = await app.request('/prov/providers/available');
      const json = await res.json();
      const openrouter = json.data.find((p: { id: string }) => p.id === 'openrouter');
      expect(openrouter.isEnabled).toBe(true);
    });
  });

  // ========================================================================
  // GET /providers/:id
  // ========================================================================

  describe('GET /prov/providers/:id', () => {
    it('returns provider with its models', async () => {
      const res = await app.request('/prov/providers/openai');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('openai');
      expect(json.data.models).toBeDefined();
      expect(json.data.models.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 404 for unknown provider', async () => {
      const res = await app.request('/prov/providers/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // DELETE /providers/:id
  // ========================================================================

  describe('DELETE /prov/providers/:id', () => {
    it('returns 400 when deleting built-in provider', async () => {
      const res = await app.request('/prov/providers/openai', { method: 'DELETE' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('Cannot delete built-in');
    });

    it('deletes a custom provider and broadcasts event', async () => {
      const res = await app.request('/prov/providers/my-custom', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('deleted');
      expect(mockBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'model_provider',
        action: 'deleted',
        id: 'my-custom',
      });
    });

    it('returns 404 when provider not found in DB', async () => {
      mockModelConfigsRepo.deleteProvider.mockResolvedValueOnce(false);

      const res = await app.request('/prov/providers/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // POST /providers/:id/discover-models
  // ========================================================================

  describe('POST /prov/providers/:id/discover-models', () => {
    it('discovers models from user provider override base URL', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'local-llm',
        apiBaseUrl: 'http://localhost:8080',
        displayName: 'Local LLM',
        isEnabled: true,
      });
      mockModelConfigsRepo.listModels.mockResolvedValueOnce([]);

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => ({
          ok: true,
          text: async () => JSON.stringify({ data: [{ id: 'my-model', object: 'model' }] }),
        }))
      );

      const res = await app.request('/prov/providers/local-llm/discover-models', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.data.models).toHaveLength(1);
      expect(json.data.data.models[0].modelId).toBe('my-model');
      expect(json.data.data.models[0].isNew).toBe(true);
      expect(mockModelConfigsRepo.upsertModel).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('discovers models from builtin provider base URL', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce(null);
      mockModelConfigsRepo.listModels.mockResolvedValueOnce([]);

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          text: async () => JSON.stringify({ data: [{ id: 'gpt-4o' }] }),
        }))
      );

      const res = await app.request('/prov/providers/openai/discover-models', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.data.provider).toBe('openai');
      expect(json.data.data.providerName).toBe('OpenAI');

      vi.unstubAllGlobals();
    });

    it('discovers models from aggregator base URL as fallback', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce(null);
      mockModelConfigsRepo.listModels.mockResolvedValueOnce([]);

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          text: async () => JSON.stringify({ data: [{ id: 'meta-llama/llama-3.1' }] }),
        }))
      );

      const res = await app.request('/prov/providers/openrouter/discover-models', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.data.providerName).toBe('OpenRouter');

      vi.unstubAllGlobals();
    });

    it('returns 400 when no base URL can be resolved', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce(null);

      const res = await app.request('/prov/providers/unknown-provider/discover-models', {
        method: 'POST',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_REQUEST');
      expect(json.error.message).toContain('no base URL');
    });

    it('returns 502 when all fetch attempts fail', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'bad-provider',
        apiBaseUrl: 'http://localhost:9999',
        displayName: 'Bad Provider',
        isEnabled: true,
      });

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: false,
          status: 500,
        }))
      );

      const res = await app.request('/prov/providers/bad-provider/discover-models', {
        method: 'POST',
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error.code).toBe('FETCH_ERROR');

      vi.unstubAllGlobals();
    });

    it('handles flat array model response format', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'ollama',
        apiBaseUrl: 'http://localhost:11434',
        displayName: 'Ollama',
        isEnabled: true,
      });
      mockModelConfigsRepo.listModels.mockResolvedValueOnce([]);

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          text: async () => JSON.stringify([{ id: 'llama2' }, { id: 'codellama' }]),
        }))
      );

      const res = await app.request('/prov/providers/ollama/discover-models', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.data.models).toHaveLength(2);

      vi.unstubAllGlobals();
    });

    it('marks existing models as not new', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'local',
        apiBaseUrl: 'http://localhost:8080',
        displayName: 'Local',
        isEnabled: true,
      });
      mockModelConfigsRepo.listModels.mockResolvedValueOnce([
        { providerId: 'local', modelId: 'existing-model' },
      ]);

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          text: async () =>
            JSON.stringify({ data: [{ id: 'existing-model' }, { id: 'new-model' }] }),
        }))
      );

      const res = await app.request('/prov/providers/local/discover-models', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.data.existingModels).toBe(1);
      expect(json.data.data.newModels).toBe(1);

      vi.unstubAllGlobals();
    });

    it('handles non-JSON response gracefully', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'broken',
        apiBaseUrl: 'http://localhost:8080',
        displayName: 'Broken',
        isEnabled: true,
      });

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          text: async () => '<html>Not JSON</html>',
        }))
      );

      const res = await app.request('/prov/providers/broken/discover-models', { method: 'POST' });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error.code).toBe('FETCH_ERROR');

      vi.unstubAllGlobals();
    });

    it('handles empty response body', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'empty',
        apiBaseUrl: 'http://localhost:8080',
        displayName: 'Empty',
        isEnabled: true,
      });

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          text: async () => '',
        }))
      );

      const res = await app.request('/prov/providers/empty/discover-models', { method: 'POST' });

      expect(res.status).toBe(502);

      vi.unstubAllGlobals();
    });

    it('handles empty model list in valid response', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'no-models',
        apiBaseUrl: 'http://localhost:8080',
        displayName: 'No Models',
        isEnabled: true,
      });

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          text: async () => JSON.stringify({ data: [] }),
        }))
      );

      const res = await app.request('/prov/providers/no-models/discover-models', {
        method: 'POST',
      });

      expect(res.status).toBe(502);

      vi.unstubAllGlobals();
    });

    it('skips models without an id field', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'partial',
        apiBaseUrl: 'http://localhost:8080',
        displayName: 'Partial',
        isEnabled: true,
      });
      mockModelConfigsRepo.listModels.mockResolvedValueOnce([]);

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          text: async () => JSON.stringify({ data: [{ id: 'valid-model' }, { object: 'model' }] }),
        }))
      );

      const res = await app.request('/prov/providers/partial/discover-models', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.data.models).toHaveLength(1);
      expect(json.data.data.models[0].modelId).toBe('valid-model');

      vi.unstubAllGlobals();
    });

    it('includes authorization header when API key is available', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce(null);
      mockModelConfigsRepo.listModels.mockResolvedValueOnce([]);

      const mockFetch = vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ data: [{ id: 'gpt-4o' }] }),
      }));

      vi.stubGlobal('fetch', mockFetch);

      await app.request('/prov/providers/openai/discover-models', { method: 'POST' });

      // Should have passed headers with Authorization
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        })
      );

      vi.unstubAllGlobals();
    });

    it('returns 500 when model save fails', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'local',
        apiBaseUrl: 'http://localhost:8080',
        displayName: 'Local',
        isEnabled: true,
      });
      mockModelConfigsRepo.listModels.mockResolvedValueOnce([]);
      mockModelConfigsRepo.upsertModel.mockRejectedValueOnce(new Error('DB save failed'));

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          text: async () => JSON.stringify({ data: [{ id: 'model-1' }] }),
        }))
      );

      const res = await app.request('/prov/providers/local/discover-models', { method: 'POST' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('UPDATE_FAILED');
      expect(json.error.message).toContain('failed to save');

      vi.unstubAllGlobals();
    });

    it('handles fetch timeout (abort signal)', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'slow',
        apiBaseUrl: 'http://localhost:8080',
        displayName: 'Slow',
        isEnabled: true,
      });

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        })
      );

      const res = await app.request('/prov/providers/slow/discover-models', { method: 'POST' });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error.code).toBe('FETCH_ERROR');

      vi.unstubAllGlobals();
    });

    it('generates readable display name from model ID', async () => {
      mockModelConfigsRepo.getProvider.mockResolvedValueOnce({
        providerId: 'org',
        apiBaseUrl: 'http://localhost:8080',
        displayName: 'Org',
        isEnabled: true,
      });
      mockModelConfigsRepo.listModels.mockResolvedValueOnce([]);

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          text: async () => JSON.stringify({ data: [{ id: 'org/my-cool-model' }] }),
        }))
      );

      const res = await app.request('/prov/providers/org/discover-models', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      // "org/my-cool-model" -> strip org prefix -> "my-cool-model" -> "My Cool Model"
      expect(json.data.data.models[0].displayName).toBe('My Cool Model');

      vi.unstubAllGlobals();
    });
  });
});
