/**
 * Local Discovery Service
 *
 * Discovers models from local AI providers (LM Studio, Ollama, LocalAI, vLLM, etc.)
 * by calling their API endpoints. This service is pure fetch logic and does NOT
 * write to the database -- the route handler is responsible for DB writes.
 */

import type { LocalProvider } from '../db/repositories/local-providers.js';
import { getErrorMessage } from '../routes/helpers.js';

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredModel {
  modelId: string;
  displayName: string;
  metadata?: Record<string, unknown>;
}

export interface DiscoveryResult {
  models: DiscoveredModel[];
  sourceUrl: string;
  error?: string;
}

// ============================================================================
// Display Name Utility
// ============================================================================

/**
 * Build a human-readable display name from a raw model ID.
 *
 * Steps:
 *   1. Strip org prefix (everything before the last `/`)
 *   2. Strip Ollama-style `:tag` suffix
 *   3. Replace dashes and underscores with spaces
 *   4. Title-case each word
 */
function buildDisplayName(modelId: string): string {
  return modelId
    .replace(/^.*\//, '') // strip org prefix
    .replace(/:[^:]+$/, '') // strip :tag (e.g. ":latest")
    .replace(/[-_]/g, ' ') // dashes / underscores -> spaces
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================================
// Fetch Helpers
// ============================================================================

/** Default timeout per URL attempt (ms). */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Perform a GET request with an 8-second timeout.
 * Returns the raw Response on success or `null` on any network / timeout error.
 */
async function timedFetch(url: string, headers: Record<string, string>): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    return response;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the standard Authorization header when an API key is present.
 */
function authHeaders(apiKey: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

// ============================================================================
// Provider-Specific Discovery
// ============================================================================

// -- LM Studio ---------------------------------------------------------------

interface LMStudioModelEntry {
  id: string;
  object?: string;
  owned_by?: string;
}

interface LMStudioModelsResponse {
  data: LMStudioModelEntry[];
}

async function discoverLMStudio(provider: LocalProvider): Promise<DiscoveryResult> {
  // If baseUrl already ends with /v1, just append /models
  const base = provider.baseUrl.replace(/\/+$/, '');
  const modelsUrl = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;

  const headers = authHeaders(provider.apiKey);
  const response = await timedFetch(modelsUrl, headers);

  if (!response) {
    return { models: [], sourceUrl: modelsUrl, error: 'Failed to connect to LM Studio' };
  }

  if (!response.ok) {
    return {
      models: [],
      sourceUrl: modelsUrl,
      error: `LM Studio returned HTTP ${String(response.status)}`,
    };
  }

  try {
    const body = (await response.json()) as LMStudioModelsResponse;
    const models: DiscoveredModel[] = (body.data ?? []).map((entry) => ({
      modelId: entry.id,
      displayName: buildDisplayName(entry.id),
      metadata: {
        object: entry.object,
        owned_by: entry.owned_by,
      },
    }));

    return { models, sourceUrl: modelsUrl };
  } catch {
    return { models: [], sourceUrl: modelsUrl, error: 'Invalid JSON response from LM Studio' };
  }
}

// -- Ollama ------------------------------------------------------------------

interface OllamaModelEntry {
  name: string;
  model: string;
  modified_at?: string;
  size?: number;
}

interface OllamaTagsResponse {
  models: OllamaModelEntry[];
}

async function discoverOllama(provider: LocalProvider): Promise<DiscoveryResult> {
  const base = provider.baseUrl.replace(/\/+$/, '');
  const tagsUrl = `${base}/api/tags`;

  const headers = authHeaders(provider.apiKey);
  const response = await timedFetch(tagsUrl, headers);

  if (!response) {
    return { models: [], sourceUrl: tagsUrl, error: 'Failed to connect to Ollama' };
  }

  if (!response.ok) {
    return {
      models: [],
      sourceUrl: tagsUrl,
      error: `Ollama returned HTTP ${String(response.status)}`,
    };
  }

  try {
    const body = (await response.json()) as OllamaTagsResponse;
    const models: DiscoveredModel[] = (body.models ?? []).map((entry) => ({
      modelId: entry.name,
      displayName: buildDisplayName(entry.name),
      metadata: {
        modified_at: entry.modified_at,
        size: entry.size,
      },
    }));

    return { models, sourceUrl: tagsUrl };
  } catch {
    return { models: [], sourceUrl: tagsUrl, error: 'Invalid JSON response from Ollama' };
  }
}

// -- Generic / LocalAI / vLLM / Custom --------------------------------------

interface GenericModelEntry {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

interface GenericModelsResponseWrapped {
  data: GenericModelEntry[];
}

/**
 * Build the list of candidate URLs for a generic/LocalAI/vLLM/custom provider.
 *
 * Priority order:
 *   1. `provider.discoveryEndpoint` resolved against baseUrl (if set)
 *   2. `{origin}/v1/models`
 *   3. `{origin}/api/v1/models`
 *   4. `{origin}/models`
 */
function buildGenericCandidateUrls(provider: LocalProvider): string[] {
  const urls: string[] = [];

  // 1. Explicit discovery endpoint (resolved against baseUrl)
  if (provider.discoveryEndpoint) {
    try {
      const resolved = new URL(provider.discoveryEndpoint, provider.baseUrl).href;
      urls.push(resolved);
    } catch {
      // If URL resolution fails, try it as-is
      urls.push(provider.discoveryEndpoint);
    }
  }

  // Derive origin from baseUrl
  let origin: string;
  try {
    const parsed = new URL(provider.baseUrl);
    origin = parsed.origin;
  } catch {
    // Fallback: strip path from baseUrl
    origin = provider.baseUrl.replace(/\/+$/, '');
  }

  // 2-4. Standard paths
  urls.push(`${origin}/v1/models`);
  urls.push(`${origin}/api/v1/models`);
  urls.push(`${origin}/models`);

  // Deduplicate while preserving order
  const seen = new Set<string>();
  return urls.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

/**
 * Parse a generic models response which may be either:
 *   - `{ data: [...] }`  (OpenAI-compatible)
 *   - A flat array `[...]`
 */
function parseGenericModels(raw: unknown): GenericModelEntry[] {
  if (Array.isArray(raw)) {
    return raw as GenericModelEntry[];
  }

  if (raw && typeof raw === 'object' && 'data' in raw) {
    const wrapped = raw as GenericModelsResponseWrapped;
    if (Array.isArray(wrapped.data)) {
      return wrapped.data;
    }
  }

  return [];
}

async function discoverGeneric(provider: LocalProvider): Promise<DiscoveryResult> {
  const candidateUrls = buildGenericCandidateUrls(provider);
  const headers = authHeaders(provider.apiKey);

  // Probe all candidate URLs in parallel for faster discovery
  const probeResults = await Promise.allSettled(
    candidateUrls.map(async (url): Promise<DiscoveryResult> => {
      const response = await timedFetch(url, headers);
      if (!response || !response.ok) {
        throw new Error(`No response from ${url}`);
      }

      let text: string;
      try {
        text = await response.text();
      } catch {
        throw new Error(`Failed to read response from ${url}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON from ${url}`);
      }

      const entries = parseGenericModels(parsed);
      if (entries.length === 0) {
        throw new Error(`No models in response from ${url}`);
      }

      const models: DiscoveredModel[] = entries
        .map((entry) => {
          const id = entry.id ?? entry.name;
          if (!id || typeof id !== 'string') return null;
          return {
            modelId: id,
            displayName: buildDisplayName(id),
            metadata: { ...entry } as Record<string, unknown>,
          };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);

      return { models, sourceUrl: url };
    })
  );

  // Return the first successful result (preserving URL priority order)
  for (const result of probeResults) {
    if (result.status === 'fulfilled' && result.value.models.length > 0) {
      return result.value;
    }
  }

  // All candidates failed
  return {
    models: [],
    sourceUrl: candidateUrls[0] ?? provider.baseUrl,
    error: `No models endpoint responded (tried ${String(candidateUrls.length)} URL(s))`,
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Discover available models from a local AI provider.
 *
 * Dispatches to provider-specific logic based on `provider.providerType`:
 *   - `lmstudio`  -- LM Studio (OpenAI-compatible /v1/models)
 *   - `ollama`    -- Ollama (/api/tags)
 *   - `localai`, `vllm`, `custom` -- Generic OpenAI-compatible, tries multiple URL patterns
 *
 * Returns a `DiscoveryResult` containing the discovered models and the URL
 * that was used. If something goes wrong the `error` field is populated.
 */
export async function discoverModels(provider: LocalProvider): Promise<DiscoveryResult> {
  try {
    switch (provider.providerType) {
      case 'lmstudio':
        return await discoverLMStudio(provider);

      case 'ollama':
        return await discoverOllama(provider);

      case 'localai':
      case 'vllm':
      case 'custom':
        return await discoverGeneric(provider);

      default:
        return {
          models: [],
          sourceUrl: provider.baseUrl,
          error: `Unsupported provider type: ${String(provider.providerType)}`,
        };
    }
  } catch (err) {
    const message = getErrorMessage(err, 'Unknown discovery error');
    return {
      models: [],
      sourceUrl: provider.baseUrl,
      error: message,
    };
  }
}
