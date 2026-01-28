/**
 * Models.dev API Sync Utility
 *
 * Fetches latest model data from models.dev and updates local JSON configs
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderConfig, ModelConfig, ModelCapability, ProviderType } from './types.js';

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
  const config = convertProvider(providerId, providerData);
  const dir = outputDir ?? __dirname;

  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write config file
  const filePath = join(dir, `${providerId}.json`);
  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');

  return config;
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
