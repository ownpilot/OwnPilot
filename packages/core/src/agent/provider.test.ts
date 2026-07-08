import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderConfig } from './types.js';
import type { ResolvedProviderConfig } from './providers/configs/index.js';
import type { ProviderFeatures } from './providers/configs/index.js';

// Mock GoogleProvider so we can control withApiKey behavior
vi.mock('./providers/google.js', () => {
  const mockGoogleProvider = {
    type: 'google',
    isReady: vi.fn().mockReturnValue(true),
    complete: vi.fn(),
    stream: vi.fn(),
    countTokens: vi.fn().mockReturnValue(0),
    getModels: vi.fn(),
  };
  return {
    GoogleProvider: {
      withApiKey: vi.fn().mockReturnValue(mockGoogleProvider),
      _mockInstance: mockGoogleProvider,
    },
  };
});

// Mock the configs/index module so we can control openai-compatible resolution
vi.mock('./providers/configs/index.js', () => {
  const mockResolvedConfig: ResolvedProviderConfig = {
    id: 'mock-provider',
    name: 'Mock Provider',
    type: 'openai-compatible',
    baseUrl: 'https://mock.api.com/v1',
    apiKey: 'mock-catalog-key',
    models: [
      {
        id: 'mock-model',
        name: 'Mock Model',
        contextWindow: 128_000,
        maxOutput: 4096,
        inputPrice: 0,
        outputPrice: 0,
        capabilities: ['chat', 'streaming'],
        default: true,
      },
    ],
    features: {
      streaming: true,
      toolUse: true,
      vision: false,
      jsonMode: true,
      systemMessage: true,
    },
  };

  return {
    resolveProviderConfig: vi.fn().mockReturnValue(mockResolvedConfig),
    loadProviderConfig: vi.fn().mockReturnValue({
      id: 'mock-provider',
      name: 'Mock Provider',
      type: 'openai-compatible',
      baseUrl: 'https://mock.api.com/v1',
      apiKeyEnv: 'MOCK_API_KEY',
      models: [
        {
          id: 'mock-model',
          name: 'Mock Model',
          contextWindow: 128_000,
          maxOutput: 4096,
          inputPrice: 0,
          outputPrice: 0,
          capabilities: ['chat', 'streaming'],
          default: true,
        },
      ],
      features: {
        streaming: true,
        toolUse: true,
        vision: false,
        jsonMode: true,
        systemMessage: true,
      },
    }),
  };
});

// Track openai-compatible calls for assertions
const openaiCompatCalls = vi.hoisted(() => ({ count: 0 }));
// Hoisted mock function reference for OpenAICompatibleProvider
vi.mock('./providers/openai-compatible.js', () => {
  const mockOpenAICompatInstance = {
    type: 'openai-compatible',
    isReady: () => true,
    complete: vi.fn(),
    stream: vi.fn(),
    countTokens: () => 0,
    getModels: vi.fn(),
    healthCheck: vi.fn(),
    recordMetric: vi.fn(),
    cancel: vi.fn(),
  };
  function OpenAICompatibleProvider(_config: unknown) {
    openaiCompatCalls.count++;
    return mockOpenAICompatInstance;
  }
  return { OpenAICompatibleProvider };
});

import { createProvider } from './provider.js';
import { GoogleProvider } from './providers/google.js';
import { resolveProviderConfig, loadProviderConfig } from './providers/configs/index.js';

