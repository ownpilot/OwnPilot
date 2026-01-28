/**
 * Models.dev API Sync Utility
 *
 * Fetches latest model data from models.dev and updates local JSON configs
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderConfig, ModelConfig, ModelCapability, ProviderType } from './types.js';

/**
 * Fields that should NEVER be overwritten by sync
 * These are preserved from existing config files
 */
const PROTECTED_FIELDS: (keyof ProviderConfig)[] = [
  'type',       // Provider type (google, anthropic, openai, openai-compatible)
  'baseUrl',    // API endpoint URL
  'apiKeyEnv',  // Environment variable name for API key
];

/**
 * CANONICAL configurations for known providers
 * These ALWAYS take precedence over both sync data and existing configs
 * This ensures providers use the correct API client regardless of sync/config errors
 */
const CANONICAL_CONFIGS: Record<string, Partial<Pick<ProviderConfig, 'type' | 'baseUrl' | 'apiKeyEnv'>>> = {
  // Native OpenAI
  'openai': {
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  // Native Anthropic
  'anthropic': {
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  // Google Gemini (NOT OpenAI-compatible, uses its own API format)
  'google': {
    type: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  // Google Vertex AI (Google Cloud)
  'google-vertex': {
    type: 'google',
    // baseUrl is project-specific, don't override
    apiKeyEnv: 'GOOGLE_VERTEX_API_KEY',
  },
  // Google Vertex with Anthropic models
  'google-vertex-anthropic': {
    type: 'anthropic',
    apiKeyEnv: 'GOOGLE_VERTEX_API_KEY',
  },
  // xAI (Grok) - OpenAI compatible
  'xai': {
    type: 'openai-compatible',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
  },
  // Groq - OpenAI compatible
  'groq': {
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
  },
  // Mistral - OpenAI compatible
  'mistral': {
    type: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
  },
  // Cohere - OpenAI compatible
  'cohere': {
    type: 'openai-compatible',
    baseUrl: 'https://api.cohere.ai/v1',
    apiKeyEnv: 'COHERE_API_KEY',
  },
  // OpenRouter - OpenAI compatible aggregator
  'openrouter': {
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  // Together AI - OpenAI compatible
  'togetherai': {
    type: 'openai-compatible',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
  },
  // Fireworks AI - OpenAI compatible
  'fireworks-ai': {
    type: 'openai-compatible',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
  },
  // Perplexity - OpenAI compatible
  'perplexity': {
    type: 'openai-compatible',
    baseUrl: 'https://api.perplexity.ai',
    apiKeyEnv: 'PERPLEXITY_API_KEY',
  },
  // DeepInfra - OpenAI compatible
  'deepinfra': {
    type: 'openai-compatible',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    apiKeyEnv: 'DEEPINFRA_API_KEY',
  },
  // Azure OpenAI (needs custom baseUrl per deployment)
  'azure': {
    type: 'openai',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
  },
  // Alibaba (DashScope) - from models.dev
  'alibaba': {
    type: 'openai-compatible',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
  },
  'alibaba-cn': {
    type: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
  },
  // Nvidia - from models.dev
  'nvidia': {
    type: 'openai-compatible',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
  },
  // Vultr - from models.dev
  'vultr': {
    type: 'openai-compatible',
    baseUrl: 'https://api.vultrinference.com/v1',
    apiKeyEnv: 'VULTR_API_KEY',
  },
  // Moonshot AI
  'moonshotai': {
    type: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
  },
  'moonshotai-cn': {
    type: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
  },
  // GitHub Models
  'github-models': {
    type: 'openai-compatible',
    baseUrl: 'https://models.inference.ai.azure.com',
    apiKeyEnv: 'GITHUB_TOKEN',
  },
  // Hugging Face
  'huggingface': {
    type: 'openai-compatible',
    baseUrl: 'https://api-inference.huggingface.co/v1',
    apiKeyEnv: 'HF_TOKEN',
  },
};

/**
 * Load existing provider config from file
 */
function loadExistingConfig(filePath: string): Partial<ProviderConfig> | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Partial<ProviderConfig>;
  } catch {
    return null;
  }
}

/**
 * Merge new config with existing, preserving protected fields
 * Then apply canonical overrides for known providers
 */
function mergeConfigs(
  newConfig: ProviderConfig,
  existingConfig: Partial<ProviderConfig> | null
): ProviderConfig {
  const merged = existingConfig ? { ...newConfig } : newConfig;

  if (existingConfig) {
    // Preserve protected fields from existing config
    for (const field of PROTECTED_FIELDS) {
      if (existingConfig[field] !== undefined) {
        (merged as unknown as Record<string, unknown>)[field] = existingConfig[field];
      }
    }

    // Also preserve features if they were manually configured
    if (existingConfig.features) {
      merged.features = {
        ...newConfig.features,
        ...existingConfig.features,
      };
    }
  }

  // CRITICAL: Apply canonical overrides for known providers
  // This ensures the correct provider type is ALWAYS used regardless of sync/config errors
  const canonical = CANONICAL_CONFIGS[newConfig.id];
  if (canonical) {
    if (canonical.type) {
      merged.type = canonical.type;
    }
    if (canonical.baseUrl) {
      merged.baseUrl = canonical.baseUrl;
    }
    if (canonical.apiKeyEnv) {
      merged.apiKeyEnv = canonical.apiKeyEnv;
    }
  }

  return merged;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const MODELS_DEV_API = 'https://models.dev/api.json';

/**
 * Models.dev API response types
 */
interface ModelsDevModel {
  id?: string;
  name?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  open_weights?: boolean;
  cost?: {
    input?: number;
    output?: number;
    unit?: string;
  };
  limit?: {
    context?: number;
    output?: number;
  };
}

interface ModelsDevProvider {
  id?: string;
  env?: string[];
  npm?: string;
  api?: string;
  name?: string;
  doc?: string;
  models?: Record<string, ModelsDevModel>;
}

type ModelsDevApiResponse = Record<string, ModelsDevProvider>;

/**
 * Map models.dev capabilities to our capability format
 */
function mapCapabilities(model: ModelsDevModel): ModelCapability[] {
  const caps: ModelCapability[] = ['chat'];

  if (model.modalities?.input?.includes('image') || model.modalities?.input?.includes('video')) {
    caps.push('vision');
  }
  if (model.modalities?.input?.includes('audio')) {
    caps.push('audio');
  }
  if (model.tool_call) {
    caps.push('function_calling');
  }
  if (model.structured_output) {
    caps.push('json_mode');
  }
  if (model.reasoning) {
    caps.push('reasoning');
  }

  // Always add streaming as most models support it
  caps.push('streaming');

  return caps;
}

/**
 * Determine provider type from provider ID
 */
function getProviderType(providerId: string): ProviderType {
  const typeMap: Record<string, ProviderType> = {
    'openai': 'openai',
    'anthropic': 'anthropic',
    'google': 'google',
    'google-vertex': 'google',
    'google-vertex-anthropic': 'anthropic',
  };

  return typeMap[providerId] ?? 'openai-compatible';
}

/**
 * Convert models.dev model to our ModelConfig format
 */
function convertModel(modelId: string, model: ModelsDevModel, isFirst: boolean): ModelConfig {
  return {
    id: model.id ?? modelId,
    name: model.name ?? modelId,
    contextWindow: model.limit?.context ?? 8192,
    maxOutput: model.limit?.output ?? 4096,
    inputPrice: model.cost?.input ?? 0,
    outputPrice: model.cost?.output ?? 0,
    capabilities: mapCapabilities(model),
    default: isFirst, // First model is default
    releaseDate: model.release_date,
  };
}

/**
 * Convert models.dev provider to our ProviderConfig format
 */
function convertProvider(providerId: string, provider: ModelsDevProvider): ProviderConfig {
  const models: ModelConfig[] = [];
  let isFirst = true;

  if (provider.models) {
    for (const [modelId, model] of Object.entries(provider.models)) {
      models.push(convertModel(modelId, model, isFirst));
      isFirst = false;
    }
  }

  // Sort models: newest first (by release date), then alphabetically
  models.sort((a, b) => {
    if (a.releaseDate && b.releaseDate) {
      return b.releaseDate.localeCompare(a.releaseDate);
    }
    if (a.releaseDate) return -1;
    if (b.releaseDate) return 1;
    return a.name.localeCompare(b.name);
  });

  // Mark first model as default after sorting
  if (models.length > 0 && models[0]) {
    models[0].default = true;
    for (let i = 1; i < models.length; i++) {
      const m = models[i];
      if (m) m.default = false;
    }
  }

  // Determine API key env var
  const apiKeyEnv = provider.env?.[0] ?? `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`;

  // Determine a sensible default baseUrl if not provided
  const defaultBaseUrl = `https://api.${providerId.replace(/-/g, '')}.com/v1`;

  return {
    id: providerId,
    name: provider.name ?? providerId,
    type: getProviderType(providerId),
    apiKeyEnv,
    features: {
      streaming: true,
      toolUse: models.some(m => m.capabilities.includes('function_calling')),
      vision: models.some(m => m.capabilities.includes('vision')),
      jsonMode: models.some(m => m.capabilities.includes('json_mode')),
      systemMessage: true,
    },
    models,
    baseUrl: provider.api ?? defaultBaseUrl,
    docsUrl: provider.doc,
  };
}

/**
 * Fetch and parse models.dev API
 */
export async function fetchModelsDevApi(): Promise<ModelsDevApiResponse> {
  const response = await fetch(MODELS_DEV_API);
  if (!response.ok) {
    throw new Error(`Failed to fetch models.dev API: ${response.status}`);
  }
  return response.json() as Promise<ModelsDevApiResponse>;
}

/**
 * Sync a single provider from models.dev data
 */
export function syncProvider(
  providerId: string,
  providerData: ModelsDevProvider,
  outputDir?: string
): ProviderConfig {
  const newConfig = convertProvider(providerId, providerData);
  const dir = outputDir ?? __dirname;

  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Load existing config and merge to preserve protected fields
  const filePath = join(dir, `${providerId}.json`);
  const existingConfig = loadExistingConfig(filePath);
  const mergedConfig = mergeConfigs(newConfig, existingConfig);

  // Write merged config file
  writeFileSync(filePath, JSON.stringify(mergedConfig, null, 2), 'utf-8');

  return mergedConfig;
}

/**
 * Sync all providers from models.dev API
 */
export async function syncAllProviders(outputDir?: string): Promise<{
  synced: string[];
  failed: string[];
  total: number;
}> {
  const data = await fetchModelsDevApi();
  const synced: string[] = [];
  const failed: string[] = [];

  for (const [providerId, providerData] of Object.entries(data)) {
    try {
      // Skip providers with no models
      if (!providerData.models || Object.keys(providerData.models).length === 0) {
        continue;
      }

      syncProvider(providerId, providerData, outputDir);
      synced.push(providerId);
    } catch (error) {
      console.error(`Failed to sync provider ${providerId}:`, error);
      failed.push(providerId);
    }
  }

  return {
    synced,
    failed,
    total: Object.keys(data).length,
  };
}

/**
 * Sync specific providers from models.dev API
 */
export async function syncProviders(
  providerIds: string[],
  outputDir?: string
): Promise<{
  synced: string[];
  failed: string[];
  notFound: string[];
}> {
  const data = await fetchModelsDevApi();
  const synced: string[] = [];
  const failed: string[] = [];
  const notFound: string[] = [];

  for (const providerId of providerIds) {
    const providerData = data[providerId];
    if (!providerData) {
      notFound.push(providerId);
      continue;
    }

    try {
      syncProvider(providerId, providerData, outputDir);
      synced.push(providerId);
    } catch (error) {
      console.error(`Failed to sync provider ${providerId}:`, error);
      failed.push(providerId);
    }
  }

  return { synced, failed, notFound };
}

/**
 * Get provider list from models.dev without syncing
 */
export async function listModelsDevProviders(): Promise<{
  id: string;
  name: string;
  modelCount: number;
}[]> {
  const data = await fetchModelsDevApi();

  return Object.entries(data)
    .map(([id, provider]) => ({
      id,
      name: provider.name ?? id,
      modelCount: provider.models ? Object.keys(provider.models).length : 0,
    }))
    .filter(p => p.modelCount > 0)
    .sort((a, b) => b.modelCount - a.modelCount);
}
