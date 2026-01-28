/**
 * Settings routes
 *
 * Provides API for managing application settings including API keys
 * Settings are persisted to SQLite database
 */

import { Hono } from 'hono';
import type { ApiResponse } from '../types/index.js';
import { settingsRepo } from '../db/repositories/index.js';
import {
  getAvailableProviders,
  getDefaultModelForProvider,
  DEFAULT_SANDBOX_SETTINGS,
  type SandboxSettings,
  isDockerAvailable,
} from '@ownpilot/core';
import { getDataDirectoryInfo } from '../paths/index.js';
import { getMigrationStatus } from '../paths/migration.js';

export const settingsRoutes = new Hono();

// Key prefix for API keys in the settings store
const API_KEY_PREFIX = 'api_key:';

// Keys for default AI provider and model settings (forward declaration)
const DEFAULT_PROVIDER_KEY = 'default_ai_provider';
const DEFAULT_MODEL_KEY = 'default_ai_model';

/**
 * Get current settings (without exposing actual keys)
 * All settings come from database - no ENV fallbacks
 */
settingsRoutes.get('/', async (c) => {
  // Get all API key settings from database only
  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);
  const configuredProviders = apiKeySettings.map((s) =>
    s.key.replace(API_KEY_PREFIX, '')
  );

  // Get default provider/model settings
  const defaultProvider = await settingsRepo.get<string>(DEFAULT_PROVIDER_KEY);
  const defaultModel = await settingsRepo.get<string>(DEFAULT_MODEL_KEY);

  // Available providers from config
  const availableProviders = getAvailableProviders();

  const response: ApiResponse = {
    success: true,
    data: {
      configuredProviders,
      demoMode: configuredProviders.length === 0,
      defaultProvider: defaultProvider ?? null,
      defaultModel: defaultModel ?? null,
      availableProviders,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get data directory information
 */
settingsRoutes.get('/data-info', async (c) => {
  const dataInfo = getDataDirectoryInfo();
  const migrationStatus = getMigrationStatus();

  const response: ApiResponse = {
    success: true,
    data: {
      dataDirectory: dataInfo.root,
      database: dataInfo.database,
      workspace: dataInfo.workspace,
      credentials: dataInfo.credentials,
      platform: dataInfo.platform,
      isDefaultLocation: dataInfo.isDefaultLocation,
      migration: {
        needsMigration: migrationStatus.needsMigration,
        legacyPath: migrationStatus.legacyPath,
        legacyFiles: migrationStatus.legacyFiles,
      },
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Set default AI provider
 */
settingsRoutes.post('/default-provider', async (c) => {
  const body = await c.req.json<{ provider: string }>();

  if (!body.provider) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Provider is required',
        },
      },
      400
    );
  }

  await settingsRepo.set(DEFAULT_PROVIDER_KEY, body.provider);

  const response: ApiResponse = {
    success: true,
    data: {
      defaultProvider: body.provider,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Set default AI model
 */
settingsRoutes.post('/default-model', async (c) => {
  const body = await c.req.json<{ model: string }>();

  if (!body.model) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Model is required',
        },
      },
      400
    );
  }

  await settingsRepo.set(DEFAULT_MODEL_KEY, body.model);

  const response: ApiResponse = {
    success: true,
    data: {
      defaultModel: body.model,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Set API key for a provider
 */
settingsRoutes.post('/api-keys', async (c) => {
  const body = await c.req.json<{ provider: string; apiKey: string }>();

  if (!body.provider || !body.apiKey) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Provider and apiKey are required',
        },
      },
      400
    );
  }

  // Store API key in database
  const key = `${API_KEY_PREFIX}${body.provider}`;
  await settingsRepo.set(key, body.apiKey);

  // Also set as environment variable for the current process
  // This allows providers to work immediately without restart
  const envVarName = `${body.provider.toUpperCase()}_API_KEY`;
  process.env[envVarName] = body.apiKey;

  const response: ApiResponse = {
    success: true,
    data: {
      provider: body.provider,
      configured: true,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Delete API key for a provider
 */
settingsRoutes.delete('/api-keys/:provider', async (c) => {
  const provider = c.req.param('provider');

  // Delete from database
  const key = `${API_KEY_PREFIX}${provider}`;
  await settingsRepo.delete(key);

  // Remove from environment
  const envVarName = `${provider.toUpperCase()}_API_KEY`;
  delete process.env[envVarName];

  const response: ApiResponse = {
    success: true,
    data: {
      provider,
      configured: false,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Check if a provider has an API key configured (database only)
 */
export async function hasApiKey(provider: string): Promise<boolean> {
  const key = `${API_KEY_PREFIX}${provider}`;
  return await settingsRepo.has(key);
}

/**
 * Get API key for a provider (database only)
 */
export async function getApiKey(provider: string): Promise<string | undefined> {
  const key = `${API_KEY_PREFIX}${provider}`;
  return (await settingsRepo.get<string>(key)) ?? undefined;
}

/**
 * Load all API keys from database into process.env for provider SDKs
 * Called at startup - this allows SDKs that read from env to work
 */
export async function loadApiKeysToEnvironment(): Promise<void> {
  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);

  for (const setting of apiKeySettings) {
    const provider = setting.key.replace(API_KEY_PREFIX, '');
    const envVarName = `${provider.toUpperCase()}_API_KEY`;
    process.env[envVarName] = setting.value as string;
    console.log(`Loaded API key for ${provider} from database`);
  }
}

/**
 * Get the default AI provider (database only, no hardcoded fallback)
 * Returns null if no provider is configured
 */
export async function getDefaultProvider(): Promise<string | null> {
  // Check database setting
  const savedProvider = await settingsRepo.get<string>(DEFAULT_PROVIDER_KEY);
  if (savedProvider && (await hasApiKey(savedProvider))) {
    return savedProvider;
  }

  // Fall back to first configured provider
  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);
  const firstSetting = apiKeySettings[0];
  if (firstSetting) {
    return firstSetting.key.replace(API_KEY_PREFIX, '');
  }

  // No providers configured
  return null;
}

/**
 * Set the default AI provider
 */
export async function setDefaultProvider(provider: string): Promise<void> {
  await settingsRepo.set(DEFAULT_PROVIDER_KEY, provider);
}

/**
 * Get the default model for a provider (database + config, no hardcoded fallback)
 * Returns null if no model can be determined
 */
export async function getDefaultModel(provider?: string): Promise<string | null> {
  // Check database setting for specific default model
  const savedModel = await settingsRepo.get<string>(DEFAULT_MODEL_KEY);
  if (savedModel) {
    return savedModel;
  }

  // Fall back to provider-specific defaults from config
  const actualProvider = provider ?? (await getDefaultProvider());
  if (!actualProvider) {
    return null;
  }

  const defaultModel = getDefaultModelForProvider(actualProvider);
  return defaultModel?.id ?? null;
}

/**
 * Set the default AI model
 */
export async function setDefaultModel(model: string): Promise<void> {
  await settingsRepo.set(DEFAULT_MODEL_KEY, model);
}

/**
 * Resolve "default" provider/model to actual values
 * Returns null values if no defaults are configured
 */
export async function resolveProviderAndModel(provider: string, model: string): Promise<{ provider: string | null; model: string | null }> {
  const resolvedProvider = provider === 'default' ? await getDefaultProvider() : provider;
  const resolvedModel = model === 'default' ? await getDefaultModel(resolvedProvider ?? undefined) : model;
  return { provider: resolvedProvider, model: resolvedModel };
}

/**
 * Check if demo mode (no providers configured)
 */
export async function isDemoModeFromSettings(): Promise<boolean> {
  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);
  return apiKeySettings.length === 0;
}

/**
 * Get the source of an API key (database only now)
 * Returns 'database' if key exists, null otherwise
 */
export async function getApiKeySource(provider: string): Promise<'database' | null> {
  const key = `${API_KEY_PREFIX}${provider}`;
  return (await settingsRepo.has(key)) ? 'database' : null;
}

// ============================================
// Sandbox Settings
// ============================================

const SANDBOX_SETTINGS_PREFIX = 'sandbox:';

/**
 * Get sandbox settings
 */
export async function getSandboxSettings(): Promise<SandboxSettings> {
  const settings = { ...DEFAULT_SANDBOX_SETTINGS } as { [K in keyof SandboxSettings]: SandboxSettings[K] };

  // Override with saved settings
  const savedSettings = await settingsRepo.getByPrefix(SANDBOX_SETTINGS_PREFIX);
  for (const setting of savedSettings) {
    const key = setting.key.replace(SANDBOX_SETTINGS_PREFIX, '') as keyof SandboxSettings;
    if (key in settings) {
      const defaultValue = DEFAULT_SANDBOX_SETTINGS[key];
      // Handle array types (allowedImages)
      if (Array.isArray(defaultValue)) {
        try {
          const parsed = JSON.parse(setting.value as string);
          if (Array.isArray(parsed)) {
            // Use type assertion with intermediate cast
            (settings[key] as unknown) = parsed;
          }
        } catch {
          // Keep default if JSON parse fails
        }
      } else if (typeof defaultValue === 'boolean') {
        (settings[key] as unknown) = setting.value === 'true' || setting.value === true;
      } else if (typeof defaultValue === 'number') {
        (settings[key] as unknown) = Number(setting.value);
      } else {
        (settings[key] as unknown) = setting.value;
      }
    }
  }

  return settings;
}

/**
 * Set a sandbox setting
 */
export async function setSandboxSetting<K extends keyof SandboxSettings>(
  key: K,
  value: SandboxSettings[K]
): Promise<void> {
  const settingKey = `${SANDBOX_SETTINGS_PREFIX}${key}`;
  if (Array.isArray(value)) {
    await settingsRepo.set(settingKey, JSON.stringify(value));
  } else {
    await settingsRepo.set(settingKey, String(value));
  }
}

/**
 * Check if sandbox is enabled
 */
export async function isSandboxEnabled(): Promise<boolean> {
  const enabledSetting = await settingsRepo.get<string>(`${SANDBOX_SETTINGS_PREFIX}enabled`);
  return enabledSetting === 'true';
}

/**
 * GET /sandbox - Get sandbox settings
 */
settingsRoutes.get('/sandbox', async (c) => {
  try {
    const settings = await getSandboxSettings();
    const dockerAvailable = await isDockerAvailable();

    const response: ApiResponse = {
      success: true,
      data: {
        settings,
        dockerAvailable,
        status: {
          enabled: settings.enabled,
          ready: settings.enabled && dockerAvailable,
          message: !dockerAvailable
            ? 'Docker is not available. Please install and start Docker to use sandboxed execution.'
            : settings.enabled
              ? 'Sandbox is enabled and ready.'
              : 'Sandbox is disabled. Enable it to use isolated user workspaces.',
        },
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SANDBOX_SETTINGS_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get sandbox settings',
        },
      },
      500
    );
  }
});

/**
 * POST /sandbox - Update sandbox settings
 */
settingsRoutes.post('/sandbox', async (c) => {
  try {
    const body = await c.req.json<Partial<SandboxSettings>>();

    // Validate and apply each setting
    const validKeys: (keyof SandboxSettings)[] = [
      'enabled',
      'basePath',
      'defaultMemoryMB',
      'defaultCpuCores',
      'defaultTimeoutMs',
      'defaultNetwork',
      'maxWorkspacesPerUser',
      'maxStoragePerUserGB',
      'allowedImages',
      'pythonImage',
      'nodeImage',
      'shellImage',
    ];

    const updated: string[] = [];

    for (const key of validKeys) {
      if (key in body) {
        const value = body[key];

        // Validation
        if (key === 'enabled' && typeof value !== 'boolean') {
          return c.json(
            {
              success: false,
              error: {
                code: 'INVALID_VALUE',
                message: `${key} must be a boolean`,
              },
            },
            400
          );
        }

        if (
          ['defaultMemoryMB', 'defaultCpuCores', 'defaultTimeoutMs', 'maxWorkspacesPerUser', 'maxStoragePerUserGB'].includes(key) &&
          typeof value !== 'number'
        ) {
          return c.json(
            {
              success: false,
              error: {
                code: 'INVALID_VALUE',
                message: `${key} must be a number`,
              },
            },
            400
          );
        }

        if (key === 'defaultNetwork' && !['none', 'restricted', 'egress', 'full'].includes(value as string)) {
          return c.json(
            {
              success: false,
              error: {
                code: 'INVALID_VALUE',
                message: `${key} must be one of: none, restricted, egress, full`,
              },
            },
            400
          );
        }

        if (key === 'allowedImages' && !Array.isArray(value)) {
          return c.json(
            {
              success: false,
              error: {
                code: 'INVALID_VALUE',
                message: `${key} must be an array of strings`,
              },
            },
            400
          );
        }

        await setSandboxSetting(key, value as SandboxSettings[typeof key]);
        updated.push(key);
      }
    }

    const newSettings = await getSandboxSettings();

    const response: ApiResponse = {
      success: true,
      data: {
        updated,
        settings: newSettings,
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SANDBOX_SETTINGS_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update sandbox settings',
        },
      },
      500
    );
  }
});

/**
 * POST /sandbox/enable - Quick enable sandbox
 */
settingsRoutes.post('/sandbox/enable', async (c) => {
  try {
    const dockerAvailable = await isDockerAvailable();

    if (!dockerAvailable) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DOCKER_UNAVAILABLE',
            message: 'Cannot enable sandbox: Docker is not available. Please install and start Docker first.',
          },
        },
        400
      );
    }

    await setSandboxSetting('enabled', true);

    const response: ApiResponse = {
      success: true,
      data: {
        enabled: true,
        message: 'Sandbox has been enabled.',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SANDBOX_ENABLE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to enable sandbox',
        },
      },
      500
    );
  }
});

/**
 * POST /sandbox/disable - Quick disable sandbox
 */
settingsRoutes.post('/sandbox/disable', async (c) => {
  try {
    await setSandboxSetting('enabled', false);

    const response: ApiResponse = {
      success: true,
      data: {
        enabled: false,
        message: 'Sandbox has been disabled.',
      },
      meta: {
        requestId: c.get('requestId') ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SANDBOX_DISABLE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to disable sandbox',
        },
      },
      500
    );
  }
});