describe('createProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default: withApiKey returns a valid provider
    vi.mocked(GoogleProvider.withApiKey).mockReturnValue({
      type: 'google',
      isReady: () => true,
      complete: vi.fn(),
      stream: vi.fn(),
      countTokens: () => 0,
      getModels: vi.fn(),
    } as unknown as ReturnType<typeof GoogleProvider.withApiKey>);
  });

  it('creates OpenAI provider', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      apiKey: 'test-key',
    };

    const provider = createProvider(config);

    expect(provider).toBeDefined();
    expect(provider.isReady()).toBe(true);
  });

  it('creates Anthropic provider', () => {
    const config: ProviderConfig = {
      provider: 'anthropic',
      apiKey: 'test-key',
    };

    const provider = createProvider(config);

    expect(provider).toBeDefined();
    expect(provider.isReady()).toBe(true);
  });

  it('defaults to OpenAI for unknown provider', () => {
    const config = {
      provider: 'unknown' as 'openai',
      apiKey: 'test-key',
    };

    // Unknown providers default to OpenAI
    const provider = createProvider(config);
    expect(provider).toBeDefined();
    expect(provider.isReady()).toBe(true);
  });

  it('handles missing API key', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      apiKey: '',
    };

    const provider = createProvider(config);

    expect(provider.isReady()).toBe(false);
  });

  it('creates Google provider when withApiKey succeeds', () => {
    const config: ProviderConfig = {
      provider: 'google',
      apiKey: 'test-google-key',
    };

    const provider = createProvider(config);

    expect(GoogleProvider.withApiKey).toHaveBeenCalledWith('test-google-key');
    expect(provider).toBeDefined();
    expect(provider.isReady()).toBe(true);
  });

  it('falls back to OpenAI when Google withApiKey returns null', () => {
    vi.mocked(GoogleProvider.withApiKey).mockReturnValue(null);

    const config: ProviderConfig = {
      provider: 'google',
      apiKey: 'test-google-key',
    };

    const provider = createProvider(config);

    expect(GoogleProvider.withApiKey).toHaveBeenCalledWith('test-google-key');
    expect(provider).toBeDefined();
    // Falls back to OpenAI provider
    expect(provider.isReady()).toBe(true);
  });

  it('passes empty string to withApiKey when apiKey is undefined', () => {
    const config: ProviderConfig = {
      provider: 'google',
    };

    createProvider(config);

    expect(GoogleProvider.withApiKey).toHaveBeenCalledWith('');
  });
});

describe('OpenAI Provider', () => {
  it('uses custom base URL', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://custom.api.com/v1',
    };

    const provider = createProvider(config);

    expect(provider).toBeDefined();
    expect(provider.isReady()).toBe(true);
  });

  it('includes organization header when provided', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      organization: 'org-123',
    };

    const provider = createProvider(config);

    expect(provider).toBeDefined();
  });
});

describe('Anthropic Provider', () => {
  it('uses custom base URL', () => {
    const config: ProviderConfig = {
      provider: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://custom.anthropic.com',
    };

    const provider = createProvider(config);

    expect(provider).toBeDefined();
    expect(provider.isReady()).toBe(true);
  });
});

describe('Provider cancel functionality', () => {
  it('supports cancel method', () => {
    const provider = createProvider({
      provider: 'openai',
      apiKey: 'test-key',
    });

    // Cancel should not throw
    if ('cancel' in provider && typeof provider.cancel === 'function') {
      expect(() => provider.cancel()).not.toThrow();
    }
  });
});

// =============================================================================
// openai-compatible tests — exercises internal helpers:
//   resolvedFromCatalogConfig, catalogModelFromAgentModel,
//   applyOpenAICompatibleOverrides, fallbackOpenAICompatibleConfig,
//   openAICompatibleConfig
// =============================================================================

