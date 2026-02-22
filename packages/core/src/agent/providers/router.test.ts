import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ok, err, type Result } from '../../types/result.js';
import { InternalError, type ValidationError } from '../../types/errors.js';
import type { CompletionRequest, CompletionResponse, StreamChunk } from '../types.js';
import type { ModelConfig, ResolvedProviderConfig } from './configs/types.js';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockModel: ModelConfig = {
  id: 'test-model',
  name: 'Test Model',
  contextWindow: 128_000,
  maxOutput: 4096,
  inputPrice: 1.0,
  outputPrice: 2.0,
  capabilities: ['chat'],
  default: true,
};

const mockGoogleModel: ModelConfig = {
  id: 'gemini-pro',
  name: 'Gemini Pro',
  contextWindow: 128_000,
  maxOutput: 8192,
  inputPrice: 0.5,
  outputPrice: 1.5,
  capabilities: ['chat', 'vision'],
  default: true,
};

const mockProviderConfig: ResolvedProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  type: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  models: [mockModel],
  features: {
    streaming: true,
    toolUse: true,
    vision: true,
    jsonMode: true,
    systemMessage: true,
  },
};

const mockGoogleProviderConfig: ResolvedProviderConfig = {
  id: 'google',
  name: 'Google AI',
  type: 'google',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: 'google-key',
  models: [mockGoogleModel],
  features: {
    streaming: true,
    toolUse: true,
    vision: true,
    jsonMode: true,
    systemMessage: true,
  },
};

const excludedProviderConfig: ResolvedProviderConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  type: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'deepseek-key',
  models: [{ ...mockModel, id: 'deepseek-chat', name: 'DeepSeek Chat' }],
  features: {
    streaming: true,
    toolUse: true,
    vision: false,
    jsonMode: true,
    systemMessage: true,
  },
};

// ---------------------------------------------------------------------------
// Hoisted mock fns — declared via vi.hoisted so vi.mock factories can use them
// ---------------------------------------------------------------------------

const {
  mockComplete,
  mockStream,
  mockGetConfiguredProviders,
  mockFindModels,
  mockSelectBestModel,
  mockGetCheapestModel,
  mockGetFastestModel,
  mockGetSmartestModel,
  mockFromProviderId,
  mockFromEnv,
} = vi.hoisted(() => ({
  mockComplete: vi.fn(),
  mockStream: vi.fn(),
  mockGetConfiguredProviders: vi.fn(),
  mockFindModels: vi.fn(),
  mockSelectBestModel: vi.fn(),
  mockGetCheapestModel: vi.fn(),
  mockGetFastestModel: vi.fn(),
  mockGetSmartestModel: vi.fn(),
  mockFromProviderId: vi.fn(),
  mockFromEnv: vi.fn(),
}));

// ---------------------------------------------------------------------------
// vi.mock declarations
// ---------------------------------------------------------------------------

vi.mock('./configs/index.js', () => ({
  getConfiguredProviders: mockGetConfiguredProviders,
  findModels: mockFindModels,
  selectBestModel: mockSelectBestModel,
  getCheapestModel: mockGetCheapestModel,
  getFastestModel: mockGetFastestModel,
  getSmartestModel: mockGetSmartestModel,
}));

vi.mock('./openai-compatible.js', () => ({
  OpenAICompatibleProvider: {
    fromProviderId: mockFromProviderId,
  },
}));

vi.mock('./google.js', () => ({
  GoogleProvider: {
    fromEnv: mockFromEnv,
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  ProviderRouter,
  getDefaultRouter,
  createRouter,
  routedComplete,
  getCheapestProvider,
  getFastestProvider,
  getSmartestProvider,
} from './router.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides?: Partial<CompletionRequest>): CompletionRequest {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    model: {
      model: '',
      maxTokens: 1000,
      temperature: 0.7,
    },
    ...overrides,
  };
}

function makeCompletionResponse(overrides?: Partial<CompletionResponse>): CompletionResponse {
  return {
    id: 'resp-1',
    content: 'Hello back!',
    finishReason: 'stop',
    model: 'test-model',
    createdAt: new Date('2026-01-01'),
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    ...overrides,
  };
}

