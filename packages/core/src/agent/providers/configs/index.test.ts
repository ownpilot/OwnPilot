/**
 * Tests for packages/core/src/agent/providers/configs/index.ts
 *
 * Tests cover:
 *   - PROVIDER_IDS (shape, content, uniqueness)
 *   - loadProviderConfig (file loading, caching, error handling)
 *   - getProviderConfig (undefined vs null return)
 *   - getDefaultModelForProvider (default flag, fallback to first, null paths)
 *   - loadAllProviderConfigs / getAllProviderConfigs (filtering, aliasing)
 *   - getAvailableProviders (copy semantics)
 *   - clearConfigCache (forces re-read)
 *   - resolveProviderConfig (env-var lookup, apiKeyEnv stripping)
 *   - getConfiguredProviders (env-filtered list)
 *   - findModels (capability/price/context/excluded/preferred filters)
 *   - selectBestModel (first from findModels)
 *   - getCheapestModel (price ranking, array/object overloads)
 *   - getFastestModel (score ranking, array/object overloads)
 *   - getSmartestModel (score ranking, array/object overloads)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderConfig, ModelConfig } from './types.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that use them
// ---------------------------------------------------------------------------

const { mockReadFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
}));

vi.mock('url', () => ({
  fileURLToPath: vi.fn(() => '/mock/packages/core/src/agent/providers/configs/index.ts'),
}));

// ---------------------------------------------------------------------------
// Static import of the module under test (used for PROVIDER_IDS and helpers)
// The configCache is module-level, so we use freshModule() to reset it between tests.
// ---------------------------------------------------------------------------

import {
  PROVIDER_IDS,
  loadProviderConfig,
  getProviderConfig,
  getDefaultModelForProvider,
  loadAllProviderConfigs,
  getAllProviderConfigs,
  getAvailableProviders,
  clearConfigCache,
  resolveProviderConfig,
  getConfiguredProviders,
  findModels,
  selectBestModel,
  getCheapestModel,
  getFastestModel,
  getSmartestModel,
} from './index.js';

// ---------------------------------------------------------------------------
// Helper: get a fresh module instance (clears configCache via resetModules)
// ---------------------------------------------------------------------------

async function freshModule() {
  vi.resetModules();
  return import('./index.js');
}

// ---------------------------------------------------------------------------
// Helpers: factory functions for mock data
// ---------------------------------------------------------------------------

function makeModelConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'model-1',
    name: 'Model 1',
    default: true,
    capabilities: ['chat', 'streaming'],
    contextWindow: 128_000,
    maxOutput: 4096,
    inputPrice: 3.0,
    outputPrice: 15.0,
    ...overrides,
  };
}

function makeProviderConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    type: 'openai-compatible',
    apiKeyEnv: 'TEST_API_KEY',
    baseUrl: 'https://api.test.com/v1',
    models: [makeModelConfig()],
    features: {
      streaming: true,
      toolUse: true,
      vision: false,
      jsonMode: false,
      systemMessage: true,
    },
    ...overrides,
  };
}

/**
 * Configure mockReadFileSync to return JSON for a given provider ID and throw
 * for everything else.
 */
function setupReadFileMock(configs: Record<string, ProviderConfig>) {
  mockReadFileSync.mockImplementation((filePath: string) => {
    const match = (filePath as string).match(/([^/\\]+)\.json$/);
    const id = match?.[1];
    if (id && Object.prototype.hasOwnProperty.call(configs, id)) {
      return JSON.stringify(configs[id]);
    }
    throw new Error(`ENOENT: no such file or directory, open '${filePath as string}'`);
  });
}

// ---------------------------------------------------------------------------
// Env-var cleanup helpers
// ---------------------------------------------------------------------------

const MANAGED_ENV_KEYS: string[] = [];

function setEnv(key: string, value: string) {
  MANAGED_ENV_KEYS.push(key);
  process.env[key] = value;
}

afterEach(() => {
  // Remove all env vars set during the test
  for (const key of MANAGED_ENV_KEYS) {
    delete process.env[key];
  }
  MANAGED_ENV_KEYS.length = 0;

  vi.clearAllMocks();
  clearConfigCache();
});

// ===========================================================================
// PROVIDER_IDS
// ===========================================================================

