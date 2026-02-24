/**
 * Model Pricing Database
 *
 * Current model pricing (as of January 2026)
 * Prices in USD per 1 million tokens
 * Sources:
 * - OpenAI: https://openai.com/api/pricing/
 * - Anthropic: https://www.anthropic.com/pricing
 * - Google: https://ai.google.dev/gemini-api/docs/pricing
 * - DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
 */

import type { ModelPricing } from './types.js';

export const MODEL_PRICING: ModelPricing[] = [
  // ==========================================================================
  // OpenAI Models (January 2026)
  // ==========================================================================

  // GPT-5 Series - Latest flagship
  {
    provider: 'openai',
    modelId: 'gpt-5',
    displayName: 'GPT-5',
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
    contextWindow: 400000,
    maxOutput: 128000,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'gpt-5-mini',
    displayName: 'GPT-5 Mini',
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 1.2,
    contextWindow: 400000,
    maxOutput: 128000,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // GPT-4.1 Series
  {
    provider: 'openai',
    modelId: 'gpt-4.1',
    displayName: 'GPT-4.1',
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0,
    contextWindow: 1050000,
    maxOutput: 32768,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini',
    inputPricePerMillion: 0.4,
    outputPricePerMillion: 1.6,
    contextWindow: 1000000,
    maxOutput: 32768,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'gpt-4.1-nano',
    displayName: 'GPT-4.1 Nano',
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    contextWindow: 1000000,
    maxOutput: 32768,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // GPT-4o Series
  {
    provider: 'openai',
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // O-Series Reasoning Models
  {
    provider: 'openai',
    modelId: 'o3',
    displayName: 'O3',
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0,
    contextWindow: 200000,
    maxOutput: 100000,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'o3-mini',
    displayName: 'O3 Mini',
    inputPricePerMillion: 1.1,
    outputPricePerMillion: 4.4,
    contextWindow: 200000,
    maxOutput: 100000,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'o1',
    displayName: 'O1',
    inputPricePerMillion: 15.0,
    outputPricePerMillion: 60.0,
    contextWindow: 200000,
    maxOutput: 100000,
    supportsFunctions: false,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'openai',
    modelId: 'o1-mini',
    displayName: 'O1 Mini',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 12.0,
    contextWindow: 128000,
    maxOutput: 65536,
    supportsFunctions: false,
    updatedAt: '2026-01-26',
  },

  // Legacy OpenAI
  {
    provider: 'openai',
    modelId: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo (Legacy)',
    inputPricePerMillion: 10.0,
    outputPricePerMillion: 30.0,
    contextWindow: 128000,
    maxOutput: 4096,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // Anthropic Claude Models (January 2026)
  // ==========================================================================

  // Claude 4.5 Series - Current Generation
  {
    provider: 'anthropic',
    modelId: 'claude-4.5-opus',
    displayName: 'Claude 4.5 Opus',
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 25.0,
    contextWindow: 200000,
    maxOutput: 16384,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-4.5-sonnet',
    displayName: 'Claude 4.5 Sonnet',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    contextWindow: 200000,
    maxOutput: 16384,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-4.5-haiku',
    displayName: 'Claude 4.5 Haiku',
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 5.0,
    contextWindow: 200000,
    maxOutput: 16384,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // Claude 4 Series (Legacy)
  {
    provider: 'anthropic',
    modelId: 'claude-4-opus',
    displayName: 'Claude 4 Opus',
    inputPricePerMillion: 15.0,
    outputPricePerMillion: 75.0,
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-4-sonnet',
    displayName: 'Claude 4 Sonnet',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // Claude 3.5 Series
  {
    provider: 'anthropic',
    modelId: 'claude-3-5-sonnet',
    displayName: 'Claude 3.5 Sonnet',
    inputPricePerMillion: 6.0,
    outputPricePerMillion: 30.0,
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-3-5-haiku',
    displayName: 'Claude 3.5 Haiku',
    inputPricePerMillion: 0.8,
    outputPricePerMillion: 4.0,
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // Claude 3 Series (Budget)
  {
    provider: 'anthropic',
    modelId: 'claude-3-haiku',
    displayName: 'Claude 3 Haiku',
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 1.25,
    contextWindow: 200000,
    maxOutput: 4096,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // Google Gemini Models (January 2026)
  // ==========================================================================

  // Gemini 3 Pro Preview
  {
    provider: 'google',
    modelId: 'gemini-3-pro-preview',
    displayName: 'Gemini 3 Pro Preview',
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 12.0,
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // Gemini 2.5 Series
  {
    provider: 'google',
    modelId: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'google',
    modelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'google',
    modelId: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash Lite',
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // Gemini 2.0 (Deprecating March 2026)
  {
    provider: 'google',
    modelId: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash (Deprecating)',
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // DeepSeek Models (January 2026) - Ultra Low Cost
  // ==========================================================================
  {
    provider: 'deepseek',
    modelId: 'deepseek-r1',
    displayName: 'DeepSeek R1 (Reasoner)',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 7.0,
    contextWindow: 128000,
    maxOutput: 65536,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'deepseek',
    modelId: 'deepseek-v3.2',
    displayName: 'DeepSeek V3.2',
    inputPricePerMillion: 0.27,
    outputPricePerMillion: 0.4,
    contextWindow: 163840,
    maxOutput: 65536,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'deepseek',
    modelId: 'deepseek-v3.1',
    displayName: 'DeepSeek V3.1',
    inputPricePerMillion: 0.14,
    outputPricePerMillion: 0.28,
    contextWindow: 128000,
    maxOutput: 65536,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    inputPricePerMillion: 0.14,
    outputPricePerMillion: 0.28,
    contextWindow: 128000,
    maxOutput: 8192,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  // ==========================================================================
  // Groq Models (January 2026 - Fast inference)
  // ==========================================================================
  {
    provider: 'groq',
    modelId: 'llama-4-maverick-17b',
    displayName: 'Llama 4 Maverick 17B',
    inputPricePerMillion: 0.24,
    outputPricePerMillion: 0.97,
    contextWindow: 1000000,
    maxOutput: 32768,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'groq',
    modelId: 'llama-3.3-70b-versatile',
    displayName: 'Llama 3.3 70B',
    inputPricePerMillion: 0.59,
    outputPricePerMillion: 0.79,
    contextWindow: 131072,
    maxOutput: 32768,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'groq',
    modelId: 'llama-3.1-8b-instant',
    displayName: 'Llama 3.1 8B Instant',
    inputPricePerMillion: 0.05,
    outputPricePerMillion: 0.08,
    contextWindow: 131072,
    maxOutput: 131072,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'groq',
    modelId: 'gpt-oss-120b',
    displayName: 'GPT OSS 120B',
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    contextWindow: 131072,
    maxOutput: 65536,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // Mistral Models (January 2026)
  // ==========================================================================
  {
    provider: 'mistral',
    modelId: 'mistral-large-3',
    displayName: 'Mistral Large 3 (675B)',
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 6.0,
    contextWindow: 262144,
    maxOutput: 262144,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'mistral',
    modelId: 'devstral-2',
    displayName: 'Devstral 2 (123B)',
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 0.9,
    contextWindow: 262144,
    maxOutput: 262144,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'mistral',
    modelId: 'ministral-3-14b',
    displayName: 'Ministral 3 (14B)',
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.3,
    contextWindow: 262144,
    maxOutput: 262144,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'mistral',
    modelId: 'codestral-latest',
    displayName: 'Codestral',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.6,
    contextWindow: 32000,
    maxOutput: 8192,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // xAI Grok Models (January 2026)
  // ==========================================================================
  {
    provider: 'xai',
    modelId: 'grok-4',
    displayName: 'Grok 4',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    contextWindow: 256000,
    maxOutput: 64000,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'xai',
    modelId: 'grok-4-fast',
    displayName: 'Grok 4 Fast',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.5,
    contextWindow: 2000000,
    maxOutput: 30000,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },
  {
    provider: 'xai',
    modelId: 'grok-3',
    displayName: 'Grok 3',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    contextWindow: 131072,
    maxOutput: 8192,
    supportsVision: true,
    supportsFunctions: true,
    updatedAt: '2026-01-26',
  },

  // ==========================================================================
  // Local Models (free)
  // ==========================================================================
  {
    provider: 'local',
    modelId: 'local-model',
    displayName: 'Local Model',
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    contextWindow: 8192,
    maxOutput: 4096,
    updatedAt: '2026-01-26',
  },
];
