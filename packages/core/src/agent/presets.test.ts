import { describe, it, expect } from 'vitest';
import {
  PROVIDER_PRESETS,
  getProviderPreset,
  listProviderPresets,
  createProviderConfigFromPreset,
  getDefaultModelConfig,
} from './presets.js';
import type { ProviderPreset } from './presets.js';

// ---------------------------------------------------------------------------
// 1. PROVIDER_PRESETS structure
// ---------------------------------------------------------------------------
describe('PROVIDER_PRESETS', () => {
  it('is not empty', () => {
    const keys = Object.keys(PROVIDER_PRESETS);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('contains the expected number of providers', () => {
    // There are 13 providers defined in the source
    expect(Object.keys(PROVIDER_PRESETS).length).toBe(13);
  });

  it('includes well-known provider ids', () => {
    const ids = Object.keys(PROVIDER_PRESETS);
    expect(ids).toContain('openai');
    expect(ids).toContain('anthropic');
    expect(ids).toContain('groq');
    expect(ids).toContain('ollama');
    expect(ids).toContain('google');
    expect(ids).toContain('xai');
  });

  it.each(Object.entries(PROVIDER_PRESETS))(
    'preset "%s" has all required fields',
    (_key, preset) => {
      expect(preset).toHaveProperty('id');
      expect(preset).toHaveProperty('name');
      expect(preset).toHaveProperty('baseUrl');
      expect(preset).toHaveProperty('defaultModel');
      expect(preset).toHaveProperty('models');
      expect(preset).toHaveProperty('openaiCompatible');
      expect(preset).toHaveProperty('envVar');
    },
  );

  it.each(Object.entries(PROVIDER_PRESETS))(
    'preset "%s" has correct field types',
    (_key, preset) => {
      expect(typeof preset.id).toBe('string');
      expect(typeof preset.name).toBe('string');
      expect(typeof preset.baseUrl).toBe('string');
      expect(typeof preset.defaultModel).toBe('string');
      expect(Array.isArray(preset.models)).toBe(true);
      expect(typeof preset.openaiCompatible).toBe('boolean');
      expect(typeof preset.envVar).toBe('string');
      // docsUrl is optional but when present must be a string
      if (preset.docsUrl !== undefined) {
        expect(typeof preset.docsUrl).toBe('string');
      }
    },
  );

  it.each(Object.entries(PROVIDER_PRESETS))(
    'preset "%s" has a non-empty id, name, and baseUrl',
    (_key, preset) => {
      expect(preset.id.length).toBeGreaterThan(0);
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.baseUrl.length).toBeGreaterThan(0);
    },
  );

  it.each(Object.entries(PROVIDER_PRESETS))(
    'preset "%s" key matches its id field',
    (key, preset) => {
      expect(key).toBe(preset.id);
    },
  );

  it.each(Object.entries(PROVIDER_PRESETS))(
    'preset "%s" defaultModel is a non-empty string',
    (_key, preset) => {
      expect(preset.defaultModel.length).toBeGreaterThan(0);
    },
  );

  it('anthropic and google are not openaiCompatible', () => {
    expect(PROVIDER_PRESETS['anthropic'].openaiCompatible).toBe(false);
    expect(PROVIDER_PRESETS['google'].openaiCompatible).toBe(false);
  });

  it('openai, groq, deepseek, ollama, xai are openaiCompatible', () => {
    expect(PROVIDER_PRESETS['openai'].openaiCompatible).toBe(true);
    expect(PROVIDER_PRESETS['groq'].openaiCompatible).toBe(true);
    expect(PROVIDER_PRESETS['deepseek'].openaiCompatible).toBe(true);
    expect(PROVIDER_PRESETS['ollama'].openaiCompatible).toBe(true);
    expect(PROVIDER_PRESETS['xai'].openaiCompatible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. getProviderPreset
// ---------------------------------------------------------------------------
describe('getProviderPreset', () => {
  it('returns a preset for a valid id', () => {
    const preset = getProviderPreset('openai');
    expect(preset).toBeDefined();
    expect(preset!.id).toBe('openai');
    expect(preset!.name).toBe('OpenAI');
  });

  it('returns the correct preset for anthropic', () => {
    const preset = getProviderPreset('anthropic');
    expect(preset).toBeDefined();
    expect(preset!.id).toBe('anthropic');
    expect(preset!.openaiCompatible).toBe(false);
  });

  it('returns undefined for an unknown id', () => {
    expect(getProviderPreset('nonexistent')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(getProviderPreset('')).toBeUndefined();
  });

  it('is case-sensitive (uppercase key returns undefined)', () => {
    expect(getProviderPreset('OpenAI')).toBeUndefined();
    expect(getProviderPreset('OPENAI')).toBeUndefined();
  });

  it('returns a reference to the same object in PROVIDER_PRESETS', () => {
    const preset = getProviderPreset('groq');
    expect(preset).toBe(PROVIDER_PRESETS['groq']);
  });
});

// ---------------------------------------------------------------------------
// 3. listProviderPresets
// ---------------------------------------------------------------------------
describe('listProviderPresets', () => {
  it('returns an array', () => {
    const list = listProviderPresets();
    expect(Array.isArray(list)).toBe(true);
  });

  it('has a length matching Object.keys(PROVIDER_PRESETS)', () => {
    const list = listProviderPresets();
    expect(list.length).toBe(Object.keys(PROVIDER_PRESETS).length);
  });

  it('every element is a ProviderPreset with required fields', () => {
    for (const preset of listProviderPresets()) {
      expect(preset).toHaveProperty('id');
      expect(preset).toHaveProperty('name');
      expect(preset).toHaveProperty('baseUrl');
      expect(preset).toHaveProperty('defaultModel');
      expect(preset).toHaveProperty('models');
      expect(preset).toHaveProperty('openaiCompatible');
      expect(preset).toHaveProperty('envVar');
    }
  });

  it('contains all preset ids from PROVIDER_PRESETS', () => {
    const listIds = listProviderPresets().map((p) => p.id);
    for (const key of Object.keys(PROVIDER_PRESETS)) {
      expect(listIds).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. createProviderConfigFromPreset
// ---------------------------------------------------------------------------
describe('createProviderConfigFromPreset', () => {
  it('returns a ProviderConfig for a valid presetId', () => {
    const config = createProviderConfigFromPreset('openai', 'sk-test-key');
    expect(config).toBeDefined();
    expect(config!.apiKey).toBe('sk-test-key');
    expect(config!.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('uses the preset defaultModel when model is not provided', () => {
    const config = createProviderConfigFromPreset('openai', 'sk-test-key');
    expect(config).toBeDefined();
    expect(config!.defaultModel).toBeDefined();
    expect(config!.defaultModel!.model).toBe(PROVIDER_PRESETS['openai'].defaultModel);
  });

  it('uses the provided model when one is given', () => {
    const config = createProviderConfigFromPreset('openai', 'sk-test-key', 'gpt-4o-mini');
    expect(config).toBeDefined();
    expect(config!.defaultModel!.model).toBe('gpt-4o-mini');
  });

  it('returns undefined for an unknown preset', () => {
    const config = createProviderConfigFromPreset('nonexistent', 'some-key');
    expect(config).toBeUndefined();
  });

  it('returns undefined for an empty presetId', () => {
    expect(createProviderConfigFromPreset('', 'key')).toBeUndefined();
  });

  it('sets provider to "openai" for openaiCompatible presets', () => {
    const openaiConfig = createProviderConfigFromPreset('openai', 'key');
    expect(openaiConfig!.provider).toBe('openai');

    const groqConfig = createProviderConfigFromPreset('groq', 'key');
    expect(groqConfig!.provider).toBe('openai');

    const deepseekConfig = createProviderConfigFromPreset('deepseek', 'key');
    expect(deepseekConfig!.provider).toBe('openai');

    const togetherConfig = createProviderConfigFromPreset('together', 'key');
    expect(togetherConfig!.provider).toBe('openai');

    const xaiConfig = createProviderConfigFromPreset('xai', 'key');
    expect(xaiConfig!.provider).toBe('openai');
  });

  it('sets provider to "anthropic" for the anthropic preset', () => {
    const config = createProviderConfigFromPreset('anthropic', 'sk-ant-key');
    expect(config).toBeDefined();
    expect(config!.provider).toBe('anthropic');
  });

  it('sets provider to the presetId for non-openaiCompatible presets (e.g. google)', () => {
    // google is not openaiCompatible, so provider = presetId cast as 'anthropic'
    // (per the source logic: preset.openaiCompatible ? 'openai' : (presetId as 'anthropic'))
    const config = createProviderConfigFromPreset('google', 'google-key');
    expect(config).toBeDefined();
    expect(config!.provider).toBe('google');
  });

  it('sets the baseUrl from the preset', () => {
    const config = createProviderConfigFromPreset('groq', 'key');
    expect(config!.baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  it('preserves the apiKey exactly as provided', () => {
    const key = 'my-super-secret-api-key-12345';
    const config = createProviderConfigFromPreset('mistral', key);
    expect(config!.apiKey).toBe(key);
  });

  it('works correctly for local providers with empty envVar', () => {
    const config = createProviderConfigFromPreset('ollama', '');
    expect(config).toBeDefined();
    expect(config!.apiKey).toBe('');
    expect(config!.baseUrl).toBe('http://localhost:11434/v1');
    expect(config!.provider).toBe('openai'); // ollama is openaiCompatible
  });

  it('returns a ProviderConfig whose defaultModel only contains the model field', () => {
    const config = createProviderConfigFromPreset('openai', 'key');
    expect(config!.defaultModel).toEqual({ model: PROVIDER_PRESETS['openai'].defaultModel });
  });
});

// ---------------------------------------------------------------------------
// 5. getDefaultModelConfig
// ---------------------------------------------------------------------------
describe('getDefaultModelConfig', () => {
  it('returns a ModelConfig for a valid preset', () => {
    const modelConfig = getDefaultModelConfig('openai');
    expect(modelConfig).toBeDefined();
  });

  it('returns the correct default model name from the preset', () => {
    const modelConfig = getDefaultModelConfig('openai');
    expect(modelConfig!.model).toBe(PROVIDER_PRESETS['openai'].defaultModel);
  });

  it('has maxTokens set to 4096', () => {
    const modelConfig = getDefaultModelConfig('anthropic');
    expect(modelConfig!.maxTokens).toBe(4096);
  });

  it('has temperature set to 0.7', () => {
    const modelConfig = getDefaultModelConfig('groq');
    expect(modelConfig!.temperature).toBe(0.7);
  });

  it('returns the full expected shape', () => {
    const modelConfig = getDefaultModelConfig('deepseek');
    expect(modelConfig).toEqual({
      model: PROVIDER_PRESETS['deepseek'].defaultModel,
      maxTokens: 4096,
      temperature: 0.7,
    });
  });

  it('returns undefined for an unknown preset', () => {
    expect(getDefaultModelConfig('nonexistent')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(getDefaultModelConfig('')).toBeUndefined();
  });

  it.each(Object.keys(PROVIDER_PRESETS))(
    'returns a valid ModelConfig for preset "%s"',
    (presetId) => {
      const modelConfig = getDefaultModelConfig(presetId);
      expect(modelConfig).toBeDefined();
      expect(modelConfig!.model).toBe(PROVIDER_PRESETS[presetId].defaultModel);
      expect(modelConfig!.maxTokens).toBe(4096);
      expect(modelConfig!.temperature).toBe(0.7);
    },
  );
});
