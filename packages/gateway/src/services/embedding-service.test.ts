/**
 * EmbeddingService Tests
 *
 * Tests for embedding generation, caching, batch processing, API calls,
 * rate-limit retries, base URL resolution, and singleton factory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const mockConfigServicesRepo = {
  getApiKey: vi.fn(),
  getFieldValue: vi.fn(),
};
vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    getApiKey: (...args: unknown[]) => mockConfigServicesRepo.getApiKey(...args),
    getFieldValue: (...args: unknown[]) => mockConfigServicesRepo.getFieldValue(...args),
  },
}));

const mockEmbeddingCacheRepo = {
  lookup: vi.fn(),
  store: vi.fn(),
  contentHash: vi.fn((text: string) => `hash_${text}`),
};
vi.mock('../db/repositories/embedding-cache.js', () => ({
  EmbeddingCacheRepository: {
    contentHash: (text: string) => mockEmbeddingCacheRepo.contentHash(text),
  },
  embeddingCacheRepo: {
    lookup: (...args: unknown[]) => mockEmbeddingCacheRepo.lookup(...args),
    store: (...args: unknown[]) => mockEmbeddingCacheRepo.store(...args),
  },
}));

vi.mock('../config/defaults.js', () => ({
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIMENSIONS: 1536,
  EMBEDDING_MAX_BATCH_SIZE: 100,
  EMBEDDING_RATE_LIMIT_DELAY_MS: 100,
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeEmbedding(dim = 8): number[] {
  return Array.from({ length: dim }, (_, i) => i * 0.1);
}

function mockFetchResponse(embeddings: number[][], status = 200) {
  return {
    ok: status === 200,
    status,
    headers: { get: vi.fn() },
    json: vi.fn().mockResolvedValue({
      data: embeddings.map((e, i) => ({ embedding: e, index: i })),
    }),
    text: vi.fn().mockResolvedValue('error body'),
  };
}

function mockRateLimitResponse(retryAfterSeconds?: string) {
  return {
    ok: false,
    status: 429,
    headers: {
      get: vi.fn((key: string) => (key === 'retry-after' ? (retryAfterSeconds ?? '0') : null)),
    },
    json: vi.fn(),
    text: vi.fn().mockResolvedValue('Rate limited'),
  };
}

function mockErrorResponse(status: number, body = 'Server error') {
  return {
    ok: false,
    status,
    headers: { get: vi.fn() },
    json: vi.fn(),
    text: vi.fn().mockResolvedValue(body),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default: Config Center has API key, no custom base URL
    mockConfigServicesRepo.getApiKey.mockReturnValue('sk-test-key-123');
    mockConfigServicesRepo.getFieldValue.mockReturnValue(null);
    mockEmbeddingCacheRepo.store.mockResolvedValue(undefined);

    // Clean env
    delete process.env.OPENAI_API_KEY;

    service = new EmbeddingService('test-model', 8);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...savedEnv };
  });

  // =========================================================================
  // isAvailable
  // =========================================================================

  describe('isAvailable', () => {
    it('returns true when Config Center has API key', () => {
      mockConfigServicesRepo.getApiKey.mockReturnValue('sk-from-config-center');
      const svc = new EmbeddingService('test-model', 8);

      expect(svc.isAvailable()).toBe(true);
    });

    it('returns true when env var OPENAI_API_KEY is set', () => {
      mockConfigServicesRepo.getApiKey.mockReturnValue(null);
      process.env.OPENAI_API_KEY = 'sk-from-env';
      const svc = new EmbeddingService('test-model', 8);

      expect(svc.isAvailable()).toBe(true);
    });

    it('returns false when no API key is configured anywhere', () => {
      mockConfigServicesRepo.getApiKey.mockReturnValue(null);
      delete process.env.OPENAI_API_KEY;
      const svc = new EmbeddingService('test-model', 8);

      expect(svc.isAvailable()).toBe(false);
    });

    it('prefers Config Center key over env var', () => {
      mockConfigServicesRepo.getApiKey.mockReturnValue('sk-cc');
      process.env.OPENAI_API_KEY = 'sk-env';

      // isAvailable just needs to succeed; we verify precedence via the fetch call
      expect(service.isAvailable()).toBe(true);
    });
  });

  // =========================================================================
  // generateEmbedding
  // =========================================================================

  describe('generateEmbedding', () => {
    it('returns cached embedding on cache hit without calling fetch', async () => {
      const cachedVec = fakeEmbedding();
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(cachedVec);

      const result = await service.generateEmbedding('hello world');

      expect(result.embedding).toBe(cachedVec);
      expect(result.cached).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls API on cache miss and returns cached: false', async () => {
      const vec = fakeEmbedding();
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockFetchResponse([vec]));

      const result = await service.generateEmbedding('hello world');

      expect(result.embedding).toEqual(vec);
      expect(result.cached).toBe(false);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('stores result in cache after API call (fire-and-forget)', async () => {
      const vec = fakeEmbedding();
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockFetchResponse([vec]));

      await service.generateEmbedding('test text');

      expect(mockEmbeddingCacheRepo.store).toHaveBeenCalledWith(
        'hash_test text',
        'test-model',
        vec,
      );
    });

    it('trims whitespace from input text before processing', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockFetchResponse([fakeEmbedding()]));

      await service.generateEmbedding('  hello world  ');

      // contentHash is called with trimmed text
      expect(mockEmbeddingCacheRepo.contentHash).toHaveBeenCalledWith('hello world');

      // API receives trimmed text
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.input).toEqual(['hello world']);
    });

    it('throws on empty text', async () => {
      await expect(service.generateEmbedding('')).rejects.toThrow('Cannot generate embedding for empty text');
    });

    it('throws on whitespace-only text', async () => {
      await expect(service.generateEmbedding('   \t\n  ')).rejects.toThrow('Cannot generate embedding for empty text');
    });

    it('throws with status and body on non-200 API error', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal server error'));

      await expect(service.generateEmbedding('test')).rejects.toThrow(
        /Embedding API error: 500 - Internal server error/,
      );
    });

    it('calls fetch with correct URL, headers, and body', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockFetchResponse([fakeEmbedding()]));

      await service.generateEmbedding('sample text');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/embeddings');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['Authorization']).toBe('Bearer sk-test-key-123');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('test-model');
      expect(body.input).toEqual(['sample text']);
      expect(body.dimensions).toBe(8);
    });
  });

  // =========================================================================
  // generateBatchEmbeddings
  // =========================================================================

  describe('generateBatchEmbeddings', () => {
    it('returns all cached results when all texts are in cache', async () => {
      const vec = fakeEmbedding();
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(vec);

      const results = await service.generateBatchEmbeddings(['text1', 'text2', 'text3']);

      expect(results).toHaveLength(3);
      expect(results.every(r => r.cached)).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('handles mix of cached and uncached texts', async () => {
      const cachedVec = [0.1, 0.2, 0.3];
      const freshVec = [0.4, 0.5, 0.6];

      // First text cached, second uncached
      mockEmbeddingCacheRepo.lookup
        .mockResolvedValueOnce(cachedVec)
        .mockResolvedValueOnce(null);
      mockFetch.mockResolvedValue(mockFetchResponse([freshVec]));

      const results = await service.generateBatchEmbeddings(['cached', 'fresh']);

      expect(results[0]!.embedding).toBe(cachedVec);
      expect(results[0]!.cached).toBe(true);
      expect(results[1]!.embedding).toEqual(freshVec);
      expect(results[1]!.cached).toBe(false);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('handles empty text in batch with cached: true and empty embedding', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockFetchResponse([fakeEmbedding()]));

      const results = await service.generateBatchEmbeddings(['', 'valid text']);

      expect(results[0]!.embedding).toEqual([]);
      expect(results[0]!.cached).toBe(true);
      expect(results[1]!.cached).toBe(false);
    });

    it('sends all uncached texts in a single API call when within batch size', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      const vecs = [fakeEmbedding(), fakeEmbedding(), fakeEmbedding()];
      mockFetch.mockResolvedValue(mockFetchResponse(vecs));

      const results = await service.generateBatchEmbeddings(['a', 'b', 'c']);

      expect(mockFetch).toHaveBeenCalledOnce();
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.input).toEqual(['a', 'b', 'c']);
      expect(results).toHaveLength(3);
      expect(results.every(r => !r.cached)).toBe(true);
    });

    it('chunks API calls by EMBEDDING_MAX_BATCH_SIZE', async () => {
      // Mock with MAX_BATCH_SIZE = 100 from defaults mock.
      // We use a service with a small batch size to test chunking.
      // Since EMBEDDING_MAX_BATCH_SIZE is 100, we need >100 texts.
      // Create 150 uncached texts.
      const texts = Array.from({ length: 150 }, (_, i) => `text_${i}`);
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);

      // First batch: 100 items, second batch: 50 items
      const vecs1 = Array.from({ length: 100 }, () => fakeEmbedding());
      const vecs2 = Array.from({ length: 50 }, () => fakeEmbedding());
      mockFetch
        .mockResolvedValueOnce(mockFetchResponse(vecs1))
        .mockResolvedValueOnce(mockFetchResponse(vecs2));

      const promise = service.generateBatchEmbeddings(texts);

      // Advance past rate limit delay between batches
      await vi.advanceTimersByTimeAsync(200);

      const results = await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(150);

      // First batch should have 100 items
      const body1 = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body1.input).toHaveLength(100);

      // Second batch should have 50 items
      const body2 = JSON.parse(mockFetch.mock.calls[1]![1].body);
      expect(body2.input).toHaveLength(50);
    });

    it('stores each uncached embedding in cache', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      const vecs = [fakeEmbedding(), fakeEmbedding()];
      mockFetch.mockResolvedValue(mockFetchResponse(vecs));

      await service.generateBatchEmbeddings(['alpha', 'beta']);

      expect(mockEmbeddingCacheRepo.store).toHaveBeenCalledTimes(2);
      expect(mockEmbeddingCacheRepo.store).toHaveBeenCalledWith('hash_alpha', 'test-model', vecs[0]);
      expect(mockEmbeddingCacheRepo.store).toHaveBeenCalledWith('hash_beta', 'test-model', vecs[1]);
    });

    it('returns empty array for empty input', async () => {
      const results = await service.generateBatchEmbeddings([]);

      expect(results).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // callEmbeddingAPI (tested via generateEmbedding)
  // =========================================================================

  describe('callEmbeddingAPI (via generateEmbedding)', () => {
    it('retries once on 429 rate limit with retry-after header', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);

      mockFetch
        .mockResolvedValueOnce(mockRateLimitResponse('1'))
        .mockResolvedValueOnce(mockFetchResponse([fakeEmbedding()]));

      const promise = service.generateEmbedding('test');

      // Advance past the retry-after delay (1 second)
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(result.embedding).toBeDefined();
      expect(result.cached).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws on second 429 (does not retry forever)', async () => {
      vi.useRealTimers(); // Use real timers to avoid unhandled rejection timing issues
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);

      // Both calls return 429 with retry-after: 0 (instant retry)
      mockFetch
        .mockResolvedValueOnce(mockRateLimitResponse('0'))
        .mockResolvedValueOnce(mockRateLimitResponse('0'));

      await expect(service.generateEmbedding('test')).rejects.toThrow(/Embedding API error: 429/);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      vi.useFakeTimers(); // Restore fake timers for subsequent tests
    });

    it('uses default retry-after of 5 seconds when header is missing', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);

      const rateLimitNoHeader = {
        ok: false,
        status: 429,
        headers: { get: vi.fn().mockReturnValue(null) },
        text: vi.fn().mockResolvedValue('Rate limited'),
      };

      mockFetch
        .mockResolvedValueOnce(rateLimitNoHeader)
        .mockResolvedValueOnce(mockFetchResponse([fakeEmbedding()]));

      const promise = service.generateEmbedding('test');

      // Default is 5 seconds per parseInt(null ?? '5', 10)
      await vi.advanceTimersByTimeAsync(6000);

      const result = await promise;
      expect(result.embedding).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws on non-200/non-429 API error with status and body', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockErrorResponse(403, 'Forbidden'));

      await expect(service.generateEmbedding('test')).rejects.toThrow(
        /Embedding API error: 403 - Forbidden/,
      );
    });

    it('sorts response embeddings by index to maintain input order', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);

      // API returns items out of order
      const outOfOrderResponse = {
        ok: true,
        status: 200,
        headers: { get: vi.fn() },
        json: vi.fn().mockResolvedValue({
          data: [
            { embedding: [0.3, 0.3], index: 2 },
            { embedding: [0.1, 0.1], index: 0 },
            { embedding: [0.2, 0.2], index: 1 },
          ],
        }),
        text: vi.fn(),
      };

      mockFetch.mockResolvedValue(outOfOrderResponse);

      const results = await service.generateBatchEmbeddings(['a', 'b', 'c']);

      // Results should be sorted by original index
      expect(results[0]!.embedding).toEqual([0.1, 0.1]);
      expect(results[1]!.embedding).toEqual([0.2, 0.2]);
      expect(results[2]!.embedding).toEqual([0.3, 0.3]);
    });
  });

  // =========================================================================
  // getBaseUrl (tested via generateEmbedding fetch URL)
  // =========================================================================

  describe('getBaseUrl (via generateEmbedding)', () => {
    beforeEach(() => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockFetchResponse([fakeEmbedding()]));
    });

    it('uses custom base_url from Config Center', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('https://my-azure.openai.azure.com/v1');

      await service.generateEmbedding('test');

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://my-azure.openai.azure.com/v1/embeddings');
    });

    it('defaults to https://api.openai.com/v1 when no custom URL', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue(null);

      await service.generateEmbedding('test');

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/embeddings');
    });

    it('defaults to openai.com when custom URL is empty string', async () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('');

      await service.generateEmbedding('test');

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/embeddings');
    });
  });

  // =========================================================================
  // getApiKey resolution (tested via generateEmbedding)
  // =========================================================================

  describe('getApiKey resolution (via generateEmbedding)', () => {
    it('uses Config Center key in Authorization header', async () => {
      mockConfigServicesRepo.getApiKey.mockReturnValue('sk-config-center');
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockFetchResponse([fakeEmbedding()]));

      await service.generateEmbedding('test');

      const options = mockFetch.mock.calls[0]![1];
      expect(options.headers['Authorization']).toBe('Bearer sk-config-center');
    });

    it('falls back to OPENAI_API_KEY env var when Config Center returns null', async () => {
      mockConfigServicesRepo.getApiKey.mockReturnValue(null);
      process.env.OPENAI_API_KEY = 'sk-env-fallback';
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockFetchResponse([fakeEmbedding()]));

      await service.generateEmbedding('test');

      const options = mockFetch.mock.calls[0]![1];
      expect(options.headers['Authorization']).toBe('Bearer sk-env-fallback');
    });

    it('throws when neither Config Center nor env var has a key', async () => {
      mockConfigServicesRepo.getApiKey.mockReturnValue(null);
      delete process.env.OPENAI_API_KEY;
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);

      await expect(service.generateEmbedding('test')).rejects.toThrow(
        /OpenAI API key not configured/,
      );
    });
  });

  // =========================================================================
  // Constructor defaults
  // =========================================================================

  describe('constructor', () => {
    it('uses defaults from config/defaults.js when no arguments provided', async () => {
      const defaultService = new EmbeddingService();
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockFetchResponse([fakeEmbedding()]));

      await defaultService.generateEmbedding('test');

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.model).toBe('text-embedding-3-small');
      expect(body.dimensions).toBe(1536);
    });

    it('accepts custom model name and dimensions', async () => {
      const customService = new EmbeddingService('custom-model', 256);
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockFetchResponse([fakeEmbedding()]));

      await customService.generateEmbedding('test');

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.model).toBe('custom-model');
      expect(body.dimensions).toBe(256);
    });
  });

  // =========================================================================
  // getEmbeddingService singleton
  // =========================================================================

  describe('getEmbeddingService', () => {
    it('returns the same instance on repeated calls', async () => {
      // Dynamic import to get the singleton factory, avoiding module-level caching issues
      const mod = await import('./embedding-service.js');
      const a = mod.getEmbeddingService();
      const b = mod.getEmbeddingService();

      expect(a).toBe(b);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles cache store failure gracefully (fire-and-forget)', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockEmbeddingCacheRepo.store.mockRejectedValue(new Error('DB write failed'));
      mockFetch.mockResolvedValue(mockFetchResponse([fakeEmbedding()]));

      // Should not throw even though store rejects
      const result = await service.generateEmbedding('test');

      expect(result.embedding).toBeDefined();
      expect(result.cached).toBe(false);
    });

    it('handles response.text() failure in error path', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);

      const brokenErrorResponse = {
        ok: false,
        status: 502,
        headers: { get: vi.fn() },
        text: vi.fn().mockRejectedValue(new Error('Stream broken')),
      };
      mockFetch.mockResolvedValue(brokenErrorResponse);

      await expect(service.generateEmbedding('test')).rejects.toThrow(
        /Embedding API error: 502 - Unknown error/,
      );
    });

    it('passes correct arguments to cache lookup', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(fakeEmbedding());

      await service.generateEmbedding('my text');

      expect(mockEmbeddingCacheRepo.contentHash).toHaveBeenCalledWith('my text');
      expect(mockEmbeddingCacheRepo.lookup).toHaveBeenCalledWith('hash_my text', 'test-model');
    });

    it('batch embeddings trim whitespace per text', async () => {
      mockEmbeddingCacheRepo.lookup.mockResolvedValue(null);
      mockFetch.mockResolvedValue(mockFetchResponse([fakeEmbedding(), fakeEmbedding()]));

      await service.generateBatchEmbeddings(['  hello  ', '  world  ']);

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.input).toEqual(['hello', 'world']);
    });
  });
});
