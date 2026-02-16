/**
 * EmbeddingService Tests
 *
 * Tests for embedding generation, caching, batch processing, and API calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingService } from './embedding-service.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockLookup = vi.fn();
const mockStore = vi.fn();

vi.mock('../db/repositories/embedding-cache.js', () => ({
  EmbeddingCacheRepository: {
    contentHash: (text: string) => `hash_${text.trim().toLowerCase().substring(0, 20)}`,
  },
  embeddingCacheRepo: {
    lookup: (...args: unknown[]) => mockLookup(...args),
    store: (...args: unknown[]) => mockStore(...args),
  },
}));

const mockGetApiKey = vi.fn();
const mockGetFieldValue = vi.fn();

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
    getFieldValue: (...args: unknown[]) => mockGetFieldValue(...args),
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeEmbedding(dim = 10): number[] {
  return Array.from({ length: dim }, (_, i) => i * 0.1);
}

function fakeApiResponse(embeddings: number[][]) {
  return {
    ok: true,
    json: async () => ({
      data: embeddings.map((e, i) => ({ embedding: e, index: i })),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiKey.mockReturnValue('sk-test-key');
    mockGetFieldValue.mockReturnValue(null);
    mockStore.mockResolvedValue(undefined);
    service = new EmbeddingService('test-model', 10);
  });

  describe('isAvailable', () => {
    it('returns true when API key is configured', () => {
      expect(service.isAvailable()).toBe(true);
    });

    it('returns false when API key is not configured', () => {
      mockGetApiKey.mockReturnValue(null);
      const noKeyService = new EmbeddingService('test-model', 10);
      expect(noKeyService.isAvailable()).toBe(false);
    });
  });

  describe('generateEmbedding', () => {
    it('returns cached embedding on cache hit', async () => {
      const embedding = fakeEmbedding();
      mockLookup.mockResolvedValue(embedding);

      const result = await service.generateEmbedding('hello world');

      expect(result.embedding).toBe(embedding);
      expect(result.cached).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls API on cache miss and stores result', async () => {
      const embedding = fakeEmbedding();
      mockLookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(fakeApiResponse([embedding]));

      const result = await service.generateEmbedding('hello world');

      expect(result.embedding).toEqual(embedding);
      expect(result.cached).toBe(false);
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockStore).toHaveBeenCalled();
    });

    it('throws on empty text', async () => {
      await expect(service.generateEmbedding('')).rejects.toThrow(/empty text/);
    });

    it('throws on whitespace-only text', async () => {
      await expect(service.generateEmbedding('   ')).rejects.toThrow(/empty text/);
    });

    it('sends correct request to OpenAI API', async () => {
      mockLookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(fakeApiResponse([fakeEmbedding()]));

      await service.generateEmbedding('test text');

      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/embeddings');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer sk-test-key');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('test-model');
      expect(body.input).toEqual(['test text']);
      expect(body.dimensions).toBe(10);
    });

    it('uses custom base URL from config', async () => {
      mockGetFieldValue.mockReturnValue('https://custom.api.com/v1');
      mockLookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(fakeApiResponse([fakeEmbedding()]));

      await service.generateEmbedding('test');

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://custom.api.com/v1/embeddings');
    });
  });

  describe('generateBatchEmbeddings', () => {
    it('uses cache for cached texts and API for uncached', async () => {
      const cached = fakeEmbedding();
      const fresh = fakeEmbedding(10).map(v => v + 1);

      // First text cached, second uncached
      mockLookup.mockResolvedValueOnce(cached).mockResolvedValueOnce(null);
      mockFetch.mockResolvedValue(fakeApiResponse([fresh]));

      const results = await service.generateBatchEmbeddings(['cached text', 'new text']);

      expect(results[0]!.embedding).toBe(cached);
      expect(results[0]!.cached).toBe(true);
      expect(results[1]!.embedding).toEqual(fresh);
      expect(results[1]!.cached).toBe(false);
    });

    it('returns all cached when all are cached', async () => {
      mockLookup.mockResolvedValue(fakeEmbedding());

      const results = await service.generateBatchEmbeddings(['a', 'b', 'c']);

      expect(results.every(r => r.cached)).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('handles empty text in batch', async () => {
      mockLookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(fakeApiResponse([fakeEmbedding()]));

      const results = await service.generateBatchEmbeddings(['', 'valid text']);

      expect(results[0]!.embedding).toEqual([]);
      expect(results[0]!.cached).toBe(true);
    });
  });

  describe('API error handling', () => {
    it('retries on 429 rate limit', async () => {
      mockLookup.mockResolvedValue(null);

      const rateLimitResponse = {
        ok: false,
        status: 429,
        headers: { get: (key: string) => key === 'retry-after' ? '0' : null },
        text: async () => 'Rate limited',
      };
      const successResponse = fakeApiResponse([fakeEmbedding()]);

      mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(successResponse);

      const result = await service.generateEmbedding('test');
      expect(result.embedding).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws on non-429 API error', async () => {
      mockLookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: () => null },
        text: async () => 'Internal server error',
      });

      await expect(service.generateEmbedding('test')).rejects.toThrow(/Embedding API error: 500/);
    });

    it('throws when no API key available', async () => {
      mockGetApiKey.mockReturnValue(null);
      const noKeyService = new EmbeddingService('test-model', 10);
      mockLookup.mockResolvedValue(null);

      await expect(noKeyService.generateEmbedding('test')).rejects.toThrow(/API key not configured/);
    });
  });
});
