/**
 * AI Model Configs Repository
 *
 * Manages user model configurations (overrides for models.dev data)
 * and custom providers (aggregators like fal.ai, together.ai, etc.)
 */

import { BaseRepository, parseJsonField } from './base.js';
import { randomUUID } from 'node:crypto';
import type { ModelCapability } from '@ownpilot/core';

// ============================================================================
// Types
// ============================================================================

export interface UserModelConfig {
  id: string;
  userId: string;
  providerId: string;
  modelId: string;
  displayName?: string;
  capabilities: ModelCapability[];
  pricingInput?: number;
  pricingOutput?: number;
  contextWindow?: number;
  maxOutput?: number;
  isEnabled: boolean;
  isCustom: boolean;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomProvider {
  id: string;
  userId: string;
  providerId: string;
  displayName: string;
  apiBaseUrl?: string;
  apiKeySetting?: string;
  providerType: 'openai_compatible' | 'custom';
  isEnabled: boolean;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateModelConfigInput {
  userId?: string;
  providerId: string;
  modelId: string;
  displayName?: string;
  capabilities?: ModelCapability[];
  pricingInput?: number;
  pricingOutput?: number;
  contextWindow?: number;
  maxOutput?: number;
  isEnabled?: boolean;
  isCustom?: boolean;
  config?: Record<string, unknown>;
}

export interface UpdateModelConfigInput {
  displayName?: string;
  capabilities?: ModelCapability[];
  pricingInput?: number;
  pricingOutput?: number;
  contextWindow?: number;
  maxOutput?: number;
  isEnabled?: boolean;
  config?: Record<string, unknown>;
}

export interface CreateProviderInput {
  userId?: string;
  providerId: string;
  displayName: string;
  apiBaseUrl?: string;
  apiKeySetting?: string;
  providerType?: 'openai_compatible' | 'custom';
  isEnabled?: boolean;
  config?: Record<string, unknown>;
}

// User provider config (overrides for built-in providers)
export interface UserProviderConfig {
  id: string;
  userId: string;
  providerId: string;
  baseUrl?: string;
  providerType?: string;
  isEnabled: boolean;
  apiKeyEnv?: string;
  notes?: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserProviderConfigInput {
  userId?: string;
  providerId: string;
  baseUrl?: string;
  providerType?: string;
  isEnabled?: boolean;
  apiKeyEnv?: string;
  notes?: string;
  config?: Record<string, unknown>;
}

export interface UpdateUserProviderConfigInput {
  baseUrl?: string;
  providerType?: string;
  isEnabled?: boolean;
  apiKeyEnv?: string;
  notes?: string;
  config?: Record<string, unknown>;
}

export interface UpdateProviderInput {
  displayName?: string;
  apiBaseUrl?: string;
  apiKeySetting?: string;
  providerType?: 'openai_compatible' | 'custom';
  isEnabled?: boolean;
  config?: Record<string, unknown>;
}

// ============================================================================
// Database Row Types
// ============================================================================

interface ModelConfigRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  provider_id: string;
  model_id: string;
  display_name: string | null;
  capabilities: string;
  pricing_input: number | null;
  pricing_output: number | null;
  context_window: number | null;
  max_output: number | null;
  is_enabled: boolean;
  is_custom: boolean;
  config: string;
  created_at: string;
  updated_at: string;
}

interface CustomProviderRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  provider_id: string;
  display_name: string;
  api_base_url: string | null;
  api_key_setting: string | null;
  provider_type: string;
  is_enabled: boolean;
  config: string;
  created_at: string;
  updated_at: string;
}

interface UserProviderConfigRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  provider_id: string;
  base_url: string | null;
  provider_type: string | null;
  is_enabled: boolean;
  api_key_env: string | null;
  notes: string | null;
  config: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Row Mapping
// ============================================================================

function rowToModelConfig(row: ModelConfigRow): UserModelConfig {
  return {
    id: row.id,
    userId: row.user_id,
    providerId: row.provider_id,
    modelId: row.model_id,
    displayName: row.display_name || undefined,
    capabilities: parseJsonField(row.capabilities, []) as ModelCapability[],
    pricingInput: row.pricing_input ?? undefined,
    pricingOutput: row.pricing_output ?? undefined,
    contextWindow: row.context_window ?? undefined,
    maxOutput: row.max_output ?? undefined,
    isEnabled: row.is_enabled,
    isCustom: row.is_custom,
    config: parseJsonField(row.config, {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToProvider(row: CustomProviderRow): CustomProvider {
  return {
    id: row.id,
    userId: row.user_id,
    providerId: row.provider_id,
    displayName: row.display_name,
    apiBaseUrl: row.api_base_url || undefined,
    apiKeySetting: row.api_key_setting || undefined,
    providerType: row.provider_type as 'openai_compatible' | 'custom',
    isEnabled: row.is_enabled,
    config: parseJsonField(row.config, {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToUserProviderConfig(row: UserProviderConfigRow): UserProviderConfig {
  return {
    id: row.id,
    userId: row.user_id,
    providerId: row.provider_id,
    baseUrl: row.base_url || undefined,
    providerType: row.provider_type || undefined,
    isEnabled: row.is_enabled,
    apiKeyEnv: row.api_key_env || undefined,
    notes: row.notes || undefined,
    config: parseJsonField(row.config, {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class ModelConfigsRepository extends BaseRepository {
  // ==========================================================================
  // Model Configs CRUD
  // ==========================================================================

  /**
   * List all model configs for a user
   */
  async listModels(userId: string = 'default', providerId?: string): Promise<UserModelConfig[]> {
    if (providerId) {
      const rows = await this.query<ModelConfigRow>(
        `SELECT * FROM user_model_configs
         WHERE user_id = $1 AND provider_id = $2
         ORDER BY provider_id, model_id`,
        [userId, providerId]
      );
      return rows.map(rowToModelConfig);
    }

    const rows = await this.query<ModelConfigRow>(
      `SELECT * FROM user_model_configs
       WHERE user_id = $1
       ORDER BY provider_id, model_id`,
      [userId]
    );
    return rows.map(rowToModelConfig);
  }

  /**
   * Get a specific model config
   */
  async getModel(
    userId: string,
    providerId: string,
    modelId: string
  ): Promise<UserModelConfig | null> {
    const row = await this.queryOne<ModelConfigRow>(
      `SELECT * FROM user_model_configs
       WHERE user_id = $1 AND provider_id = $2 AND model_id = $3`,
      [userId, providerId, modelId]
    );
    return row ? rowToModelConfig(row) : null;
  }

  /**
   * Create or update a model config
   */
  async upsertModel(input: CreateModelConfigInput): Promise<UserModelConfig> {
    const userId = input.userId || 'default';
    const existing = await this.getModel(userId, input.providerId, input.modelId);
    const now = new Date().toISOString();

    if (existing) {
      // Update existing
      await this.execute(
        `UPDATE user_model_configs SET
          display_name = COALESCE($1, display_name),
          capabilities = COALESCE($2, capabilities),
          pricing_input = COALESCE($3, pricing_input),
          pricing_output = COALESCE($4, pricing_output),
          context_window = COALESCE($5, context_window),
          max_output = COALESCE($6, max_output),
          is_enabled = COALESCE($7, is_enabled),
          config = COALESCE($8, config),
          updated_at = $9
        WHERE user_id = $10 AND provider_id = $11 AND model_id = $12`,
        [
          input.displayName ?? null,
          input.capabilities ? JSON.stringify(input.capabilities) : null,
          input.pricingInput ?? null,
          input.pricingOutput ?? null,
          input.contextWindow ?? null,
          input.maxOutput ?? null,
          input.isEnabled !== undefined ? input.isEnabled : null,
          input.config ? JSON.stringify(input.config) : null,
          now,
          userId,
          input.providerId,
          input.modelId,
        ]
      );

      const model = await this.getModel(userId, input.providerId, input.modelId);
      if (!model) throw new Error('Failed to upsert model config');
      return model;
    } else {
      // Insert new
      const id = randomUUID();
      await this.execute(
        `INSERT INTO user_model_configs (
          id, user_id, provider_id, model_id, display_name,
          capabilities, pricing_input, pricing_output,
          context_window, max_output, is_enabled, is_custom, config, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          id,
          userId,
          input.providerId,
          input.modelId,
          input.displayName || null,
          JSON.stringify(input.capabilities || []),
          input.pricingInput ?? null,
          input.pricingOutput ?? null,
          input.contextWindow ?? null,
          input.maxOutput ?? null,
          input.isEnabled !== false,
          input.isCustom || false,
          JSON.stringify(input.config || {}),
          now,
          now,
        ]
      );

      const model = await this.getModel(userId, input.providerId, input.modelId);
      if (!model) throw new Error('Failed to upsert model config');
      return model;
    }
  }

  /**
   * Update a model config
   */
  async updateModel(
    userId: string,
    providerId: string,
    modelId: string,
    input: UpdateModelConfigInput
  ): Promise<UserModelConfig | null> {
    const existing = await this.getModel(userId, providerId, modelId);
    if (!existing) return null;

    const now = new Date().toISOString();

    await this.execute(
      `UPDATE user_model_configs SET
        display_name = COALESCE($1, display_name),
        capabilities = COALESCE($2, capabilities),
        pricing_input = COALESCE($3, pricing_input),
        pricing_output = COALESCE($4, pricing_output),
        context_window = COALESCE($5, context_window),
        max_output = COALESCE($6, max_output),
        is_enabled = COALESCE($7, is_enabled),
        config = COALESCE($8, config),
        updated_at = $9
      WHERE user_id = $10 AND provider_id = $11 AND model_id = $12`,
      [
        input.displayName ?? null,
        input.capabilities ? JSON.stringify(input.capabilities) : null,
        input.pricingInput ?? null,
        input.pricingOutput ?? null,
        input.contextWindow ?? null,
        input.maxOutput ?? null,
        input.isEnabled !== undefined ? input.isEnabled : null,
        input.config ? JSON.stringify(input.config) : null,
        now,
        userId,
        providerId,
        modelId,
      ]
    );

    return this.getModel(userId, providerId, modelId);
  }

  /**
   * Delete a model config
   */
  async deleteModel(userId: string, providerId: string, modelId: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM user_model_configs
       WHERE user_id = $1 AND provider_id = $2 AND model_id = $3`,
      [userId, providerId, modelId]
    );
    return result.changes > 0;
  }

  /**
   * Toggle model enabled status
   */
  async toggleModel(
    userId: string,
    providerId: string,
    modelId: string,
    enabled: boolean
  ): Promise<boolean> {
    const result = await this.execute(
      `UPDATE user_model_configs SET
        is_enabled = $1,
        updated_at = NOW()
      WHERE user_id = $2 AND provider_id = $3 AND model_id = $4`,
      [enabled, userId, providerId, modelId]
    );
    return result.changes > 0;
  }

  /**
   * Get all enabled model IDs for a user
   */
  async getEnabledModelIds(userId: string = 'default'): Promise<Set<string>> {
    const rows = await this.query<{ provider_id: string; model_id: string }>(
      `SELECT provider_id, model_id FROM user_model_configs
       WHERE user_id = $1 AND is_enabled = true`,
      [userId]
    );
    return new Set(rows.map((r) => `${r.provider_id}/${r.model_id}`));
  }

  /**
   * Get all disabled model IDs for a user
   */
  async getDisabledModelIds(userId: string = 'default'): Promise<Set<string>> {
    const rows = await this.query<{ provider_id: string; model_id: string }>(
      `SELECT provider_id, model_id FROM user_model_configs
       WHERE user_id = $1 AND is_enabled = false`,
      [userId]
    );
    return new Set(rows.map((r) => `${r.provider_id}/${r.model_id}`));
  }

  /**
   * Get custom models only
   */
  async getCustomModels(userId: string = 'default'): Promise<UserModelConfig[]> {
    const rows = await this.query<ModelConfigRow>(
      `SELECT * FROM user_model_configs
       WHERE user_id = $1 AND is_custom = true
       ORDER BY provider_id, model_id`,
      [userId]
    );
    return rows.map(rowToModelConfig);
  }

  // ==========================================================================
  // Custom Providers CRUD
  // ==========================================================================

  /**
   * List all custom providers for a user
   */
  async listProviders(userId: string = 'default'): Promise<CustomProvider[]> {
    const rows = await this.query<CustomProviderRow>(
      `SELECT * FROM custom_providers
       WHERE user_id = $1
       ORDER BY display_name`,
      [userId]
    );
    return rows.map(rowToProvider);
  }

  /**
   * Get a specific custom provider
   */
  async getProvider(userId: string, providerId: string): Promise<CustomProvider | null> {
    const row = await this.queryOne<CustomProviderRow>(
      `SELECT * FROM custom_providers
       WHERE user_id = $1 AND provider_id = $2`,
      [userId, providerId]
    );
    return row ? rowToProvider(row) : null;
  }

  /**
   * Create or update a custom provider
   */
  async upsertProvider(input: CreateProviderInput): Promise<CustomProvider> {
    const userId = input.userId || 'default';
    const existing = await this.getProvider(userId, input.providerId);
    const now = new Date().toISOString();

    if (existing) {
      // Update existing
      await this.execute(
        `UPDATE custom_providers SET
          display_name = COALESCE($1, display_name),
          api_base_url = COALESCE($2, api_base_url),
          api_key_setting = COALESCE($3, api_key_setting),
          provider_type = COALESCE($4, provider_type),
          is_enabled = COALESCE($5, is_enabled),
          config = COALESCE($6, config),
          updated_at = $7
        WHERE user_id = $8 AND provider_id = $9`,
        [
          input.displayName ?? null,
          input.apiBaseUrl ?? null,
          input.apiKeySetting ?? null,
          input.providerType ?? null,
          input.isEnabled !== undefined ? input.isEnabled : null,
          input.config ? JSON.stringify(input.config) : null,
          now,
          userId,
          input.providerId,
        ]
      );

      const provider = await this.getProvider(userId, input.providerId);
      if (!provider) throw new Error('Failed to upsert provider');
      return provider;
    } else {
      // Insert new
      const id = randomUUID();
      await this.execute(
        `INSERT INTO custom_providers (
          id, user_id, provider_id, display_name,
          api_base_url, api_key_setting, provider_type, is_enabled, config, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          userId,
          input.providerId,
          input.displayName,
          input.apiBaseUrl || null,
          input.apiKeySetting || null,
          input.providerType || 'openai_compatible',
          input.isEnabled !== false,
          JSON.stringify(input.config || {}),
          now,
          now,
        ]
      );

      const provider = await this.getProvider(userId, input.providerId);
      if (!provider) throw new Error('Failed to upsert provider');
      return provider;
    }
  }

  /**
   * Update a custom provider
   */
  async updateProvider(
    userId: string,
    providerId: string,
    input: UpdateProviderInput
  ): Promise<CustomProvider | null> {
    const existing = await this.getProvider(userId, providerId);
    if (!existing) return null;

    const now = new Date().toISOString();

    await this.execute(
      `UPDATE custom_providers SET
        display_name = COALESCE($1, display_name),
        api_base_url = COALESCE($2, api_base_url),
        api_key_setting = COALESCE($3, api_key_setting),
        provider_type = COALESCE($4, provider_type),
        is_enabled = COALESCE($5, is_enabled),
        config = COALESCE($6, config),
        updated_at = $7
      WHERE user_id = $8 AND provider_id = $9`,
      [
        input.displayName ?? null,
        input.apiBaseUrl ?? null,
        input.apiKeySetting ?? null,
        input.providerType ?? null,
        input.isEnabled !== undefined ? input.isEnabled : null,
        input.config ? JSON.stringify(input.config) : null,
        now,
        userId,
        providerId,
      ]
    );

    return this.getProvider(userId, providerId);
  }

  /**
   * Delete a custom provider and its models
   */
  async deleteProvider(userId: string, providerId: string): Promise<boolean> {
    // First delete all models for this provider
    await this.execute(
      `DELETE FROM user_model_configs
       WHERE user_id = $1 AND provider_id = $2`,
      [userId, providerId]
    );

    // Then delete the provider
    const result = await this.execute(
      `DELETE FROM custom_providers
       WHERE user_id = $1 AND provider_id = $2`,
      [userId, providerId]
    );
    return result.changes > 0;
  }

  /**
   * Toggle provider enabled status
   */
  async toggleProvider(userId: string, providerId: string, enabled: boolean): Promise<boolean> {
    const result = await this.execute(
      `UPDATE custom_providers SET
        is_enabled = $1,
        updated_at = NOW()
      WHERE user_id = $2 AND provider_id = $3`,
      [enabled, userId, providerId]
    );
    return result.changes > 0;
  }

  /**
   * Get all enabled provider IDs for a user
   */
  async getEnabledProviderIds(userId: string = 'default'): Promise<Set<string>> {
    const rows = await this.query<{ provider_id: string }>(
      `SELECT provider_id FROM custom_providers
       WHERE user_id = $1 AND is_enabled = true`,
      [userId]
    );
    return new Set(rows.map((r) => r.provider_id));
  }

  // ==========================================================================
  // User Provider Configs CRUD (built-in provider overrides)
  // ==========================================================================

  /**
   * List all user provider configs for a user
   */
  async listUserProviderConfigs(userId: string = 'default'): Promise<UserProviderConfig[]> {
    const rows = await this.query<UserProviderConfigRow>(
      `SELECT * FROM user_provider_configs
       WHERE user_id = $1
       ORDER BY provider_id`,
      [userId]
    );
    return rows.map(rowToUserProviderConfig);
  }

  /**
   * Get a specific user provider config
   */
  async getUserProviderConfig(
    userId: string,
    providerId: string
  ): Promise<UserProviderConfig | null> {
    const row = await this.queryOne<UserProviderConfigRow>(
      `SELECT * FROM user_provider_configs
       WHERE user_id = $1 AND provider_id = $2`,
      [userId, providerId]
    );
    return row ? rowToUserProviderConfig(row) : null;
  }

  /**
   * Create or update a user provider config
   */
  async upsertUserProviderConfig(
    input: CreateUserProviderConfigInput
  ): Promise<UserProviderConfig> {
    const userId = input.userId || 'default';
    const existing = await this.getUserProviderConfig(userId, input.providerId);
    const now = new Date().toISOString();

    if (existing) {
      // Update existing
      await this.execute(
        `UPDATE user_provider_configs SET
          base_url = COALESCE($1, base_url),
          provider_type = COALESCE($2, provider_type),
          is_enabled = COALESCE($3, is_enabled),
          api_key_env = COALESCE($4, api_key_env),
          notes = COALESCE($5, notes),
          config = COALESCE($6, config),
          updated_at = $7
        WHERE user_id = $8 AND provider_id = $9`,
        [
          input.baseUrl ?? null,
          input.providerType ?? null,
          input.isEnabled !== undefined ? input.isEnabled : null,
          input.apiKeyEnv ?? null,
          input.notes ?? null,
          input.config ? JSON.stringify(input.config) : null,
          now,
          userId,
          input.providerId,
        ]
      );

      const config = await this.getUserProviderConfig(userId, input.providerId);
      if (!config) throw new Error('Failed to upsert user provider config');
      return config;
    } else {
      // Insert new
      const id = randomUUID();
      await this.execute(
        `INSERT INTO user_provider_configs (
          id, user_id, provider_id, base_url, provider_type,
          is_enabled, api_key_env, notes, config, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          userId,
          input.providerId,
          input.baseUrl || null,
          input.providerType || null,
          input.isEnabled !== false,
          input.apiKeyEnv || null,
          input.notes || null,
          JSON.stringify(input.config || {}),
          now,
          now,
        ]
      );

      const config = await this.getUserProviderConfig(userId, input.providerId);
      if (!config) throw new Error('Failed to upsert user provider config');
      return config;
    }
  }

  /**
   * Update a user provider config
   */
  async updateUserProviderConfig(
    userId: string,
    providerId: string,
    input: UpdateUserProviderConfigInput
  ): Promise<UserProviderConfig | null> {
    const existing = await this.getUserProviderConfig(userId, providerId);
    if (!existing) return null;

    const now = new Date().toISOString();

    await this.execute(
      `UPDATE user_provider_configs SET
        base_url = COALESCE($1, base_url),
        provider_type = COALESCE($2, provider_type),
        is_enabled = COALESCE($3, is_enabled),
        api_key_env = COALESCE($4, api_key_env),
        notes = COALESCE($5, notes),
        config = COALESCE($6, config),
        updated_at = $7
      WHERE user_id = $8 AND provider_id = $9`,
      [
        input.baseUrl ?? null,
        input.providerType ?? null,
        input.isEnabled !== undefined ? input.isEnabled : null,
        input.apiKeyEnv ?? null,
        input.notes ?? null,
        input.config ? JSON.stringify(input.config) : null,
        now,
        userId,
        providerId,
      ]
    );

    return this.getUserProviderConfig(userId, providerId);
  }

  /**
   * Delete a user provider config
   */
  async deleteUserProviderConfig(userId: string, providerId: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM user_provider_configs
       WHERE user_id = $1 AND provider_id = $2`,
      [userId, providerId]
    );
    return result.changes > 0;
  }

  /**
   * Toggle user provider config enabled status
   */
  async toggleUserProviderConfig(
    userId: string,
    providerId: string,
    enabled: boolean
  ): Promise<boolean> {
    // First check if config exists, if not create it
    const existing = await this.getUserProviderConfig(userId, providerId);
    if (!existing) {
      await this.upsertUserProviderConfig({
        userId,
        providerId,
        isEnabled: enabled,
      });
      return true;
    }

    const result = await this.execute(
      `UPDATE user_provider_configs SET
        is_enabled = $1,
        updated_at = NOW()
      WHERE user_id = $2 AND provider_id = $3`,
      [enabled, userId, providerId]
    );
    return result.changes > 0;
  }

  /**
   * Get all disabled built-in provider IDs for a user
   */
  async getDisabledBuiltinProviderIds(userId: string = 'default'): Promise<Set<string>> {
    const rows = await this.query<{ provider_id: string }>(
      `SELECT provider_id FROM user_provider_configs
       WHERE user_id = $1 AND is_enabled = false`,
      [userId]
    );
    return new Set(rows.map((r) => r.provider_id));
  }

  /**
   * Get provider override (baseUrl, type) for a built-in provider
   * Returns null if no override exists
   */
  async getProviderOverride(
    userId: string,
    providerId: string
  ): Promise<{ baseUrl?: string; providerType?: string } | null> {
    const config = await this.getUserProviderConfig(userId, providerId);
    if (!config) return null;
    return {
      baseUrl: config.baseUrl,
      providerType: config.providerType,
    };
  }

  /**
   * Delete ALL user provider configs (for full reset)
   */
  async deleteAllUserProviderConfigs(userId: string = 'default'): Promise<number> {
    const result = await this.execute(`DELETE FROM user_provider_configs WHERE user_id = $1`, [
      userId,
    ]);
    return result.changes;
  }

  /**
   * Delete ALL user model configs (for full reset)
   */
  async deleteAllUserModelConfigs(userId: string = 'default'): Promise<number> {
    const result = await this.execute(`DELETE FROM user_model_configs WHERE user_id = $1`, [
      userId,
    ]);
    return result.changes;
  }

  /**
   * Delete ALL custom providers (for full reset)
   */
  async deleteAllCustomProviders(userId: string = 'default'): Promise<number> {
    const result = await this.execute(`DELETE FROM custom_providers WHERE user_id = $1`, [userId]);
    return result.changes;
  }

  /**
   * Full reset - delete all user model data
   */
  async fullReset(
    userId: string = 'default'
  ): Promise<{ providerConfigs: number; modelConfigs: number; customProviders: number }> {
    const providerConfigs = await this.deleteAllUserProviderConfigs(userId);
    const modelConfigs = await this.deleteAllUserModelConfigs(userId);
    const customProviders = await this.deleteAllCustomProviders(userId);
    return { providerConfigs, modelConfigs, customProviders };
  }
}

// Singleton instance
export const modelConfigsRepo = new ModelConfigsRepository();

// Factory function
export function createModelConfigsRepository(): ModelConfigsRepository {
  return new ModelConfigsRepository();
}