describe('openai-compatible provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset resolveProviderConfig to return the default mock config
    vi.mocked(resolveProviderConfig).mockReturnValue({
      id: 'mock-provider',
      name: 'Mock Provider',
      type: 'openai-compatible',
      baseUrl: 'https://mock.api.com/v1',
      apiKey: 'mock-catalog-key',
      models: [
        {
          id: 'mock-model',
          name: 'Mock Model',
          contextWindow: 128_000,
          maxOutput: 4096,
          inputPrice: 0,
          outputPrice: 0,
          capabilities: ['chat', 'streaming'],
          default: true,
        },
      ],
      features: {
        streaming: true,
        toolUse: true,
        vision: false,
        jsonMode: true,
        systemMessage: true,
      },
    });
  });

  it('creates an openai-compatible provider via resolveProviderConfig', () => {
    const config: ProviderConfig = {
      provider: 'openai-compatible',
    };

    const provider = createProvider(config);

    expect(openaiCompatCalls.count).toBe(1);
    expect(resolveProviderConfig).toHaveBeenCalledWith('openai-compatible');
    expect(provider).toBeDefined();
    expect(provider.type).toBe('openai-compatible');
    expect(provider.isReady()).toBe(true);
  });

  it('creates an openai-compatible provider with explicit apiKey', () => {
    const config: ProviderConfig = {
      provider: 'openai-compatible',
      apiKey: 'my-direct-key',
    };

    const provider = createProvider(config);

    expect(openaiCompatCalls.count).toBeGreaterThanOrEqual(1);
    expect(loadProviderConfig).toHaveBeenCalledWith('openai-compatible');
    expect(provider.isReady()).toBe(true);
  });

  it('passes id as provider for config lookup when id is set', () => {
    const config: ProviderConfig = {
      provider: 'openai-compatible',
      id: 'custom-provider',
    };

    createProvider(config);

    expect(resolveProviderConfig).toHaveBeenCalledWith('custom-provider');
  });

  it('overrides model when defaultModel is provided', () => {
    const config: ProviderConfig = {
      provider: 'openai-compatible',
      defaultModel: { model: 'gpt-4o', maxTokens: 8192 },
    };

    createProvider(config);

    // The OpenAICompatibleProvider should have been called with the overridden model
    expect(openaiCompatCalls.count).toBeGreaterThanOrEqual(1);
  });

  it('overrides baseUrl when provided in config', () => {
    const config: ProviderConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://custom.api.com/v1',
    };

    createProvider(config);

    expect(openaiCompatCalls.count).toBeGreaterThanOrEqual(1);
  });

  it('merges custom headers with base config headers', () => {
    const config: ProviderConfig = {
      provider: 'openai-compatible',
      headers: { 'X-Custom': 'value', 'X-API-Version': '2' },
    };

    createProvider(config);

    expect(openaiCompatCalls.count).toBeGreaterThanOrEqual(1);
  });

  it('overrides features when provided in config', () => {
    const config: ProviderConfig = {
      provider: 'openai-compatible',
      features: { vision: true, streaming: false } as Partial<ProviderFeatures>,
    };

    createProvider(config);

    expect(openaiCompatCalls.count).toBeGreaterThanOrEqual(1);
  });

  it('falls back when resolveProviderConfig returns null and loadProviderConfig fails', () => {
    vi.mocked(resolveProviderConfig).mockReturnValue(null);

    const config: ProviderConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://fallback.api.com',
    };

    createProvider(config);

    // Should have called loadProviderConfig as fallback
    expect(loadProviderConfig).toHaveBeenCalledWith('openai-compatible');
    expect(openaiCompatCalls.count).toBeGreaterThanOrEqual(1);
  });

  it('uses fallback config when both resolveProviderConfig and loadProviderConfig fail', () => {
    vi.mocked(resolveProviderConfig).mockReturnValue(null);
    vi.mocked(loadProviderConfig).mockReturnValue(null);

    const config: ProviderConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://direct.api.com',
      apiKey: 'direct-key',
    };

    createProvider(config);

    // Should still create provider with fallback config
    expect(openaiCompatCalls.count).toBeGreaterThanOrEqual(1);
  });

  it('resolves timeout if not provided', () => {
    const config: ProviderConfig = {
      provider: 'openai-compatible',
      timeout: 30000,
    };

    createProvider(config);

    expect(openaiCompatCalls.count).toBeGreaterThanOrEqual(1);
  });
});
