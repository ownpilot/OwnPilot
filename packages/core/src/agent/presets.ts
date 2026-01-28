/**
 * Provider presets for OpenAI-compatible APIs
 *
 * These providers all use the OpenAI API format but with different base URLs.
 */

import type { ProviderConfig, ModelConfig } from './types.js';

/**
 * Provider preset configuration
 */
export interface ProviderPreset {
  /** Provider display name */
  readonly name: string;
  /** Provider identifier */
  readonly id: string;
  /** API base URL */
  readonly baseUrl: string;
  /** Default model */
  readonly defaultModel: string;
  /** Available models */
  readonly models: readonly string[];
  /** Whether it's OpenAI compatible */
  readonly openaiCompatible: boolean;
  /** Environment variable for API key */
  readonly envVar: string;
  /** Documentation URL */
  readonly docsUrl?: string;
}

/**
 * Built-in provider presets
 */
export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  // OpenAI (Updated January 2026)
  openai: {
    name: 'OpenAI',
    id: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5',
    models: [
      'gpt-5',
      'gpt-5.1',
      'gpt-5.2-codex',
      'o3',
      'o3-pro',
      'o4-mini',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
    ],
    openaiCompatible: true,
    envVar: 'OPENAI_API_KEY',
    docsUrl: 'https://platform.openai.com/docs',
  },

  // Anthropic (Updated January 2026)
  anthropic: {
    name: 'Anthropic',
    id: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-opus-4-5-20251101',
    models: [
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20251101',
      'claude-haiku-4-5-20251101',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
    openaiCompatible: false,
    envVar: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://docs.anthropic.com',
  },

  // Zhipu AI (ZAI GLM) - Updated January 2026
  zhipu: {
    name: 'Zhipu AI (GLM)',
    id: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.7',
    models: [
      'glm-4.7',
      'glm-4.7-flash',
      'glm-4-plus',
      'glm-4',
      'glm-4-air',
      'glm-4-airx',
      'glm-4-flash',
      'glm-4-long',
      'glm-4v-plus',
      'glm-4v',
    ],
    openaiCompatible: true,
    envVar: 'ZHIPU_API_KEY',
    docsUrl: 'https://open.bigmodel.cn/dev/api',
  },

  // DeepSeek (Updated January 2026)
  deepseek: {
    name: 'DeepSeek',
    id: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v3.2',
    models: [
      'deepseek-v3.2',
      'deepseek-v3.2-speciale',
      'deepseek-v3.1-terminus',
      'deepseek-chat',
      'deepseek-coder',
      'deepseek-reasoner',
    ],
    openaiCompatible: true,
    envVar: 'DEEPSEEK_API_KEY',
    docsUrl: 'https://platform.deepseek.com/docs',
  },

  // Groq (Updated January 2026 - Llama 4 models)
  groq: {
    name: 'Groq',
    id: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-4-maverick',
    models: [
      'llama-4-maverick',
      'llama-4-scout',
      'llama-3.3-70b-versatile',
      'llama-3.1-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
    ],
    openaiCompatible: true,
    envVar: 'GROQ_API_KEY',
    docsUrl: 'https://console.groq.com/docs',
  },

  // Together AI (Updated January 2026)
  together: {
    name: 'Together AI',
    id: 'together',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-4-Maverick-Instruct-Turbo',
    models: [
      'meta-llama/Llama-4-Maverick-Instruct-Turbo',
      'meta-llama/Llama-4-Scout-Instruct-Turbo',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'mistralai/Mistral-Large-3-Instruct',
      'Qwen/Qwen3-72B-Instruct-Turbo',
    ],
    openaiCompatible: true,
    envVar: 'TOGETHER_API_KEY',
    docsUrl: 'https://docs.together.ai',
  },

  // Mistral AI (Updated January 2026)
  mistral: {
    name: 'Mistral AI',
    id: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-3',
    models: [
      'mistral-large-3',
      'devstral-2',
      'mistral-large-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
      'codestral-latest',
    ],
    openaiCompatible: true,
    envVar: 'MISTRAL_API_KEY',
    docsUrl: 'https://docs.mistral.ai',
  },

  // Fireworks AI (Updated January 2026)
  fireworks: {
    name: 'Fireworks AI',
    id: 'fireworks',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-4-maverick-instruct',
    models: [
      'accounts/fireworks/models/llama-4-maverick-instruct',
      'accounts/fireworks/models/llama-4-scout-instruct',
      'accounts/fireworks/models/llama-v3p3-70b-instruct',
      'accounts/fireworks/models/mistral-large-3-instruct',
    ],
    openaiCompatible: true,
    envVar: 'FIREWORKS_API_KEY',
    docsUrl: 'https://docs.fireworks.ai',
  },

  // Perplexity (Updated January 2026)
  perplexity: {
    name: 'Perplexity',
    id: 'perplexity',
    baseUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar-pro',
    models: [
      'sonar-pro',
      'sonar-reasoning',
      'sonar-turbo',
      'llama-3.1-sonar-large-128k-online',
      'llama-3.1-sonar-huge-128k-online',
    ],
    openaiCompatible: true,
    envVar: 'PERPLEXITY_API_KEY',
    docsUrl: 'https://docs.perplexity.ai',
  },

  // Ollama (local) - Updated January 2026
  ollama: {
    name: 'Ollama (Local)',
    id: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama4',
    models: ['llama4', 'llama3.3', 'qwen3', 'mistral', 'codellama', 'deepseek-coder-v3'],
    openaiCompatible: true,
    envVar: '',
    docsUrl: 'https://ollama.com/docs',
  },

  // LM Studio (local)
  lmstudio: {
    name: 'LM Studio (Local)',
    id: 'lmstudio',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    models: [],
    openaiCompatible: true,
    envVar: '',
    docsUrl: 'https://lmstudio.ai',
  },

  // Google AI (Gemini) - Added January 2026
  google: {
    name: 'Google AI (Gemini)',
    id: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-pro',
    models: [
      'gemini-2.0-pro',
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ],
    openaiCompatible: false,
    envVar: 'GOOGLE_API_KEY',
    docsUrl: 'https://ai.google.dev/docs',
  },

  // xAI (Grok) - Added January 2026
  xai: {
    name: 'xAI (Grok)',
    id: 'xai',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-3',
    models: ['grok-3', 'grok-3-mini', 'grok-2'],
    openaiCompatible: true,
    envVar: 'XAI_API_KEY',
    docsUrl: 'https://docs.x.ai',
  },
};

/**
 * Get a provider preset by ID
 */
export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS[id];
}

/**
 * List all provider presets
 */
export function listProviderPresets(): ProviderPreset[] {
  return Object.values(PROVIDER_PRESETS);
}

/**
 * Create a provider config from a preset
 */
export function createProviderConfigFromPreset(
  presetId: string,
  apiKey: string,
  model?: string
): ProviderConfig | undefined {
  const preset = PROVIDER_PRESETS[presetId];
  if (!preset) return undefined;

  return {
    provider: preset.openaiCompatible ? 'openai' : (presetId as 'anthropic'),
    apiKey,
    baseUrl: preset.baseUrl,
    defaultModel: {
      model: model ?? preset.defaultModel,
    },
  };
}

/**
 * Get default model config for a preset
 */
export function getDefaultModelConfig(presetId: string): ModelConfig | undefined {
  const preset = PROVIDER_PRESETS[presetId];
  if (!preset) return undefined;

  return {
    model: preset.defaultModel,
    maxTokens: 4096,
    temperature: 0.7,
  };
}
