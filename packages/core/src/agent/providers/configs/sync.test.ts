/**
 * Tests for packages/core/src/agent/providers/configs/sync.ts
 *
 * Tests cover:
 *   - mapCapabilities
 *   - getProviderType
 *   - convertModel
 *   - convertProvider (sorting, defaults, feature derivation)
 *   - loadExistingConfig
 *   - mergeConfigs (protected fields, features, canonical overrides)
 *   - syncProvider
 *   - syncAllProviders
 *   - syncProviders
 *   - listModelsDevProviders
 *   - fetchModelsDevApi
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderConfig as _ProviderConfig, ModelConfig as _ModelConfig } from './types.js';

// ---------------------------------------------------------------------------
// FS mock — must be hoisted before the module under test is imported
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

// node:path and node:url are used for __dirname resolution inside the module.
// We do NOT mock them; the real implementations work fine in Node test runner.

// ---------------------------------------------------------------------------
// Imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import {
  fetchModelsDevApi,
  syncProvider,
  syncAllProviders,
  syncProviders,
  listModelsDevProviders,
} from './sync.js';

// ---------------------------------------------------------------------------
// Typed aliases for mocked fs functions
// ---------------------------------------------------------------------------

const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal models.dev model object. */
function makeDevModel(
  overrides: {
    id?: string;
    name?: string;
    reasoning?: boolean;
    tool_call?: boolean;
    structured_output?: boolean;
    modalities?: { input?: string[]; output?: string[] };
    cost?: { input?: number; output?: number };
    limit?: { context?: number; output?: number };
    release_date?: string;
  } = {}
) {
  return {
    id: overrides.id,
    name: overrides.name,
    reasoning: overrides.reasoning,
    tool_call: overrides.tool_call,
    structured_output: overrides.structured_output,
    modalities: overrides.modalities,
    cost: overrides.cost,
    limit: overrides.limit,
    release_date: overrides.release_date,
  };
}

/** Build a minimal models.dev provider object. */
function makeDevProvider(
  overrides: {
    id?: string;
    name?: string;
    api?: string;
    env?: string[];
    doc?: string;
    models?: Record<string, ReturnType<typeof makeDevModel>>;
  } = {}
) {
  return {
    id: overrides.id,
    name: overrides.name,
    api: overrides.api,
    env: overrides.env,
    doc: overrides.doc,
    models: overrides.models ?? {},
  };
}

/** Build a successful mock fetch response. */
function okFetchResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

