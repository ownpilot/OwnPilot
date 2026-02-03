/**
 * Local Discovery Service Tests
 *
 * Tests model discovery from local AI providers (LM Studio, Ollama, generic).
 * Covers URL construction, display name building, response parsing, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LocalProvider } from '../db/repositories/local-providers.js';
import { discoverModels } from './local-discovery.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Test Provider',
    providerType: 'lmstudio',
    baseUrl: 'http://localhost:1234',
    apiKey: null,
    discoveryEndpoint: null,
    ...overrides,
  } as unknown as LocalProvider;
}

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Local Discovery Service', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ========================================================================
  // LM Studio
  // ========================================================================

  describe('discoverModels - lmstudio', () => {
    it('discovers models from LM Studio /v1/models', async () => {
      globalThis.fetch = mockFetchResponse({
        data: [
          { id: 'TheBloke/Mistral-7B-v0.1', object: 'model', owned_by: 'user' },
          { id: 'lmstudio-community/Meta-Llama-3.1-8B', object: 'model' },
        ],
      });

      const result = await discoverModels(makeProvider({
        baseUrl: 'http://localhost:1234/v1',
      }));

      expect(result.models).toHaveLength(2);
      expect(result.models[0].modelId).toBe('TheBloke/Mistral-7B-v0.1');
      expect(result.models[0].displayName).toBe('Mistral 7B V0.1');
      expect(result.error).toBeUndefined();
    });

    it('appends /v1/models when baseUrl has no /v1', async () => {
      globalThis.fetch = mockFetchResponse({ data: [] });

      await discoverModels(makeProvider({ baseUrl: 'http://localhost:1234' }));

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:1234/v1/models',
        expect.anything(),
      );
    });

    it('appends /models when baseUrl ends with /v1', async () => {
      globalThis.fetch = mockFetchResponse({ data: [] });

      await discoverModels(makeProvider({ baseUrl: 'http://localhost:1234/v1' }));

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:1234/v1/models',
        expect.anything(),
      );
    });

    it('returns error on connection failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await discoverModels(makeProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toContain('Failed to connect');
    });

    it('returns error on non-200 response', async () => {
      globalThis.fetch = mockFetchResponse({}, false, 401);

      const result = await discoverModels(makeProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toContain('HTTP 401');
    });

    it('returns error on invalid JSON', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('invalid JSON')),
      });

      const result = await discoverModels(makeProvider());

      expect(result.models).toHaveLength(0);
      expect(result.error).toContain('Invalid JSON');
    });

    it('sends authorization header when apiKey present', async () => {
      globalThis.fetch = mockFetchResponse({ data: [] });

      await discoverModels(makeProvider({ apiKey: 'sk-test' }));

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test',
          }),
        }),
      );
    });

    it('omits authorization header when no apiKey', async () => {
      globalThis.fetch = mockFetchResponse({ data: [] });

      await discoverModels(makeProvider({ apiKey: null }));

      const callHeaders = vi.mocked(globalThis.fetch).mock.calls[0][1]!.headers as Record<string, string>;
      expect(callHeaders.Authorization).toBeUndefined();
    });
  });

  // ========================================================================
  // Ollama
  // ========================================================================

  describe('discoverModels - ollama', () => {
    it('discovers models from Ollama /api/tags', async () => {
      globalThis.fetch = mockFetchResponse({
        models: [
          { name: 'llama3:latest', model: 'llama3:latest', size: 4000000000, modified_at: '2025-01-01T00:00:00Z' },
          { name: 'codellama:7b', model: 'codellama:7b', size: 3000000000 },
        ],
      });

      const result = await discoverModels(makeProvider({
        providerType: 'ollama',
        baseUrl: 'http://localhost:11434',
      }));

      expect(result.models).toHaveLength(2);
      expect(result.models[0].modelId).toBe('llama3:latest');
      // Display name strips :tag
      expect(result.models[0].displayName).toBe('Llama3');
      expect(result.sourceUrl).toContain('/api/tags');
    });

    it('returns error on connection failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await discoverModels(makeProvider({
        providerType: 'ollama',
        baseUrl: 'http://localhost:11434',
      }));

      expect(result.error).toContain('Failed to connect to Ollama');
    });
  });

  // ========================================================================
  // Generic / LocalAI / vLLM / Custom
  // ========================================================================

  describe('discoverModels - generic', () => {
    it('discovers from first working URL', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string) => {
        callCount++;
        if (callCount === 1) {
          // First URL fails
          return { ok: false, status: 404 };
        }
        // Second URL works
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({
            data: [{ id: 'model-1' }, { id: 'model-2' }],
          })),
        };
      });

      const result = await discoverModels(makeProvider({
        providerType: 'localai',
        baseUrl: 'http://localhost:8080',
      }));

      expect(result.models).toHaveLength(2);
      expect(callCount).toBe(2);
    });

    it('handles flat array response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify([
          { id: 'flat-model-1' },
          { id: 'flat-model-2' },
        ])),
      });

      const result = await discoverModels(makeProvider({
        providerType: 'vllm',
        baseUrl: 'http://localhost:8000',
      }));

      expect(result.models).toHaveLength(2);
      expect(result.models[0].modelId).toBe('flat-model-1');
    });

    it('uses discoveryEndpoint when set', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ data: [{ id: 'model-1' }] })),
      });

      const result = await discoverModels(makeProvider({
        providerType: 'custom',
        baseUrl: 'http://localhost:9000',
        discoveryEndpoint: '/custom/api/models',
      }));

      // First call should be the custom endpoint
      expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('http://localhost:9000/custom/api/models');
      expect(result.models).toHaveLength(1);
    });

    it('returns error when all candidate URLs fail', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await discoverModels(makeProvider({
        providerType: 'custom',
        baseUrl: 'http://localhost:9000',
      }));

      expect(result.models).toHaveLength(0);
      expect(result.error).toContain('No models endpoint responded');
    });

    it('skips entries without id or name', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          data: [
            { id: 'valid-model' },
            { no_id: true }, // Missing both id and name
            { name: 'named-model' },
          ],
        })),
      });

      const result = await discoverModels(makeProvider({
        providerType: 'localai',
        baseUrl: 'http://localhost:8080',
      }));

      expect(result.models).toHaveLength(2);
    });
  });

  // ========================================================================
  // Unknown provider type
  // ========================================================================

  describe('discoverModels - unsupported type', () => {
    it('returns error for unsupported provider type', async () => {
      const result = await discoverModels(makeProvider({
        providerType: 'unknown_provider',
      }));

      expect(result.models).toHaveLength(0);
      expect(result.error).toContain('Unsupported provider type');
    });
  });

  // ========================================================================
  // Display name building
  // ========================================================================

  describe('display name building', () => {
    it('strips org prefix', async () => {
      globalThis.fetch = mockFetchResponse({
        data: [{ id: 'TheBloke/Llama-2-7B' }],
      });

      const result = await discoverModels(makeProvider());
      expect(result.models[0].displayName).toBe('Llama 2 7B');
    });

    it('strips :tag suffix', async () => {
      globalThis.fetch = mockFetchResponse({
        models: [{ name: 'llama3:70b-instruct-q4_K_M', model: 'llama3:70b' }],
      });

      const result = await discoverModels(makeProvider({ providerType: 'ollama' }));
      expect(result.models[0].displayName).toBe('Llama3');
    });

    it('replaces dashes and underscores with spaces', async () => {
      globalThis.fetch = mockFetchResponse({
        data: [{ id: 'my-custom_model' }],
      });

      const result = await discoverModels(makeProvider());
      expect(result.models[0].displayName).toBe('My Custom Model');
    });
  });
});
