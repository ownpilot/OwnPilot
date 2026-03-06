/**
 * Model Configs Shared — getMergedModels / getMergedProviders Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockListModels,
  mockGetDisabledModelIds,
  mockGetCustomModels,
  mockGetProvider,
  mockListProviders: mockListProvidersModels,
  mockLocalListProviders,
  mockLocalListModels,
  mockGetAllProviderConfigs,
  mockGetProviderConfig,
  mockGetAllAggregatorProviders,
  mockGetAggregatorProvider,
  mockIsAggregatorProvider,
  mockHasApiKey,
  mockGetConfiguredProviderIds,
} = vi.hoisted(() => ({
  mockListModels: vi.fn(),
  mockGetDisabledModelIds: vi.fn(),
  mockGetCustomModels: vi.fn(),
  mockGetProvider: vi.fn(),
  mockListProviders: vi.fn(),
  mockLocalListProviders: vi.fn(),
  mockLocalListModels: vi.fn(),
  mockGetAllProviderConfigs: vi.fn(),
  mockGetProviderConfig: vi.fn(),
  mockGetAllAggregatorProviders: vi.fn(),
  mockGetAggregatorProvider: vi.fn(),
  mockIsAggregatorProvider: vi.fn(),
  mockHasApiKey: vi.fn(),
  mockGetConfiguredProviderIds: vi.fn(),
}));

vi.mock('../../db/repositories/index.js', () => ({
  modelConfigsRepo: {
    listModels: mockListModels,
    getDisabledModelIds: mockGetDisabledModelIds,
    getCustomModels: mockGetCustomModels,
    getProvider: mockGetProvider,
    listProviders: mockListProvidersModels,
  },
  localProvidersRepo: {
    listProviders: mockLocalListProviders,
    listModels: mockLocalListModels,
  },
}));

vi.mock('@ownpilot/core', () => ({
  getAllProviderConfigs: mockGetAllProviderConfigs,
  getProviderConfig: mockGetProviderConfig,
  getAllAggregatorProviders: mockGetAllAggregatorProviders,
  getAggregatorProvider: mockGetAggregatorProvider,
  isAggregatorProvider: mockIsAggregatorProvider,
}));

vi.mock('../settings.js', () => ({
  hasApiKey: mockHasApiKey,
  getConfiguredProviderIds: mockGetConfiguredProviderIds,
}));

import { getMergedModels, getMergedProviders, isProviderConfigured } from './shared.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuiltinProvider(id: string, name: string, models: any[] = []) {
  return {
    id,
    name,
    baseUrl: `https://api.${id}.com`,
    apiKeyEnv: `${id.toUpperCase()}_API_KEY`,
    docsUrl: `https://docs.${id}.com`,
    models: models.length
      ? models
      : [
          {
            id: `${id}-model-1`,
            name: `${name} Model 1`,
            capabilities: ['chat'],
            inputPrice: 1.0,
            outputPrice: 2.0,
            contextWindow: 128000,
            maxOutput: 4096,
          },
        ],
  };
}

function makeAggregator(id: string, name: string) {
  return {
    id,
    name,
    apiBase: `https://api.${id}.com`,
    apiKeyEnv: `${id.toUpperCase()}_API_KEY`,
    docsUrl: `https://docs.${id}.com`,
    description: `${name} aggregator`,
    defaultModels: [
      {
        id: `${id}-agg-model`,
        name: `${name} Agg Model`,
        capabilities: ['chat'],
        pricingInput: 0.5,
        pricingOutput: 1.0,
        pricingPerRequest: 0,
        contextWindow: 32000,
        maxOutput: 2048,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// isProviderConfigured
// ---------------------------------------------------------------------------

describe('isProviderConfigured', () => {
  it('returns true when hasApiKey returns true', async () => {
    mockHasApiKey.mockResolvedValue(true);
    expect(await isProviderConfigured('openai')).toBe(true);
    expect(mockHasApiKey).toHaveBeenCalledWith('openai');
  });

  it('returns false when hasApiKey returns false', async () => {
    mockHasApiKey.mockResolvedValue(false);
    expect(await isProviderConfigured('anthropic')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getMergedModels
// ---------------------------------------------------------------------------

describe('getMergedModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty everywhere
    mockListModels.mockResolvedValue([]);
    mockGetDisabledModelIds.mockResolvedValue(new Set());
    mockGetConfiguredProviderIds.mockResolvedValue(new Set());
    mockGetAllProviderConfigs.mockReturnValue([]);
    mockGetAllAggregatorProviders.mockReturnValue([]);
    mockGetCustomModels.mockResolvedValue([]);
    mockLocalListProviders.mockResolvedValue([]);
    mockLocalListModels.mockResolvedValue([]);
    mockGetProvider.mockResolvedValue(null);
    mockGetProviderConfig.mockReturnValue(null);
    mockIsAggregatorProvider.mockReturnValue(false);
  });

  it('returns empty array when no providers or models', async () => {
    const result = await getMergedModels('user-1');
    expect(result).toEqual([]);
  });

  it('includes builtin provider models', async () => {
    mockGetAllProviderConfigs.mockReturnValue([makeBuiltinProvider('openai', 'OpenAI')]);
    const result = await getMergedModels('user-1');
    expect(result).toHaveLength(1);
    expect(result[0].providerId).toBe('openai');
    expect(result[0].source).toBe('builtin');
    expect(result[0].isCustom).toBe(false);
  });

  it('marks builtin model as configured when provider is in configuredProviders', async () => {
    mockGetAllProviderConfigs.mockReturnValue([makeBuiltinProvider('openai', 'OpenAI')]);
    mockGetConfiguredProviderIds.mockResolvedValue(new Set(['openai']));
    const result = await getMergedModels('user-1');
    expect(result[0].isConfigured).toBe(true);
  });

  it('marks builtin model as NOT configured when provider not in configuredProviders', async () => {
    mockGetAllProviderConfigs.mockReturnValue([makeBuiltinProvider('openai', 'OpenAI')]);
    const result = await getMergedModels('user-1');
    expect(result[0].isConfigured).toBe(false);
  });

  it('marks disabled models correctly', async () => {
    mockGetAllProviderConfigs.mockReturnValue([makeBuiltinProvider('openai', 'OpenAI')]);
    mockGetDisabledModelIds.mockResolvedValue(new Set(['openai/openai-model-1']));
    const result = await getMergedModels('user-1');
    expect(result[0].isEnabled).toBe(false);
  });

  it('applies user overrides to builtin models (displayName, capabilities)', async () => {
    mockGetAllProviderConfigs.mockReturnValue([makeBuiltinProvider('openai', 'OpenAI')]);
    mockListModels.mockResolvedValue([
      {
        providerId: 'openai',
        modelId: 'openai-model-1',
        displayName: 'My Custom Name',
        capabilities: ['chat', 'code'],
        pricingInput: 5.0,
        pricingOutput: 10.0,
      },
    ]);
    const result = await getMergedModels('user-1');
    expect(result[0].displayName).toBe('My Custom Name');
    expect(result[0].capabilities).toContain('code');
    expect(result[0].hasOverride).toBe(true);
  });

  it('includes aggregator models when provider is enabled', async () => {
    const agg = makeAggregator('openrouter', 'OpenRouter');
    mockGetAllAggregatorProviders.mockReturnValue([agg]);
    mockGetProvider.mockResolvedValue({ isEnabled: true });
    mockGetConfiguredProviderIds.mockResolvedValue(new Set(['openrouter']));

    const result = await getMergedModels('user-1');
    expect(result.some((m) => m.source === 'aggregator')).toBe(true);
    expect(result[0].providerId).toBe('openrouter');
  });

  it('skips aggregator models when provider is not enabled', async () => {
    const agg = makeAggregator('openrouter', 'OpenRouter');
    mockGetAllAggregatorProviders.mockReturnValue([agg]);
    mockGetProvider.mockResolvedValue({ isEnabled: false });

    const result = await getMergedModels('user-1');
    expect(result.filter((m) => m.source === 'aggregator')).toHaveLength(0);
  });

  it('skips aggregator models when no user provider record', async () => {
    const agg = makeAggregator('openrouter', 'OpenRouter');
    mockGetAllAggregatorProviders.mockReturnValue([agg]);
    mockGetProvider.mockResolvedValue(null);

    const result = await getMergedModels('user-1');
    expect(result.filter((m) => m.source === 'aggregator')).toHaveLength(0);
  });

  it('includes custom models', async () => {
    mockGetCustomModels.mockResolvedValue([
      {
        providerId: 'my-provider',
        modelId: 'my-model',
        displayName: 'My Model',
        capabilities: ['chat'],
        isEnabled: true,
        pricingInput: 0,
        pricingOutput: 0,
      },
    ]);
    const result = await getMergedModels('user-1');
    expect(result.some((m) => m.source === 'custom' && m.modelId === 'my-model')).toBe(true);
    expect(result.find((m) => m.modelId === 'my-model')?.isCustom).toBe(true);
    expect(result.find((m) => m.modelId === 'my-model')?.isConfigured).toBe(true);
  });

  it('skips custom model if already seen (dedup)', async () => {
    // Builtin provider already has this model
    mockGetAllProviderConfigs.mockReturnValue([
      makeBuiltinProvider('openai', 'OpenAI', [
        { id: 'gpt-4', name: 'GPT-4', capabilities: ['chat'], inputPrice: 10, outputPrice: 30 },
      ]),
    ]);
    mockGetCustomModels.mockResolvedValue([
      {
        providerId: 'openai',
        modelId: 'gpt-4',
        displayName: 'GPT-4 Duplicate',
        capabilities: ['chat'],
        isEnabled: true,
      },
    ]);
    const result = await getMergedModels('user-1');
    const gpt4Models = result.filter((m) => m.modelId === 'gpt-4');
    expect(gpt4Models).toHaveLength(1);
  });

  it('resolves custom model provider name from builtin', async () => {
    mockGetProviderConfig.mockReturnValue({ id: 'openai', name: 'OpenAI (Builtin)' });
    mockGetCustomModels.mockResolvedValue([
      {
        providerId: 'openai',
        modelId: 'custom-gpt',
        displayName: 'Custom GPT',
        capabilities: [],
        isEnabled: true,
      },
    ]);
    const result = await getMergedModels('user-1');
    expect(result.find((m) => m.modelId === 'custom-gpt')?.providerName).toBe('OpenAI (Builtin)');
  });

  it('includes local provider models', async () => {
    const lp = {
      id: 'lm-studio',
      name: 'LM Studio',
      baseUrl: 'http://localhost:1234',
      isEnabled: true,
    };
    const lm = {
      localProviderId: 'lm-studio',
      modelId: 'llama-3',
      displayName: 'Llama 3',
      capabilities: ['chat'],
      contextWindow: 8192,
      maxOutput: 2048,
      isEnabled: true,
    };
    mockLocalListProviders.mockResolvedValue([lp]);
    mockLocalListModels.mockResolvedValue([lm]);

    const result = await getMergedModels('user-1');
    expect(result.some((m) => m.source === 'local' && m.modelId === 'llama-3')).toBe(true);
    expect(result.find((m) => m.modelId === 'llama-3')?.isConfigured).toBe(true);
    expect(result.find((m) => m.modelId === 'llama-3')?.pricingInput).toBe(0);
  });

  it('skips disabled local provider', async () => {
    mockLocalListProviders.mockResolvedValue([{ id: 'ollama', name: 'Ollama', isEnabled: false }]);
    mockLocalListModels.mockResolvedValue([
      {
        localProviderId: 'ollama',
        modelId: 'mistral',
        isEnabled: true,
        displayName: 'Mistral',
        capabilities: [],
      },
    ]);
    const result = await getMergedModels('user-1');
    expect(result.filter((m) => m.source === 'local')).toHaveLength(0);
  });

  it('sorts configured providers before unconfigured', async () => {
    mockGetAllProviderConfigs.mockReturnValue([
      makeBuiltinProvider('anthropic', 'Anthropic'),
      makeBuiltinProvider('openai', 'OpenAI'),
    ]);
    mockGetConfiguredProviderIds.mockResolvedValue(new Set(['openai']));
    const result = await getMergedModels('user-1');
    // openai (configured) should come before anthropic (not configured)
    const openaiIdx = result.findIndex((m) => m.providerId === 'openai');
    const anthropicIdx = result.findIndex((m) => m.providerId === 'anthropic');
    expect(openaiIdx).toBeLessThan(anthropicIdx);
  });
});

// ---------------------------------------------------------------------------
// getMergedProviders
// ---------------------------------------------------------------------------

describe('getMergedProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProvidersModels.mockResolvedValue([]);
    mockGetAllProviderConfigs.mockReturnValue([]);
    mockGetAllAggregatorProviders.mockReturnValue([]);
    mockIsAggregatorProvider.mockReturnValue(false);
    mockHasApiKey.mockResolvedValue(false);
    mockListModels.mockResolvedValue([]);
    mockLocalListProviders.mockResolvedValue([]);
    mockLocalListModels.mockResolvedValue([]);
  });

  it('returns empty array when no providers', async () => {
    const result = await getMergedProviders('user-1');
    expect(result).toEqual([]);
  });

  it('includes builtin providers', async () => {
    mockGetAllProviderConfigs.mockReturnValue([makeBuiltinProvider('openai', 'OpenAI')]);
    const result = await getMergedProviders('user-1');
    expect(result.some((p) => p.id === 'openai' && p.type === 'builtin')).toBe(true);
  });

  it('marks builtin provider as configured when hasApiKey returns true', async () => {
    mockGetAllProviderConfigs.mockReturnValue([makeBuiltinProvider('openai', 'OpenAI')]);
    mockHasApiKey.mockResolvedValue(true);
    const result = await getMergedProviders('user-1');
    expect(result.find((p) => p.id === 'openai')?.isConfigured).toBe(true);
  });

  it('marks disabled providers correctly', async () => {
    mockGetAllProviderConfigs.mockReturnValue([makeBuiltinProvider('openai', 'OpenAI')]);
    mockListProvidersModels.mockResolvedValue([
      { providerId: 'openai', isEnabled: false, displayName: 'OpenAI' },
    ]);
    const result = await getMergedProviders('user-1');
    expect(result.find((p) => p.id === 'openai')?.isEnabled).toBe(false);
  });

  it('includes aggregator providers', async () => {
    const agg = makeAggregator('openrouter', 'OpenRouter');
    mockGetAllAggregatorProviders.mockReturnValue([agg]);
    const result = await getMergedProviders('user-1');
    expect(result.some((p) => p.id === 'openrouter' && p.type === 'aggregator')).toBe(true);
  });

  it('aggregator provider isEnabled=false by default (not added by user)', async () => {
    const agg = makeAggregator('openrouter', 'OpenRouter');
    mockGetAllAggregatorProviders.mockReturnValue([agg]);
    const result = await getMergedProviders('user-1');
    expect(result.find((p) => p.id === 'openrouter')?.isEnabled).toBe(false);
  });

  it('aggregator provider isEnabled=true when user has added it', async () => {
    const agg = makeAggregator('openrouter', 'OpenRouter');
    mockGetAllAggregatorProviders.mockReturnValue([agg]);
    mockListProvidersModels.mockResolvedValue([
      {
        providerId: 'openrouter',
        isEnabled: true,
        displayName: 'OpenRouter Custom',
        apiBaseUrl: 'https://custom.com',
        apiKeySetting: 'my-setting',
      },
    ]);
    const result = await getMergedProviders('user-1');
    const or = result.find((p) => p.id === 'openrouter');
    expect(or?.isEnabled).toBe(true);
    expect(or?.name).toBe('OpenRouter Custom');
  });

  it('includes custom providers (not aggregator)', async () => {
    mockIsAggregatorProvider.mockReturnValue(false);
    mockListProvidersModels.mockResolvedValue([
      {
        providerId: 'my-custom',
        isEnabled: true,
        displayName: 'My Custom Provider',
        apiBaseUrl: 'http://custom.local',
        apiKeySetting: 'my-key',
      },
    ]);
    mockListModels.mockResolvedValue([]); // listModels for custom provider
    const result = await getMergedProviders('user-1');
    expect(result.some((p) => p.id === 'my-custom' && p.type === 'custom')).toBe(true);
    expect(result.find((p) => p.id === 'my-custom')?.isConfigured).toBe(true);
  });

  it('skips custom provider that is an aggregator', async () => {
    mockIsAggregatorProvider.mockImplementation((id: string) => id === 'openrouter');
    mockListProvidersModels.mockResolvedValue([
      { providerId: 'openrouter', isEnabled: true, displayName: 'OpenRouter', apiBaseUrl: '' },
    ]);
    const agg = makeAggregator('openrouter', 'OpenRouter');
    mockGetAllAggregatorProviders.mockReturnValue([agg]);

    const result = await getMergedProviders('user-1');
    const orProviders = result.filter((p) => p.id === 'openrouter');
    // Should only appear as aggregator, not custom
    expect(orProviders.every((p) => p.type === 'aggregator')).toBe(true);
  });

  it('includes local providers', async () => {
    mockLocalListProviders.mockResolvedValue([
      { id: 'lm-studio', name: 'LM Studio', baseUrl: 'http://localhost:1234', isEnabled: true },
    ]);
    mockLocalListModels.mockResolvedValue([
      { localProviderId: 'lm-studio', modelId: 'llama', isEnabled: true, displayName: 'Llama' },
    ]);
    const result = await getMergedProviders('user-1');
    const lm = result.find((p) => p.id === 'lm-studio');
    expect(lm?.type).toBe('local');
    expect(lm?.isConfigured).toBe(true);
    expect(lm?.modelCount).toBe(1);
  });

  it('sorts configured providers before unconfigured', async () => {
    mockGetAllProviderConfigs.mockReturnValue([
      makeBuiltinProvider('anthropic', 'Anthropic'),
      makeBuiltinProvider('openai', 'OpenAI'),
    ]);
    mockHasApiKey.mockImplementation((id: string) => id === 'openai');
    const result = await getMergedProviders('user-1');
    const openaiIdx = result.findIndex((p) => p.id === 'openai');
    const anthropicIdx = result.findIndex((p) => p.id === 'anthropic');
    expect(openaiIdx).toBeLessThan(anthropicIdx);
  });
});