/** Build an error mock fetch response. */
function errFetchResponse(status: number) {
  return { ok: false, status };
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: directory does NOT exist → mkdirSync will be called
  mockExistsSync.mockReturnValue(false);
  // Default: readFileSync throws (file not found) → loadExistingConfig returns null
  mockReadFileSync.mockImplementation(() => {
    throw new Error('ENOENT');
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// mapCapabilities — tested indirectly via syncProvider / convertModel results
// We expose the behaviour through the public API (syncProvider) which calls
// convertProvider → convertModel → mapCapabilities.
// ===========================================================================

describe('mapCapabilities', () => {
  /**
   * Helper: sync a single-model provider and return the first model's capabilities.
   */
  function capsFor(model: ReturnType<typeof makeDevModel>): string[] {
    mockExistsSync.mockReturnValue(true); // dir exists
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    }); // no existing config
    const result = syncProvider(
      'test-provider',
      makeDevProvider({ models: { 'model-a': model } }),
      '/tmp/test'
    );
    return result.models[0]?.capabilities ?? [];
  }

  it('always includes chat and streaming', () => {
    const caps = capsFor(makeDevModel());
    expect(caps).toContain('chat');
    expect(caps).toContain('streaming');
  });

  it('has exactly chat and streaming when no flags are set', () => {
    const caps = capsFor(makeDevModel());
    expect(caps).toEqual(['chat', 'streaming']);
  });

  it('adds vision when input modalities include image', () => {
    const caps = capsFor(makeDevModel({ modalities: { input: ['image'] } }));
    expect(caps).toContain('vision');
  });

  it('adds vision when input modalities include video', () => {
    const caps = capsFor(makeDevModel({ modalities: { input: ['video'] } }));
    expect(caps).toContain('vision');
  });

  it('adds vision when input modalities include both image and video', () => {
    const caps = capsFor(makeDevModel({ modalities: { input: ['image', 'video'] } }));
    expect(caps.filter((c) => c === 'vision').length).toBe(1); // deduplicated
  });

  it('adds audio when input modalities include audio', () => {
    const caps = capsFor(makeDevModel({ modalities: { input: ['audio'] } }));
    expect(caps).toContain('audio');
  });

  it('does NOT add vision or audio when output modalities contain those keywords', () => {
    const caps = capsFor(makeDevModel({ modalities: { output: ['image', 'video', 'audio'] } }));
    expect(caps).not.toContain('vision');
    expect(caps).not.toContain('audio');
  });

  it('adds function_calling when tool_call is true', () => {
    const caps = capsFor(makeDevModel({ tool_call: true }));
    expect(caps).toContain('function_calling');
  });

  it('does NOT add function_calling when tool_call is false', () => {
    const caps = capsFor(makeDevModel({ tool_call: false }));
    expect(caps).not.toContain('function_calling');
  });

  it('adds json_mode when structured_output is true', () => {
    const caps = capsFor(makeDevModel({ structured_output: true }));
    expect(caps).toContain('json_mode');
  });

  it('does NOT add json_mode when structured_output is false', () => {
    const caps = capsFor(makeDevModel({ structured_output: false }));
    expect(caps).not.toContain('json_mode');
  });

  it('adds reasoning when reasoning is true', () => {
    const caps = capsFor(makeDevModel({ reasoning: true }));
    expect(caps).toContain('reasoning');
  });

  it('does NOT add reasoning when reasoning is false', () => {
    const caps = capsFor(makeDevModel({ reasoning: false }));
    expect(caps).not.toContain('reasoning');
  });

  it('combines all capabilities correctly for a fully-featured model', () => {
    const caps = capsFor(
      makeDevModel({
        modalities: { input: ['image', 'audio'] },
        tool_call: true,
        structured_output: true,
        reasoning: true,
      })
    );
    expect(caps).toContain('chat');
    expect(caps).toContain('streaming');
    expect(caps).toContain('vision');
    expect(caps).toContain('audio');
    expect(caps).toContain('function_calling');
    expect(caps).toContain('json_mode');
    expect(caps).toContain('reasoning');
    expect(caps.length).toBe(7);
  });

  it('streaming is always the last capability added', () => {
    const caps = capsFor(makeDevModel({ tool_call: true }));
    expect(caps[caps.length - 1]).toBe('streaming');
  });

  it('does not duplicate chat when modalities are empty object', () => {
    const caps = capsFor(makeDevModel({ modalities: {} }));
    expect(caps.filter((c) => c === 'chat').length).toBe(1);
  });
});

// ===========================================================================
// getProviderType — tested through syncProvider result.type
// (before canonical overrides are applied we can check unknown providers)
// ===========================================================================

describe('getProviderType', () => {
  function typeFor(providerId: string): string {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    // Use a provider id that has no CANONICAL_CONFIGS entry so we see raw type
    const result = syncProvider(
      providerId,
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    return result.type;
  }

  it('maps openai to openai', () => {
    // openai has a canonical override that also sets type='openai'
    const result = syncProvider(
      'openai',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.type).toBe('openai');
  });

  it('maps anthropic to anthropic', () => {
    const result = syncProvider(
      'anthropic',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.type).toBe('anthropic');
  });

  it('maps google to google', () => {
    const result = syncProvider(
      'google',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.type).toBe('google');
  });

  it('maps google-vertex to google (canonical has no baseUrl override)', () => {
    const result = syncProvider(
      'google-vertex',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.type).toBe('google');
  });

  it('maps google-vertex-anthropic to anthropic', () => {
    const result = syncProvider(
      'google-vertex-anthropic',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.type).toBe('anthropic');
  });

  it('maps unknown provider to openai-compatible', () => {
    expect(typeFor('some-random-llm-service')).toBe('openai-compatible');
  });

  it('maps another unknown provider to openai-compatible', () => {
    expect(typeFor('my-custom-provider')).toBe('openai-compatible');
  });
});

// ===========================================================================
// convertModel — tested through syncProvider
// ===========================================================================

describe('convertModel field mapping', () => {
  function syncSingle(modelKey: string, model: ReturnType<typeof makeDevModel>) {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'unknown-provider',
      makeDevProvider({ models: { [modelKey]: model } }),
      '/tmp/test'
    );
    return result.models[0]!;
  }

  it('uses model.id when present, ignoring the modelId key', () => {
    const m = syncSingle('key-id', makeDevModel({ id: 'actual-model-id' }));
    expect(m.id).toBe('actual-model-id');
  });

  it('falls back to modelId key when model.id is absent', () => {
    const m = syncSingle('key-id', makeDevModel());
    expect(m.id).toBe('key-id');
  });

  it('uses model.name when present', () => {
    const m = syncSingle('key', makeDevModel({ name: 'My Model Name' }));
    expect(m.name).toBe('My Model Name');
  });

  it('falls back to modelId when model.name is absent', () => {
    const m = syncSingle('fallback-name', makeDevModel());
    expect(m.name).toBe('fallback-name');
  });

  it('uses limit.context for contextWindow', () => {
    const m = syncSingle('k', makeDevModel({ limit: { context: 200_000 } }));
    expect(m.contextWindow).toBe(200_000);
  });

  it('defaults contextWindow to 8192 when limit.context is absent', () => {
    const m = syncSingle('k', makeDevModel());
    expect(m.contextWindow).toBe(8192);
  });

  it('uses limit.output for maxOutput', () => {
    const m = syncSingle('k', makeDevModel({ limit: { output: 16_384 } }));
    expect(m.maxOutput).toBe(16_384);
  });

  it('defaults maxOutput to 4096 when limit.output is absent', () => {
    const m = syncSingle('k', makeDevModel());
    expect(m.maxOutput).toBe(4096);
  });

  it('uses cost.input for inputPrice', () => {
    const m = syncSingle('k', makeDevModel({ cost: { input: 3.5 } }));
    expect(m.inputPrice).toBe(3.5);
  });

  it('defaults inputPrice to 0 when cost.input is absent', () => {
    const m = syncSingle('k', makeDevModel());
    expect(m.inputPrice).toBe(0);
  });

  it('uses cost.output for outputPrice', () => {
    const m = syncSingle('k', makeDevModel({ cost: { output: 7.0 } }));
    expect(m.outputPrice).toBe(7.0);
  });

  it('defaults outputPrice to 0 when cost.output is absent', () => {
    const m = syncSingle('k', makeDevModel());
    expect(m.outputPrice).toBe(0);
  });

  it('preserves release_date on the converted model', () => {
    const m = syncSingle('k', makeDevModel({ release_date: '2024-06-15' }));
    expect(m.releaseDate).toBe('2024-06-15');
  });

  it('leaves releaseDate undefined when not provided', () => {
    const m = syncSingle('k', makeDevModel());
    expect(m.releaseDate).toBeUndefined();
  });
});

// ===========================================================================
// convertProvider — sorting and defaults
// ===========================================================================

describe('convertProvider sorting and default assignment', () => {
  function sync(models: Record<string, ReturnType<typeof makeDevModel>>) {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    return syncProvider('unknown-provider', makeDevProvider({ models }), '/tmp/test');
  }

  it('marks first model after date-sort as default=true', () => {
    const result = sync({
      'old-model': makeDevModel({ name: 'Old Model', release_date: '2023-01-01' }),
      'new-model': makeDevModel({ name: 'New Model', release_date: '2024-06-01' }),
    });
    const defaultModel = result.models.find((m) => m.default === true);
    expect(defaultModel?.name).toBe('New Model');
  });

  it('marks all other models as default=false', () => {
    const result = sync({
      a: makeDevModel({ name: 'A', release_date: '2024-01-01' }),
      b: makeDevModel({ name: 'B', release_date: '2023-01-01' }),
      c: makeDevModel({ name: 'C', release_date: '2022-01-01' }),
    });
    const nonDefaults = result.models.filter((m) => m.default !== true);
    expect(nonDefaults.length).toBe(2);
    nonDefaults.forEach((m) => expect(m.default).toBe(false));
  });

  it('sorts models newest release_date first', () => {
    const result = sync({
      z: makeDevModel({ name: 'Z Model', release_date: '2022-01-01' }),
      a: makeDevModel({ name: 'A Model', release_date: '2025-01-01' }),
      m: makeDevModel({ name: 'M Model', release_date: '2023-06-15' }),
    });
    expect(result.models[0]!.name).toBe('A Model');
    expect(result.models[1]!.name).toBe('M Model');
    expect(result.models[2]!.name).toBe('Z Model');
  });

  it('models without release_date sort after models with release_date', () => {
    const result = sync({
      dated: makeDevModel({ name: 'Dated', release_date: '2024-01-01' }),
      undated: makeDevModel({ name: 'Undated' }),
    });
    expect(result.models[0]!.name).toBe('Dated');
    expect(result.models[1]!.name).toBe('Undated');
  });

  it('models without release_date sort alphabetically by name among themselves', () => {
    const result = sync({
      'z-model': makeDevModel({ name: 'Zeta' }),
      'a-model': makeDevModel({ name: 'Alpha' }),
      'm-model': makeDevModel({ name: 'Mu' }),
    });
    expect(result.models[0]!.name).toBe('Alpha');
    expect(result.models[1]!.name).toBe('Mu');
    expect(result.models[2]!.name).toBe('Zeta');
  });

  it('returns empty models array when provider has no models', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider('unknown-provider', makeDevProvider({ models: {} }), '/tmp/test');
    expect(result.models).toEqual([]);
  });

  it('uses provider.env[0] as apiKeyEnv when present', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'my-provider',
      makeDevProvider({ env: ['MY_CUSTOM_KEY'], models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    // canonical override won't affect this unknown provider
    expect(result.apiKeyEnv).toBe('MY_CUSTOM_KEY');
  });

  it('generates apiKeyEnv from provider ID when env not provided', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'my-cool-provider',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.apiKeyEnv).toBe('MY_COOL_PROVIDER_API_KEY');
  });

  it('uses provider.api as baseUrl when present', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'my-provider',
      makeDevProvider({ api: 'https://custom.endpoint/v2', models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.baseUrl).toBe('https://custom.endpoint/v2');
  });

  it('generates a default baseUrl from provider ID when api not provided', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'my-cool-provider',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.baseUrl).toBe('https://api.mycoolprovider.com/v1');
  });

  it('uses provider.name as name when present', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'my-provider',
      makeDevProvider({ name: 'My Provider Name', models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.name).toBe('My Provider Name');
  });

  it('falls back to providerId as name when provider.name absent', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'fallback-name',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.name).toBe('fallback-name');
  });

  it('preserves docsUrl from provider.doc', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'my-provider',
      makeDevProvider({ doc: 'https://docs.myprovider.com', models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.docsUrl).toBe('https://docs.myprovider.com');
  });

  it('features.streaming is always true', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'unknown',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.features.streaming).toBe(true);
  });

  it('features.systemMessage is always true', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'unknown',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.features.systemMessage).toBe(true);
  });

  it('features.toolUse is true when at least one model has function_calling', () => {
    const result = sync({
      'tool-model': makeDevModel({ tool_call: true }),
      'basic-model': makeDevModel(),
    });
    expect(result.features.toolUse).toBe(true);
  });

  it('features.toolUse is false when no model has function_calling', () => {
    const result = sync({ 'basic-model': makeDevModel() });
    expect(result.features.toolUse).toBe(false);
  });

  it('features.vision is true when at least one model has vision', () => {
    const result = sync({
      'vision-model': makeDevModel({ modalities: { input: ['image'] } }),
    });
    expect(result.features.vision).toBe(true);
  });

  it('features.vision is false when no model has vision', () => {
    const result = sync({ 'basic-model': makeDevModel() });
    expect(result.features.vision).toBe(false);
  });

  it('features.jsonMode is true when at least one model has json_mode', () => {
    const result = sync({ 'json-model': makeDevModel({ structured_output: true }) });
    expect(result.features.jsonMode).toBe(true);
  });

  it('features.jsonMode is false when no model has json_mode', () => {
    const result = sync({ 'basic-model': makeDevModel() });
    expect(result.features.jsonMode).toBe(false);
  });
});

