import { describe, it, expect } from 'vitest';
import {
  PROVIDER_PRESETS,
  getProviderPreset,
  listProviderPresets,
  createProviderConfigFromPreset,
  getDefaultModelConfig,
} from './presets.js';

const EXPECTED_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'zhipu',
  'deepseek',
  'groq',
  'together',
  'mistral',
  'fireworks',
  'perplexity',
  'ollama',
  'lmstudio',
  'google',
  'xai',
];

describe('PROVIDER_PRESETS', () => {
  it('has exactly 13 entries', () => {
    expect(Object.keys(PROVIDER_PRESETS)).toHaveLength(13);
  });

  it('contains all expected provider IDs', () => {
    for (const id of EXPECTED_PROVIDER_IDS) {
      expect(PROVIDER_PRESETS).toHaveProperty(id);
    }
  });

  it('each preset has all required fields', () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      expect(preset).toHaveProperty('name');
      expect(preset).toHaveProperty('id');
      expect(preset).toHaveProperty('baseUrl');
      expect(preset).toHaveProperty('defaultModel');
      expect(preset).toHaveProperty('models');
      expect(preset).toHaveProperty('openaiCompatible');
      expect(preset).toHaveProperty('envVar');
    }
  });

  it('all IDs match their key in the record', () => {
    for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(preset.id).toBe(key);
    }
  });

  it('all names are non-empty strings', () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      expect(typeof preset.name).toBe('string');
      expect(preset.name.length).toBeGreaterThan(0);
    }
  });

  it('all baseUrls are non-empty and start with http', () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      expect(typeof preset.baseUrl).toBe('string');
      expect(preset.baseUrl.length).toBeGreaterThan(0);
      expect(preset.baseUrl).toMatch(/^https?:\/\//);
    }
  });

  it('all models are arrays', () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      expect(Array.isArray(preset.models)).toBe(true);
    }
  });

  it('defaultModel is in models array for providers with non-empty models', () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      if (preset.models.length > 0) {
        expect(preset.models).toContain(preset.defaultModel);
      }
    }
  });

  it('lmstudio has an empty models array', () => {
    expect(PROVIDER_PRESETS['lmstudio']!.models).toHaveLength(0);
  });

  it('openaiCompatible is boolean for all presets', () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      expect(typeof preset.openaiCompatible).toBe('boolean');
    }
  });

  it('envVar is a string for all presets', () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      expect(typeof preset.envVar).toBe('string');
    }
  });

  it('anthropic and google are not openai-compatible', () => {
    expect(PROVIDER_PRESETS['anthropic']!.openaiCompatible).toBe(false);
    expect(PROVIDER_PRESETS['google']!.openaiCompatible).toBe(false);
  });
});

describe('getProviderPreset', () => {
  it('returns preset for a known ID', () => {
    const preset = getProviderPreset('openai');
    expect(preset).toBeDefined();
    expect(preset!.id).toBe('openai');
  });

  it('returns undefined for an unknown ID', () => {
    expect(getProviderPreset('nonexistent-provider')).toBeUndefined();
  });

  it('returned preset matches the PROVIDER_PRESETS entry', () => {
    for (const id of EXPECTED_PROVIDER_IDS) {
      const preset = getProviderPreset(id);
      expect(preset).toBe(PROVIDER_PRESETS[id]);
    }
  });
});

describe('listProviderPresets', () => {
  it('returns an array with 13 entries', () => {
    const list = listProviderPresets();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(13);
  });

  it('all entries have required fields', () => {
    const list = listProviderPresets();
    for (const preset of list) {
      expect(preset.name).toBeTruthy();
      expect(preset.id).toBeTruthy();
      expect(preset.baseUrl).toBeTruthy();
      expect(typeof preset.openaiCompatible).toBe('boolean');
      expect(typeof preset.envVar).toBe('string');
      expect(Array.isArray(preset.models)).toBe(true);
    }
  });
});

describe('createProviderConfigFromPreset', () => {
  it('returns a ProviderConfig for a known preset', () => {
    const config = createProviderConfigFromPreset('openai', 'sk-test-key');
    expect(config).toBeDefined();
    expect(config!.apiKey).toBe('sk-test-key');
    expect(config!.baseUrl).toBe(PROVIDER_PRESETS['openai']!.baseUrl);
    expect(config!.defaultModel).toBeDefined();
  });

  it('returns undefined for an unknown preset', () => {
    expect(createProviderConfigFromPreset('nonexistent', 'key')).toBeUndefined();
  });

  it('custom model overrides default', () => {
    const config = createProviderConfigFromPreset('openai', 'sk-key', 'gpt-4o-mini');
    expect(config).toBeDefined();
    expect(config!.defaultModel!.model).toBe('gpt-4o-mini');
  });

  it('openai-compatible preset gets provider openai; anthropic gets provider anthropic', () => {
    const openaiConfig = createProviderConfigFromPreset('deepseek', 'key');
    expect(openaiConfig).toBeDefined();
    expect(openaiConfig!.provider).toBe('openai');

    const anthropicConfig = createProviderConfigFromPreset('anthropic', 'key');
    expect(anthropicConfig).toBeDefined();
    expect(anthropicConfig!.provider).toBe('anthropic');
  });
});

describe('getDefaultModelConfig', () => {
  it('returns model config for a known preset', () => {
    const config = getDefaultModelConfig('openai');
    expect(config).toBeDefined();
    expect(config!.model).toBeTruthy();
    expect(config!.maxTokens).toBe(4096);
    expect(config!.temperature).toBe(0.7);
  });

  it('returns undefined for an unknown preset', () => {
    expect(getDefaultModelConfig('nonexistent')).toBeUndefined();
  });

  it('model matches the preset defaultModel', () => {
    for (const id of EXPECTED_PROVIDER_IDS) {
      const config = getDefaultModelConfig(id);
      expect(config).toBeDefined();
      expect(config!.model).toBe(PROVIDER_PRESETS[id]!.defaultModel);
    }
  });
});
