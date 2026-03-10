import { describe, it, expect } from 'vitest';
import { PROVIDER_PRESETS } from './presets.js';

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