// ===========================================================================
// loadExistingConfig — tested via syncProvider
// (The function itself is internal; we observe its effects through merge output)
// ===========================================================================

describe('loadExistingConfig', () => {
  it('returns null when file does not exist (existsSync=false) → no protected-field merging', () => {
    mockExistsSync.mockReturnValue(false);
    // Dir doesn't exist, file doesn't exist
    const result = syncProvider(
      'unknown-provider',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    // Without existing config the converted type is used (getProviderType fallback)
    expect(result.type).toBe('openai-compatible');
  });

  it('returns null on readFileSync error → gracefully ignores corrupted file', () => {
    mockExistsSync.mockImplementation((_p: string) => {
      // dir exists, file also "exists"
      return true;
    });
    mockReadFileSync.mockImplementation(() => {
      throw new Error('Disk error');
    });

    const result = syncProvider(
      'unknown-provider',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    // Should succeed without merging
    expect(result).toBeDefined();
    expect(result.models.length).toBe(1);
  });

  it('returns null on JSON parse error → treats as no existing config', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('NOT_VALID_JSON');

    const result = syncProvider(
      'unknown-provider',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result).toBeDefined();
  });

  it('reads and parses valid existing JSON config file', () => {
    const existingConfig = {
      id: 'unknown-provider',
      type: 'openai-compatible',
      baseUrl: 'https://my.custom.url/v1',
      apiKeyEnv: 'MY_CUSTOM_KEY',
      name: 'Unknown Provider',
      models: [],
      features: {
        streaming: true,
        toolUse: false,
        vision: false,
        jsonMode: false,
        systemMessage: true,
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existingConfig));

    const result = syncProvider(
      'unknown-provider',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    // Protected field baseUrl preserved from existing
    expect(result.baseUrl).toBe('https://my.custom.url/v1');
  });
});

// ===========================================================================
// mergeConfigs — protected fields, features merge, canonical overrides
// ===========================================================================

describe('mergeConfigs', () => {
  function syncWithExisting(providerId: string, existingConfig: object) {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existingConfig));
    return syncProvider(
      providerId,
      makeDevProvider({ models: { m: makeDevModel() }, api: 'https://api.newurl.com' }),
      '/tmp/test'
    );
  }

  // --- No existing config ---

  it('returns newConfig as-is (with canonical) when no existing config', () => {
    mockExistsSync.mockReturnValue(false);
    const result = syncProvider(
      'unknown-provider',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(result.id).toBe('unknown-provider');
  });

  // --- Protected field preservation ---

  it('preserves type from existing config', () => {
    const result = syncWithExisting('unknown-provider', {
      type: 'anthropic',
      baseUrl: 'https://old.url',
      apiKeyEnv: 'OLD_KEY',
    });
    expect(result.type).toBe('anthropic');
  });

  it('preserves baseUrl from existing config', () => {
    const result = syncWithExisting('unknown-provider', {
      baseUrl: 'https://preserved.url/v1',
    });
    expect(result.baseUrl).toBe('https://preserved.url/v1');
  });

  it('preserves apiKeyEnv from existing config', () => {
    const result = syncWithExisting('unknown-provider', {
      apiKeyEnv: 'PRESERVED_API_KEY',
    });
    expect(result.apiKeyEnv).toBe('PRESERVED_API_KEY');
  });

  it('uses new values when existing config does not have protected fields', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'Old Name' })); // no protected fields
    const result = syncProvider(
      'unknown-provider',
      makeDevProvider({
        env: ['NEW_KEY'],
        api: 'https://new.url/v1',
        models: { m: makeDevModel() },
      }),
      '/tmp/test'
    );
    expect(result.apiKeyEnv).toBe('NEW_KEY');
    expect(result.baseUrl).toBe('https://new.url/v1');
  });

  // --- Features merge ---

  it('merges features: new features are base, existing features overlay', () => {
    const result = syncWithExisting('unknown-provider', {
      features: {
        streaming: false, // existing overrides
        toolUse: true, // existing overrides
        vision: false,
        jsonMode: true,
        systemMessage: false,
      },
    });
    // existing features take precedence
    expect(result.features.streaming).toBe(false);
    expect(result.features.toolUse).toBe(true);
    expect(result.features.systemMessage).toBe(false);
  });

  it('uses newConfig features when existing config has no features field', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'Provider' }));
    const result = syncProvider(
      'unknown-provider',
      makeDevProvider({ models: { m: makeDevModel({ tool_call: true }) } }),
      '/tmp/test'
    );
    expect(result.features.toolUse).toBe(true);
    expect(result.features.streaming).toBe(true);
  });

  // --- Canonical overrides always win ---

  it('canonical type always overrides even when existing config has different type', () => {
    const result = syncWithExisting('openai', {
      type: 'openai-compatible', // wrong — canonical should override
      baseUrl: 'https://wrong.url',
      apiKeyEnv: 'WRONG_KEY',
    });
    expect(result.type).toBe('openai');
  });

  it('canonical baseUrl always overrides', () => {
    const result = syncWithExisting('openai', {
      baseUrl: 'https://wrong.url.com/v1',
    });
    expect(result.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('canonical apiKeyEnv always overrides', () => {
    const result = syncWithExisting('openai', {
      apiKeyEnv: 'WRONG_KEY',
    });
    expect(result.apiKeyEnv).toBe('OPENAI_API_KEY');
  });

  it('canonical anthropic provider always has correct type', () => {
    const result = syncWithExisting('anthropic', { type: 'openai' });
    expect(result.type).toBe('anthropic');
    expect(result.apiKeyEnv).toBe('ANTHROPIC_API_KEY');
    expect(result.baseUrl).toBe('https://api.anthropic.com/v1');
  });

  it('canonical google provider always has correct type and baseUrl', () => {
    const result = syncWithExisting('google', { type: 'openai' });
    expect(result.type).toBe('google');
    expect(result.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(result.apiKeyEnv).toBe('GOOGLE_GENERATIVE_AI_API_KEY');
  });

  it('canonical google-vertex does NOT override baseUrl (project-specific)', () => {
    const result = syncWithExisting('google-vertex', {
      baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1/projects/my-project',
    });
    // canonical for google-vertex has no baseUrl → preserved from existing
    expect(result.baseUrl).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/my-project'
    );
    // but type and apiKeyEnv still overridden
    expect(result.type).toBe('google');
    expect(result.apiKeyEnv).toBe('GOOGLE_VERTEX_API_KEY');
  });

  it('canonical google-vertex-anthropic sets type=anthropic', () => {
    const result = syncWithExisting('google-vertex-anthropic', { type: 'openai' });
    expect(result.type).toBe('anthropic');
  });

  it('canonical azure does NOT override baseUrl (deployment-specific)', () => {
    const result = syncWithExisting('azure', {
      baseUrl: 'https://my-deploy.openai.azure.com/openai',
    });
    expect(result.baseUrl).toBe('https://my-deploy.openai.azure.com/openai');
    expect(result.type).toBe('openai');
    expect(result.apiKeyEnv).toBe('AZURE_OPENAI_API_KEY');
  });

  it('canonical xai has correct baseUrl and apiKeyEnv', () => {
    const result = syncWithExisting('xai', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.x.ai/v1');
    expect(result.apiKeyEnv).toBe('XAI_API_KEY');
  });

  it('canonical groq has correct values', () => {
    const result = syncWithExisting('groq', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(result.apiKeyEnv).toBe('GROQ_API_KEY');
  });

  it('canonical mistral has correct values', () => {
    const result = syncWithExisting('mistral', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.mistral.ai/v1');
    expect(result.apiKeyEnv).toBe('MISTRAL_API_KEY');
  });

  it('canonical cohere has correct values', () => {
    const result = syncWithExisting('cohere', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.cohere.ai/v1');
    expect(result.apiKeyEnv).toBe('COHERE_API_KEY');
  });

  it('canonical openrouter has correct values', () => {
    const result = syncWithExisting('openrouter', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(result.apiKeyEnv).toBe('OPENROUTER_API_KEY');
  });

  it('canonical togetherai has correct values', () => {
    const result = syncWithExisting('togetherai', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.together.xyz/v1');
    expect(result.apiKeyEnv).toBe('TOGETHER_API_KEY');
  });

  it('canonical fireworks-ai has correct values', () => {
    const result = syncWithExisting('fireworks-ai', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.fireworks.ai/inference/v1');
    expect(result.apiKeyEnv).toBe('FIREWORKS_API_KEY');
  });

  it('canonical perplexity has correct values', () => {
    const result = syncWithExisting('perplexity', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.perplexity.ai');
    expect(result.apiKeyEnv).toBe('PERPLEXITY_API_KEY');
  });

  it('canonical deepinfra has correct values', () => {
    const result = syncWithExisting('deepinfra', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.deepinfra.com/v1/openai');
    expect(result.apiKeyEnv).toBe('DEEPINFRA_API_KEY');
  });

  it('canonical alibaba has correct values', () => {
    const result = syncWithExisting('alibaba', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
    expect(result.apiKeyEnv).toBe('DASHSCOPE_API_KEY');
  });

  it('canonical alibaba-cn has correct values', () => {
    const result = syncWithExisting('alibaba-cn', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(result.apiKeyEnv).toBe('DASHSCOPE_API_KEY');
  });

  it('canonical nvidia has correct values', () => {
    const result = syncWithExisting('nvidia', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(result.apiKeyEnv).toBe('NVIDIA_API_KEY');
  });

  it('canonical vultr has correct values', () => {
    const result = syncWithExisting('vultr', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.vultrinference.com/v1');
    expect(result.apiKeyEnv).toBe('VULTR_API_KEY');
  });

  it('canonical moonshotai has correct values', () => {
    const result = syncWithExisting('moonshotai', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.moonshot.ai/v1');
    expect(result.apiKeyEnv).toBe('MOONSHOT_API_KEY');
  });

  it('canonical moonshotai-cn has correct values', () => {
    const result = syncWithExisting('moonshotai-cn', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api.moonshot.cn/v1');
    expect(result.apiKeyEnv).toBe('MOONSHOT_API_KEY');
  });

  it('canonical github-models has correct values', () => {
    const result = syncWithExisting('github-models', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://models.inference.ai.azure.com');
    expect(result.apiKeyEnv).toBe('GITHUB_TOKEN');
  });

  it('canonical huggingface has correct values', () => {
    const result = syncWithExisting('huggingface', {});
    expect(result.type).toBe('openai-compatible');
    expect(result.baseUrl).toBe('https://api-inference.huggingface.co/v1');
    expect(result.apiKeyEnv).toBe('HF_TOKEN');
  });

  it('non-canonical provider uses no canonical override', () => {
    const result = syncWithExisting('my-custom-llm', {
      type: 'anthropic',
      baseUrl: 'https://my.url',
      apiKeyEnv: 'MY_KEY',
    });
    // Protected fields preserved, no canonical override
    expect(result.type).toBe('anthropic');
    expect(result.baseUrl).toBe('https://my.url');
    expect(result.apiKeyEnv).toBe('MY_KEY');
  });
});

// ===========================================================================
// syncProvider
// ===========================================================================

describe('syncProvider', () => {
  it('creates the output directory when it does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    syncProvider('my-prov', makeDevProvider({ models: { m: makeDevModel() } }), '/tmp/outdir');
    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/outdir', { recursive: true });
  });

  it('does NOT call mkdirSync when directory already exists', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    syncProvider('my-prov', makeDevProvider({ models: { m: makeDevModel() } }), '/tmp/outdir');
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it('writes JSON file to correct path', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    syncProvider('my-prov', makeDevProvider({ models: { m: makeDevModel() } }), '/tmp/outdir');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('my-prov.json'),
      expect.any(String),
      'utf-8'
    );
  });

  it('writes valid JSON to the file', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    syncProvider('my-prov', makeDevProvider({ models: { m: makeDevModel() } }), '/tmp/outdir');
    const writtenContent = mockWriteFileSync.mock.calls[0]?.[1] as string;
    expect(() => JSON.parse(writtenContent)).not.toThrow();
  });

  it('writes pretty-printed JSON (2-space indent)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    syncProvider('my-prov', makeDevProvider({ models: { m: makeDevModel() } }), '/tmp/outdir');
    const writtenContent = mockWriteFileSync.mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('\n  '); // indented
  });

  it('returns the merged ProviderConfig', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'my-prov',
      makeDevProvider({ name: 'My Provider', models: { m: makeDevModel() } }),
      '/tmp/outdir'
    );
    expect(result.id).toBe('my-prov');
    expect(result.name).toBe('My Provider');
    expect(result.models.length).toBe(1);
  });

  it('calls readFileSync when existsSync returns true for the file path', () => {
    // Both dir and file exist
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        id: 'my-prov',
        type: 'openai-compatible',
        baseUrl: 'https://existing.url',
        apiKeyEnv: 'EXISTING_KEY',
        name: 'My Provider',
        models: [],
        features: {
          streaming: true,
          toolUse: false,
          vision: false,
          jsonMode: false,
          systemMessage: true,
        },
      })
    );
    const result = syncProvider(
      'my-prov',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/outdir'
    );
    // Protected baseUrl preserved from existing
    expect(result.baseUrl).toBe('https://existing.url');
  });

  it('uses getProviderDataDir() when outputDir is not provided', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    // Should not throw — it calls getProviderDataDir() internally
    expect(() =>
      syncProvider('my-prov', makeDevProvider({ models: { m: makeDevModel() } }))
    ).not.toThrow();
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});

// ===========================================================================
// fetchModelsDevApi
// ===========================================================================

describe('fetchModelsDevApi', () => {
  it('returns parsed JSON on a successful response', async () => {
    const apiData = { openai: { name: 'OpenAI', models: { 'gpt-4': {} } } };
    mockFetch.mockResolvedValueOnce(okFetchResponse(apiData));
    const result = await fetchModelsDevApi();
    expect(result).toEqual(apiData);
  });

  it('calls fetch with the models.dev API URL', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({}));
    await fetchModelsDevApi();
    expect(mockFetch).toHaveBeenCalledWith('https://models.dev/api.json');
  });

  it('throws an error when response.ok is false', async () => {
    mockFetch.mockResolvedValueOnce(errFetchResponse(503));
    await expect(fetchModelsDevApi()).rejects.toThrow('503');
  });

  it('includes the status code in the error message', async () => {
    mockFetch.mockResolvedValueOnce(errFetchResponse(404));
    await expect(fetchModelsDevApi()).rejects.toThrow('404');
  });

  it('propagates network errors from fetch', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    await expect(fetchModelsDevApi()).rejects.toThrow('Network error');
  });
});

// ===========================================================================
// syncAllProviders
// ===========================================================================

describe('syncAllProviders', () => {
  const providerA = makeDevProvider({ name: 'Provider A', models: { 'model-a': makeDevModel() } });
  const providerB = makeDevProvider({ name: 'Provider B', models: { 'model-b': makeDevModel() } });
  const emptyProvider = makeDevProvider({ name: 'Empty', models: {} });

  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
  });

  it('returns synced array with ids of successfully synced providers', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA, 'prov-b': providerB }));
    const result = await syncAllProviders('/tmp/out');
    expect(result.synced).toContain('prov-a');
    expect(result.synced).toContain('prov-b');
  });

  it('returns empty failed array on full success', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA }));
    const result = await syncAllProviders('/tmp/out');
    expect(result.failed).toEqual([]);
  });

  it('skips providers with no models (empty models object)', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({ 'empty-prov': emptyProvider, 'real-prov': providerA })
    );
    const result = await syncAllProviders('/tmp/out');
    expect(result.synced).not.toContain('empty-prov');
    expect(result.synced).toContain('real-prov');
  });

  it('skips providers where models field is missing', async () => {
    const noModelsProv = { name: 'No Models' }; // no models key
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({ 'no-models': noModelsProv, real: providerA })
    );
    const result = await syncAllProviders('/tmp/out');
    expect(result.synced).not.toContain('no-models');
    expect(result.synced).toContain('real');
  });

  it('returns total count including skipped providers', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({
        'prov-a': providerA,
        'prov-b': providerB,
        empty: emptyProvider,
      })
    );
    const result = await syncAllProviders('/tmp/out');
    expect(result.total).toBe(3);
  });

  it('pushes to failed array when syncProvider throws', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA }));
    // Make writeFileSync throw to simulate a sync failure
    mockWriteFileSync.mockImplementationOnce(() => {
      throw new Error('Write failed');
    });
    const result = await syncAllProviders('/tmp/out');
    expect(result.failed).toContain('prov-a');
    expect(result.synced).not.toContain('prov-a');
  });

  it('continues syncing other providers after one fails', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({ 'fail-prov': providerA, 'ok-prov': providerB })
    );
    // First writeFileSync call throws, second succeeds
    mockWriteFileSync
      .mockImplementationOnce(() => {
        throw new Error('Write failed');
      })
      .mockImplementationOnce(() => {});
    const result = await syncAllProviders('/tmp/out');
    expect(result.synced).toContain('ok-prov');
  });

  it('throws when fetchModelsDevApi fails', async () => {
    mockFetch.mockResolvedValueOnce(errFetchResponse(500));
    await expect(syncAllProviders('/tmp/out')).rejects.toThrow('500');
  });

  it('passes outputDir to syncProvider (writes to correct dir)', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA }));
    await syncAllProviders('/custom/output/dir');
    const filePath = mockWriteFileSync.mock.calls[0]?.[0] as string;
    expect(filePath).toContain('prov-a.json');
  });

  it('uses default outputDir when none provided', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA }));
    await expect(syncAllProviders()).resolves.toBeDefined();
  });

  it('returns empty synced and failed arrays when all providers have no models', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ e1: emptyProvider, e2: emptyProvider }));
    const result = await syncAllProviders('/tmp/out');
    expect(result.synced).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.total).toBe(2);
  });
});

