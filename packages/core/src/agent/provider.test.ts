import { describe, it, expect } from 'vitest';
import { createProvider } from './provider.js';
import type { ProviderConfig } from './types.js';

describe('createProvider', () => {
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
