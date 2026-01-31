/**
 * Generate provider configs from models.dev API data
 *
 * Run with: npx tsx scripts/generate-provider-configs.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Models.dev data structure
interface ModelsDevModel {
  id: string;
  name: string;
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
    cache_read?: number;
    cache_write?: number;
    reasoning?: number;
    input_audio?: number;
    output_audio?: number;
  };
  limit?: {
    context?: number;
    output?: number;
  };
  interleaved?: {
    field?: string;
  };
  notes?: string;
}

interface ModelsDevProvider {
  id: string;
  name: string;
  env?: string[];
  npm?: string;
  api?: string;
  doc?: string;
  models: Record<string, ModelsDevModel>;
}

// Our config format
interface ProviderModel {
  id: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  inputPrice: number;
  outputPrice: number;
  capabilities: string[];
  default?: boolean;
  notes?: string;
  releaseDate?: string;
  deprecated?: string;
  aliases?: string[];
}

interface ProviderConfig {
  id: string;
  name: string;
  type: string;
  baseUrl?: string;
  apiKeyEnv: string;
  docsUrl?: string;
  statusUrl?: string;
  features: {
    streaming: boolean;
    toolUse: boolean;
    vision: boolean;
    jsonMode: boolean;
    systemMessage: boolean;
    caching?: boolean;
  };
  models: ProviderModel[];
  notes?: string;
}

// Provider type mapping (non-openai-compatible providers)
const providerTypes: Record<string, string> = {
  'openai': 'openai',
  'anthropic': 'anthropic',
  'google': 'google-genai',  // Google uses its own API format
  'azure': 'azure',
  'amazon-bedrock': 'bedrock',
  'google-vertex': 'vertex',
  'google-vertex-anthropic': 'vertex-anthropic',
  'cohere': 'cohere',  // Cohere has its own API format
};

// Default API URLs
const apiUrls: Record<string, string> = {
  // Major providers
  'openai': 'https://api.openai.com/v1',
  'anthropic': 'https://api.anthropic.com/v1',
  'google': 'https://generativelanguage.googleapis.com/v1beta',
  'deepseek': 'https://api.deepseek.com/v1',
  'groq': 'https://api.groq.com/openai/v1',
  'mistral': 'https://api.mistral.ai/v1',
  'xai': 'https://api.x.ai/v1',
  'cohere': 'https://api.cohere.ai/v1',
  'perplexity': 'https://api.perplexity.ai',

  // Cloud providers
  'azure': 'https://{resource}.openai.azure.com/openai/deployments/{deployment}',
  'azure-cognitive-services': 'https://{resource}.cognitiveservices.azure.com/openai/deployments/{deployment}',
  'amazon-bedrock': 'https://bedrock-runtime.{region}.amazonaws.com',
  'google-vertex': 'https://{region}-aiplatform.googleapis.com/v1',
  'google-vertex-anthropic': 'https://{region}-aiplatform.googleapis.com/v1',
  'sap-ai-core': 'https://api.ai.{landscape}.hana.ondemand.com/v2',

  // Inference providers
  'togetherai': 'https://api.together.xyz/v1',
  'fireworks-ai': 'https://api.fireworks.ai/inference/v1',
  'deepinfra': 'https://api.deepinfra.com/v1/openai',
  'cerebras': 'https://api.cerebras.ai/v1',
  'novita-ai': 'https://api.novita.ai/v3/openai',
  'friendli': 'https://api.friendli.ai/v1',
  'inference': 'https://api.inference.net/v1',
  'scaleway': 'https://api.scaleway.ai/v1',
  'vultr': 'https://api.vultrinference.com/v1',
  'nvidia': 'https://integrate.api.nvidia.com/v1',
  'venice': 'https://api.venice.ai/api/v1',

  // Chinese providers
  'zhipuai': 'https://open.bigmodel.cn/api/paas/v4',
  'alibaba': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'alibaba-cn': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'moonshotai': 'https://api.moonshot.ai/v1',
  'moonshotai-cn': 'https://api.moonshot.cn/v1',
  'siliconflow': 'https://api.siliconflow.cn/v1',
  'siliconflow-cn': 'https://api.siliconflow.cn/v1',
  'minimax': 'https://api.minimax.chat/v1',
  'minimax-cn': 'https://api.minimaxi.com/v1',
  'xiaomi': 'https://api.xiaomimimo.com/v1',
  'upstage': 'https://api.upstage.ai/v1/solar',

  // Platform providers
  'huggingface': 'https://api-inference.huggingface.co/models',
  'github-models': 'https://models.inference.ai.azure.com',
  'gitlab': 'https://gitlab.com/api/v4/ai',
  'openrouter': 'https://openrouter.ai/api/v1',
  'ollama-cloud': 'https://ollama.com/v1',

  // Edge / CDN providers
  'cloudflare-workers-ai': 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run',
  'vercel': 'https://api.vercel.ai/v1',
  'v0': 'https://api.v0.dev/v1',
};

// Environment variable names
const envVars: Record<string, string> = {
  // Major providers
  'openai': 'OPENAI_API_KEY',
  'anthropic': 'ANTHROPIC_API_KEY',
  'google': 'GOOGLE_GENERATIVE_AI_API_KEY',  // Gemini API key
  'deepseek': 'DEEPSEEK_API_KEY',
  'groq': 'GROQ_API_KEY',
  'mistral': 'MISTRAL_API_KEY',
  'xai': 'XAI_API_KEY',
  'cohere': 'COHERE_API_KEY',
  'perplexity': 'PERPLEXITY_API_KEY',

  // Cloud providers
  'azure': 'AZURE_OPENAI_API_KEY',
  'azure-cognitive-services': 'AZURE_COGNITIVE_SERVICES_KEY',
  'amazon-bedrock': 'AWS_ACCESS_KEY_ID',
  'google-vertex': 'GOOGLE_APPLICATION_CREDENTIALS',
  'google-vertex-anthropic': 'GOOGLE_APPLICATION_CREDENTIALS',
  'sap-ai-core': 'SAP_AI_CORE_API_KEY',

  // Inference providers
  'togetherai': 'TOGETHER_API_KEY',
  'fireworks-ai': 'FIREWORKS_API_KEY',
  'deepinfra': 'DEEPINFRA_API_KEY',
  'cerebras': 'CEREBRAS_API_KEY',
  'novita-ai': 'NOVITA_API_KEY',
  'friendli': 'FRIENDLI_API_KEY',
  'inference': 'INFERENCE_API_KEY',
  'scaleway': 'SCALEWAY_API_KEY',
  'vultr': 'VULTR_API_KEY',
  'nvidia': 'NVIDIA_API_KEY',
  'venice': 'VENICE_API_KEY',

  // Chinese providers
  'zhipuai': 'ZHIPU_API_KEY',
  'alibaba': 'DASHSCOPE_API_KEY',
  'alibaba-cn': 'DASHSCOPE_API_KEY',
  'moonshotai': 'MOONSHOT_API_KEY',
  'moonshotai-cn': 'MOONSHOT_API_KEY',
  'siliconflow': 'SILICONFLOW_API_KEY',
  'siliconflow-cn': 'SILICONFLOW_API_KEY',
  'minimax': 'MINIMAX_API_KEY',
  'minimax-cn': 'MINIMAX_API_KEY',
  'xiaomi': 'XIAOMI_API_KEY',
  'upstage': 'UPSTAGE_API_KEY',

  // Platform providers
  'huggingface': 'HUGGINGFACE_API_KEY',
  'github-models': 'GITHUB_TOKEN',
  'gitlab': 'GITLAB_TOKEN',
  'openrouter': 'OPENROUTER_API_KEY',
  'ollama-cloud': 'OLLAMA_API_KEY',

  // Edge / CDN providers
  'cloudflare-workers-ai': 'CLOUDFLARE_API_TOKEN',
  'vercel': 'VERCEL_API_KEY',
  'v0': 'V0_API_KEY',
};

function transformModel(model: ModelsDevModel, isFirst: boolean): ProviderModel {
  const capabilities: string[] = ['chat'];

  // Add capabilities based on model features
  if (model.modalities?.input?.includes('image') || model.attachment) {
    capabilities.push('vision');
  }
  if (model.modalities?.input?.includes('audio')) {
    capabilities.push('audio');
  }
  if (model.modalities?.input?.includes('video')) {
    capabilities.push('video');
  }
  if (model.tool_call) {
    capabilities.push('function_calling');
  }
  if (model.structured_output) {
    capabilities.push('json_mode');
  }
  if (model.reasoning) {
    capabilities.push('reasoning');
  }
  capabilities.push('streaming');

  // Check if it's a code model
  if (model.family?.includes('coder') || model.family?.includes('codestral') ||
      model.family?.includes('devstral') || model.id.includes('code')) {
    capabilities.push('code');
  }

  const result: ProviderModel = {
    id: model.id,
    name: model.name,
    contextWindow: model.limit?.context || 128000,
    maxOutput: model.limit?.output || 8192,
    inputPrice: model.cost?.input || 0,
    outputPrice: model.cost?.output || 0,
    capabilities: [...new Set(capabilities)], // Remove duplicates
  };

  if (isFirst) {
    result.default = true;
  }

  if (model.release_date) {
    result.releaseDate = model.release_date;
  }

  if (model.notes) {
    result.notes = model.notes;
  }

  return result;
}

function transformProvider(id: string, provider: ModelsDevProvider): ProviderConfig | null {
  if (!provider.models || Object.keys(provider.models).length === 0) {
    console.log(`  Skipping ${id}: no models`);
    return null;
  }

  // Include ALL models from models.dev without filtering
  const models = Object.values(provider.models);

  // Sort models: put default/latest models first
  models.sort((a, b) => {
    // Prefer models without version numbers (latest aliases)
    const aIsLatest = !a.id.match(/\d{4}/) && !a.id.includes('-preview');
    const bIsLatest = !b.id.match(/\d{4}/) && !b.id.includes('-preview');
    if (aIsLatest && !bIsLatest) return -1;
    if (!aIsLatest && bIsLatest) return 1;

    // Sort by release date (newest first)
    if (a.release_date && b.release_date) {
      return b.release_date.localeCompare(a.release_date);
    }
    return 0;
  });

  // Determine provider type
  let type = 'openai-compatible';
  if (providerTypes[id]) {
    type = providerTypes[id];
  }

  // Get base URL
  let baseUrl = provider.api || apiUrls[id] || '';

  // Get API key env var
  let apiKeyEnv = provider.env?.[0] || envVars[id] || `${id.toUpperCase().replace(/-/g, '_')}_API_KEY`;

  // Determine features based on models
  const hasVision = models.some(m => m.attachment || m.modalities?.input?.includes('image'));
  const hasToolUse = models.some(m => m.tool_call);
  const hasJsonMode = models.some(m => m.structured_output);

  const config: ProviderConfig = {
    id,
    name: provider.name,
    type,
    apiKeyEnv,
    features: {
      streaming: true,
      toolUse: hasToolUse,
      vision: hasVision,
      jsonMode: hasJsonMode,
      systemMessage: true,
    },
    models: models.map((m, i) => transformModel(m, i === 0)), // All models included
  };

  if (baseUrl) {
    config.baseUrl = baseUrl;
  }

  if (provider.doc) {
    config.docsUrl = provider.doc;
  }

  return config;
}

const MODELS_DEV_API_URL = 'https://models.dev/api.json';

async function main() {
  const outputDir = path.join(__dirname, '..', 'packages', 'core', 'data', 'providers');
  const cachePath = path.join(__dirname, '..', 'models-dev-full.json');

  console.log('Fetching models.dev API data...');

  let data: Record<string, ModelsDevProvider>;

  try {
    // Try to fetch from API
    const response = await fetch(MODELS_DEV_API_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    data = await response.json() as Record<string, ModelsDevProvider>;

    // Cache the data locally
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
    console.log(`Fetched and cached ${Object.keys(data).length} providers from API`);
  } catch (error) {
    console.log(`API fetch failed: ${error}`);
    console.log('Falling back to cached data...');

    if (fs.existsSync(cachePath)) {
      data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      console.log(`Loaded ${Object.keys(data).length} providers from cache`);
    } else {
      throw new Error('No cached data available and API fetch failed');
    }
  }

  console.log(`Found ${Object.keys(data).length} providers`);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let generated = 0;
  let skipped = 0;

  for (const [id, provider] of Object.entries(data)) {
    console.log(`Processing ${id}...`);

    const config = transformProvider(id, provider);

    if (config) {
      const outputPath = path.join(outputDir, `${id}.json`);
      fs.writeFileSync(outputPath, JSON.stringify(config, null, 2) + '\n');
      generated++;
    } else {
      skipped++;
    }
  }

  console.log(`\nDone! Generated ${generated} configs, skipped ${skipped}`);

  // Generate provider IDs file (separate from main index.ts to avoid overwriting)
  const providerIds = Object.keys(data).filter(id => {
    const provider = data[id];
    return provider.models && Object.keys(provider.models).length > 0;
  }).sort();

  // Update PROVIDER_IDS in the existing index.ts (stays in src/, not in data/)
  const indexPath = path.join(__dirname, '..', 'packages', 'core', 'src', 'agent', 'providers', 'configs', 'index.ts');
  if (fs.existsSync(indexPath)) {
    let indexContent = fs.readFileSync(indexPath, 'utf-8');
    // Replace the PROVIDER_IDS array
    const idsArrayStr = JSON.stringify(providerIds, null, 2);
    indexContent = indexContent.replace(
      /export const PROVIDER_IDS = \[[\s\S]*?\] as const;/,
      `export const PROVIDER_IDS = ${idsArrayStr} as const;`
    );
    fs.writeFileSync(indexPath, indexContent);
    console.log('Updated PROVIDER_IDS in index.ts');
  } else {
    console.log('Warning: index.ts not found, skipping PROVIDER_IDS update');
  }
}

main().catch(console.error);