// ===========================================================================
// syncProviders
// ===========================================================================

describe('syncProviders', () => {
  const providerA = makeDevProvider({ name: 'Provider A', models: { 'model-a': makeDevModel() } });
  const providerB = makeDevProvider({ name: 'Provider B', models: { 'model-b': makeDevModel() } });

  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
  });

  it('syncs requested providers that are found in the API response', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA, 'prov-b': providerB }));
    const result = await syncProviders(['prov-a'], '/tmp/out');
    expect(result.synced).toContain('prov-a');
    expect(result.notFound).not.toContain('prov-a');
    expect(result.failed).not.toContain('prov-a');
  });

  it('pushes to notFound when provider ID is absent from API response', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA }));
    const result = await syncProviders(['prov-a', 'missing-prov'], '/tmp/out');
    expect(result.notFound).toContain('missing-prov');
    expect(result.synced).not.toContain('missing-prov');
  });

  it('pushes to failed when syncProvider throws for a found provider', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA }));
    mockWriteFileSync.mockImplementationOnce(() => {
      throw new Error('Write failed');
    });
    const result = await syncProviders(['prov-a'], '/tmp/out');
    expect(result.failed).toContain('prov-a');
    expect(result.synced).not.toContain('prov-a');
  });

  it('handles multiple providers with mixed outcomes', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({
        'prov-a': providerA,
        'prov-b': providerB,
      })
    );
    mockWriteFileSync
      .mockImplementationOnce(() => {}) // prov-a ok
      .mockImplementationOnce(() => {
        throw new Error('Disk full');
      }); // prov-b fail
    const result = await syncProviders(['prov-a', 'prov-b', 'missing'], '/tmp/out');
    expect(result.synced).toContain('prov-a');
    expect(result.failed).toContain('prov-b');
    expect(result.notFound).toContain('missing');
  });

  it('returns all three arrays even when empty', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA }));
    const result = await syncProviders(['prov-a'], '/tmp/out');
    expect(result).toHaveProperty('synced');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('notFound');
  });

  it('handles empty providerIds array', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA }));
    const result = await syncProviders([], '/tmp/out');
    expect(result.synced).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.notFound).toEqual([]);
  });

  it('throws when fetchModelsDevApi fails', async () => {
    mockFetch.mockResolvedValueOnce(errFetchResponse(503));
    await expect(syncProviders(['prov-a'], '/tmp/out')).rejects.toThrow('503');
  });

  it('passes outputDir to syncProvider', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA }));
    await syncProviders(['prov-a'], '/custom/dir');
    const filePath = mockWriteFileSync.mock.calls[0]?.[0] as string;
    expect(filePath).toContain('prov-a.json');
  });

  it('uses default outputDir when none provided', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({ 'prov-a': providerA }));
    await expect(syncProviders(['prov-a'])).resolves.toBeDefined();
  });

  it('does not include notFound ids in synced or failed', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({}));
    const result = await syncProviders(['ghost'], '/tmp/out');
    expect(result.synced).not.toContain('ghost');
    expect(result.failed).not.toContain('ghost');
  });
});

