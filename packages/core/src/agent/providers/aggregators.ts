/**
 * Aggregator Provider Configurations
 *
 * Pre-configured aggregator providers (fal.ai, together.ai, groq, fireworks, etc.)
 * These providers offer multiple models through a single API endpoint.
 */

import type { ModelCapability } from './configs/types.js';

// ============================================================================
// Types
// ============================================================================

export interface AggregatorModel {
  id: string;
  name: string;
  capabilities: ModelCapability[];
  pricingInput?: number;
  pricingOutput?: number;
  pricingPerRequest?: number;
  contextWindow?: number;
  maxOutput?: number;
}

export interface AggregatorProvider {
  id: string;
  name: string;
  description: string;
  apiBase: string;
  type: 'openai_compatible' | 'custom';
  apiKeyEnv: string;
  docsUrl?: string;
  defaultModels: AggregatorModel[];
}

// ============================================================================
// Aggregator Provider Definitions
// ============================================================================

export const AGGREGATOR_PROVIDERS: Record<string, AggregatorProvider> = {
  fal: {
    id: 'fal',
    name: 'fal.ai',
    description: 'Fast ML inference for image/video generation',
    apiBase: 'https://fal.run',
    type: 'custom',
    apiKeyEnv: 'FAL_KEY',
    docsUrl: 'https://fal.ai/docs',
    defaultModels: [
      {
        id: 'fal-ai/flux-pro/v1.1',
        name: 'FLUX Pro v1.1',
        capabilities: ['image_generation'],
        pricingPerRequest: 0.05,
      },
      {
        id: 'fal-ai/flux-dev',
        name: 'FLUX Dev',
        capabilities: ['image_generation'],
        pricingPerRequest: 0.025,
      },
      {
        id: 'fal-ai/flux-schnell',
        name: 'FLUX Schnell',
        capabilities: ['image_generation'],
        pricingPerRequest: 0.003,
      },
      {
        id: 'fal-ai/fast-sdxl',
        name: 'Fast SDXL',
        capabilities: ['image_generation'],
        pricingPerRequest: 0.003,
      },
      {
        id: 'fal-ai/stable-diffusion-v3-medium',
        name: 'SD3 Medium',
        capabilities: ['image_generation'],
        pricingPerRequest: 0.035,
      },
      {
        id: 'fal-ai/recraft-v3',
        name: 'Recraft v3',
        capabilities: ['image_generation'],
        pricingPerRequest: 0.04,
      },
      {
        id: 'fal-ai/aura-flow',
        name: 'AuraFlow',
        capabilities: ['image_generation'],
        pricingPerRequest: 0.01,
      },
    ],
  },

  together: {
    id: 'together',
    name: 'Together AI',
    description: 'Open-source model hosting with fast inference',
    apiBase: 'https://api.together.xyz/v1',
    type: 'openai_compatible',
    apiKeyEnv: 'TOGETHER_API_KEY',
    docsUrl: 'https://docs.together.ai',
    defaultModels: [
      {
        id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        name: 'Llama 3.3 70B Turbo',
        capabilities: ['chat', 'code', 'function_calling', 'streaming'],
        pricingInput: 0.88,
        pricingOutput: 0.88,
        contextWindow: 131072,
        maxOutput: 4096,
      },
      {
        id: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
        name: 'Llama 3.2 90B Vision',
        capabilities: ['chat', 'vision', 'streaming'],
        pricingInput: 1.2,
        pricingOutput: 1.2,
        contextWindow: 131072,
        maxOutput: 4096,
      },
      {
        id: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
        name: 'Llama 3.2 11B Vision',
        capabilities: ['chat', 'vision', 'streaming'],
        pricingInput: 0.18,
        pricingOutput: 0.18,
        contextWindow: 131072,
        maxOutput: 4096,
      },
      {
        id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        name: 'Qwen 2.5 Coder 32B',
        capabilities: ['chat', 'code', 'streaming'],
        pricingInput: 0.8,
        pricingOutput: 0.8,
        contextWindow: 32768,
        maxOutput: 4096,
      },
      {
        id: 'Qwen/QwQ-32B-Preview',
        name: 'QwQ 32B (Reasoning)',
        capabilities: ['chat', 'code', 'reasoning', 'streaming'],
        pricingInput: 0.8,
        pricingOutput: 0.8,
        contextWindow: 32768,
        maxOutput: 16384,
      },
      {
        id: 'deepseek-ai/DeepSeek-R1',
        name: 'DeepSeek R1',
        capabilities: ['chat', 'code', 'reasoning', 'streaming'],
        pricingInput: 3.0,
        pricingOutput: 7.0,
        contextWindow: 65536,
        maxOutput: 8192,
      },
      {
        id: 'deepseek-ai/DeepSeek-V3',
        name: 'DeepSeek V3',
        capabilities: ['chat', 'code', 'function_calling', 'streaming'],
        pricingInput: 0.9,
        pricingOutput: 0.9,
        contextWindow: 65536,
        maxOutput: 8192,
      },
      {
        id: 'google/gemma-2-27b-it',
        name: 'Gemma 2 27B',
        capabilities: ['chat', 'streaming'],
        pricingInput: 0.8,
        pricingOutput: 0.8,
        contextWindow: 8192,
        maxOutput: 4096,
      },
      {
        id: 'mistralai/Mixtral-8x22B-Instruct-v0.1',
        name: 'Mixtral 8x22B',
        capabilities: ['chat', 'code', 'function_calling', 'streaming'],
        pricingInput: 0.9,
        pricingOutput: 0.9,
        contextWindow: 65536,
        maxOutput: 4096,
      },
      {
        id: 'black-forest-labs/FLUX.1-schnell-Free',
        name: 'FLUX Schnell (Free)',
        capabilities: ['image_generation'],
        pricingPerRequest: 0,
      },
    ],
  },

  groq: {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast LLM inference with LPU',
    apiBase: 'https://api.groq.com/openai/v1',
    type: 'openai_compatible',
    apiKeyEnv: 'GROQ_API_KEY',
    docsUrl: 'https://console.groq.com/docs',
    defaultModels: [
      {
        id: 'llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B',
        capabilities: ['chat', 'code', 'function_calling', 'json_mode', 'streaming'],
        pricingInput: 0.59,
        pricingOutput: 0.79,
        contextWindow: 128000,
        maxOutput: 32768,
      },
      {
        id: 'llama-3.1-8b-instant',
        name: 'Llama 3.1 8B',
        capabilities: ['chat', 'code', 'function_calling', 'json_mode', 'streaming'],
        pricingInput: 0.05,
        pricingOutput: 0.08,
        contextWindow: 128000,
        maxOutput: 8192,
      },
      {
        id: 'mixtral-8x7b-32768',
        name: 'Mixtral 8x7B',
        capabilities: ['chat', 'code', 'function_calling', 'json_mode', 'streaming'],
        pricingInput: 0.24,
        pricingOutput: 0.24,
        contextWindow: 32768,
        maxOutput: 4096,
      },
      {
        id: 'gemma2-9b-it',
        name: 'Gemma 2 9B',
        capabilities: ['chat', 'streaming'],
        pricingInput: 0.2,
        pricingOutput: 0.2,
        contextWindow: 8192,
        maxOutput: 4096,
      },
      {
        id: 'whisper-large-v3-turbo',
        name: 'Whisper Large v3 Turbo',
        capabilities: ['audio'],
        pricingInput: 0.04, // per audio minute
        pricingOutput: 0,
      },
      {
        id: 'distil-whisper-large-v3-en',
        name: 'Distil Whisper (English)',
        capabilities: ['audio'],
        pricingInput: 0.02, // per audio minute
        pricingOutput: 0,
      },
    ],
  },

  fireworks: {
    id: 'fireworks',
    name: 'Fireworks AI',
    description: 'Fast inference platform with serverless and on-demand',
    apiBase: 'https://api.fireworks.ai/inference/v1',
    type: 'openai_compatible',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    docsUrl: 'https://docs.fireworks.ai',
    defaultModels: [
      {
        id: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
        name: 'Llama 3.3 70B',
        capabilities: ['chat', 'code', 'function_calling', 'json_mode', 'streaming'],
        pricingInput: 0.9,
        pricingOutput: 0.9,
        contextWindow: 131072,
        maxOutput: 16384,
      },
      {
        id: 'accounts/fireworks/models/llama-v3p2-11b-vision-instruct',
        name: 'Llama 3.2 11B Vision',
        capabilities: ['chat', 'vision', 'streaming'],
        pricingInput: 0.2,
        pricingOutput: 0.2,
        contextWindow: 131072,
        maxOutput: 4096,
      },
      {
        id: 'accounts/fireworks/models/qwen2p5-coder-32b-instruct',
        name: 'Qwen 2.5 Coder 32B',
        capabilities: ['chat', 'code', 'streaming'],
        pricingInput: 0.9,
        pricingOutput: 0.9,
        contextWindow: 32768,
        maxOutput: 4096,
      },
      {
        id: 'accounts/fireworks/models/deepseek-v3',
        name: 'DeepSeek V3',
        capabilities: ['chat', 'code', 'function_calling', 'streaming'],
        pricingInput: 0.9,
        pricingOutput: 0.9,
        contextWindow: 65536,
        maxOutput: 8192,
      },
      {
        id: 'accounts/fireworks/models/flux-1-dev-fp8',
        name: 'FLUX.1 Dev',
        capabilities: ['image_generation'],
        pricingPerRequest: 0.025,
      },
      {
        id: 'accounts/fireworks/models/flux-1-schnell-fp8',
        name: 'FLUX.1 Schnell',
        capabilities: ['image_generation'],
        pricingPerRequest: 0.003,
      },
      {
        id: 'accounts/fireworks/models/stable-diffusion-xl-1024-v1-0',
        name: 'SDXL 1.0',
        capabilities: ['image_generation'],
        pricingPerRequest: 0.002,
      },
    ],
  },

  deepinfra: {
    id: 'deepinfra',
    name: 'DeepInfra',
    description: 'Serverless GPU inference at scale',
    apiBase: 'https://api.deepinfra.com/v1/openai',
    type: 'openai_compatible',
    apiKeyEnv: 'DEEPINFRA_API_KEY',
    docsUrl: 'https://deepinfra.com/docs',
    defaultModels: [
      {
        id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        name: 'Llama 3.3 70B Turbo',
        capabilities: ['chat', 'code', 'function_calling', 'streaming'],
        pricingInput: 0.35,
        pricingOutput: 0.4,
        contextWindow: 131072,
        maxOutput: 4096,
      },
      {
        id: 'meta-llama/Llama-3.2-90B-Vision-Instruct',
        name: 'Llama 3.2 90B Vision',
        capabilities: ['chat', 'vision', 'streaming'],
        pricingInput: 0.35,
        pricingOutput: 0.4,
        contextWindow: 131072,
        maxOutput: 4096,
      },
      {
        id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        name: 'Qwen 2.5 Coder 32B',
        capabilities: ['chat', 'code', 'streaming'],
        pricingInput: 0.07,
        pricingOutput: 0.16,
        contextWindow: 32768,
        maxOutput: 4096,
      },
      {
        id: 'deepseek-ai/DeepSeek-R1',
        name: 'DeepSeek R1',
        capabilities: ['chat', 'code', 'reasoning', 'streaming'],
        pricingInput: 0.55,
        pricingOutput: 2.19,
        contextWindow: 65536,
        maxOutput: 8192,
      },
    ],
  },

  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified API for all LLM providers',
    apiBase: 'https://openrouter.ai/api/v1',
    type: 'openai_compatible',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    docsUrl: 'https://openrouter.ai/docs',
    defaultModels: [
      {
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        capabilities: ['chat', 'code', 'vision', 'function_calling', 'streaming'],
        pricingInput: 3.0,
        pricingOutput: 15.0,
        contextWindow: 200000,
        maxOutput: 8192,
      },
      {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        capabilities: ['chat', 'code', 'vision', 'function_calling', 'json_mode', 'streaming'],
        pricingInput: 2.5,
        pricingOutput: 10.0,
        contextWindow: 128000,
        maxOutput: 16384,
      },
      {
        id: 'google/gemini-2.0-flash-exp:free',
        name: 'Gemini 2.0 Flash (Free)',
        capabilities: ['chat', 'vision', 'streaming'],
        pricingInput: 0,
        pricingOutput: 0,
        contextWindow: 1000000,
        maxOutput: 8192,
      },
      {
        id: 'deepseek/deepseek-r1',
        name: 'DeepSeek R1',
        capabilities: ['chat', 'code', 'reasoning', 'streaming'],
        pricingInput: 0.55,
        pricingOutput: 2.19,
        contextWindow: 65536,
        maxOutput: 8192,
      },
      {
        id: 'meta-llama/llama-3.3-70b-instruct',
        name: 'Llama 3.3 70B',
        capabilities: ['chat', 'code', 'function_calling', 'streaming'],
        pricingInput: 0.12,
        pricingOutput: 0.3,
        contextWindow: 131072,
        maxOutput: 4096,
      },
    ],
  },

  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'AI-powered search with citations',
    apiBase: 'https://api.perplexity.ai',
    type: 'openai_compatible',
    apiKeyEnv: 'PERPLEXITY_API_KEY',
    docsUrl: 'https://docs.perplexity.ai',
    defaultModels: [
      {
        id: 'sonar-pro',
        name: 'Sonar Pro',
        capabilities: ['chat', 'streaming'],
        pricingInput: 3.0,
        pricingOutput: 15.0,
        contextWindow: 200000,
      },
      {
        id: 'sonar',
        name: 'Sonar',
        capabilities: ['chat', 'streaming'],
        pricingInput: 1.0,
        pricingOutput: 1.0,
        contextWindow: 128000,
      },
      {
        id: 'sonar-reasoning',
        name: 'Sonar Reasoning',
        capabilities: ['chat', 'reasoning', 'streaming'],
        pricingInput: 1.0,
        pricingOutput: 5.0,
        contextWindow: 128000,
      },
    ],
  },

  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'Fastest inference with Wafer-Scale Engine',
    apiBase: 'https://api.cerebras.ai/v1',
    type: 'openai_compatible',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    docsUrl: 'https://inference-docs.cerebras.ai',
    defaultModels: [
      {
        id: 'llama3.3-70b',
        name: 'Llama 3.3 70B',
        capabilities: ['chat', 'code', 'streaming'],
        pricingInput: 0.85,
        pricingOutput: 1.2,
        contextWindow: 128000,
        maxOutput: 8192,
      },
      {
        id: 'llama3.1-8b',
        name: 'Llama 3.1 8B',
        capabilities: ['chat', 'code', 'streaming'],
        pricingInput: 0.1,
        pricingOutput: 0.1,
        contextWindow: 128000,
        maxOutput: 8192,
      },
    ],
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all available aggregator provider IDs
 */
export function getAggregatorIds(): string[] {
  return Object.keys(AGGREGATOR_PROVIDERS);
}

/**
 * Get aggregator provider by ID
 */
export function getAggregatorProvider(id: string): AggregatorProvider | undefined {
  return AGGREGATOR_PROVIDERS[id];
}

/**
 * Get all aggregator providers
 */
export function getAllAggregatorProviders(): AggregatorProvider[] {
  return Object.values(AGGREGATOR_PROVIDERS);
}

/**
 * Check if a provider ID is an aggregator
 */
export function isAggregatorProvider(id: string): boolean {
  return id in AGGREGATOR_PROVIDERS;
}

/**
 * Get aggregator models for a specific provider
 */
export function getAggregatorModels(providerId: string): AggregatorModel[] {
  const provider = AGGREGATOR_PROVIDERS[providerId];
  return provider?.defaultModels || [];
}