describe('PROVIDER_IDS', () => {
  it('is an array', () => {
    expect(Array.isArray(PROVIDER_IDS)).toBe(true);
  });

  it('contains at least 50 entries', () => {
    expect(PROVIDER_IDS.length).toBeGreaterThanOrEqual(50);
  });

  it('contains the openai provider', () => {
    expect(PROVIDER_IDS).toContain('openai');
  });

  it('contains the anthropic provider', () => {
    expect(PROVIDER_IDS).toContain('anthropic');
  });

  it('contains the google provider', () => {
    expect(PROVIDER_IDS).toContain('google');
  });

  it('contains the mistral provider', () => {
    expect(PROVIDER_IDS).toContain('mistral');
  });

  it('contains the groq provider', () => {
    expect(PROVIDER_IDS).toContain('groq');
  });

  it('contains the cohere provider', () => {
    expect(PROVIDER_IDS).toContain('cohere');
  });

  it('contains the deepseek provider', () => {
    expect(PROVIDER_IDS).toContain('deepseek');
  });

  it('contains the openrouter provider', () => {
    expect(PROVIDER_IDS).toContain('openrouter');
  });

  it('contains the xai provider', () => {
    expect(PROVIDER_IDS).toContain('xai');
  });

  it('contains the azure provider', () => {
    expect(PROVIDER_IDS).toContain('azure');
  });

  it('contains the google-vertex provider', () => {
    expect(PROVIDER_IDS).toContain('google-vertex');
  });

  it('contains the amazon-bedrock provider', () => {
    expect(PROVIDER_IDS).toContain('amazon-bedrock');
  });

  it('contains the huggingface provider', () => {
    expect(PROVIDER_IDS).toContain('huggingface');
  });

  it('contains the nvidia provider', () => {
    expect(PROVIDER_IDS).toContain('nvidia');
  });

  it('all entries are strings', () => {
    for (const id of PROVIDER_IDS) {
      expect(typeof id).toBe('string');
    }
  });

  it('all entries are non-empty strings', () => {
    for (const id of PROVIDER_IDS) {
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate entries', () => {
    const unique = new Set(PROVIDER_IDS);
    expect(unique.size).toBe(PROVIDER_IDS.length);
  });

  it('all entries are lowercase kebab-case (no uppercase letters)', () => {
    for (const id of PROVIDER_IDS) {
      expect(id).toBe(id.toLowerCase());
    }
  });
});

// ===========================================================================
// loadProviderConfig
// ===========================================================================

describe('loadProviderConfig', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('loads config from JSON file for a known provider', () => {
    const config = makeProviderConfig({ id: 'test-provider' });
    setupReadFileMock({ 'test-provider': config });

    const result = loadProviderConfig('test-provider');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('test-provider');
    expect(result?.name).toBe('Test Provider');
  });

  it('returns null for a provider whose JSON file does not exist', () => {
    setupReadFileMock({});
    const result = loadProviderConfig('nonexistent-provider');
    expect(result).toBeNull();
  });

  it('returns null when readFileSync throws an error', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    const result = loadProviderConfig('error-provider');
    expect(result).toBeNull();
  });

  it('caches the result so readFileSync is called only once for repeated loads', () => {
    const config = makeProviderConfig({ id: 'cached-provider' });
    setupReadFileMock({ 'cached-provider': config });

    loadProviderConfig('cached-provider');
    loadProviderConfig('cached-provider');
    loadProviderConfig('cached-provider');

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });

  it('returns the same object reference on repeated calls (cache hit)', () => {
    const config = makeProviderConfig({ id: 'ref-provider' });
    setupReadFileMock({ 'ref-provider': config });

    const first = loadProviderConfig('ref-provider');
    const second = loadProviderConfig('ref-provider');
    expect(first).toBe(second);
  });

  it('reads from the correct directory path containing "data/providers"', () => {
    const config = makeProviderConfig({ id: 'path-provider' });
    setupReadFileMock({ 'path-provider': config });

    loadProviderConfig('path-provider');

    const calledPath = mockReadFileSync.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain('data');
    expect(calledPath).toContain('providers');
    expect(calledPath).toContain('path-provider.json');
  });

  it('uses utf-8 encoding when reading the file', () => {
    const config = makeProviderConfig({ id: 'encoding-provider' });
    setupReadFileMock({ 'encoding-provider': config });

    loadProviderConfig('encoding-provider');

    const calledEncoding = mockReadFileSync.mock.calls[0]?.[1];
    expect(calledEncoding).toBe('utf-8');
  });

  it('returns a parsed object with all expected fields', () => {
    const config = makeProviderConfig({
      id: 'full-provider',
      name: 'Full Provider',
      apiKeyEnv: 'FULL_API_KEY',
      baseUrl: 'https://api.full.com/v1',
    });
    setupReadFileMock({ 'full-provider': config });

    const result = loadProviderConfig('full-provider');
    expect(result?.id).toBe('full-provider');
    expect(result?.name).toBe('Full Provider');
    expect(result?.apiKeyEnv).toBe('FULL_API_KEY');
    expect(result?.baseUrl).toBe('https://api.full.com/v1');
  });

  it('returns null when the file contains invalid JSON', () => {
    mockReadFileSync.mockReturnValue('NOT_VALID_JSON{{{');

    const result = loadProviderConfig('bad-json-provider');
    expect(result).toBeNull();
  });

  it('does not cache null results (failed loads are retried)', () => {
    // First call fails
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    const first = loadProviderConfig('retry-provider');
    expect(first).toBeNull();

    // Second call succeeds
    const config = makeProviderConfig({ id: 'retry-provider' });
    mockReadFileSync.mockReturnValueOnce(JSON.stringify(config));
    const second = loadProviderConfig('retry-provider');
    expect(second).not.toBeNull();
    expect(second?.id).toBe('retry-provider');
  });
});

// ===========================================================================
// getProviderConfig
// ===========================================================================

describe('getProviderConfig', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('returns the config for a valid provider id', () => {
    const config = makeProviderConfig({ id: 'openai' });
    setupReadFileMock({ openai: config });

    const result = getProviderConfig('openai');
    expect(result).toBeDefined();
    expect(result?.id).toBe('openai');
  });

  it('returns undefined (not null) for an invalid provider id', () => {
    setupReadFileMock({});

    const result = getProviderConfig('does-not-exist');
    expect(result).toBeUndefined();
    expect(result).not.toBeNull();
  });

  it('returns undefined when readFileSync throws', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('IO error');
    });

    const result = getProviderConfig('any-provider');
    expect(result).toBeUndefined();
  });

  it('returns a ProviderConfig with models array when valid', () => {
    const config = makeProviderConfig({ id: 'anthropic' });
    setupReadFileMock({ anthropic: config });

    const result = getProviderConfig('anthropic');
    expect(Array.isArray(result?.models)).toBe(true);
  });
});

// ===========================================================================
// getDefaultModelForProvider
// ===========================================================================

describe('getDefaultModelForProvider', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('returns the model marked with default: true', () => {
    const config = makeProviderConfig({
      id: 'p1',
      models: [
        makeModelConfig({ id: 'model-a', name: 'Model A', default: false }),
        makeModelConfig({ id: 'model-b', name: 'Model B', default: true }),
        makeModelConfig({ id: 'model-c', name: 'Model C', default: false }),
      ],
    });
    setupReadFileMock({ p1: config });

    const result = getDefaultModelForProvider('p1');
    expect(result?.id).toBe('model-b');
    expect(result?.name).toBe('Model B');
  });

  it('returns the first model when no model has default: true', () => {
    const config = makeProviderConfig({
      id: 'p2',
      models: [
        makeModelConfig({ id: 'first-model', name: 'First', default: false }),
        makeModelConfig({ id: 'second-model', name: 'Second', default: false }),
      ],
    });
    setupReadFileMock({ p2: config });

    const result = getDefaultModelForProvider('p2');
    expect(result?.id).toBe('first-model');
  });

  it('returns the first model when no model has the default field at all', () => {
    const config = makeProviderConfig({
      id: 'p3',
      models: [
        makeModelConfig({ id: 'alpha', name: 'Alpha' }),
        makeModelConfig({ id: 'beta', name: 'Beta' }),
      ],
    });
    // Remove default field from both models
    config.models.forEach(m => delete m.default);
    setupReadFileMock({ p3: config });

    const result = getDefaultModelForProvider('p3');
    expect(result?.id).toBe('alpha');
  });

  it('returns null when the provider does not exist', () => {
    setupReadFileMock({});
    const result = getDefaultModelForProvider('ghost-provider');
    expect(result).toBeNull();
  });

  it('returns null when the provider has an empty models array', () => {
    const config = makeProviderConfig({ id: 'empty-models', models: [] });
    setupReadFileMock({ 'empty-models': config });

    const result = getDefaultModelForProvider('empty-models');
    expect(result).toBeNull();
  });

  it('returns the single model when there is exactly one model', () => {
    const config = makeProviderConfig({
      id: 'single-model-prov',
      models: [makeModelConfig({ id: 'only-one', default: false })],
    });
    setupReadFileMock({ 'single-model-prov': config });

    const result = getDefaultModelForProvider('single-model-prov');
    expect(result?.id).toBe('only-one');
  });

  it('returns the correct model when only the last model has default: true', () => {
    const config = makeProviderConfig({
      id: 'last-default',
      models: [
        makeModelConfig({ id: 'm1', default: false }),
        makeModelConfig({ id: 'm2', default: false }),
        makeModelConfig({ id: 'm3', default: true }),
      ],
    });
    setupReadFileMock({ 'last-default': config });

    const result = getDefaultModelForProvider('last-default');
    expect(result?.id).toBe('m3');
  });
});

