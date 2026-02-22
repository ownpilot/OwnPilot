/**
 * Local Providers Repository
 *
 * Manages local AI providers (LM Studio, Ollama, LocalAI, vLLM, etc.)
 * and their discovered models. Tracks provider connectivity, default
 * selection, and per-model enable/disable state.
 *
 * Uses in-memory cache for fast synchronous access (same pattern as
 * PluginsRepository and ConfigServicesRepository).
 */

import { randomUUID } from 'node:crypto';
import { BaseRepository, parseJsonField, parseBool } from './base.js';
import { getLog } from '../../services/log.js';

const log = getLog('LocalProvidersRepo');

// =============================================================================
// ROW TYPES (database representation)
// =============================================================================

interface LocalProviderRow {
  id: string;
  user_id: string;
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string | null;
  is_enabled: boolean;
  is_default: boolean;
  discovery_endpoint: string | null;
  last_discovered_at: string | null;
  metadata: string; // JSONB string
  created_at: string;
  updated_at: string;
}

interface LocalModelRow {
  id: string;
  user_id: string;
  local_provider_id: string;
  model_id: string;
  display_name: string;
  capabilities: string; // JSONB string
  context_window: number;
  max_output: number;
  is_enabled: boolean;
  metadata: string; // JSONB string
  created_at: string;
  updated_at: string;
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export type LocalProviderType = 'lmstudio' | 'ollama' | 'localai' | 'vllm' | 'custom';

export interface LocalProvider {
  id: string;
  userId: string;
  name: string;
  providerType: LocalProviderType;
  baseUrl: string;
  apiKey?: string;
  isEnabled: boolean;
  isDefault: boolean;
  discoveryEndpoint?: string;
  lastDiscoveredAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LocalModel {
  id: string;
  userId: string;
  localProviderId: string;
  modelId: string;
  displayName: string;
  capabilities: string[];
  contextWindow: number;
  maxOutput: number;
  isEnabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLocalProviderInput {
  userId?: string;
  name: string;
  providerType: LocalProviderType;
  baseUrl: string;
  apiKey?: string;
  discoveryEndpoint?: string;
}

export interface CreateLocalModelInput {
  userId?: string;
  localProviderId: string;
  modelId: string;
  displayName: string;
  capabilities?: string[];
  contextWindow?: number;
  maxOutput?: number;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// CACHE
// =============================================================================

let providersCache = new Map<string, LocalProvider>(); // keyed by provider id
let modelsCache = new Map<string, LocalModel[]>(); // keyed by provider id
let cacheInitialized = false;

// =============================================================================
// ROW-TO-MODEL CONVERSION
// =============================================================================

function rowToProvider(row: LocalProviderRow): LocalProvider {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    providerType: row.provider_type as LocalProviderType,
    baseUrl: row.base_url,
    apiKey: row.api_key ?? undefined,
    isEnabled: parseBool(row.is_enabled),
    isDefault: parseBool(row.is_default),
    discoveryEndpoint: row.discovery_endpoint ?? undefined,
    lastDiscoveredAt: row.last_discovered_at ?? undefined,
    metadata: parseJsonField<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToModel(row: LocalModelRow): LocalModel {
  return {
    id: row.id,
    userId: row.user_id,
    localProviderId: row.local_provider_id,
    modelId: row.model_id,
    displayName: row.display_name,
    capabilities: parseJsonField<string[]>(row.capabilities, []),
    contextWindow: row.context_window,
    maxOutput: row.max_output,
    isEnabled: parseBool(row.is_enabled),
    metadata: parseJsonField<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class LocalProvidersRepository extends BaseRepository {
  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Load cache from database.
   * Tables are created via schema.ts migrations, not here.
   */
  async initialize(): Promise<void> {
    await this.refreshCache();
  }

  /**
   * Reload every provider and model into the in-memory caches.
   */
  async refreshCache(): Promise<void> {
    const [providerRows, modelRows] = await Promise.all([
      this.query<LocalProviderRow>('SELECT * FROM local_providers'),
      this.query<LocalModelRow>('SELECT * FROM local_models ORDER BY display_name ASC'),
    ]);

    providersCache = new Map(providerRows.map((r) => [r.id, rowToProvider(r)]));

    const grouped = new Map<string, LocalModel[]>();
    for (const row of modelRows) {
      const model = rowToModel(row);
      const list = grouped.get(model.localProviderId);
      if (list) {
        list.push(model);
      } else {
        grouped.set(model.localProviderId, [model]);
      }
    }
    modelsCache = grouped;
    cacheInitialized = true;
  }

  /**
   * Refresh the cache for a single provider and its models.
   */
  private async refreshProviderCache(providerId: string): Promise<void> {
    const [providerRow, modelRows] = await Promise.all([
      this.queryOne<LocalProviderRow>('SELECT * FROM local_providers WHERE id = $1', [providerId]),
      this.query<LocalModelRow>(
        'SELECT * FROM local_models WHERE local_provider_id = $1 ORDER BY display_name ASC',
        [providerId]
      ),
    ]);

    if (providerRow) {
      providersCache.set(providerId, rowToProvider(providerRow));
    } else {
      providersCache.delete(providerId);
    }

    if (modelRows.length > 0) {
      modelsCache.set(providerId, modelRows.map(rowToModel));
    } else {
      modelsCache.delete(providerId);
    }
  }

  // ---------------------------------------------------------------------------
  // Provider accessors
  // ---------------------------------------------------------------------------

  /**
   * List all providers, optionally filtered by user id.
   */
  async listProviders(userId?: string): Promise<LocalProvider[]> {
    const all = Array.from(providersCache.values());
    if (userId) {
      return all.filter((p) => p.userId === userId);
    }
    return all;
  }

  /**
   * Get a provider by id (async, from cache).
   */
  async getProvider(providerId: string): Promise<LocalProvider | null> {
    if (!cacheInitialized) {
      log.warn(`[LocalProviders] Cache not initialized, returning null for: ${providerId}`);
      return null;
    }
    return providersCache.get(providerId) ?? null;
  }

  /**
   * Get a provider by id (sync, from cache). Designed for use in agents.ts
   * and other hot paths that cannot await.
   */
  getProviderSync(providerId: string): LocalProvider | null {
    if (!cacheInitialized) {
      log.warn(`[LocalProviders] Cache not initialized, returning null for: ${providerId}`);
      return null;
    }
    return providersCache.get(providerId) ?? null;
  }

  /**
   * Get the default provider, optionally filtered by user id (from cache).
   */
  async getDefault(userId?: string): Promise<LocalProvider | null> {
    if (!cacheInitialized) {
      log.warn('[LocalProviders] Cache not initialized, returning null for default');
      return null;
    }
    const all = Array.from(providersCache.values());
    if (userId) {
      return all.find((p) => p.isDefault && p.userId === userId) ?? null;
    }
    return all.find((p) => p.isDefault) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Provider CRUD (async, writes to DB + refreshes cache)
  // ---------------------------------------------------------------------------

  /**
   * Create a new local provider.
   */
  async createProvider(input: CreateLocalProviderInput): Promise<LocalProvider> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const userId = input.userId ?? 'default';

    await this.execute(
      `INSERT INTO local_providers
        (id, user_id, name, provider_type, base_url, api_key, is_enabled, is_default,
         discovery_endpoint, last_discovered_at, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        userId,
        input.name,
        input.providerType,
        input.baseUrl,
        input.apiKey ?? null,
        true, // is_enabled
        false, // is_default
        input.discoveryEndpoint ?? null,
        null, // last_discovered_at
        '{}', // metadata
        now,
        now,
      ]
    );

    await this.refreshProviderCache(id);
    return providersCache.get(id)!;
  }

  /**
   * Update a provider's fields. Returns null if not found.
   */
  async updateProvider(
    providerId: string,
    updates: Partial<{
      name: string;
      baseUrl: string;
      apiKey: string;
      discoveryEndpoint: string;
      isEnabled: boolean;
    }>
  ): Promise<LocalProvider | null> {
    const existing = providersCache.get(providerId);
    if (!existing) return null;

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.baseUrl !== undefined) {
      setClauses.push(`base_url = $${paramIndex++}`);
      values.push(updates.baseUrl);
    }
    if (updates.apiKey !== undefined) {
      setClauses.push(`api_key = $${paramIndex++}`);
      values.push(updates.apiKey);
    }
    if (updates.discoveryEndpoint !== undefined) {
      setClauses.push(`discovery_endpoint = $${paramIndex++}`);
      values.push(updates.discoveryEndpoint);
    }
    if (updates.isEnabled !== undefined) {
      setClauses.push(`is_enabled = $${paramIndex++}`);
      values.push(updates.isEnabled);
    }

    if (setClauses.length === 0) return existing;

    setClauses.push(`updated_at = $${paramIndex++}`);
    values.push(new Date().toISOString());

    values.push(providerId); // WHERE clause
    await this.execute(
      `UPDATE local_providers SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    await this.refreshProviderCache(providerId);
    return providersCache.get(providerId) ?? null;
  }

  /**
   * Delete a provider and all its models (CASCADE). Returns true if deleted.
   */
  async deleteProvider(providerId: string): Promise<boolean> {
    // Delete models first (manual cascade)
    await this.execute('DELETE FROM local_models WHERE local_provider_id = $1', [providerId]);
    const result = await this.execute('DELETE FROM local_providers WHERE id = $1', [providerId]);

    providersCache.delete(providerId);
    modelsCache.delete(providerId);

    return result.changes > 0;
  }

  /**
   * Set a provider as the default for a user. Clears all other defaults first.
   */
  async setDefault(userId: string, providerId: string): Promise<void> {
    await this.execute(
      'UPDATE local_providers SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE',
      [userId]
    );
    await this.execute(
      'UPDATE local_providers SET is_default = TRUE, updated_at = $1 WHERE id = $2',
      [new Date().toISOString(), providerId]
    );

    await this.refreshCache();
  }

  // ---------------------------------------------------------------------------
  // Model accessors
  // ---------------------------------------------------------------------------

  /**
   * List models, optionally filtered by user id and/or provider id.
   */
  async listModels(userId?: string, providerId?: string): Promise<LocalModel[]> {
    if (providerId) {
      const models = modelsCache.get(providerId) ?? [];
      if (userId) {
        return models.filter((m) => m.userId === userId);
      }
      return models;
    }

    // No providerId filter -- flatten all cached models
    const all: LocalModel[] = [];
    for (const models of modelsCache.values()) {
      for (const model of models) {
        if (userId && model.userId !== userId) continue;
        all.push(model);
      }
    }
    return all;
  }

  // ---------------------------------------------------------------------------
  // Model CRUD (async, writes to DB + refreshes cache)
  // ---------------------------------------------------------------------------

  /**
   * Upsert a model. On conflict (user_id, local_provider_id, model_id) the
   * existing row is updated with the new values.
   */
  async upsertModel(input: CreateLocalModelInput): Promise<LocalModel> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const userId = input.userId ?? 'default';

    const row = await this.queryOne<LocalModelRow>(
      `INSERT INTO local_models
        (id, user_id, local_provider_id, model_id, display_name,
         capabilities, context_window, max_output, is_enabled, metadata,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (user_id, local_provider_id, model_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         capabilities = EXCLUDED.capabilities,
         context_window = EXCLUDED.context_window,
         max_output = EXCLUDED.max_output,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        id,
        userId,
        input.localProviderId,
        input.modelId,
        input.displayName,
        JSON.stringify(input.capabilities ?? []),
        input.contextWindow ?? 4096,
        input.maxOutput ?? 4096,
        true, // is_enabled
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      ]
    );

    await this.refreshProviderCache(input.localProviderId);

    if (row) {
      return rowToModel(row);
    }

    // Fallback: find from refreshed cache
    const models = modelsCache.get(input.localProviderId) ?? [];
    const found = models.find((m) => m.userId === userId && m.modelId === input.modelId);
    if (!found) {
      throw new Error(`Failed to upsert local model: ${input.modelId}`);
    }
    return found;
  }

  /**
   * Toggle a model's enabled state.
   */
  async toggleModel(modelId: string, enabled: boolean): Promise<void> {
    const row = await this.queryOne<LocalModelRow>('SELECT * FROM local_models WHERE id = $1', [
      modelId,
    ]);
    if (!row) return;

    await this.execute('UPDATE local_models SET is_enabled = $1, updated_at = $2 WHERE id = $3', [
      enabled,
      new Date().toISOString(),
      modelId,
    ]);

    await this.refreshProviderCache(row.local_provider_id);
  }

  /**
   * Delete all models for a provider. Returns the number of deleted rows.
   */
  async deleteModelsForProvider(providerId: string): Promise<number> {
    const result = await this.execute('DELETE FROM local_models WHERE local_provider_id = $1', [
      providerId,
    ]);

    modelsCache.delete(providerId);

    return result.changes;
  }

  /**
   * Update the last_discovered_at timestamp for a provider.
   */
  async updateDiscoveredAt(providerId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.execute(
      'UPDATE local_providers SET last_discovered_at = $1, updated_at = $2 WHERE id = $3',
      [now, now, providerId]
    );

    await this.refreshProviderCache(providerId);
  }
}

// =============================================================================
// SINGLETON & INIT
// =============================================================================

export const localProvidersRepo = new LocalProvidersRepository();

export async function initializeLocalProvidersRepo(): Promise<void> {
  await localProvidersRepo.initialize();
}
