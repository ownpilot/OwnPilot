/**
 * Local Discovery Service Tests
 *
 * Comprehensive tests for model discovery from local AI providers
 * (LM Studio, Ollama, LocalAI, vLLM, custom). Covers URL construction,
 * display name building, response parsing, error handling, and dispatch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LocalProvider } from '../db/repositories/local-providers.js';

vi.mock('../routes/helpers.js', () => ({
  getErrorMessage: (e: unknown, fallback = 'Unknown error') =>
    e instanceof Error ? e.message : fallback,
}));

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(overrides: Partial<LocalProvider> = {}): LocalProvider {
  return {
    id: 'test-1',
    userId: 'user-1',
    name: 'Test Provider',
    providerType: 'lmstudio',
    baseUrl: 'http://localhost:1234',
    apiKey: undefined,
    isEnabled: true,
    isDefault: false,
    discoveryEndpoint: undefined,
    lastDiscoveredAt: undefined,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function textResponse(text: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(text),
  };
}

// ---------------------------------------------------------------------------
// Import via dynamic import so vi.stubGlobal takes effect
// ---------------------------------------------------------------------------

async function loadModule() {
  return await import('./local-discovery.js');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('local-discovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  // ========================================================================
  // buildDisplayName (tested indirectly via discoverModels results)
  // ========================================================================

  describe('buildDisplayName (via model displayName)', () => {
    it('strips org prefix', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'meta-llama/Llama-3' }] }),
      );
      const result = await discoverModels(makeProvider());
      expect(result.models[0]!.displayName).toBe('Llama 3');
    });

    it('strips :tag suffix', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          models: [{ name: 'llama3:latest', model: 'llama3:latest' }],
        }),
      );
      const result = await discoverModels(
        makeProvider({ providerType: 'ollama' }),
      );
      expect(result.models[0]!.displayName).toBe('Llama3');
    });

    it('replaces dashes with spaces and title-cases', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'gpt-4-turbo' }] }),
      );
      const result = await discoverModels(makeProvider());
      expect(result.models[0]!.displayName).toBe('Gpt 4 Turbo');
    });

    it('replaces underscores with spaces and title-cases', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'code_llama' }] }),
      );
      const result = await discoverModels(makeProvider());
      expect(result.models[0]!.displayName).toBe('Code Llama');
    });

    it('title-cases a simple name', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'mistral' }] }),
      );
      const result = await discoverModels(makeProvider());
      expect(result.models[0]!.displayName).toBe('Mistral');
    });

    it('handles combined org prefix, dashes, and :tag', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          models: [
            {
              name: 'TheBloke/Mistral-7B-v0.1:Q4_K_M',
              model: 'TheBloke/Mistral-7B-v0.1:Q4_K_M',
            },
          ],
        }),
      );
      const result = await discoverModels(
        makeProvider({ providerType: 'ollama' }),
      );
      expect(result.models[0]!.displayName).toBe('Mistral 7B V0.1');
    });

    it('keeps already-clean name with title case', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'gpt-4' }] }),
      );
      const result = await discoverModels(makeProvider());
      expect(result.models[0]!.displayName).toBe('Gpt 4');
    });

    it('handles id with multiple slashes (uses last segment)', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'org/sub/model-name' }] }),
      );
      const result = await discoverModels(makeProvider());
      expect(result.models[0]!.displayName).toBe('Model Name');
    });

    it('handles id with colon but no tag content gracefully', async () => {
      // "model:" -- regex /:[^:]+$/ requires at least one char after :, so no match
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          models: [{ name: 'model:', model: 'model:' }],
        }),
      );
      const result = await discoverModels(
        makeProvider({ providerType: 'ollama' }),
      );
      expect(result.models[0]!.modelId).toBe('model:');
    });

    it('preserves numeric segments', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'llama-3.1-70b' }] }),
      );
      const result = await discoverModels(makeProvider());
      expect(result.models[0]!.displayName).toBe('Llama 3.1 70b');
    });
  });

  // ========================================================================
  // authHeaders (tested via fetch call inspection)
  // ========================================================================

  describe('authHeaders (via fetch call inspection)', () => {
    it('includes Authorization Bearer when apiKey is present', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await discoverModels(makeProvider({ apiKey: 'sk-test-key' }));

      const headers = mockFetch.mock.calls[0]![1].headers;
      expect(headers['Authorization']).toBe('Bearer sk-test-key');
    });

    it('does not include Authorization when apiKey is undefined', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await discoverModels(makeProvider());

      const headers = mockFetch.mock.calls[0]![1].headers;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('does not include Authorization when apiKey is empty string', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await discoverModels(makeProvider({ apiKey: '' }));

      const headers = mockFetch.mock.calls[0]![1].headers;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('always includes Accept: application/json', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await discoverModels(makeProvider());

      const headers = mockFetch.mock.calls[0]![1].headers;
      expect(headers['Accept']).toBe('application/json');
    });
  });

  // ========================================================================
  // timedFetch (via discoverModels behavior)
  // ========================================================================

  describe('timedFetch (via discoverModels behavior)', () => {
    it('returns response on successful fetch', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      const result = await discoverModels(makeProvider());
      expect(result.models).toHaveLength(1);
      expect(result.error).toBeUndefined();
    });

    it('returns null on network error causing connection error', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await discoverModels(makeProvider());
      expect(result.models).toHaveLength(0);
      expect(result.error).toBe('Failed to connect to LM Studio');
    });

    it('passes an AbortSignal to fetch', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await discoverModels(makeProvider());

      const fetchOptions = mockFetch.mock.calls[0]![1];
      expect(fetchOptions.signal).toBeDefined();
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it('uses GET method', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await discoverModels(makeProvider());

      const fetchOptions = mockFetch.mock.calls[0]![1];
      expect(fetchOptions.method).toBe('GET');
    });

    it('handles fetch returning a rejected promise gracefully', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const result = await discoverModels(makeProvider());
      expect(result.models).toHaveLength(0);
      expect(result.error).toContain('Failed to connect');
    });
  });

  // ========================================================================
  // discoverLMStudio
  // ========================================================================

  describe('discoverLMStudio', () => {
    it('constructs /v1/models URL when baseUrl ends with /v1', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await discoverModels(
        makeProvider({ baseUrl: 'http://localhost:1234/v1' }),
      );

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:1234/v1/models');
    });

    it('appends /v1/models when baseUrl does not end with /v1', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await discoverModels(
        makeProvider({ baseUrl: 'http://localhost:1234' }),
      );

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:1234/v1/models');
    });

    it('strips trailing slashes from baseUrl', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await discoverModels(
        makeProvider({ baseUrl: 'http://localhost:1234///' }),
      );

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:1234/v1/models');
    });

    it('strips trailing slashes after /v1 path', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await discoverModels(
        makeProvider({ baseUrl: 'http://localhost:1234/v1/' }),
      );

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:1234/v1/models');
    });

    it('returns discovered models with correct modelId and displayName', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 'meta-llama/Llama-3-8B', object: 'model', owned_by: 'meta' },
            { id: 'mistral-7b-instruct', object: 'model', owned_by: 'mistral' },
          ],
        }),
      );
      const result = await discoverModels(makeProvider());

      expect(result.models).toHaveLength(2);
      expect(result.models[0]!.modelId).toBe('meta-llama/Llama-3-8B');
      expect(result.models[0]!.displayName).toBe('Llama 3 8B');
      expect(result.models[1]!.modelId).toBe('mistral-7b-instruct');
      expect(result.models[1]!.displayName).toBe('Mistral 7b Instruct');
    });

    it('includes metadata (object, owned_by)', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'model-x', object: 'model', owned_by: 'org-x' }],
        }),
      );
      const result = await discoverModels(makeProvider());

      expect(result.models[0]!.metadata).toEqual({
        object: 'model',
        owned_by: 'org-x',
      });
    });

    it('handles missing metadata fields as undefined', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'model-x' }],
        }),
      );
      const result = await discoverModels(makeProvider());

      expect(result.models[0]!.metadata).toEqual({
        object: undefined,
        owned_by: undefined,
      });
    });

    it('returns error on connection failure', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await discoverModels(makeProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toBe('Failed to connect to LM Studio');
      expect(result.sourceUrl).toBe('http://localhost:1234/v1/models');
    });

    it('returns error on non-OK response with status code', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      const result = await discoverModels(makeProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toBe('LM Studio returned HTTP 500');
    });

    it('returns error on 404 status', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));
      const result = await discoverModels(makeProvider());

      expect(result.error).toBe('LM Studio returned HTTP 404');
    });

    it('returns error on invalid JSON', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });
      const result = await discoverModels(makeProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toBe('Invalid JSON response from LM Studio');
    });

    it('handles empty data array', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      const result = await discoverModels(makeProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toBeUndefined();
    });

    it('handles missing data field (defaults to empty array)', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      const result = await discoverModels(makeProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toBeUndefined();
    });

    it('passes API key in Authorization header', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      await discoverModels(makeProvider({ apiKey: 'my-lmstudio-key' }));

      const headers = mockFetch.mock.calls[0]![1].headers;
      expect(headers['Authorization']).toBe('Bearer my-lmstudio-key');
    });

    it('sets sourceUrl to the constructed URL', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      const result = await discoverModels(makeProvider());

      expect(result.sourceUrl).toBe('http://localhost:1234/v1/models');
    });

    it('sets sourceUrl even on error', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await discoverModels(makeProvider());

      expect(result.sourceUrl).toBe('http://localhost:1234/v1/models');
    });

    it('handles response with data: null as empty', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: null }));
      const result = await discoverModels(makeProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toBeUndefined();
    });

    it('handles large model list', async () => {
      const { discoverModels } = await loadModule();
      const data = Array.from({ length: 100 }, (_, i) => ({
        id: `model-${i}`,
        object: 'model',
      }));
      mockFetch.mockResolvedValueOnce(jsonResponse({ data }));
      const result = await discoverModels(makeProvider());

      expect(result.models).toHaveLength(100);
      expect(result.models[99]!.modelId).toBe('model-99');
    });
  });

  // ========================================================================
  // discoverOllama
  // ========================================================================

  describe('discoverOllama', () => {
    const ollamaProvider = (overrides: Partial<LocalProvider> = {}) =>
      makeProvider({ providerType: 'ollama', ...overrides });

    it('constructs /api/tags URL from baseUrl', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ models: [] }));
      await discoverModels(ollamaProvider());

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:1234/api/tags');
    });

    it('strips trailing slashes before appending /api/tags', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ models: [] }));
      await discoverModels(
        ollamaProvider({ baseUrl: 'http://localhost:11434/' }),
      );

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:11434/api/tags');
    });

    it('returns models with correct modelId (uses name field)', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          models: [
            { name: 'llama3:latest', model: 'llama3:latest', size: 4700000000 },
            { name: 'codellama:7b', model: 'codellama:7b', size: 3800000000 },
          ],
        }),
      );
      const result = await discoverModels(ollamaProvider());

      expect(result.models).toHaveLength(2);
      expect(result.models[0]!.modelId).toBe('llama3:latest');
      expect(result.models[1]!.modelId).toBe('codellama:7b');
    });

    it('builds displayName from name field', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          models: [{ name: 'llama3:latest', model: 'llama3:latest' }],
        }),
      );
      const result = await discoverModels(ollamaProvider());

      expect(result.models[0]!.displayName).toBe('Llama3');
    });

    it('includes metadata (modified_at, size)', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          models: [
            {
              name: 'model-a',
              model: 'model-a',
              modified_at: '2025-01-15T10:00:00Z',
              size: 1234567890,
            },
          ],
        }),
      );
      const result = await discoverModels(ollamaProvider());

      expect(result.models[0]!.metadata).toEqual({
        modified_at: '2025-01-15T10:00:00Z',
        size: 1234567890,
      });
    });

    it('handles undefined metadata fields', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          models: [{ name: 'model-a', model: 'model-a' }],
        }),
      );
      const result = await discoverModels(ollamaProvider());

      expect(result.models[0]!.metadata).toEqual({
        modified_at: undefined,
        size: undefined,
      });
    });

    it('handles empty models array', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ models: [] }));
      const result = await discoverModels(ollamaProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toBeUndefined();
    });

    it('handles missing models field (defaults to empty)', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      const result = await discoverModels(ollamaProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toBeUndefined();
    });

    it('returns error on connection failure', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await discoverModels(ollamaProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toBe('Failed to connect to Ollama');
      expect(result.sourceUrl).toBe('http://localhost:1234/api/tags');
    });

    it('returns error on non-OK response (500)', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      const result = await discoverModels(ollamaProvider());

      expect(result.error).toBe('Ollama returned HTTP 500');
    });

    it('returns error on non-OK response (403)', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 403));
      const result = await discoverModels(ollamaProvider());

      expect(result.error).toBe('Ollama returned HTTP 403');
    });

    it('returns error on invalid JSON', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });
      const result = await discoverModels(ollamaProvider());

      expect(result.error).toBe('Invalid JSON response from Ollama');
    });

    it('sets sourceUrl correctly', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ models: [] }));
      const result = await discoverModels(ollamaProvider());

      expect(result.sourceUrl).toBe('http://localhost:1234/api/tags');
    });

    it('passes API key in headers for protected Ollama', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ models: [] }));
      await discoverModels(ollamaProvider({ apiKey: 'ollama-secret' }));

      const headers = mockFetch.mock.calls[0]![1].headers;
      expect(headers['Authorization']).toBe('Bearer ollama-secret');
    });

    it('handles models: null as empty', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ models: null }));
      const result = await discoverModels(ollamaProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toBeUndefined();
    });
  });

  // ========================================================================
  // discoverGeneric (localai, vllm, custom)
  // ========================================================================

  describe('discoverGeneric', () => {
    const genericProvider = (overrides: Partial<LocalProvider> = {}) =>
      makeProvider({ providerType: 'custom', ...overrides });

    it('tries /v1/models first when no discoveryEndpoint', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      const result = await discoverModels(genericProvider());

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:1234/v1/models');
      expect(result.models).toHaveLength(1);
    });

    it('tries multiple URLs in order on failure', async () => {
      const { discoverModels } = await loadModule();
      // First two fail, third succeeds
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      const result = await discoverModels(genericProvider());

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.models).toHaveLength(1);
      expect(result.sourceUrl).toBe('http://localhost:1234/models');
    });

    it('stops at the first successful response', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      const result = await discoverModels(genericProvider());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.models).toHaveLength(1);
    });

    it('uses discoveryEndpoint first when set', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      const result = await discoverModels(
        genericProvider({ discoveryEndpoint: '/custom/list' }),
      );

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:1234/custom/list');
      expect(result.models).toHaveLength(1);
    });

    it('resolves discoveryEndpoint as absolute URL against baseUrl', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      await discoverModels(
        genericProvider({
          baseUrl: 'http://localhost:8080',
          discoveryEndpoint: '/api/custom/models',
        }),
      );

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:8080/api/custom/models');
    });

    it('uses discoveryEndpoint as full URL when it is absolute', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      await discoverModels(
        genericProvider({
          discoveryEndpoint: 'http://other-host:9090/models',
        }),
      );

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://other-host:9090/models');
    });

    it('falls back to standard paths after discoveryEndpoint fails', async () => {
      const { discoverModels } = await loadModule();
      // discoveryEndpoint fails
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      // /v1/models succeeds
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      const result = await discoverModels(
        genericProvider({ discoveryEndpoint: '/custom/list' }),
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.models).toHaveLength(1);
    });

    it('deduplicates URLs when discoveryEndpoint resolves to same as standard path', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValue(new Error('fail'));
      const result = await discoverModels(
        genericProvider({
          baseUrl: 'http://localhost:1234',
          discoveryEndpoint: '/v1/models',
        }),
      );

      // Should try: /v1/models (deduped), /api/v1/models, /models = 3 calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.error).toContain('tried 3 URL(s)');
    });

    it('handles OpenAI-wrapped format: { data: [...] }', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 'gpt-4', object: 'model' },
            { id: 'gpt-3.5-turbo', object: 'model' },
          ],
        }),
      );
      const result = await discoverModels(genericProvider());

      expect(result.models).toHaveLength(2);
      expect(result.models[0]!.modelId).toBe('gpt-4');
      expect(result.models[1]!.modelId).toBe('gpt-3.5-turbo');
    });

    it('handles flat array format: [...]', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse([{ id: 'model-a' }, { id: 'model-b' }]),
      );
      const result = await discoverModels(genericProvider());

      expect(result.models).toHaveLength(2);
      expect(result.models[0]!.modelId).toBe('model-a');
    });

    it('skips non-OK responses and tries next URL', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      const result = await discoverModels(genericProvider());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.models).toHaveLength(1);
    });

    it('skips non-JSON responses and tries next URL', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(textResponse('<html>Not Found</html>'));
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      const result = await discoverModels(genericProvider());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.models).toHaveLength(1);
    });

    it('skips empty model lists and tries next URL', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      const result = await discoverModels(genericProvider());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.models).toHaveLength(1);
    });

    it('filters out entries with no id or name', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 'valid-model' },
            { other: 'no-id-or-name' },
            { id: null },
            { id: 'another-valid' },
          ],
        }),
      );
      const result = await discoverModels(genericProvider());

      expect(result.models).toHaveLength(2);
      expect(result.models[0]!.modelId).toBe('valid-model');
      expect(result.models[1]!.modelId).toBe('another-valid');
    });

    it('prefers .id over .name when both are present', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'model-id', name: 'model-name' }],
        }),
      );
      const result = await discoverModels(genericProvider());

      expect(result.models[0]!.modelId).toBe('model-id');
    });

    it('falls back to .name when .id is missing', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [{ name: 'model-name-only' }],
        }),
      );
      const result = await discoverModels(genericProvider());

      expect(result.models[0]!.modelId).toBe('model-name-only');
    });

    it('returns error when all URLs fail', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValue(new Error('fail'));
      const result = await discoverModels(genericProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toContain('No models endpoint responded');
    });

    it('error message includes candidate URL count', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValue(new Error('fail'));
      const result = await discoverModels(genericProvider());

      expect(result.error).toContain('tried 3 URL(s)');
    });

    it('error message includes candidate count with discoveryEndpoint', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValue(new Error('fail'));
      const result = await discoverModels(
        genericProvider({ discoveryEndpoint: '/custom/endpoint' }),
      );

      expect(result.error).toContain('tried 4 URL(s)');
    });

    it('sets sourceUrl to first candidate URL on total failure', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValue(new Error('fail'));
      const result = await discoverModels(genericProvider());

      expect(result.sourceUrl).toBe('http://localhost:1234/v1/models');
    });

    it('sets sourceUrl to discoveryEndpoint on total failure when set', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValue(new Error('fail'));
      const result = await discoverModels(
        genericProvider({ discoveryEndpoint: '/custom/list' }),
      );

      expect(result.sourceUrl).toBe('http://localhost:1234/custom/list');
    });

    it('includes entry metadata in discovered models', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 'model-x', object: 'model', owned_by: 'local', extra_field: 42 },
          ],
        }),
      );
      const result = await discoverModels(genericProvider());

      expect(result.models[0]!.metadata).toMatchObject({
        id: 'model-x',
        object: 'model',
        owned_by: 'local',
        extra_field: 42,
      });
    });

    it('handles text() throwing by skipping to next URL', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.reject(new Error('read error')),
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-1' }] }),
      );
      const result = await discoverModels(genericProvider());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.models).toHaveLength(1);
    });

    it('handles entries where id is a number (non-string) by filtering out', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 123 },
            { id: 'valid-model' },
          ],
        }),
      );
      const result = await discoverModels(genericProvider());

      expect(result.models).toHaveLength(1);
      expect(result.models[0]!.modelId).toBe('valid-model');
    });

    it('handles entries where id is empty string by filtering out', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: '' },
            { id: 'valid-model' },
          ],
        }),
      );
      const result = await discoverModels(genericProvider());

      expect(result.models).toHaveLength(1);
      expect(result.models[0]!.modelId).toBe('valid-model');
    });
  });

  // ========================================================================
  // parseGenericModels (via discoverGeneric)
  // ========================================================================

  describe('parseGenericModels (via discoverGeneric)', () => {
    const genericProvider = () => makeProvider({ providerType: 'custom' });

    it('parses { data: [...] } wrapped format', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'wrapped-model' }] }),
      );
      const result = await discoverModels(genericProvider());

      expect(result.models).toHaveLength(1);
      expect(result.models[0]!.modelId).toBe('wrapped-model');
    });

    it('parses flat array', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse([{ id: 'flat-model' }]),
      );
      const result = await discoverModels(genericProvider());

      expect(result.models).toHaveLength(1);
      expect(result.models[0]!.modelId).toBe('flat-model');
    });

    it('returns empty for { data: "not array" } (skips to next URL)', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: 'not an array' }),
      );
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await discoverModels(genericProvider());

      expect(result.models).toHaveLength(0);
    });

    it('returns empty for non-object, non-array (e.g. number)', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse(42));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await discoverModels(genericProvider());

      expect(result.models).toHaveLength(0);
    });

    it('returns empty for string response', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse('just a string'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await discoverModels(genericProvider());

      expect(result.models).toHaveLength(0);
    });
  });

  // ========================================================================
  // buildGenericCandidateUrls (via discoverGeneric URL attempts)
  // ========================================================================

  describe('buildGenericCandidateUrls (via fetch call URLs)', () => {
    const genericProvider = (overrides: Partial<LocalProvider> = {}) =>
      makeProvider({ providerType: 'custom', ...overrides });

    it('generates 3 candidate URLs without discoveryEndpoint', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValue(new Error('fail'));
      await discoverModels(genericProvider());

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const urls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls).toEqual([
        'http://localhost:1234/v1/models',
        'http://localhost:1234/api/v1/models',
        'http://localhost:1234/models',
      ]);
    });

    it('generates 4 candidate URLs with discoveryEndpoint', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValue(new Error('fail'));
      await discoverModels(
        genericProvider({ discoveryEndpoint: '/custom/models' }),
      );

      expect(mockFetch).toHaveBeenCalledTimes(4);
      const urls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls[0]).toBe('http://localhost:1234/custom/models');
    });

    it('uses origin from baseUrl for standard paths', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValue(new Error('fail'));
      await discoverModels(
        genericProvider({ baseUrl: 'http://myhost:9090/some/path' }),
      );

      const urls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls).toEqual([
        'http://myhost:9090/v1/models',
        'http://myhost:9090/api/v1/models',
        'http://myhost:9090/models',
      ]);
    });

    it('deduplicates when discoveryEndpoint resolves to same as a standard path', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValue(new Error('fail'));
      await discoverModels(
        genericProvider({
          baseUrl: 'http://localhost:1234',
          discoveryEndpoint: 'http://localhost:1234/v1/models',
        }),
      );

      // discoveryEndpoint = /v1/models = first standard path -> deduped
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  // ========================================================================
  // discoverModels (main entry point / dispatch)
  // ========================================================================

  describe('discoverModels (dispatch)', () => {
    it('dispatches to LM Studio for providerType=lmstudio', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'lm-model' }] }),
      );
      const result = await discoverModels(
        makeProvider({ providerType: 'lmstudio' }),
      );

      expect(result.models[0]!.modelId).toBe('lm-model');
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain('/v1/models');
    });

    it('dispatches to Ollama for providerType=ollama', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          models: [{ name: 'ollama-model', model: 'ollama-model' }],
        }),
      );
      const result = await discoverModels(
        makeProvider({ providerType: 'ollama' }),
      );

      expect(result.models[0]!.modelId).toBe('ollama-model');
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain('/api/tags');
    });

    it('dispatches to generic for providerType=localai', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'localai-model' }] }),
      );
      const result = await discoverModels(
        makeProvider({ providerType: 'localai' }),
      );

      expect(result.models[0]!.modelId).toBe('localai-model');
    });

    it('dispatches to generic for providerType=vllm', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'vllm-model' }] }),
      );
      const result = await discoverModels(
        makeProvider({ providerType: 'vllm' }),
      );

      expect(result.models[0]!.modelId).toBe('vllm-model');
    });

    it('dispatches to generic for providerType=custom', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'custom-model' }] }),
      );
      const result = await discoverModels(
        makeProvider({ providerType: 'custom' }),
      );

      expect(result.models[0]!.modelId).toBe('custom-model');
    });

    it('returns error for unknown provider type', async () => {
      const { discoverModels } = await loadModule();
      const result = await discoverModels(
        makeProvider({ providerType: 'unknown' as 'lmstudio' }),
      );

      expect(result.models).toHaveLength(0);
      expect(result.error).toBe('Unsupported provider type: unknown');
      expect(result.sourceUrl).toBe('http://localhost:1234');
    });

    it('catches unexpected thrown errors and returns them', async () => {
      const { discoverModels } = await loadModule();
      // Force an error inside discoverLMStudio by making apiKey a getter that throws.
      // authHeaders(provider.apiKey) accesses apiKey before timedFetch's try/catch.
      const badProvider = makeProvider();
      Object.defineProperty(badProvider, 'apiKey', {
        get() {
          throw new Error('Unexpected catastrophic failure');
        },
      });
      const result = await discoverModels(badProvider);

      expect(result.models).toHaveLength(0);
      expect(result.error).toBe('Unexpected catastrophic failure');
      expect(result.sourceUrl).toBe('http://localhost:1234');
    });

    it('catches non-Error thrown values and uses fallback message', async () => {
      const { discoverModels } = await loadModule();
      // Force a non-Error throw via a getter
      const badProvider = makeProvider();
      Object.defineProperty(badProvider, 'apiKey', {
        get() {
          throw 'string error';
        },
      });
      const result = await discoverModels(badProvider);

      expect(result.models).toHaveLength(0);
      // getErrorMessage returns fallback for non-Error values
      expect(result.error).toBe('Unknown discovery error');
    });

    it('error includes provider baseUrl as sourceUrl', async () => {
      const { discoverModels } = await loadModule();
      const result = await discoverModels(
        makeProvider({
          providerType: 'unknown' as 'lmstudio',
          baseUrl: 'http://myserver:5000',
        }),
      );

      expect(result.sourceUrl).toBe('http://myserver:5000');
    });

    it('catches error from json() throwing synchronously in LM Studio', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => {
          throw new TypeError('Cannot read properties of null');
        },
      });
      const result = await discoverModels(makeProvider());

      expect(result.error).toBe('Invalid JSON response from LM Studio');
    });
  });

  // ========================================================================
  // Edge cases / Integration
  // ========================================================================

  describe('edge cases', () => {
    it('handles baseUrl with port and path for LM Studio', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'm1' }] }));
      await discoverModels(
        makeProvider({ baseUrl: 'http://192.168.1.100:8080/api' }),
      );

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://192.168.1.100:8080/api/v1/models');
    });

    it('handles baseUrl with /v1 for Ollama (still uses /api/tags)', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ models: [] }));
      await discoverModels(
        makeProvider({
          providerType: 'ollama',
          baseUrl: 'http://localhost:11434/v1',
        }),
      );

      const url = mockFetch.mock.calls[0]![0] as string;
      // Ollama strips trailing slashes and appends /api/tags
      expect(url).toBe('http://localhost:11434/v1/api/tags');
    });

    it('handles model IDs with special characters', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'user/model+v2@latest' }],
        }),
      );
      const result = await discoverModels(makeProvider());

      expect(result.models[0]!.modelId).toBe('user/model+v2@latest');
    });

    it('returns DiscoveryResult shape even for empty success', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
      const result = await discoverModels(makeProvider());

      expect(result).toHaveProperty('models');
      expect(result).toHaveProperty('sourceUrl');
      expect(Array.isArray(result.models)).toBe(true);
      expect(typeof result.sourceUrl).toBe('string');
    });

    it('returns DiscoveryResult shape on error', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const result = await discoverModels(makeProvider());

      expect(result).toHaveProperty('models');
      expect(result).toHaveProperty('sourceUrl');
      expect(result).toHaveProperty('error');
      expect(Array.isArray(result.models)).toBe(true);
      expect(typeof result.sourceUrl).toBe('string');
      expect(typeof result.error).toBe('string');
    });

    it('generic provider with localai type uses correct paths', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockRejectedValue(new Error('fail'));
      await discoverModels(
        makeProvider({
          providerType: 'localai',
          baseUrl: 'http://localhost:8080',
        }),
      );

      const urls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls).toContain('http://localhost:8080/v1/models');
      expect(urls).toContain('http://localhost:8080/api/v1/models');
      expect(urls).toContain('http://localhost:8080/models');
    });

    it('generic discovery with multiple valid entries preserves order', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 'alpha' },
            { id: 'beta' },
            { id: 'gamma' },
          ],
        }),
      );
      const result = await discoverModels(
        makeProvider({ providerType: 'custom' }),
      );

      expect(result.models.map((m) => m.modelId)).toEqual([
        'alpha',
        'beta',
        'gamma',
      ]);
    });

    it('generic discovery metadata includes all original entry fields', async () => {
      const { discoverModels } = await loadModule();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'model-x',
              object: 'model',
              owned_by: 'org',
              created: 1234567890,
              permission: [],
            },
          ],
        }),
      );
      const result = await discoverModels(
        makeProvider({ providerType: 'custom' }),
      );

      const meta = result.models[0]!.metadata!;
      expect(meta['id']).toBe('model-x');
      expect(meta['object']).toBe('model');
      expect(meta['created']).toBe(1234567890);
      expect(meta['permission']).toEqual([]);
    });
  });
});
