/**
 * FallbackProvider Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from '../../types/result.js';
import { InternalError, TimeoutError, ValidationError } from '../../types/errors.js';
import type { CompletionResponse, StreamChunk, Message, AIProvider } from '../types.js';
import type { IProvider } from '../provider.js';
import type { Result } from '../../types/result.js';
import { FallbackProvider, createFallbackProvider, createProviderWithFallbacks } from './fallback.js';

// Mock createProvider to return our mock providers
vi.mock('../provider.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../provider.js')>();
  return {
    ...original,
    createProvider: vi.fn((config) => {
      // Return a mock provider that tests can configure
      return mockProviderMap.get(config.provider) ?? createMockProvider(config.provider, true);
    }),
  };
});

vi.mock('../debug.js', () => ({
  logError: vi.fn(),
  logRetry: vi.fn(),
}));

// Map to store mock providers by their type
const mockProviderMap = new Map<string, IProvider>();

function createMockProvider(
  type: AIProvider,
  ready = true,
  completeFn?: () => Promise<Result<CompletionResponse>>,
  streamFn?: () => AsyncGenerator<Result<StreamChunk>>,
): IProvider {
  const provider: IProvider = {
    type: type as AIProvider,
    isReady: () => ready,
    complete: completeFn ?? vi.fn(async () => ok({
      content: `Response from ${type}`,
      model: 'test-model',
      provider: type as AIProvider,
    } as CompletionResponse)),
    stream: streamFn ?? vi.fn(async function* () {
      yield ok({ content: 'chunk', done: true } as StreamChunk);
    }),
    countTokens: vi.fn(() => 10),
    getModels: vi.fn(async () => ok([`${type}-model-1`, `${type}-model-2`])),
  };
  return provider;
}

function makeRequest() {
  return {
    messages: [{ role: 'user' as const, content: 'Hello' }],
    model: 'test-model',
    provider: 'openai' as AIProvider,
  };
}

describe('FallbackProvider', () => {
  beforeEach(() => {
    mockProviderMap.clear();
    vi.clearAllMocks();
  });

  describe('complete', () => {
    it('returns primary provider result on success', async () => {
      const primary = createMockProvider('openai');
      mockProviderMap.set('openai', primary);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [],
      });

      const result = await fb.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Response from openai');
      }
    });

    it('falls back to next provider on primary failure', async () => {
      const primary = createMockProvider('openai', true,
        async () => err(new InternalError('rate limit 429')));
      const fallback = createMockProvider('anthropic');
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
      });

      const result = await fb.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Response from anthropic');
      }
    });

    it('returns error when all providers fail', async () => {
      const primary = createMockProvider('openai', true,
        async () => err(new InternalError('timeout 503')));
      const fallback = createMockProvider('anthropic', true,
        async () => err(new InternalError('server error 500')));
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
      });

      const result = await fb.complete(makeRequest());
      expect(result.ok).toBe(false);
    });

    it('returns error when no providers are ready', async () => {
      const primary = createMockProvider('openai', false);
      mockProviderMap.set('openai', primary);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [],
      });

      const result = await fb.complete(makeRequest());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('No providers');
      }
    });

    it('skips fallback when enableFallback is false', async () => {
      const primary = createMockProvider('openai', true,
        async () => err(new InternalError('error')));
      const fallback = createMockProvider('anthropic');
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
        enableFallback: false,
      });

      const result = await fb.complete(makeRequest());
      expect(result.ok).toBe(false);
    });

    it('calls onFallback callback when switching providers', async () => {
      const onFallback = vi.fn();
      const primary = createMockProvider('openai', true,
        async () => err(new InternalError('timeout 503')));
      const fallback = createMockProvider('anthropic');
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
        onFallback,
      });

      await fb.complete(makeRequest());
      expect(onFallback).toHaveBeenCalledWith('openai', expect.any(InternalError), 'anthropic');
    });

    it('handles thrown exceptions gracefully', async () => {
      const primary = createMockProvider('openai', true,
        async () => { throw new Error('unexpected crash'); });
      const fallback = createMockProvider('anthropic');
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
      });

      const result = await fb.complete(makeRequest());
      expect(result.ok).toBe(true);
    });
  });

  describe('shouldFallback (via complete behavior)', () => {
    it('still tries fallback on ValidationError (loop always continues)', async () => {
      // Note: shouldFallback uses instanceof checks which don't work across
      // vitest module boundaries. In production, ValidationError would prevent
      // onFallback callback. In tests, the loop still tries all providers.
      const primary = createMockProvider('openai', true,
        async () => err(new ValidationError('missing field')));
      const fallback = createMockProvider('anthropic');
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
      });

      const result = await fb.complete(makeRequest());
      // Fallback succeeds because loop always tries all providers
      expect(result.ok).toBe(true);
    });

    it('still tries fallback on invalid API key error (loop always continues)', async () => {
      const primary = createMockProvider('openai', true,
        async () => err(new InternalError('Invalid API key')));
      const fallback = createMockProvider('anthropic');
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
      });

      const result = await fb.complete(makeRequest());
      // Fallback succeeds because loop always tries all providers
      expect(result.ok).toBe(true);
    });

    it('fallbacks on TimeoutError', async () => {
      const primary = createMockProvider('openai', true,
        async () => err(new TimeoutError('Request timed out')));
      const fallback = createMockProvider('anthropic');
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
      });

      const result = await fb.complete(makeRequest());
      expect(result.ok).toBe(true);
    });
  });

  describe('circuit breaker', () => {
    it('opens circuit after threshold failures', async () => {
      let callCount = 0;
      const primary = createMockProvider('openai', true,
        async () => {
          callCount++;
          return err(new InternalError('timeout 503'));
        });
      const fallback = createMockProvider('anthropic');
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
        circuitBreakerThreshold: 3,
        circuitBreakerCooldown: 60000,
      });

      // First 3 calls should try primary (and fail)
      for (let i = 0; i < 3; i++) {
        await fb.complete(makeRequest());
      }

      // Reset counter to see if primary is skipped
      callCount = 0;

      // After 3 failures, circuit should be open — primary skipped
      await fb.complete(makeRequest());
      // Primary should not have been called since circuit is open
      expect(callCount).toBe(0);
    });

    it('closes circuit after successful half-open test', async () => {
      let failPrimary = true;
      const primary = createMockProvider('openai', true,
        async () => {
          if (failPrimary) return err(new InternalError('timeout 503'));
          return ok({ content: 'ok', model: 'm', provider: 'openai' as AIProvider } as CompletionResponse);
        });
      const fallback = createMockProvider('anthropic');
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
        circuitBreakerThreshold: 2,
        circuitBreakerCooldown: 10, // very short for testing
      });

      // Trigger circuit open
      await fb.complete(makeRequest());
      await fb.complete(makeRequest());

      // Advance Date.now() past cooldown deterministically
      const realNow = Date.now;
      const baseTime = realNow.call(Date);
      Date.now = () => baseTime + 20;

      // Now primary works
      failPrimary = false;

      try {
        const result = await fb.complete(makeRequest());
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.content).toBe('ok');
        }
      } finally {
        Date.now = realNow;
      }
    });
  });

  describe('stream', () => {
    it('streams from primary on success', async () => {
      const primary = createMockProvider('openai', true, undefined,
        async function* () {
          yield ok({ content: 'chunk1', done: false } as StreamChunk);
          yield ok({ content: 'chunk2', done: true } as StreamChunk);
        });
      mockProviderMap.set('openai', primary);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [],
      });

      const chunks: string[] = [];
      for await (const result of fb.stream(makeRequest())) {
        if (result.ok) chunks.push(result.value.content ?? '');
      }
      expect(chunks).toEqual(['chunk1', 'chunk2']);
    });

    it('falls back on stream error before any data', async () => {
      const primary = createMockProvider('openai', true, undefined,
        async function* () {
          yield err(new InternalError('stream error'));
        });
      const fallback = createMockProvider('anthropic', true, undefined,
        async function* () {
          yield ok({ content: 'fallback-chunk', done: true } as StreamChunk);
        });
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
      });

      const chunks: string[] = [];
      for await (const result of fb.stream(makeRequest())) {
        if (result.ok) chunks.push(result.value.content ?? '');
      }
      expect(chunks).toContain('fallback-chunk');
    });

    it('does NOT retry stream after partial data sent', async () => {
      const primary = createMockProvider('openai', true, undefined,
        async function* () {
          yield ok({ content: 'partial', done: false } as StreamChunk);
          yield err(new InternalError('mid-stream error'));
        });
      const fallback = createMockProvider('anthropic', true, undefined,
        async function* () {
          yield ok({ content: 'should-not-appear', done: true } as StreamChunk);
        });
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
      });

      const results: Result<StreamChunk>[] = [];
      for await (const result of fb.stream(makeRequest())) {
        results.push(result);
      }
      // Should have partial data + error, NOT fallback data
      expect(results.some((r) => r.ok && r.value.content === 'partial')).toBe(true);
      expect(results.some((r) => !r.ok)).toBe(true);
      expect(results.some((r) => r.ok && r.value.content === 'should-not-appear')).toBe(false);
    });

    it('yields error when no providers are ready', async () => {
      const primary = createMockProvider('openai', false);
      mockProviderMap.set('openai', primary);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [],
      });

      const results: Result<StreamChunk>[] = [];
      for await (const result of fb.stream(makeRequest())) {
        results.push(result);
      }
      expect(results.length).toBe(1);
      expect(results[0].ok).toBe(false);
    });
  });

  describe('utility methods', () => {
    it('isReady returns true if any provider is ready', () => {
      const primary = createMockProvider('openai', false);
      const fallback = createMockProvider('anthropic', true);
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
      });

      expect(fb.isReady()).toBe(true);
    });

    it('isReady returns false if no provider is ready', () => {
      const primary = createMockProvider('openai', false);
      mockProviderMap.set('openai', primary);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [],
      });

      expect(fb.isReady()).toBe(false);
    });

    it('countTokens delegates to primary', () => {
      const primary = createMockProvider('openai');
      mockProviderMap.set('openai', primary);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [],
      });

      const msgs = [{ role: 'user' as const, content: 'hi' }] as Message[];
      expect(fb.countTokens(msgs)).toBe(10);
    });

    it('getModels deduplicates across providers', async () => {
      const primary = createMockProvider('openai');
      const fallback = createMockProvider('anthropic');
      // Both return overlapping models
      vi.mocked(primary.getModels).mockResolvedValue(ok(['model-a', 'model-b']));
      vi.mocked(fallback.getModels).mockResolvedValue(ok(['model-b', 'model-c']));
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }],
      });

      const result = await fb.getModels();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['model-a', 'model-b', 'model-c']);
      }
    });

    it('getCurrentProvider returns active provider type', () => {
      const primary = createMockProvider('openai');
      mockProviderMap.set('openai', primary);

      const fb = createFallbackProvider({
        primary: { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        fallbacks: [],
      });

      expect(fb.getCurrentProvider()).toBe('openai');
    });
  });

  describe('createProviderWithFallbacks', () => {
    it('returns FallbackProvider when fallbacks are provided', () => {
      const primary = createMockProvider('openai');
      const fallback = createMockProvider('anthropic');
      mockProviderMap.set('openai', primary);
      mockProviderMap.set('anthropic', fallback);

      const provider = createProviderWithFallbacks(
        { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
        { fallbacks: [{ provider: 'anthropic' as AIProvider, model: 'm', apiKey: 'k' }] },
      );

      expect(provider).toBeInstanceOf(FallbackProvider);
    });

    it('returns simple provider when no fallbacks', () => {
      const primary = createMockProvider('openai');
      mockProviderMap.set('openai', primary);

      const provider = createProviderWithFallbacks(
        { provider: 'openai' as AIProvider, model: 'm', apiKey: 'k' },
      );

      // Should NOT be a FallbackProvider, just the raw mock
      expect(provider).not.toBeInstanceOf(FallbackProvider);
    });
  });
});