// ===========================================================================
// loadAllProviderConfigs / getAllProviderConfigs
// ===========================================================================

describe('loadAllProviderConfigs', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('returns an array', () => {
    setupReadFileMock({});
    const result = loadAllProviderConfigs();
    expect(Array.isArray(result)).toBe(true);
  });

  it('filters out null results (providers that fail to load)', () => {
    // All reads throw — should get empty array, no nulls
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = loadAllProviderConfigs();
    expect(result).toEqual([]);
  });

  it('includes configs for providers that load successfully', () => {
    const openaiConfig = makeProviderConfig({ id: 'openai', name: 'OpenAI' });
    const anthropicConfig = makeProviderConfig({ id: 'anthropic', name: 'Anthropic' });
    setupReadFileMock({ openai: openaiConfig, anthropic: anthropicConfig });

    const result = loadAllProviderConfigs();
    const ids = result.map(c => c.id);
    expect(ids).toContain('openai');
    expect(ids).toContain('anthropic');
  });

  it('result contains no null or undefined values', () => {
    // Some succeed, most throw
    const config = makeProviderConfig({ id: 'openai' });
    setupReadFileMock({ openai: config });

    const result = loadAllProviderConfigs();
    for (const item of result) {
      expect(item).not.toBeNull();
      expect(item).not.toBeUndefined();
    }
  });

  it('each result item has the expected shape (id, name, models, features)', () => {
    const config = makeProviderConfig({ id: 'openai' });
    setupReadFileMock({ openai: config });

    const result = loadAllProviderConfigs();
    const found = result.find(c => c.id === 'openai');
    expect(found).toBeDefined();
    expect(found).toHaveProperty('id');
    expect(found).toHaveProperty('name');
    expect(found).toHaveProperty('models');
    expect(found).toHaveProperty('features');
  });
});

describe('getAllProviderConfigs', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('is an alias for loadAllProviderConfigs and returns the same data', () => {
    const config = makeProviderConfig({ id: 'openai' });
    setupReadFileMock({ openai: config });

    const fromLoad = loadAllProviderConfigs();

    clearConfigCache();

    const fromGet = getAllProviderConfigs();
    expect(fromGet.map(c => c.id)).toEqual(fromLoad.map(c => c.id));
  });

  it('returns an array', () => {
    setupReadFileMock({});
    expect(Array.isArray(getAllProviderConfigs())).toBe(true);
  });

  it('filters out nulls just like loadAllProviderConfigs', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = getAllProviderConfigs();
    expect(result).toEqual([]);
  });
});

// ===========================================================================
// getAvailableProviders
// ===========================================================================

describe('getAvailableProviders', () => {
  it('returns a copy of PROVIDER_IDS', () => {
    const result = getAvailableProviders();
    expect(result).toEqual([...PROVIDER_IDS]);
  });

  it('returns an array of strings', () => {
    const result = getAvailableProviders();
    expect(Array.isArray(result)).toBe(true);
    for (const id of result) {
      expect(typeof id).toBe('string');
    }
  });

  it('has the same length as PROVIDER_IDS', () => {
    expect(getAvailableProviders().length).toBe(PROVIDER_IDS.length);
  });

  it('modifying the returned array does not affect PROVIDER_IDS', () => {
    const original = PROVIDER_IDS.length;
    const result = getAvailableProviders();
    (result as string[]).push('fake-provider-xyz');
    expect(PROVIDER_IDS.length).toBe(original);
    expect(PROVIDER_IDS).not.toContain('fake-provider-xyz');
  });

  it('contains openai in the result', () => {
    expect(getAvailableProviders()).toContain('openai');
  });

  it('successive calls return independent copies', () => {
    const a = getAvailableProviders();
    const b = getAvailableProviders();
    expect(a).not.toBe(b);   // different array references
    expect(a).toEqual(b);    // same content
  });
});

// ===========================================================================
// clearConfigCache
// ===========================================================================

describe('clearConfigCache', () => {
  it('causes the next load to re-read the file', async () => {
    const m = await freshModule();

    const configV1 = makeProviderConfig({ id: 'openai', name: 'OpenAI V1' });
    mockReadFileSync.mockReturnValue(JSON.stringify(configV1));

    const firstLoad = m.loadProviderConfig('openai');
    expect(firstLoad?.name).toBe('OpenAI V1');

    m.clearConfigCache();

    const configV2 = makeProviderConfig({ id: 'openai', name: 'OpenAI V2' });
    mockReadFileSync.mockReturnValue(JSON.stringify(configV2));

    const secondLoad = m.loadProviderConfig('openai');
    expect(secondLoad?.name).toBe('OpenAI V2');
  });

  it('causes readFileSync to be called again after cache is cleared', async () => {
    const m = await freshModule();

    const config = makeProviderConfig({ id: 'groq' });
    mockReadFileSync.mockReturnValue(JSON.stringify(config));

    m.loadProviderConfig('groq');
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);

    m.clearConfigCache();

    m.loadProviderConfig('groq');
    expect(mockReadFileSync).toHaveBeenCalledTimes(2);
  });

  it('clearing cache allows a previously-failed load to succeed', async () => {
    const m = await freshModule();

    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    const first = m.loadProviderConfig('mistral');
    expect(first).toBeNull();

    m.clearConfigCache();

    const config = makeProviderConfig({ id: 'mistral' });
    mockReadFileSync.mockReturnValue(JSON.stringify(config));
    const second = m.loadProviderConfig('mistral');
    expect(second).not.toBeNull();
  });

  it('can be called multiple times without error', () => {
    expect(() => {
      clearConfigCache();
      clearConfigCache();
      clearConfigCache();
    }).not.toThrow();
  });
});

// ===========================================================================
// resolveProviderConfig
// ===========================================================================