// ===========================================================================
// listModelsDevProviders
// ===========================================================================

describe('listModelsDevProviders', () => {
  it('returns providers with id, name, modelCount fields', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({
        'prov-a': makeDevProvider({
          name: 'Provider A',
          models: { m1: makeDevModel(), m2: makeDevModel() },
        }),
      })
    );
    const result = await listModelsDevProviders();
    expect(result[0]).toMatchObject({ id: 'prov-a', name: 'Provider A', modelCount: 2 });
  });

  it('filters out providers with zero models (empty models object)', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({
        empty: makeDevProvider({ name: 'Empty', models: {} }),
        real: makeDevProvider({ name: 'Real', models: { m: makeDevModel() } }),
      })
    );
    const result = await listModelsDevProviders();
    expect(result.map((p) => p.id)).not.toContain('empty');
    expect(result.map((p) => p.id)).toContain('real');
  });

  it('filters out providers with missing models field', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({
        'no-models': { name: 'No Models' },
        'has-models': makeDevProvider({ name: 'Has Models', models: { m: makeDevModel() } }),
      })
    );
    const result = await listModelsDevProviders();
    expect(result.map((p) => p.id)).not.toContain('no-models');
  });

  it('sorts by modelCount descending', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({
        small: makeDevProvider({ name: 'Small', models: { m: makeDevModel() } }),
        large: makeDevProvider({
          name: 'Large',
          models: { m1: makeDevModel(), m2: makeDevModel(), m3: makeDevModel() },
        }),
        medium: makeDevProvider({
          name: 'Medium',
          models: { m1: makeDevModel(), m2: makeDevModel() },
        }),
      })
    );
    const result = await listModelsDevProviders();
    expect(result[0]!.id).toBe('large');
    expect(result[1]!.id).toBe('medium');
    expect(result[2]!.id).toBe('small');
  });

  it('falls back to provider id as name when provider.name absent', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({
        'my-prov': { models: { m: makeDevModel() } }, // no name field
      })
    );
    const result = await listModelsDevProviders();
    expect(result[0]!.name).toBe('my-prov');
  });

  it('returns empty array when all providers have no models', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({
        e1: makeDevProvider({ models: {} }),
        e2: makeDevProvider({ models: {} }),
      })
    );
    const result = await listModelsDevProviders();
    expect(result).toEqual([]);
  });

  it('returns empty array when API response is empty', async () => {
    mockFetch.mockResolvedValueOnce(okFetchResponse({}));
    const result = await listModelsDevProviders();
    expect(result).toEqual([]);
  });

  it('returns correct modelCount for each provider', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({
        three: makeDevProvider({
          name: 'Three',
          models: { a: makeDevModel(), b: makeDevModel(), c: makeDevModel() },
        }),
      })
    );
    const result = await listModelsDevProviders();
    expect(result[0]!.modelCount).toBe(3);
  });

  it('throws when fetchModelsDevApi fails', async () => {
    mockFetch.mockResolvedValueOnce(errFetchResponse(401));
    await expect(listModelsDevProviders()).rejects.toThrow('401');
  });

  it('includes id field equal to the API key', async () => {
    mockFetch.mockResolvedValueOnce(
      okFetchResponse({
        'exact-id': makeDevProvider({ name: 'X', models: { m: makeDevModel() } }),
      })
    );
    const result = await listModelsDevProviders();
    expect(result[0]!.id).toBe('exact-id');
  });
});

