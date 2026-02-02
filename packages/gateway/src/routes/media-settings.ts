/**
 * Media Settings API Routes
 *
 * Configure media providers for image generation, vision, TTS, and STT.
 */

import { Hono } from 'hono';
import {
  mediaSettingsRepo,
  settingsRepo,
  AVAILABLE_PROVIDERS,
  type MediaCapability,
} from '../db/repositories/index.js';
import { getLog } from '../services/log.js';
import { getUserId, apiError } from './helpers.js';

const log = getLog('MediaSettings');

export const mediaSettingsRoutes = new Hono();

// =============================================================================
// Types
// =============================================================================

interface ProviderWithStatus {
  provider: string;
  displayName: string;
  models?: Array<{ id: string; name: string; default?: boolean }>;
  apiKeyEnv: string;
  requiresApiKey: boolean;
  isConfigured: boolean;
  apiKeyName: string;
}

interface CapabilitySettings {
  capability: MediaCapability;
  name: string;
  description: string;
  currentProvider: string | null;
  currentModel: string | null;
  availableProviders: ProviderWithStatus[];
}

// =============================================================================
// Provider API Key Mapping
// =============================================================================

const PROVIDER_API_KEYS: Record<string, string> = {
  openai: 'openai_api_key',
  anthropic: 'anthropic_api_key',
  google: 'google_ai_api_key',
  fireworks: 'fireworks_api_key',
  elevenlabs: 'elevenlabs_api_key',
  groq: 'groq_api_key',
  deepgram: 'deepgram_api_key',
};

// =============================================================================
// Capability Metadata
// =============================================================================

