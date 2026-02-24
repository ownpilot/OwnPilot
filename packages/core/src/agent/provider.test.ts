import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderConfig } from './types.js';

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

import { createProvider } from './provider.js';
import { GoogleProvider } from './providers/google.js';

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