/** Reset all mocks and set default return values */
function resetMockDefaults(): void {
  mockGetConfiguredProviders.mockReturnValue([mockProviderConfig]);
  mockFindModels.mockReturnValue([{ provider: mockProviderConfig, model: mockModel }]);
  mockSelectBestModel.mockReturnValue({ provider: mockProviderConfig, model: mockModel });
  mockGetCheapestModel.mockReturnValue({ provider: mockProviderConfig, model: mockModel });
  mockGetFastestModel.mockReturnValue({ provider: mockProviderConfig, model: mockModel });
  mockGetSmartestModel.mockReturnValue({ provider: mockProviderConfig, model: mockModel });
  mockFromProviderId.mockReturnValue({ complete: mockComplete, stream: mockStream });
  mockFromEnv.mockReturnValue({ complete: mockComplete, stream: mockStream });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockDefaults();
  });

  // -------------------------------------------------------------------------
  // Constructor defaults
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('applies default config when no options provided', () => {
      const router = new ProviderRouter();
      // Verify defaults by exercising selectProvider which uses the config
      // The default strategy is 'balanced' which calls selectBestModel
      router.selectProvider();
      expect(mockSelectBestModel).toHaveBeenCalled();
    });

    it('merges user config with defaults', () => {
      const router = new ProviderRouter({
        defaultStrategy: 'cheapest',
        maxRetries: 5,
        excludedProviders: ['groq'],
      });
      // The default strategy is now 'cheapest'
      router.selectProvider();
      expect(mockGetCheapestModel).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getAvailableProviders
  // -------------------------------------------------------------------------

  describe('getAvailableProviders', () => {
    it('returns all configured providers when none excluded', () => {
      mockGetConfiguredProviders.mockReturnValue([mockProviderConfig, mockGoogleProviderConfig]);
      const router = new ProviderRouter();
      const providers = router.getAvailableProviders();
      expect(providers).toHaveLength(2);
      expect(providers.map((p) => p.id)).toEqual(['openai', 'google']);
    });

    it('filters out excluded providers', () => {
      mockGetConfiguredProviders.mockReturnValue([
        mockProviderConfig,
        excludedProviderConfig,
        mockGoogleProviderConfig,
      ]);
      const router = new ProviderRouter({ excludedProviders: ['deepseek'] });
      const providers = router.getAvailableProviders();
      expect(providers).toHaveLength(2);
      expect(providers.map((p) => p.id)).toEqual(['openai', 'google']);
    });
  });

  // -------------------------------------------------------------------------
  // selectProvider
  // -------------------------------------------------------------------------

  describe('selectProvider', () => {
    it('uses cheapest strategy', () => {
      const router = new ProviderRouter();
      const result = router.selectProvider({}, 'cheapest');
      expect(result.ok).toBe(true);
      expect(mockGetCheapestModel).toHaveBeenCalled();
    });

    it('uses fastest strategy', () => {
      const router = new ProviderRouter();
      const result = router.selectProvider({ capabilities: ['vision'] }, 'fastest');
      expect(result.ok).toBe(true);
      expect(mockGetFastestModel).toHaveBeenCalledWith(expect.arrayContaining(['vision']));
    });

    it('uses smartest strategy', () => {
      const router = new ProviderRouter();
      const result = router.selectProvider({}, 'smartest');
      expect(result.ok).toBe(true);
      expect(mockGetSmartestModel).toHaveBeenCalled();
    });

    it('uses balanced strategy (default) which calls selectBestModel', () => {
      const router = new ProviderRouter();
      const result = router.selectProvider();
      expect(result.ok).toBe(true);
      expect(mockSelectBestModel).toHaveBeenCalled();
    });

    it('uses fallback strategy which also calls selectBestModel', () => {
      const router = new ProviderRouter();
      const result = router.selectProvider({}, 'fallback');
      expect(result.ok).toBe(true);
      expect(mockSelectBestModel).toHaveBeenCalled();
    });

    it('merges required capabilities from config and criteria', () => {
      const router = new ProviderRouter({ requiredCapabilities: ['chat'] });
      router.selectProvider({ capabilities: ['vision'] }, 'cheapest');
      // getCheapestModel receives deduplicated capabilities
      expect(mockGetCheapestModel).toHaveBeenCalledWith(expect.arrayContaining(['chat', 'vision']));
    });

    it('returns error when no provider found (selection returns null)', () => {
      mockSelectBestModel.mockReturnValue(null);
      const router = new ProviderRouter();
      const result = router.selectProvider();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('ValidationError');
        expect(result.error.message).toContain('No suitable provider found');
      }
    });

    it('returns error when provider creation fails', () => {
      mockSelectBestModel.mockReturnValue({
        provider: { id: 'openai' },
        model: mockModel,
      });
      mockFromProviderId.mockReturnValue(null);
      const router = new ProviderRouter();
      const result = router.selectProvider();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('ValidationError');
        expect(result.error.message).toContain('Failed to create provider');
      }
    });

    it('populates RoutingResult with correct fields on success', () => {
      const router = new ProviderRouter();
      const result = router.selectProvider();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.providerId).toBe('openai');
        expect(result.value.modelId).toBe('test-model');
        expect(result.value.modelConfig).toBe(mockModel);
        expect(result.value.estimatedCost).toEqual({
          inputPer1M: 1.0,
          outputPer1M: 2.0,
        });
      }
    });
  });

  // -------------------------------------------------------------------------
  // complete
  // -------------------------------------------------------------------------

  describe('complete', () => {
    it('returns completion with routingInfo on success', async () => {
      const mockResponse = makeCompletionResponse();
      mockComplete.mockResolvedValue(ok(mockResponse));

      const router = new ProviderRouter();
      const result = await router.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello back!');
        expect(result.value.routingInfo).toBeDefined();
        expect(result.value.routingInfo.providerId).toBe('openai');
        expect(result.value.routingInfo.modelId).toBe('test-model');
      }
    });

    it('uses routed model ID when request.model.model is empty', async () => {
      const mockResponse = makeCompletionResponse();
      mockComplete.mockResolvedValue(ok(mockResponse));

      const router = new ProviderRouter();
      await router.complete(makeRequest({ model: { model: '' } }));

      expect(mockComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ model: 'test-model' }),
        })
      );
    });

    it('preserves request.model.model when already set', async () => {
      const mockResponse = makeCompletionResponse();
      mockComplete.mockResolvedValue(ok(mockResponse));

      const router = new ProviderRouter();
      await router.complete(makeRequest({ model: { model: 'custom-model' } }));

      expect(mockComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({ model: 'custom-model' }),
        })
      );
    });

    it('propagates selection error', async () => {
      mockSelectBestModel.mockReturnValue(null);

      const router = new ProviderRouter();
      const result = await router.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('ValidationError');
      }
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('propagates provider error', async () => {
      mockComplete.mockResolvedValue(err(new InternalError('Provider timeout')));

      const router = new ProviderRouter();
      const result = await router.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('InternalError');
        expect(result.error.message).toBe('Provider timeout');
      }
    });
  });

  // -------------------------------------------------------------------------
  // stream
  // -------------------------------------------------------------------------

  describe('stream', () => {
    it('yields routingInfo on the first chunk only', async () => {
      const chunk1: StreamChunk = { id: 'c1', content: 'He', done: false };
      const chunk2: StreamChunk = { id: 'c2', content: 'llo', done: true, finishReason: 'stop' };

      async function* fakeStream() {
        yield ok(chunk1);
        yield ok(chunk2);
      }
      mockStream.mockReturnValue(fakeStream());

      const router = new ProviderRouter();
      const chunks: Array<
        Result<StreamChunk & { routingInfo?: unknown }, InternalError | ValidationError>
      > = [];
      for await (const chunk of router.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      // First chunk has routingInfo
      expect(chunks[0].ok).toBe(true);
      expect(chunks[0].value.routingInfo).toBeDefined();
      expect(chunks[0].value.routingInfo.providerId).toBe('openai');
      expect(chunks[0].value.content).toBe('He');
      // Second chunk does NOT have routingInfo
      expect(chunks[1].ok).toBe(true);
      expect(chunks[1].value.routingInfo).toBeUndefined();
      expect(chunks[1].value.content).toBe('llo');
    });

    it('yields error when no provider found', async () => {
      mockSelectBestModel.mockReturnValue(null);

      const router = new ProviderRouter();
      const chunks: Array<
        Result<StreamChunk & { routingInfo?: unknown }, InternalError | ValidationError>
      > = [];
      for await (const chunk of router.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].ok).toBe(false);
      expect(chunks[0].error.constructor.name).toBe('ValidationError');
    });

    it('forwards stream errors from provider', async () => {
      async function* fakeStream() {
        yield err(new InternalError('Stream broke'));
      }
      mockStream.mockReturnValue(fakeStream());

      const router = new ProviderRouter();
      const chunks: Array<
        Result<StreamChunk & { routingInfo?: unknown }, InternalError | ValidationError>
      > = [];
      for await (const chunk of router.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].ok).toBe(false);
      expect(chunks[0].error.message).toBe('Stream broke');
    });
  });

  // -------------------------------------------------------------------------
  // completeWithFallback
  // -------------------------------------------------------------------------

  describe('completeWithFallback', () => {
    it('succeeds on first try', async () => {
      const mockResponse = makeCompletionResponse();
      mockComplete.mockResolvedValue(ok(mockResponse));
      mockFindModels.mockReturnValue([{ provider: mockProviderConfig, model: mockModel }]);

      const router = new ProviderRouter();
      const result = await router.completeWithFallback(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello back!');
        expect(result.value.attempts).toEqual(['openai']);
        expect(result.value.routingInfo.providerId).toBe('openai');
      }
    });

    it('tries next candidate after first failure', async () => {
      const secondModel: ModelConfig = {
        ...mockModel,
        id: 'backup-model',
        name: 'Backup Model',
      };
      const secondProviderConfig: ResolvedProviderConfig = {
        ...mockProviderConfig,
        id: 'anthropic',
        name: 'Anthropic',
      };

      mockFindModels.mockReturnValue([
        { provider: mockProviderConfig, model: mockModel },
        { provider: secondProviderConfig, model: secondModel },
      ]);

      const failComplete = vi.fn().mockResolvedValue(err(new InternalError('Rate limited')));
      const successComplete = vi
        .fn()
        .mockResolvedValue(ok(makeCompletionResponse({ model: 'backup-model' })));

      mockFromProviderId
        .mockReturnValueOnce({ complete: failComplete, stream: mockStream })
        .mockReturnValueOnce({ complete: successComplete, stream: mockStream });

      const router = new ProviderRouter();
      router.clearCache();
      const result = await router.completeWithFallback(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.attempts).toEqual(['openai', 'anthropic']);
        expect(result.value.routingInfo.providerId).toBe('anthropic');
        expect(result.value.routingInfo.modelId).toBe('backup-model');
      }
    });

    it('returns error when all candidates fail', async () => {
      mockFindModels.mockReturnValue([
        { provider: mockProviderConfig, model: mockModel },
        { provider: { ...mockProviderConfig, id: 'anthropic' }, model: mockModel },
      ]);
      mockComplete.mockResolvedValue(err(new InternalError('Overloaded')));

      const router = new ProviderRouter();
      router.clearCache();
      const result = await router.completeWithFallback(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('InternalError');
        expect(result.error.message).toContain('All providers failed after 2 attempts');
      }
    });

    it('respects maxRetries limit', async () => {
      const candidates = Array.from({ length: 5 }, (_, i) => ({
        provider: { ...mockProviderConfig, id: `provider-${i}` },
        model: { ...mockModel, id: `model-${i}` },
      }));
      mockFindModels.mockReturnValue(candidates);
      mockComplete.mockResolvedValue(err(new InternalError('Fail')));

      const router = new ProviderRouter({ maxRetries: 2 });
      router.clearCache();
      const result = await router.completeWithFallback(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Only 2 attempts despite 5 candidates
        expect(result.error.message).toContain('after 2 attempts');
      }
    });

    it('skips candidate when provider creation returns null', async () => {
      const secondProviderConfig = { ...mockProviderConfig, id: 'anthropic' };
      mockFindModels.mockReturnValue([
        { provider: { ...mockProviderConfig, id: 'broken' }, model: mockModel },
        { provider: secondProviderConfig, model: mockModel },
      ]);

      mockFromProviderId
        .mockReturnValueOnce(null) // broken provider
        .mockReturnValueOnce({
          complete: vi.fn().mockResolvedValue(ok(makeCompletionResponse())),
          stream: mockStream,
        });

      const router = new ProviderRouter();
      router.clearCache();
      const result = await router.completeWithFallback(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.attempts).toEqual(['broken', 'anthropic']);
      }
    });
  });

  // -------------------------------------------------------------------------
  // estimateCost
  // -------------------------------------------------------------------------

  describe('estimateCost', () => {
    it('calculates cost from input and output token counts', () => {
      const router = new ProviderRouter();
      const result = router.estimateCost(1_000_000, 500_000);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // inputPrice=1.0 per 1M, outputPrice=2.0 per 1M
        // (1_000_000 / 1_000_000) * 1.0 + (500_000 / 1_000_000) * 2.0 = 1.0 + 1.0 = 2.0
        expect(result.value.estimatedCost).toBeCloseTo(2.0);
        expect(result.value.providerId).toBe('openai');
        expect(result.value.modelId).toBe('test-model');
      }
    });

    it('returns zero cost for zero tokens', () => {
      const router = new ProviderRouter();
      const result = router.estimateCost(0, 0);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.estimatedCost).toBe(0);
      }
    });

    it('propagates selection error', () => {
      mockSelectBestModel.mockReturnValue(null);
      const router = new ProviderRouter();
      const result = router.estimateCost(1000, 1000);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('ValidationError');
      }
    });

    it('passes strategy through to selectProvider', () => {
      const router = new ProviderRouter();
      router.estimateCost(1000, 1000, {}, 'cheapest');
      expect(mockGetCheapestModel).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // clearCache / getOrCreateProvider caching
  // -------------------------------------------------------------------------

  describe('clearCache', () => {
    it('clears the provider cache so next call creates fresh instances', () => {
      const router = new ProviderRouter();

      // First call creates the provider
      router.selectProvider();
      expect(mockFromProviderId).toHaveBeenCalledTimes(1);

      // Second call uses cache
      router.selectProvider();
      expect(mockFromProviderId).toHaveBeenCalledTimes(1);

      // After clearing cache, a new instance is created
      router.clearCache();
      router.selectProvider();
      expect(mockFromProviderId).toHaveBeenCalledTimes(2);
    });
  });

  describe('getOrCreateProvider (via selectProvider)', () => {
    it('caches provider instances by ID', () => {
      const router = new ProviderRouter();
      const r1 = router.selectProvider();
      const r2 = router.selectProvider();

      expect(r1.ok && r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        // Same instance returned from cache
        expect(r1.value.provider).toBe(r2.value.provider);
      }
      // Only one factory call
      expect(mockFromProviderId).toHaveBeenCalledTimes(1);
    });

    it('creates GoogleProvider for provider ID "google"', () => {
      mockSelectBestModel.mockReturnValue({
        provider: mockGoogleProviderConfig,
        model: mockGoogleModel,
      });

      const router = new ProviderRouter();
      const result = router.selectProvider();

      expect(result.ok).toBe(true);
      expect(mockFromEnv).toHaveBeenCalled();
      expect(mockFromProviderId).not.toHaveBeenCalled();
    });

    it('creates OpenAICompatibleProvider for non-google provider IDs', () => {
      const router = new ProviderRouter();
      router.selectProvider();

      expect(mockFromProviderId).toHaveBeenCalledWith('openai');
      expect(mockFromEnv).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Factory functions
  // -------------------------------------------------------------------------

  describe('factory functions', () => {
    it('getDefaultRouter returns a ProviderRouter instance', () => {
      const router = getDefaultRouter();
      expect(router).toBeInstanceOf(ProviderRouter);
    });

    it('getDefaultRouter returns the same instance on repeated calls', () => {
      const r1 = getDefaultRouter();
      const r2 = getDefaultRouter();
      expect(r1).toBe(r2);
    });

    it('createRouter returns a new ProviderRouter each time', () => {
      const r1 = createRouter();
      const r2 = createRouter();
      expect(r1).not.toBe(r2);
      expect(r1).toBeInstanceOf(ProviderRouter);
    });

    it('createRouter accepts custom config', () => {
      const router = createRouter({ defaultStrategy: 'fastest' });
      router.selectProvider();
      expect(mockGetFastestModel).toHaveBeenCalled();
    });

    it('routedComplete delegates to default router and strips routingInfo', async () => {
      const mockResponse = makeCompletionResponse();
      mockComplete.mockResolvedValue(ok(mockResponse));

      const result = await routedComplete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello back!');
        // routingInfo should be stripped
        expect((result.value as Record<string, unknown>).routingInfo).toBeUndefined();
      }
    });

    it('getCheapestProvider selects with cheapest strategy', () => {
      const result = getCheapestProvider(['chat']);
      expect(result.ok).toBe(true);
      expect(mockGetCheapestModel).toHaveBeenCalled();
    });

    it('getFastestProvider selects with fastest strategy', () => {
      const result = getFastestProvider(['chat']);
      expect(result.ok).toBe(true);
      expect(mockGetFastestModel).toHaveBeenCalled();
    });

    it('getSmartestProvider selects with smartest strategy', () => {
      const result = getSmartestProvider(['chat']);
      expect(result.ok).toBe(true);
      expect(mockGetSmartestModel).toHaveBeenCalled();
    });
  });
});
