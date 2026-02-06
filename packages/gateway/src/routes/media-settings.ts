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
import { getUserId, apiResponse, apiError, ERROR_CODES } from './helpers.js'

const log = getLog('MediaSettings');

/** Sanitize user-supplied IDs for safe interpolation in error messages */
const sanitizeId = (id: string) => id.replace(/[^\w-]/g, '').slice(0, 100);

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

  return apiResponse(c, settings);
});

/**
 * Get settings for a specific capability
 */
mediaSettingsRoutes.get('/:capability', async (c) => {
  const capability = c.req.param('capability') as MediaCapability;
  const userId = getUserId(c);

  // Validate capability
  if (!CAPABILITY_META[capability]) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Invalid capability: ${sanitizeId(capability)}` }, 400);
  }

  const current = await mediaSettingsRepo.getEffective(userId, capability);
  const availableProviders = getProvidersWithStatus(capability);

  return apiResponse(c, {
    capability,
    name: CAPABILITY_META[capability].name,
    description: CAPABILITY_META[capability].description,
    currentProvider: current?.provider || null,
    currentModel: current?.model || null,
    config: current?.config || null,
    availableProviders,
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
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Invalid capability: ${sanitizeId(capability)}` }, 400);
  }

  try {
    const rawBody = await c.req.json().catch(() => null);

    if (!rawBody) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Request body is required' }, 400);
    }

    const { validateBody, mediaSettingsSchema } = await import('../middleware/validation.js');
    const body = validateBody(mediaSettingsSchema, rawBody) as {
      provider: string;
      model?: string;
      config?: Record<string, unknown>;
    };

    if (!body.provider) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Provider is required' }, 400);
    }

    // Validate provider exists for this capability
    const availableProviders = AVAILABLE_PROVIDERS[capability] || [];
    const providerExists = availableProviders.some((p) => p.provider === body.provider);

    if (!providerExists) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Invalid provider: ${sanitizeId(body.provider)}. Valid: ${availableProviders.map((p) => p.provider).join(', ')}` }, 400);
    }

    // Check if provider is configured (has API key)
    if (!isProviderConfigured(body.provider)) {
      const keyName = PROVIDER_API_KEYS[body.provider];
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: `Provider ${sanitizeId(body.provider)} is not configured. Add your ${sanitizeId(body.provider)} API key in Settings → API Keys (${keyName})` }, 400);
    }

    // Validate model if provided
    if (body.model) {
      const providerOption = availableProviders.find((p) => p.provider === body.provider);
      const modelIds = providerOption?.models?.map((m) => m.id) || [];
      if (providerOption?.models && !modelIds.includes(body.model)) {
        return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Invalid model: ${sanitizeId(body.model)}. Valid: ${modelIds.join(', ')}` }, 400);
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

    return apiResponse(c, {
      message: `${CAPABILITY_META[capability].name} provider set to ${sanitizeId(body.provider)}`,
      capability,
      provider: body.provider,
      model: body.model,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to save setting';
    if (msg.startsWith('Validation failed:')) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: msg }, 400);
    }
    log.error('Failed to save media setting:', error);
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: msg }, 500);
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
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Invalid capability: ${sanitizeId(capability)}` }, 400);
  }

  await mediaSettingsRepo.delete(userId, capability);

  return apiResponse(c, { message: `${CAPABILITY_META[capability].name} reset to default`, });
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

  return apiResponse(c, allProviders);
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

  return apiResponse(c, {
    summary,
    capabilities: status,
  });
});