const CAPABILITY_META: Record<MediaCapability, { name: string; description: string }> = {
  image_generation: {
    name: 'Image Generation',
    description: 'Generate images from text descriptions (DALL-E, FLUX, Imagen)',
  },
  vision: {
    name: 'Vision / Image Analysis',
    description: 'Analyze images, extract text (OCR), describe content',
  },
  tts: {
    name: 'Text-to-Speech',
    description: 'Convert text to spoken audio',
  },
  stt: {
    name: 'Speech-to-Text',
    description: 'Transcribe audio to text',
  },
  weather: {
    name: 'Weather',
    description: 'Get current weather and forecasts',
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

function isProviderConfigured(providerId: string): boolean {
  const keyName = PROVIDER_API_KEYS[providerId];
  if (!keyName) return false;
  const apiKey = settingsRepo.get<string>(keyName);
  return !!apiKey && apiKey.length > 0;
}

function getProvidersWithStatus(capability: MediaCapability): ProviderWithStatus[] {
  const providers = AVAILABLE_PROVIDERS[capability] || [];

  return providers.map((p) => ({
    ...p,
    isConfigured: isProviderConfigured(p.provider),
    apiKeyName: PROVIDER_API_KEYS[p.provider] || 'unknown',
  }));
}

// =============================================================================
// Routes
// =============================================================================

/**
 * Get all media settings
 */
mediaSettingsRoutes.get('/', async (c) => {
  const userId = getUserId(c);

  const capabilities: MediaCapability[] = ['image_generation', 'vision', 'tts', 'stt'];

  const settings: CapabilitySettings[] = await Promise.all(
    capabilities.map(async (capability) => {
      const current = await mediaSettingsRepo.getEffective(userId, capability);
      const availableProviders = getProvidersWithStatus(capability);

      return {
        capability,
        name: CAPABILITY_META[capability].name,
        description: CAPABILITY_META[capability].description,
        currentProvider: current?.provider || null,
        currentModel: current?.model || null,
        availableProviders,
      };
    })
  );

  return c.json({
    success: true,
    data: settings,
  });
});

/**
 * Get settings for a specific capability
 */
mediaSettingsRoutes.get('/:capability', async (c) => {
  const capability = c.req.param('capability') as MediaCapability;
  const userId = getUserId(c);

  // Validate capability
  if (!CAPABILITY_META[capability]) {
    return apiError(c, `Invalid capability: ${capability}`, 400);
  }

  const current = await mediaSettingsRepo.getEffective(userId, capability);
  const availableProviders = getProvidersWithStatus(capability);

  return c.json({
    success: true,
    data: {
      capability,
      name: CAPABILITY_META[capability].name,
      description: CAPABILITY_META[capability].description,
      currentProvider: current?.provider || null,
      currentModel: current?.model || null,
      config: current?.config || null,
      availableProviders,
    },
  });
});

/**
 * Set provider for a capability
 */
mediaSettingsRoutes.post('/:capability', async (c) => {
  const capability = c.req.param('capability') as MediaCapability;
  const userId = getUserId(c);

  // Validate capability
  if (!CAPABILITY_META[capability]) {
    return apiError(c, `Invalid capability: ${capability}`, 400);
  }

  try {
    const body = await c.req.json<{
      provider: string;
      model?: string;
      config?: Record<string, unknown>;
    }>();

    if (!body.provider) {
      return apiError(c, 'Provider is required', 400);
    }

    // Validate provider exists for this capability
    const availableProviders = AVAILABLE_PROVIDERS[capability] || [];
    const providerExists = availableProviders.some((p) => p.provider === body.provider);

    if (!providerExists) {
      return c.json(
        {
          success: false,
          error: `Invalid provider: ${body.provider}`,
          validProviders: availableProviders.map((p) => p.provider),
        },
        400
      );
    }

    // Check if provider is configured (has API key)
    if (!isProviderConfigured(body.provider)) {
      const keyName = PROVIDER_API_KEYS[body.provider];
      return c.json(
        {
          success: false,
          error: `Provider ${body.provider} is not configured`,
          hint: `Add your ${body.provider} API key in Settings → API Keys (${keyName})`,
        },
        400
      );
    }

    // Validate model if provided
    if (body.model) {
      const providerOption = availableProviders.find((p) => p.provider === body.provider);
      const modelIds = providerOption?.models?.map((m) => m.id) || [];
      if (providerOption?.models && !modelIds.includes(body.model)) {
        return c.json(
          {
            success: false,
            error: `Invalid model: ${body.model}`,
            validModels: modelIds,
          },
          400
        );
      }
    }

    // Save setting
    await mediaSettingsRepo.set({
      userId,
      capability,
      provider: body.provider,
      model: body.model,
      config: body.config,
    });

    return c.json({
      success: true,
      message: `${CAPABILITY_META[capability].name} provider set to ${body.provider}`,
      data: {
        capability,
        provider: body.provider,
        model: body.model,
      },
    });
  } catch (error) {
    log.error('Failed to save media setting:', error);
    return apiError(c, 'Failed to save setting', 500);
  }
});

/**
 * Delete/reset setting for a capability
 */
mediaSettingsRoutes.delete('/:capability', async (c) => {
  const capability = c.req.param('capability') as MediaCapability;
  const userId = getUserId(c);

  // Validate capability
  if (!CAPABILITY_META[capability]) {
    return apiError(c, `Invalid capability: ${capability}`, 400);
  }

  await mediaSettingsRepo.delete(userId, capability);

  return c.json({
    success: true,
    message: `${CAPABILITY_META[capability].name} reset to default`,
  });
});

/**
 * Get available providers for all capabilities
 * (Useful for populating UI dropdowns)
 */
mediaSettingsRoutes.get('/providers/all', async (c) => {
  const capabilities: MediaCapability[] = ['image_generation', 'vision', 'tts', 'stt'];

  const allProviders: Record<MediaCapability, ProviderWithStatus[]> = {} as Record<
    MediaCapability,
    ProviderWithStatus[]
  >;

  for (const capability of capabilities) {
    allProviders[capability] = getProvidersWithStatus(capability);
  }

  return c.json({
    success: true,
    data: allProviders,
  });
});

/**
 * Check which capabilities are configured
 */
mediaSettingsRoutes.get('/status/summary', async (c) => {
  const userId = getUserId(c);
  const capabilities: MediaCapability[] = ['image_generation', 'vision', 'tts', 'stt'];

  const status = await Promise.all(
    capabilities.map(async (capability) => {
      const setting = await mediaSettingsRepo.getEffective(userId, capability);
      const isConfigured = setting ? isProviderConfigured(setting.provider) : false;

      return {
        capability,
        name: CAPABILITY_META[capability].name,
        hasProvider: !!setting,
        provider: setting?.provider,
        model: setting?.model,
        isConfigured,
      };
    })
  );

  const summary = {
    total: capabilities.length,
    configured: status.filter((s) => s.isConfigured).length,
    unconfigured: status.filter((s) => !s.isConfigured).length,
  };

  return c.json({
    success: true,
    data: {
      summary,
      capabilities: status,
    },
  });
});
