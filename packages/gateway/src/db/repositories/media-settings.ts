/**
 * Media Provider Settings Repository
 *
 * Manages user preferences for media capabilities (image generation, vision, TTS, STT, weather).
 * Each capability can be configured with a specific provider and model.
 */

import { getDatabase } from '../connection.js';
import { randomUUID } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

export type MediaCapability = 'image_generation' | 'vision' | 'tts' | 'stt' | 'weather';

export interface MediaProviderSetting {
  id: string;
  userId: string;
  capability: MediaCapability;
  provider: string;
  model?: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SetMediaProviderInput {
  userId?: string;
  capability: MediaCapability;
  provider: string;
  model?: string;
  config?: Record<string, unknown>;
}

interface MediaSettingRow {
  id: string;
  user_id: string;
  capability: string;
  provider: string;
  model: string | null;
  config: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Default Providers
// ============================================================================

export const DEFAULT_PROVIDERS: Record<MediaCapability, { provider: string; model?: string }> = {
  image_generation: { provider: 'openai', model: 'dall-e-3' },
  vision: { provider: 'openai', model: 'gpt-4o' },
  tts: { provider: 'openai', model: 'tts-1' },
  stt: { provider: 'openai', model: 'whisper-1' },
  weather: { provider: 'openweathermap' },
};

// ============================================================================
// Available Providers per Capability
// ============================================================================

export interface ProviderOption {
  provider: string;
  displayName: string;
  models?: Array<{ id: string; name: string; default?: boolean }>;
  apiKeyEnv: string;
  requiresApiKey: boolean;
}

export const AVAILABLE_PROVIDERS: Record<MediaCapability, ProviderOption[]> = {
  image_generation: [
    {
      provider: 'openai',
      displayName: 'OpenAI',
      models: [
        { id: 'dall-e-3', name: 'DALL-E 3', default: true },
        { id: 'dall-e-2', name: 'DALL-E 2' },
      ],
      apiKeyEnv: 'OPENAI_API_KEY',
      requiresApiKey: true,
    },
    {
      provider: 'fireworks',
      displayName: 'Fireworks AI',
      models: [
        { id: 'flux-1-pro', name: 'FLUX.1 Pro', default: true },
        { id: 'flux-1-schnell', name: 'FLUX.1 Schnell' },
        { id: 'flux-1-dev', name: 'FLUX.1 Dev' },
      ],
      apiKeyEnv: 'FIREWORKS_API_KEY',
      requiresApiKey: true,
    },
    {
      provider: 'replicate',
      displayName: 'Replicate',
      models: [
        { id: 'stability-ai/sdxl', name: 'Stable Diffusion XL', default: true },
        { id: 'black-forest-labs/flux-schnell', name: 'FLUX Schnell' },
      ],
      apiKeyEnv: 'REPLICATE_API_TOKEN',
      requiresApiKey: true,
    },
  ],
  vision: [
    {
      provider: 'openai',
      displayName: 'OpenAI',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', default: true },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      ],
      apiKeyEnv: 'OPENAI_API_KEY',
      requiresApiKey: true,
    },
    {
      provider: 'anthropic',
      displayName: 'Anthropic',
      models: [
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', default: true },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
      ],
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      requiresApiKey: true,
    },
    {
      provider: 'google',
      displayName: 'Google AI',
      models: [
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', default: true },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
      ],
      apiKeyEnv: 'GOOGLE_AI_API_KEY',
      requiresApiKey: true,
    },
  ],
  tts: [
    {
      provider: 'openai',
      displayName: 'OpenAI',
      models: [
        { id: 'tts-1', name: 'TTS-1 (Standard)', default: true },
        { id: 'tts-1-hd', name: 'TTS-1 HD (High Quality)' },
      ],
      apiKeyEnv: 'OPENAI_API_KEY',
      requiresApiKey: true,
    },
    {
      provider: 'elevenlabs',
      displayName: 'ElevenLabs',
      models: [
        { id: 'eleven_multilingual_v2', name: 'Multilingual v2', default: true },
        { id: 'eleven_turbo_v2', name: 'Turbo v2' },
      ],
      apiKeyEnv: 'ELEVENLABS_API_KEY',
      requiresApiKey: true,
    },
  ],
  stt: [
    {
      provider: 'openai',
      displayName: 'OpenAI',
      models: [{ id: 'whisper-1', name: 'Whisper', default: true }],
      apiKeyEnv: 'OPENAI_API_KEY',
      requiresApiKey: true,
    },
    {
      provider: 'groq',
      displayName: 'Groq',
      models: [{ id: 'whisper-large-v3', name: 'Whisper Large v3', default: true }],
      apiKeyEnv: 'GROQ_API_KEY',
      requiresApiKey: true,
    },
    {
      provider: 'deepgram',
      displayName: 'Deepgram',
      models: [{ id: 'nova-2', name: 'Nova 2', default: true }],
      apiKeyEnv: 'DEEPGRAM_API_KEY',
      requiresApiKey: true,
    },
  ],
  weather: [
    {
      provider: 'openweathermap',
      displayName: 'OpenWeatherMap',
      apiKeyEnv: 'OPENWEATHERMAP_API_KEY',
      requiresApiKey: true,
    },
    {
      provider: 'weatherapi',
      displayName: 'WeatherAPI',
      apiKeyEnv: 'WEATHERAPI_KEY',
      requiresApiKey: true,
    },
  ],
};

// ============================================================================
// Row Mapping
// ============================================================================

function rowToSetting(row: MediaSettingRow): MediaProviderSetting {
  return {
    id: row.id,
    userId: row.user_id,
    capability: row.capability as MediaCapability,
    provider: row.provider,
    model: row.model || undefined,
    config: JSON.parse(row.config),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class MediaSettingsRepository {
  private db = getDatabase();

  /**
   * Get media provider setting for a capability
   */
  get(userId: string, capability: MediaCapability): MediaProviderSetting | null {
    const stmt = this.db.prepare<[string, string], MediaSettingRow>(`
      SELECT * FROM media_provider_settings
      WHERE user_id = ? AND capability = ?
    `);
    const row = stmt.get(userId, capability);
    return row ? rowToSetting(row) : null;
  }

  /**
   * Get effective provider for a capability (with defaults)
   */
  getEffective(
    userId: string,
    capability: MediaCapability
  ): { provider: string; model?: string; config: Record<string, unknown> } {
    const setting = this.get(userId, capability);

    if (setting) {
      return {
        provider: setting.provider,
        model: setting.model,
        config: setting.config,
      };
    }

    // Return default
    const defaultConfig = DEFAULT_PROVIDERS[capability];
    return {
      provider: defaultConfig.provider,
      model: defaultConfig.model,
      config: {},
    };
  }

  /**
   * Set media provider for a capability
   */
  set(input: SetMediaProviderInput): MediaProviderSetting {
    const userId = input.userId || 'default';
    const existing = this.get(userId, input.capability);

    if (existing) {
      // Update
      const stmt = this.db.prepare(`
        UPDATE media_provider_settings SET
          provider = ?,
          model = ?,
          config = ?,
          updated_at = datetime('now')
        WHERE user_id = ? AND capability = ?
      `);

      stmt.run(
        input.provider,
        input.model || null,
        JSON.stringify(input.config || {}),
        userId,
        input.capability
      );

      return this.get(userId, input.capability)!;
    } else {
      // Insert
      const id = randomUUID();
      const stmt = this.db.prepare(`
        INSERT INTO media_provider_settings (
          id, user_id, capability, provider, model, config
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        userId,
        input.capability,
        input.provider,
        input.model || null,
        JSON.stringify(input.config || {})
      );

      return this.get(userId, input.capability)!;
    }
  }

  /**
   * List all media settings for a user
   */
  listByUser(userId: string = 'default'): MediaProviderSetting[] {
    const stmt = this.db.prepare<string, MediaSettingRow>(`
      SELECT * FROM media_provider_settings
      WHERE user_id = ?
      ORDER BY capability
    `);
    return stmt.all(userId).map(rowToSetting);
  }

  /**
   * Get all effective settings for a user (includes defaults)
   */
  getAllEffective(userId: string = 'default'): Record<
    MediaCapability,
    { provider: string; model?: string; config: Record<string, unknown> }
  > {
    const capabilities: MediaCapability[] = ['image_generation', 'vision', 'tts', 'stt', 'weather'];
    const result: Record<string, { provider: string; model?: string; config: Record<string, unknown> }> = {};

    for (const capability of capabilities) {
      result[capability] = this.getEffective(userId, capability);
    }

    return result as Record<
      MediaCapability,
      { provider: string; model?: string; config: Record<string, unknown> }
    >;
  }

  /**
   * Delete a media setting
   */
  delete(userId: string, capability: MediaCapability): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM media_provider_settings
      WHERE user_id = ? AND capability = ?
    `);
    const result = stmt.run(userId, capability);
    return result.changes > 0;
  }

  /**
   * Reset all media settings for a user to defaults
   */
  resetToDefaults(userId: string = 'default'): void {
    const stmt = this.db.prepare(`
      DELETE FROM media_provider_settings WHERE user_id = ?
    `);
    stmt.run(userId);
  }

  /**
   * Get available providers for a capability
   */
  getAvailableProviders(capability: MediaCapability): ProviderOption[] {
    return AVAILABLE_PROVIDERS[capability] || [];
  }

  /**
   * Get all available providers grouped by capability
   */
  getAllAvailableProviders(): Record<MediaCapability, ProviderOption[]> {
    return AVAILABLE_PROVIDERS;
  }
}

export const mediaSettingsRepo = new MediaSettingsRepository();