// ===========================================================================
// Integration: syncProvider writes correct structure
// ===========================================================================

describe('syncProvider integration', () => {
  it('written JSON contains all required ProviderConfig fields', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    syncProvider(
      'openai',
      makeDevProvider({
        name: 'OpenAI',
        api: 'https://api.openai.com/v1',
        models: { 'gpt-4': makeDevModel({ name: 'GPT-4' }) },
      }),
      '/tmp/test'
    );
    const written = JSON.parse(mockWriteFileSync.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(written).toHaveProperty('id');
    expect(written).toHaveProperty('name');
    expect(written).toHaveProperty('type');
    expect(written).toHaveProperty('apiKeyEnv');
    expect(written).toHaveProperty('baseUrl');
    expect(written).toHaveProperty('models');
    expect(written).toHaveProperty('features');
  });

  it('written JSON has canonical openai values regardless of provider data', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    syncProvider(
      'openai',
      makeDevProvider({
        api: 'https://wrong.url',
        env: ['WRONG_KEY'],
        models: { m: makeDevModel() },
      }),
      '/tmp/test'
    );
    const written = JSON.parse(mockWriteFileSync.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(written['type']).toBe('openai');
    expect(written['baseUrl']).toBe('https://api.openai.com/v1');
    expect(written['apiKeyEnv']).toBe('OPENAI_API_KEY');
  });

  it('single-model provider has that model marked as default', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = syncProvider(
      'unknown-provider',
      makeDevProvider({ models: { 'the-model': makeDevModel({ name: 'The Model' }) } }),
      '/tmp/test'
    );
    expect(result.models[0]?.default).toBe(true);
  });

  it('writes file exactly once per syncProvider call', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    syncProvider(
      'unknown-provider',
      makeDevProvider({ models: { m: makeDevModel() } }),
      '/tmp/test'
    );
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });
});
