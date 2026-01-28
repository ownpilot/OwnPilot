/**
 * AI Model Configs Repository
 *
 * Manages user model configurations (overrides for models.dev data)
 * and custom providers (aggregators like fal.ai, together.ai, etc.)
 */

import { getDatabase } from '../connection.js';
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
  is_enabled: number;
  is_custom: number;
  config: string;
  created_at: string;
  updated_at: string;
}

interface CustomProviderRow {
  id: string;
  user_id: string;
  provider_id: string;
  display_name: string;
  api_base_url: string | null;
  api_key_setting: string | null;
  provider_type: string;
  is_enabled: number;
  config: string;
  created_at: string;
  updated_at: string;
}

interface UserProviderConfigRow {
  id: string;
  user_id: string;
  provider_id: string;
  base_url: string | null;
  provider_type: string | null;
  is_enabled: number;
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
    capabilities: JSON.parse(row.capabilities) as ModelCapability[],
    pricingInput: row.pricing_input ?? undefined,
    pricingOutput: row.pricing_output ?? undefined,
    contextWindow: row.context_window ?? undefined,
    maxOutput: row.max_output ?? undefined,
    isEnabled: row.is_enabled === 1,
    isCustom: row.is_custom === 1,
    config: JSON.parse(row.config),
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
    isEnabled: row.is_enabled === 1,
    config: JSON.parse(row.config),
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
    isEnabled: row.is_enabled === 1,
    apiKeyEnv: row.api_key_env || undefined,
    notes: row.notes || undefined,
    config: JSON.parse(row.config),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class ModelConfigsRepository {
  private db = getDatabase();

  // ==========================================================================
  // Model Configs CRUD
  // ==========================================================================

  /**
   * List all model configs for a user
   */
  listModels(userId: string = 'default', providerId?: string): UserModelConfig[] {
    if (providerId) {
      const stmt = this.db.prepare<[string, string], ModelConfigRow>(`
        SELECT * FROM user_model_configs
        WHERE user_id = ? AND provider_id = ?
        ORDER BY provider_id, model_id
      `);
      return stmt.all(userId, providerId).map(rowToModelConfig);
    }

    const stmt = this.db.prepare<string, ModelConfigRow>(`
      SELECT * FROM user_model_configs
      WHERE user_id = ?
      ORDER BY provider_id, model_id
    `);
    return stmt.all(userId).map(rowToModelConfig);
  }

  /**
   * Get a specific model config
   */
  getModel(userId: string, providerId: string, modelId: string): UserModelConfig | null {
    const stmt = this.db.prepare<[string, string, string], ModelConfigRow>(`
      SELECT * FROM user_model_configs
      WHERE user_id = ? AND provider_id = ? AND model_id = ?
    `);
    const row = stmt.get(userId, providerId, modelId);
    return row ? rowToModelConfig(row) : null;
  }

  /**
   * Create or update a model config
   */
  upsertModel(input: CreateModelConfigInput): UserModelConfig {
    const userId = input.userId || 'default';
    const existing = this.getModel(userId, input.providerId, input.modelId);

    if (existing) {
      // Update existing
      const stmt = this.db.prepare(`
        UPDATE user_model_configs SET
          display_name = COALESCE(?, display_name),
          capabilities = COALESCE(?, capabilities),
          pricing_input = COALESCE(?, pricing_input),
          pricing_output = COALESCE(?, pricing_output),
          context_window = COALESCE(?, context_window),
          max_output = COALESCE(?, max_output),
          is_enabled = COALESCE(?, is_enabled),
          config = COALESCE(?, config),
          updated_at = datetime('now')
        WHERE user_id = ? AND provider_id = ? AND model_id = ?
      `);

      stmt.run(
        input.displayName ?? null,
        input.capabilities ? JSON.stringify(input.capabilities) : null,
        input.pricingInput ?? null,
        input.pricingOutput ?? null,
        input.contextWindow ?? null,
        input.maxOutput ?? null,
        input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : null,
        input.config ? JSON.stringify(input.config) : null,
        userId,
        input.providerId,
        input.modelId
      );

      return this.getModel(userId, input.providerId, input.modelId)!;
    } else {
      // Insert new
      const id = randomUUID();
      const stmt = this.db.prepare(`
        INSERT INTO user_model_configs (
          id, user_id, provider_id, model_id, display_name,
          capabilities, pricing_input, pricing_output,
          context_window, max_output, is_enabled, is_custom, config
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
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
        input.isEnabled !== false ? 1 : 0,
        input.isCustom ? 1 : 0,
        JSON.stringify(input.config || {})
      );

      return this.getModel(userId, input.providerId, input.modelId)!;
    }
  }

  /**
   * Update a model config
   */
  updateModel(
    userId: string,
    providerId: string,
    modelId: string,
    input: UpdateModelConfigInput
  ): UserModelConfig | null {
    const existing = this.getModel(userId, providerId, modelId);
    if (!existing) return null;

    const stmt = this.db.prepare(`
      UPDATE user_model_configs SET
        display_name = COALESCE(?, display_name),
        capabilities = COALESCE(?, capabilities),
        pricing_input = COALESCE(?, pricing_input),
        pricing_output = COALESCE(?, pricing_output),
        context_window = COALESCE(?, context_window),
        max_output = COALESCE(?, max_output),
        is_enabled = COALESCE(?, is_enabled),
        config = COALESCE(?, config),
        updated_at = datetime('now')
      WHERE user_id = ? AND provider_id = ? AND model_id = ?
    `);

    stmt.run(
      input.displayName ?? null,
      input.capabilities ? JSON.stringify(input.capabilities) : null,
      input.pricingInput ?? null,
      input.pricingOutput ?? null,
      input.contextWindow ?? null,
      input.maxOutput ?? null,
      input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : null,
      input.config ? JSON.stringify(input.config) : null,
      userId,
      providerId,
      modelId
    );

    return this.getModel(userId, providerId, modelId);
  }

  /**
   * Delete a model config
   */
  deleteModel(userId: string, providerId: string, modelId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM user_model_configs
      WHERE user_id = ? AND provider_id = ? AND model_id = ?
    `);
    const result = stmt.run(userId, providerId, modelId);
    return result.changes > 0;
  }

  /**
   * Toggle model enabled status
   */
  toggleModel(userId: string, providerId: string, modelId: string, enabled: boolean): boolean {
    const stmt = this.db.prepare(`
      UPDATE user_model_configs SET
        is_enabled = ?,
        updated_at = datetime('now')
      WHERE user_id = ? AND provider_id = ? AND model_id = ?
    `);
    const result = stmt.run(enabled ? 1 : 0, userId, providerId, modelId);
    return result.changes > 0;
  }

  /**
   * Get all enabled model IDs for a user
   */
  getEnabledModelIds(userId: string = 'default'): Set<string> {
    const stmt = this.db.prepare<string, { provider_id: string; model_id: string }>(`
      SELECT provider_id, model_id FROM user_model_configs
      WHERE user_id = ? AND is_enabled = 1
    `);
    const rows = stmt.all(userId);
    return new Set(rows.map((r) => `${r.provider_id}/${r.model_id}`));
  }

  /**
   * Get all disabled model IDs for a user
   */
  getDisabledModelIds(userId: string = 'default'): Set<string> {
    const stmt = this.db.prepare<string, { provider_id: string; model_id: string }>(`
      SELECT provider_id, model_id FROM user_model_configs
      WHERE user_id = ? AND is_enabled = 0
    `);
    const rows = stmt.all(userId);
    return new Set(rows.map((r) => `${r.provider_id}/${r.model_id}`));
  }

  /**
   * Get custom models only
   */
  getCustomModels(userId: string = 'default'): UserModelConfig[] {
    const stmt = this.db.prepare<string, ModelConfigRow>(`
      SELECT * FROM user_model_configs
      WHERE user_id = ? AND is_custom = 1
      ORDER BY provider_id, model_id
    `);
    return stmt.all(userId).map(rowToModelConfig);
  }

  // ==========================================================================
  // Custom Providers CRUD
  // ==========================================================================

  /**
   * List all custom providers for a user
   */
  listProviders(userId: string = 'default'): CustomProvider[] {
    const stmt = this.db.prepare<string, CustomProviderRow>(`
      SELECT * FROM custom_providers
      WHERE user_id = ?
      ORDER BY display_name
    `);
    return stmt.all(userId).map(rowToProvider);
  }

  /**
   * Get a specific custom provider
   */
  getProvider(userId: string, providerId: string): CustomProvider | null {
    const stmt = this.db.prepare<[string, string], CustomProviderRow>(`
      SELECT * FROM custom_providers
      WHERE user_id = ? AND provider_id = ?
    `);
    const row = stmt.get(userId, providerId);
    return row ? rowToProvider(row) : null;
  }

  /**
   * Create or update a custom provider
   */
  upsertProvider(input: CreateProviderInput): CustomProvider {
    const userId = input.userId || 'default';
    const existing = this.getProvider(userId, input.providerId);

    if (existing) {
      // Update existing
      const stmt = this.db.prepare(`
        UPDATE custom_providers SET
          display_name = COALESCE(?, display_name),
          api_base_url = COALESCE(?, api_base_url),
          api_key_setting = COALESCE(?, api_key_setting),
          provider_type = COALESCE(?, provider_type),
          is_enabled = COALESCE(?, is_enabled),
          config = COALESCE(?, config),
          updated_at = datetime('now')
        WHERE user_id = ? AND provider_id = ?
      `);

      stmt.run(
        input.displayName ?? null,
        input.apiBaseUrl ?? null,
        input.apiKeySetting ?? null,
        input.providerType ?? null,
        input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : null,
        input.config ? JSON.stringify(input.config) : null,
        userId,
        input.providerId
      );

      return this.getProvider(userId, input.providerId)!;
    } else {
      // Insert new
      const id = randomUUID();
      const stmt = this.db.prepare(`
        INSERT INTO custom_providers (
          id, user_id, provider_id, display_name,
          api_base_url, api_key_setting, provider_type, is_enabled, config
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        userId,
        input.providerId,
        input.displayName,
        input.apiBaseUrl || null,
        input.apiKeySetting || null,
        input.providerType || 'openai_compatible',
        input.isEnabled !== false ? 1 : 0,
        JSON.stringify(input.config || {})
      );

      return this.getProvider(userId, input.providerId)!;
    }
  }

  /**
   * Update a custom provider
   */
  updateProvider(
    userId: string,
    providerId: string,
    input: UpdateProviderInput
  ): CustomProvider | null {
    const existing = this.getProvider(userId, providerId);
    if (!existing) return null;

    const stmt = this.db.prepare(`
      UPDATE custom_providers SET
        display_name = COALESCE(?, display_name),
        api_base_url = COALESCE(?, api_base_url),
        api_key_setting = COALESCE(?, api_key_setting),
        provider_type = COALESCE(?, provider_type),
        is_enabled = COALESCE(?, is_enabled),
        config = COALESCE(?, config),
        updated_at = datetime('now')
      WHERE user_id = ? AND provider_id = ?
    `);

    stmt.run(
      input.displayName ?? null,
      input.apiBaseUrl ?? null,
      input.apiKeySetting ?? null,
      input.providerType ?? null,
      input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : null,
      input.config ? JSON.stringify(input.config) : null,
      userId,
      providerId
    );

    return this.getProvider(userId, providerId);
  }

  /**
   * Delete a custom provider and its models
   */
  deleteProvider(userId: string, providerId: string): boolean {
    // First delete all models for this provider
    const deleteModels = this.db.prepare(`
      DELETE FROM user_model_configs
      WHERE user_id = ? AND provider_id = ?
    `);
    deleteModels.run(userId, providerId);

    // Then delete the provider
    const deleteProvider = this.db.prepare(`
      DELETE FROM custom_providers
      WHERE user_id = ? AND provider_id = ?
    `);
    const result = deleteProvider.run(userId, providerId);
    return result.changes > 0;
  }

  /**
   * Toggle provider enabled status
   */
  toggleProvider(userId: string, providerId: string, enabled: boolean): boolean {
    const stmt = this.db.prepare(`
      UPDATE custom_providers SET
        is_enabled = ?,
        updated_at = datetime('now')
      WHERE user_id = ? AND provider_id = ?
    `);
    const result = stmt.run(enabled ? 1 : 0, userId, providerId);
    return result.changes > 0;
  }

  /**
   * Get all enabled provider IDs for a user
   */
  getEnabledProviderIds(userId: string = 'default'): Set<string> {
    const stmt = this.db.prepare<string, { provider_id: string }>(`
      SELECT provider_id FROM custom_providers
      WHERE user_id = ? AND is_enabled = 1
    `);
    const rows = stmt.all(userId);
    return new Set(rows.map((r) => r.provider_id));
  }

  // ==========================================================================
  // User Provider Configs CRUD (built-in provider overrides)
  // ==========================================================================

  /**
   * List all user provider configs for a user
   */
  listUserProviderConfigs(userId: string = 'default'): UserProviderConfig[] {
    const stmt = this.db.prepare<string, UserProviderConfigRow>(`
      SELECT * FROM user_provider_configs
      WHERE user_id = ?
      ORDER BY provider_id
    `);
    return stmt.all(userId).map(rowToUserProviderConfig);
  }

  /**
   * Get a specific user provider config
   */
  getUserProviderConfig(userId: string, providerId: string): UserProviderConfig | null {
    const stmt = this.db.prepare<[string, string], UserProviderConfigRow>(`
      SELECT * FROM user_provider_configs
      WHERE user_id = ? AND provider_id = ?
    `);
    const row = stmt.get(userId, providerId);
    return row ? rowToUserProviderConfig(row) : null;
  }

  /**
   * Create or update a user provider config
   */
  upsertUserProviderConfig(input: CreateUserProviderConfigInput): UserProviderConfig {
    const userId = input.userId || 'default';
    const existing = this.getUserProviderConfig(userId, input.providerId);

    if (existing) {
      // Update existing
      const stmt = this.db.prepare(`
        UPDATE user_provider_configs SET
          base_url = COALESCE(?, base_url),
          provider_type = COALESCE(?, provider_type),
          is_enabled = COALESCE(?, is_enabled),
          api_key_env = COALESCE(?, api_key_env),
          notes = COALESCE(?, notes),
          config = COALESCE(?, config),
          updated_at = datetime('now')
        WHERE user_id = ? AND provider_id = ?
      `);

      stmt.run(
        input.baseUrl ?? null,
        input.providerType ?? null,
        input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : null,
        input.apiKeyEnv ?? null,
        input.notes ?? null,
        input.config ? JSON.stringify(input.config) : null,
        userId,
        input.providerId
      );

      return this.getUserProviderConfig(userId, input.providerId)!;
    } else {
      // Insert new
      const id = randomUUID();
      const stmt = this.db.prepare(`
        INSERT INTO user_provider_configs (
          id, user_id, provider_id, base_url, provider_type,
          is_enabled, api_key_env, notes, config
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        userId,
        input.providerId,
        input.baseUrl || null,
        input.providerType || null,
        input.isEnabled !== false ? 1 : 0,
        input.apiKeyEnv || null,
        input.notes || null,
        JSON.stringify(input.config || {})
      );

      return this.getUserProviderConfig(userId, input.providerId)!;
    }
  }

  /**
   * Update a user provider config
   */
  updateUserProviderConfig(
    userId: string,
    providerId: string,
    input: UpdateUserProviderConfigInput
  ): UserProviderConfig | null {
    const existing = this.getUserProviderConfig(userId, providerId);
    if (!existing) return null;

    const stmt = this.db.prepare(`
      UPDATE user_provider_configs SET
        base_url = COALESCE(?, base_url),
        provider_type = COALESCE(?, provider_type),
        is_enabled = COALESCE(?, is_enabled),
        api_key_env = COALESCE(?, api_key_env),
        notes = COALESCE(?, notes),
        config = COALESCE(?, config),
        updated_at = datetime('now')
      WHERE user_id = ? AND provider_id = ?
    `);

    stmt.run(
      input.baseUrl ?? null,
      input.providerType ?? null,
      input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : null,
      input.apiKeyEnv ?? null,
      input.notes ?? null,
      input.config ? JSON.stringify(input.config) : null,
      userId,
      providerId
    );

    return this.getUserProviderConfig(userId, providerId);
  }

  /**
   * Delete a user provider config
   */
  deleteUserProviderConfig(userId: string, providerId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM user_provider_configs
      WHERE user_id = ? AND provider_id = ?
    `);
    const result = stmt.run(userId, providerId);
    return result.changes > 0;
  }

  /**
   * Toggle user provider config enabled status
   */
  toggleUserProviderConfig(userId: string, providerId: string, enabled: boolean): boolean {
    // First check if config exists, if not create it
    const existing = this.getUserProviderConfig(userId, providerId);
    if (!existing) {
      this.upsertUserProviderConfig({
        userId,
        providerId,
        isEnabled: enabled,
      });
      return true;
    }

    const stmt = this.db.prepare(`
      UPDATE user_provider_configs SET
        is_enabled = ?,
        updated_at = datetime('now')
      WHERE user_id = ? AND provider_id = ?
    `);
    const result = stmt.run(enabled ? 1 : 0, userId, providerId);
    return result.changes > 0;
  }

  /**
   * Get all disabled built-in provider IDs for a user
   */
  getDisabledBuiltinProviderIds(userId: string = 'default'): Set<string> {
    const stmt = this.db.prepare<string, { provider_id: string }>(`
      SELECT provider_id FROM user_provider_configs
      WHERE user_id = ? AND is_enabled = 0
    `);
    const rows = stmt.all(userId);
    return new Set(rows.map((r) => r.provider_id));
  }

  /**
   * Get provider override (baseUrl, type) for a built-in provider
   * Returns null if no override exists
   */
  getProviderOverride(userId: string, providerId: string): { baseUrl?: string; providerType?: string } | null {
    const config = this.getUserProviderConfig(userId, providerId);
    if (!config) return null;
    return {
      baseUrl: config.baseUrl,
      providerType: config.providerType,
    };
  }
}

export const modelConfigsRepo = new ModelConfigsRepository();