describe('resolveProviderConfig', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('returns a config with apiKey when the env var is set', () => {
    const config = makeProviderConfig({ id: 'openai', apiKeyEnv: 'OPENAI_API_KEY' });
    setupReadFileMock({ openai: config });
    setEnv('OPENAI_API_KEY', 'sk-test-key-123');

    const result = resolveProviderConfig('openai');
    expect(result).not.toBeNull();
    expect(result?.apiKey).toBe('sk-test-key-123');
  });

  it('returns null when the provider does not exist', () => {
    setupReadFileMock({});

    const result = resolveProviderConfig('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when the env var is not set', () => {
    const config = makeProviderConfig({ id: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' });
    setupReadFileMock({ anthropic: config });
    delete process.env['ANTHROPIC_API_KEY'];

    const result = resolveProviderConfig('anthropic');
    expect(result).toBeNull();
  });

  it('returns null when the env var is an empty string', () => {
    const config = makeProviderConfig({ id: 'groq', apiKeyEnv: 'GROQ_API_KEY' });
    setupReadFileMock({ groq: config });
    process.env['GROQ_API_KEY'] = '';

    const result = resolveProviderConfig('groq');
    expect(result).toBeNull();
  });

  it('strips apiKeyEnv from the returned object', () => {
    const config = makeProviderConfig({ id: 'mistral', apiKeyEnv: 'MISTRAL_API_KEY' });
    setupReadFileMock({ mistral: config });
    setEnv('MISTRAL_API_KEY', 'test-mistral-key');

    const result = resolveProviderConfig('mistral');
    expect(result).not.toHaveProperty('apiKeyEnv');
  });

  it('includes the provider id, name, models, and features in the result', () => {
    const config = makeProviderConfig({ id: 'cohere', name: 'Cohere', apiKeyEnv: 'COHERE_API_KEY' });
    setupReadFileMock({ cohere: config });
    setEnv('COHERE_API_KEY', 'cohere-key-abc');

    const result = resolveProviderConfig('cohere');
    expect(result?.id).toBe('cohere');
    expect(result?.name).toBe('Cohere');
    expect(Array.isArray(result?.models)).toBe(true);
    expect(result?.features).toBeDefined();
  });

  it('includes the baseUrl in the result', () => {
    const config = makeProviderConfig({
      id: 'deepseek',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    setupReadFileMock({ deepseek: config });
    setEnv('DEEPSEEK_API_KEY', 'ds-key');

    const result = resolveProviderConfig('deepseek');
    expect(result?.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('does not return the apiKey when env var is missing even if other fields are valid', () => {
    const config = makeProviderConfig({ id: 'xai', apiKeyEnv: 'XAI_API_KEY' });
    setupReadFileMock({ xai: config });
    delete process.env['XAI_API_KEY'];

    const result = resolveProviderConfig('xai');
    expect(result).toBeNull();
  });
});

// ===========================================================================
// getConfiguredProviders
// ===========================================================================

describe('getConfiguredProviders', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('returns providers that have API keys set', () => {
    const openaiConfig = makeProviderConfig({ id: 'openai', apiKeyEnv: 'OPENAI_API_KEY' });
    const anthropicConfig = makeProviderConfig({ id: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' });
    setupReadFileMock({ openai: openaiConfig, anthropic: anthropicConfig });
    setEnv('OPENAI_API_KEY', 'sk-openai-key');
    setEnv('ANTHROPIC_API_KEY', 'sk-anthropic-key');

    const result = getConfiguredProviders();
    const ids = result.map(p => p.id);
    expect(ids).toContain('openai');
    expect(ids).toContain('anthropic');
  });

  it('excludes providers that do not have API keys set', () => {
    const config = makeProviderConfig({ id: 'openai', apiKeyEnv: 'OPENAI_API_KEY' });
    setupReadFileMock({ openai: config });
    delete process.env['OPENAI_API_KEY'];

    const result = getConfiguredProviders();
    const ids = result.map(p => p.id);
    expect(ids).not.toContain('openai');
  });

  it('returns empty array when no env vars are set', () => {
    // All providers load but no keys exist
    mockReadFileSync.mockImplementation((filePath: string) => {
      const match = (filePath as string).match(/([^/\\]+)\.json$/);
      const id = match?.[1];
      if (id) {
        return JSON.stringify(makeProviderConfig({ id, apiKeyEnv: `${id.toUpperCase()}_API_KEY` }));
      }
      throw new Error('ENOENT');
    });
    // Don't set any env vars

    const result = getConfiguredProviders();
    expect(result).toEqual([]);
  });

  it('each result has apiKey and no apiKeyEnv field', () => {
    const config = makeProviderConfig({ id: 'groq', apiKeyEnv: 'GROQ_API_KEY' });
    setupReadFileMock({ groq: config });
    setEnv('GROQ_API_KEY', 'groq-key-xyz');

    const result = getConfiguredProviders();
    const groq = result.find(p => p.id === 'groq');
    expect(groq?.apiKey).toBe('groq-key-xyz');
    expect(groq).not.toHaveProperty('apiKeyEnv');
  });

  it('returns an array of ResolvedProviderConfig objects', () => {
    const config = makeProviderConfig({ id: 'mistral', apiKeyEnv: 'MISTRAL_API_KEY' });
    setupReadFileMock({ mistral: config });
    setEnv('MISTRAL_API_KEY', 'mistral-key');

    const result = getConfiguredProviders();
    expect(Array.isArray(result)).toBe(true);
    for (const item of result) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('apiKey');
      expect(item).toHaveProperty('models');
    }
  });
});

// ===========================================================================
// findModels
// ===========================================================================

describe('findModels', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  /**
   * findModels calls getConfiguredProviders() which iterates over the static
   * PROVIDER_IDS array.  Any provider we set up must therefore use an ID that
   * is already in PROVIDER_IDS.  We use 'openai' and 'anthropic' throughout
   * these tests because they are guaranteed to be present.
   */

  /** Configure openai + anthropic with the given model lists and set their API keys. */
  function setupOpenaiAndAnthropic(modelsOpenai: ModelConfig[], modelsAnthropic: ModelConfig[]) {
    const openaiConfig = makeProviderConfig({ id: 'openai', apiKeyEnv: 'OPENAI_API_KEY', models: modelsOpenai });
    const anthropicConfig = makeProviderConfig({ id: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY', models: modelsAnthropic });
    setupReadFileMock({ openai: openaiConfig, anthropic: anthropicConfig });
    setEnv('OPENAI_API_KEY', 'sk-openai-key');
    setEnv('ANTHROPIC_API_KEY', 'sk-anthropic-key');
  }

  /** Configure only openai with the given model list and set its API key. */
  function setupOpenaiOnly(models: ModelConfig[]) {
    const openaiConfig = makeProviderConfig({ id: 'openai', apiKeyEnv: 'OPENAI_API_KEY', models });
    setupReadFileMock({ openai: openaiConfig });
    setEnv('OPENAI_API_KEY', 'sk-openai-key');
  }

  it('returns an array of {provider, model} pairs', () => {
    setupOpenaiOnly([makeModelConfig({ id: 'm1', capabilities: ['chat', 'streaming'] })]);
    const results = findModels({ capabilities: ['chat'] });
    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(results[0]).toHaveProperty('provider');
      expect(results[0]).toHaveProperty('model');
    }
  });

  it('returns models matching the required capabilities', () => {
    setupOpenaiAndAnthropic(
      [makeModelConfig({ id: 'vision-model', capabilities: ['chat', 'vision', 'streaming'] })],
      [makeModelConfig({ id: 'plain-model', capabilities: ['chat', 'streaming'] })],
    );
    const results = findModels({ capabilities: ['vision'] });
    const modelIds = results.map(r => r.model.id);
    expect(modelIds).toContain('vision-model');
    expect(modelIds).not.toContain('plain-model');
  });

  it('returns empty array when no models match required capabilities', () => {
    setupOpenaiAndAnthropic(
      [makeModelConfig({ id: 'm1', capabilities: ['chat', 'streaming'] })],
      [makeModelConfig({ id: 'm2', capabilities: ['chat', 'streaming'] })],
    );
    const results = findModels({ capabilities: ['embeddings'] });
    expect(results).toEqual([]);
  });

  it('requires ALL specified capabilities (AND logic)', () => {
    setupOpenaiOnly([
      makeModelConfig({ id: 'full', capabilities: ['chat', 'vision', 'function_calling', 'streaming'] }),
      makeModelConfig({ id: 'partial', capabilities: ['chat', 'vision', 'streaming'] }),
    ]);
    const results = findModels({ capabilities: ['vision', 'function_calling'] });
    const modelIds = results.map(r => r.model.id);
    expect(modelIds).toContain('full');
    expect(modelIds).not.toContain('partial');
  });

  it('filters by maxInputPrice (excludes models above the threshold)', () => {
    setupOpenaiAndAnthropic(
      [makeModelConfig({ id: 'cheap', inputPrice: 1.0, outputPrice: 5.0, capabilities: ['chat', 'streaming'] })],
      [makeModelConfig({ id: 'expensive', inputPrice: 10.0, outputPrice: 30.0, capabilities: ['chat', 'streaming'] })],
    );
    const results = findModels({ maxInputPrice: 5.0 });
    const modelIds = results.map(r => r.model.id);
    expect(modelIds).toContain('cheap');
    expect(modelIds).not.toContain('expensive');
  });

  it('includes model when inputPrice exactly equals maxInputPrice', () => {
    setupOpenaiOnly([makeModelConfig({ id: 'exact', inputPrice: 5.0, outputPrice: 10.0, capabilities: ['chat', 'streaming'] })]);
    const results = findModels({ maxInputPrice: 5.0 });
    const modelIds = results.map(r => r.model.id);
    expect(modelIds).toContain('exact');
  });

  it('filters by maxOutputPrice (excludes models above the threshold)', () => {
    setupOpenaiAndAnthropic(
      [makeModelConfig({ id: 'cheap-out', inputPrice: 1.0, outputPrice: 5.0, capabilities: ['chat', 'streaming'] })],
      [makeModelConfig({ id: 'expensive-out', inputPrice: 1.0, outputPrice: 50.0, capabilities: ['chat', 'streaming'] })],
    );
    const results = findModels({ maxOutputPrice: 10.0 });
    const modelIds = results.map(r => r.model.id);
    expect(modelIds).toContain('cheap-out');
    expect(modelIds).not.toContain('expensive-out');
  });

  it('filters by minContextWindow (excludes models with smaller context)', () => {
    setupOpenaiAndAnthropic(
      [makeModelConfig({ id: 'small-ctx', contextWindow: 8_000, capabilities: ['chat', 'streaming'] })],
      [makeModelConfig({ id: 'large-ctx', contextWindow: 200_000, capabilities: ['chat', 'streaming'] })],
    );
    const results = findModels({ minContextWindow: 100_000 });
    const modelIds = results.map(r => r.model.id);
    expect(modelIds).not.toContain('small-ctx');
    expect(modelIds).toContain('large-ctx');
  });

  it('includes model when contextWindow exactly equals minContextWindow', () => {
    setupOpenaiOnly([makeModelConfig({ id: 'exact-ctx', contextWindow: 128_000, capabilities: ['chat', 'streaming'] })]);
    const results = findModels({ minContextWindow: 128_000 });
    const modelIds = results.map(r => r.model.id);
    expect(modelIds).toContain('exact-ctx');
  });

  it('excludes providers listed in excludedProviders', () => {
    setupOpenaiAndAnthropic(
      [makeModelConfig({ id: 'm-openai', capabilities: ['chat', 'streaming'] })],
      [makeModelConfig({ id: 'm-anthropic', capabilities: ['chat', 'streaming'] })],
    );
    const results = findModels({ excludedProviders: ['openai'] });
    const providerIds = results.map(r => r.provider.id);
    expect(providerIds).not.toContain('openai');
    expect(providerIds).toContain('anthropic');
  });

  it('excludes multiple providers listed in excludedProviders', () => {
    setupOpenaiAndAnthropic(
      [makeModelConfig({ id: 'm-openai', capabilities: ['chat', 'streaming'] })],
      [makeModelConfig({ id: 'm-anthropic', capabilities: ['chat', 'streaming'] })],
    );
    const results = findModels({ excludedProviders: ['openai', 'anthropic'] });
    expect(results).toEqual([]);
  });

  it('sorts results so preferred providers appear first', () => {
    setupOpenaiAndAnthropic(
      [makeModelConfig({ id: 'm-openai', capabilities: ['chat', 'streaming'] })],
      [makeModelConfig({ id: 'm-anthropic', capabilities: ['chat', 'streaming'] })],
    );
    const results = findModels({ preferredProviders: ['anthropic', 'openai'] });
    expect(results[0]?.provider.id).toBe('anthropic');
    expect(results[1]?.provider.id).toBe('openai');
  });

  it('puts non-preferred providers after preferred ones', () => {
    // Use openai, anthropic, and groq — all are in PROVIDER_IDS
    const openaiConfig = makeProviderConfig({ id: 'openai', apiKeyEnv: 'OPENAI_API_KEY', models: [makeModelConfig({ id: 'm-openai', capabilities: ['chat', 'streaming'] })] });
    const anthropicConfig = makeProviderConfig({ id: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY', models: [makeModelConfig({ id: 'm-anthropic', capabilities: ['chat', 'streaming'] })] });
    const groqConfig = makeProviderConfig({ id: 'groq', apiKeyEnv: 'GROQ_API_KEY', models: [makeModelConfig({ id: 'm-groq', capabilities: ['chat', 'streaming'] })] });
    setupReadFileMock({ openai: openaiConfig, anthropic: anthropicConfig, groq: groqConfig });
    setEnv('OPENAI_API_KEY', 'sk-openai-key');
    setEnv('ANTHROPIC_API_KEY', 'sk-anthropic-key');
    setEnv('GROQ_API_KEY', 'sk-groq-key');

    const results = findModels({ preferredProviders: ['groq'] });
    // groq should be first
    expect(results[0]?.provider.id).toBe('groq');
    // Others follow in any order
    const rest = results.slice(1).map(r => r.provider.id);
    expect(rest).toContain('openai');
    expect(rest).toContain('anthropic');
  });

  it('applies multiple filters combined (AND logic)', () => {
    setupOpenaiOnly([
      makeModelConfig({ id: 'all-match', capabilities: ['chat', 'vision', 'streaming'], inputPrice: 2.0, outputPrice: 8.0, contextWindow: 150_000 }),
      makeModelConfig({ id: 'no-vision', capabilities: ['chat', 'streaming'], inputPrice: 1.0, outputPrice: 5.0, contextWindow: 200_000 }),
      makeModelConfig({ id: 'too-expensive', capabilities: ['chat', 'vision', 'streaming'], inputPrice: 20.0, outputPrice: 80.0, contextWindow: 200_000 }),
      makeModelConfig({ id: 'small-context', capabilities: ['chat', 'vision', 'streaming'], inputPrice: 2.0, outputPrice: 8.0, contextWindow: 4_000 }),
    ]);
    const results = findModels({
      capabilities: ['vision'],
      maxInputPrice: 5.0,
      maxOutputPrice: 20.0,
      minContextWindow: 100_000,
    });
    const modelIds = results.map(r => r.model.id);
    expect(modelIds).toContain('all-match');
    expect(modelIds).not.toContain('no-vision');
    expect(modelIds).not.toContain('too-expensive');
    expect(modelIds).not.toContain('small-context');
  });

  it('returns empty array when no providers have API keys configured', () => {
    // Provider loads fine but no env var is set → resolveProviderConfig returns null
    const config = makeProviderConfig({ id: 'openai', apiKeyEnv: 'OPENAI_API_KEY' });
    setupReadFileMock({ openai: config });
    delete process.env['OPENAI_API_KEY'];

    const results = findModels({ capabilities: ['chat'] });
    expect(results).toEqual([]);
  });

  it('returns empty array when criteria object is empty (no constraints) but no providers configured', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const results = findModels({});
    expect(results).toEqual([]);
  });

  it('returns multiple models from the same provider when all pass the filters', () => {
    setupOpenaiOnly([
      makeModelConfig({ id: 'm1', capabilities: ['chat', 'streaming'], inputPrice: 1.0, outputPrice: 3.0 }),
      makeModelConfig({ id: 'm2', capabilities: ['chat', 'streaming'], inputPrice: 2.0, outputPrice: 6.0 }),
    ]);
    const results = findModels({ capabilities: ['chat'] });
    const modelIds = results.map(r => r.model.id);
    expect(modelIds).toContain('m1');
    expect(modelIds).toContain('m2');
  });
});

// ===========================================================================
// selectBestModel
// ===========================================================================

describe('selectBestModel', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('returns the first result from findModels', () => {
    // Use 'openai' — a real PROVIDER_IDS entry
    const config = makeProviderConfig({
      id: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: [
        makeModelConfig({ id: 'model-first', capabilities: ['chat', 'streaming'] }),
        makeModelConfig({ id: 'model-second', capabilities: ['chat', 'streaming'] }),
      ],
    });
    setupReadFileMock({ openai: config });
    setEnv('OPENAI_API_KEY', 'sk-openai');

    const result = selectBestModel({ capabilities: ['chat'] });
    expect(result).not.toBeNull();
    expect(result?.model.id).toBe('model-first');
  });

  it('returns null when no models match', () => {
    const config = makeProviderConfig({
      id: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: [makeModelConfig({ id: 'm1', capabilities: ['chat', 'streaming'] })],
    });
    setupReadFileMock({ openai: config });
    setEnv('OPENAI_API_KEY', 'sk-openai');

    const result = selectBestModel({ capabilities: ['embeddings'] });
    expect(result).toBeNull();
  });

  it('returns null when there are no configured providers', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = selectBestModel({});
    expect(result).toBeNull();
  });

  it('respects preferredProviders ordering from findModels', () => {
    const openaiConfig = makeProviderConfig({
      id: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: [makeModelConfig({ id: 'openai-model', capabilities: ['chat', 'streaming'] })],
    });
    const anthropicConfig = makeProviderConfig({
      id: 'anthropic',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      models: [makeModelConfig({ id: 'anthropic-model', capabilities: ['chat', 'streaming'] })],
    });
    setupReadFileMock({ openai: openaiConfig, anthropic: anthropicConfig });
    setEnv('OPENAI_API_KEY', 'sk-openai');
    setEnv('ANTHROPIC_API_KEY', 'sk-anthropic');

    const result = selectBestModel({ preferredProviders: ['anthropic'] });
    expect(result?.provider.id).toBe('anthropic');
  });

  it('returns an object with both provider and model properties', () => {
    const config = makeProviderConfig({
      id: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: [makeModelConfig({ id: 'shape-model', capabilities: ['chat', 'streaming'] })],
    });
    setupReadFileMock({ openai: config });
    setEnv('OPENAI_API_KEY', 'sk-openai');

    const result = selectBestModel({});
    if (result !== null) {
      expect(result).toHaveProperty('provider');
      expect(result).toHaveProperty('model');
    }
  });
});

// ===========================================================================
// getCheapestModel
// ===========================================================================

describe('getCheapestModel', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  // Use 'openai' — a real PROVIDER_IDS entry
  function setupCheapestProviders() {
    const config = makeProviderConfig({
      id: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: [
        makeModelConfig({ id: 'expensive', inputPrice: 10.0, outputPrice: 30.0, capabilities: ['chat', 'streaming'] }),
        makeModelConfig({ id: 'moderate', inputPrice: 3.0, outputPrice: 15.0, capabilities: ['chat', 'streaming'] }),
        makeModelConfig({ id: 'cheapest', inputPrice: 0.5, outputPrice: 1.5, capabilities: ['chat', 'streaming'] }),
      ],
    });
    setupReadFileMock({ openai: config });
    setEnv('OPENAI_API_KEY', 'sk-openai');
  }

  it('returns the model with the lowest combined inputPrice + outputPrice', () => {
    setupCheapestProviders();
    const result = getCheapestModel({});
    expect(result?.model.id).toBe('cheapest');
  });

  it('accepts an array of capabilities as the argument', () => {
    setupCheapestProviders();
    const result = getCheapestModel(['chat'] as import('./types.js').ModelCapability[]);
    expect(result).not.toBeNull();
    expect(result?.model.id).toBe('cheapest');
  });

  it('accepts a criteria object as the argument', () => {
    setupCheapestProviders();
    const result = getCheapestModel({ capabilities: ['chat'] });
    expect(result?.model.id).toBe('cheapest');
  });

  it('returns null when no models match the criteria', () => {
    setupCheapestProviders();
    const result = getCheapestModel({ capabilities: ['embeddings'] });
    expect(result).toBeNull();
  });

  it('returns null when there are no configured providers', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = getCheapestModel({});
    expect(result).toBeNull();
  });

  it('filters by capabilities before selecting cheapest', () => {
    // Use 'anthropic' — another real PROVIDER_IDS entry
    const config = makeProviderConfig({
      id: 'anthropic',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      models: [
        makeModelConfig({ id: 'vision-cheap', inputPrice: 1.0, outputPrice: 2.0, capabilities: ['chat', 'vision', 'streaming'] }),
        makeModelConfig({ id: 'ultra-cheap-no-vision', inputPrice: 0.1, outputPrice: 0.2, capabilities: ['chat', 'streaming'] }),
      ],
    });
    setupReadFileMock({ anthropic: config });
    setEnv('ANTHROPIC_API_KEY', 'sk-anthropic');

    const result = getCheapestModel({ capabilities: ['vision'] });
    expect(result?.model.id).toBe('vision-cheap');
  });

  it('works with empty criteria object (no filters)', () => {
    setupCheapestProviders();
    const result = getCheapestModel({});
    expect(result).not.toBeNull();
    expect(result?.model.id).toBe('cheapest');
  });

  it('works with empty array argument (no capability filter)', () => {
    setupCheapestProviders();
    const result = getCheapestModel([]);
    expect(result).not.toBeNull();
    expect(result?.model.id).toBe('cheapest');
  });

  it('uses combined price (inputPrice + outputPrice) for ranking', () => {
    const config = makeProviderConfig({
      id: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: [
        // low input, high output: combined = 1 + 20 = 21
        makeModelConfig({ id: 'low-in-high-out', inputPrice: 1.0, outputPrice: 20.0, capabilities: ['chat', 'streaming'] }),
        // high input, low output: combined = 15 + 2 = 17
        makeModelConfig({ id: 'high-in-low-out', inputPrice: 15.0, outputPrice: 2.0, capabilities: ['chat', 'streaming'] }),
        // mid combined: combined = 8 + 8 = 16 — cheapest
        makeModelConfig({ id: 'mid-both', inputPrice: 8.0, outputPrice: 8.0, capabilities: ['chat', 'streaming'] }),
      ],
    });
    setupReadFileMock({ openai: config });
    setEnv('OPENAI_API_KEY', 'sk-openai');

    const result = getCheapestModel({});
    // mid-both has combined 16, high-in-low-out has 17, low-in-high-out has 21
    expect(result?.model.id).toBe('mid-both');
  });
});

// ===========================================================================
// getFastestModel
// ===========================================================================

describe('getFastestModel', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  // Use 'groq' — a real PROVIDER_IDS entry
  function setupFastestProviders() {
    const config = makeProviderConfig({
      id: 'groq',
      apiKeyEnv: 'GROQ_API_KEY',
      models: [
        // score = contextWindow + inputPrice * 1000 = 200_000 + 10_000 = 210_000
        makeModelConfig({ id: 'slow-large', contextWindow: 200_000, inputPrice: 10.0, capabilities: ['chat', 'streaming'] }),
        // score = 8_000 + 100 = 8_100
        makeModelConfig({ id: 'fast-small', contextWindow: 8_000, inputPrice: 0.1, capabilities: ['chat', 'streaming'] }),
        // score = 32_000 + 1_000 = 33_000
        makeModelConfig({ id: 'medium', contextWindow: 32_000, inputPrice: 1.0, capabilities: ['chat', 'streaming'] }),
      ],
    });
    setupReadFileMock({ groq: config });
    setEnv('GROQ_API_KEY', 'sk-groq');
  }

  it('returns the model with the lowest contextWindow + inputPrice * 1000 score', () => {
    setupFastestProviders();
    const result = getFastestModel({});
    expect(result?.model.id).toBe('fast-small');
  });

  it('accepts an array of capabilities as the argument', () => {
    setupFastestProviders();
    const result = getFastestModel(['chat'] as import('./types.js').ModelCapability[]);
    expect(result).not.toBeNull();
    expect(result?.model.id).toBe('fast-small');
  });

  it('accepts a criteria object as the argument', () => {
    setupFastestProviders();
    const result = getFastestModel({ capabilities: ['chat'] });
    expect(result?.model.id).toBe('fast-small');
  });

  it('returns null when no models match the criteria', () => {
    setupFastestProviders();
    const result = getFastestModel({ capabilities: ['embeddings'] });
    expect(result).toBeNull();
  });

  it('returns null when there are no configured providers', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = getFastestModel({});
    expect(result).toBeNull();
  });

  it('filters by capabilities before selecting fastest', () => {
    // Use 'mistral' — a real PROVIDER_IDS entry
    const config = makeProviderConfig({
      id: 'mistral',
      apiKeyEnv: 'MISTRAL_API_KEY',
      models: [
        makeModelConfig({ id: 'vision-fast', contextWindow: 16_000, inputPrice: 0.5, capabilities: ['chat', 'vision', 'streaming'] }),
        makeModelConfig({ id: 'non-vision-fastest', contextWindow: 4_000, inputPrice: 0.1, capabilities: ['chat', 'streaming'] }),
      ],
    });
    setupReadFileMock({ mistral: config });
    setEnv('MISTRAL_API_KEY', 'sk-mistral');

    const result = getFastestModel({ capabilities: ['vision'] });
    expect(result?.model.id).toBe('vision-fast');
  });

  it('works with empty criteria object', () => {
    setupFastestProviders();
    const result = getFastestModel({});
    expect(result).not.toBeNull();
  });

  it('works with empty array argument', () => {
    setupFastestProviders();
    const result = getFastestModel([]);
    expect(result).not.toBeNull();
  });

  it('uses inputPrice * 1000 as part of the score (higher input price = slower)', () => {
    const config = makeProviderConfig({
      id: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: [
        // score = 1_000 + 5.0 * 1000 = 6_000
        makeModelConfig({ id: 'cheap-small', contextWindow: 1_000, inputPrice: 5.0, capabilities: ['chat', 'streaming'] }),
        // score = 100 + 0.1 * 1000 = 200  → fastest
        makeModelConfig({ id: 'cheaper-tiny', contextWindow: 100, inputPrice: 0.1, capabilities: ['chat', 'streaming'] }),
      ],
    });
    setupReadFileMock({ openai: config });
    setEnv('OPENAI_API_KEY', 'sk-openai');

    const result = getFastestModel({});
    expect(result?.model.id).toBe('cheaper-tiny');
  });
});

// ===========================================================================
// getSmartestModel
// ===========================================================================

describe('getSmartestModel', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  // Use 'anthropic' — a real PROVIDER_IDS entry
  function setupSmartestProviders() {
    const config = makeProviderConfig({
      id: 'anthropic',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      models: [
        // score = contextWindow + outputPrice * 10000 = 128_000 + 150_000 = 278_000
        makeModelConfig({ id: 'standard', contextWindow: 128_000, outputPrice: 15.0, capabilities: ['chat', 'streaming'] }),
        // score = 8_000 + 10_000 = 18_000
        makeModelConfig({ id: 'basic', contextWindow: 8_000, outputPrice: 1.0, capabilities: ['chat', 'streaming'] }),
        // score = 200_000 + 300_000 = 500_000  → smartest
        makeModelConfig({ id: 'smartest', contextWindow: 200_000, outputPrice: 30.0, capabilities: ['chat', 'streaming'] }),
      ],
    });
    setupReadFileMock({ anthropic: config });
    setEnv('ANTHROPIC_API_KEY', 'sk-anthropic');
  }

  it('returns the model with the highest contextWindow + outputPrice * 10000 score', () => {
    setupSmartestProviders();
    const result = getSmartestModel({});
    expect(result?.model.id).toBe('smartest');
  });

  it('accepts an array of capabilities as the argument', () => {
    setupSmartestProviders();
    const result = getSmartestModel(['chat'] as import('./types.js').ModelCapability[]);
    expect(result).not.toBeNull();
    expect(result?.model.id).toBe('smartest');
  });

  it('accepts a criteria object as the argument', () => {
    setupSmartestProviders();
    const result = getSmartestModel({ capabilities: ['chat'] });
    expect(result?.model.id).toBe('smartest');
  });

  it('returns null when no models match the criteria', () => {
    setupSmartestProviders();
    const result = getSmartestModel({ capabilities: ['embeddings'] });
    expect(result).toBeNull();
  });

  it('returns null when there are no configured providers', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = getSmartestModel({});
    expect(result).toBeNull();
  });

  it('filters by capabilities before selecting smartest', () => {
    // Use 'openai' — a real PROVIDER_IDS entry
    const config = makeProviderConfig({
      id: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: [
        makeModelConfig({ id: 'reasoning-smart', contextWindow: 64_000, outputPrice: 20.0, capabilities: ['chat', 'reasoning', 'streaming'] }),
        makeModelConfig({ id: 'non-reasoning-smarter', contextWindow: 500_000, outputPrice: 50.0, capabilities: ['chat', 'streaming'] }),
      ],
    });
    setupReadFileMock({ openai: config });
    setEnv('OPENAI_API_KEY', 'sk-openai');

    const result = getSmartestModel({ capabilities: ['reasoning'] });
    expect(result?.model.id).toBe('reasoning-smart');
  });

  it('works with empty criteria object', () => {
    setupSmartestProviders();
    const result = getSmartestModel({});
    expect(result).not.toBeNull();
  });

  it('works with empty array argument', () => {
    setupSmartestProviders();
    const result = getSmartestModel([]);
    expect(result).not.toBeNull();
  });

  it('uses outputPrice * 10000 as part of the score (higher output price = smarter)', () => {
    const config = makeProviderConfig({
      id: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      models: [
        // score = 4_000 + 0.1 * 10000 = 5_000
        makeModelConfig({ id: 'tiny-cheap', contextWindow: 4_000, outputPrice: 0.1, capabilities: ['chat', 'streaming'] }),
        // score = 4_000 + 60.0 * 10000 = 604_000  → smartest by output price
        makeModelConfig({ id: 'tiny-expensive', contextWindow: 4_000, outputPrice: 60.0, capabilities: ['chat', 'streaming'] }),
      ],
    });
    setupReadFileMock({ openai: config });
    setEnv('OPENAI_API_KEY', 'sk-openai');

    const result = getSmartestModel({});
    expect(result?.model.id).toBe('tiny-expensive');
  });

  it('returns the provider alongside the model', () => {
    setupSmartestProviders();
    const result = getSmartestModel({});
    expect(result?.provider.id).toBe('anthropic');
  });
});

// ===========================================================================
// Integration: cache isolation between test runs via freshModule()
// ===========================================================================

describe('freshModule cache isolation', () => {
  it('freshModule() gives a module with an empty cache', async () => {
    const m = await freshModule();
    // First call should hit readFileSync (not cache)
    mockReadFileSync.mockReturnValueOnce(JSON.stringify(makeProviderConfig({ id: 'openai' })));
    m.loadProviderConfig('openai');
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });

  it('two different freshModule() instances have independent caches', async () => {
    const m1 = await freshModule();
    const m2 = await freshModule();

    const configV1 = makeProviderConfig({ id: 'openai', name: 'Module One' });
    const configV2 = makeProviderConfig({ id: 'openai', name: 'Module Two' });

    mockReadFileSync.mockReturnValueOnce(JSON.stringify(configV1));
    const r1 = m1.loadProviderConfig('openai');

    mockReadFileSync.mockReturnValueOnce(JSON.stringify(configV2));
    const r2 = m2.loadProviderConfig('openai');

    expect(r1?.name).toBe('Module One');
    expect(r2?.name).toBe('Module Two');
  });
});
