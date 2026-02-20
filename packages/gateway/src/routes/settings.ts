/**
 * Settings routes
 *
 * Provides API for managing application settings including API keys
 * Settings are persisted to the database (PostgreSQL)
 */

import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';
import { settingsRepo, localProvidersRepo } from '../db/repositories/index.js';
import {
  getAvailableProviders,
  getDefaultModelForProvider,
  DEFAULT_SANDBOX_SETTINGS,
  type SandboxSettings,
  isDockerAvailable,
  TOOL_GROUPS,
  DEFAULT_ENABLED_GROUPS,
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

  // Include enabled local providers as configured (they don't need API keys)
  const localProviders = await localProvidersRepo.listProviders();
  const enabledLocalProviders = localProviders
    .filter((lp) => lp.isEnabled)
    .map((lp) => ({ id: lp.id, name: lp.name, type: 'local' as const }));
  const localProviderIds = enabledLocalProviders.map((lp) => lp.id);

  // Merge: remote configured + local enabled
  const allConfiguredProviders = [...configuredProviders, ...localProviderIds];

  // Get default provider/model settings
  const defaultProvider = await settingsRepo.get<string>(DEFAULT_PROVIDER_KEY);
  const defaultModel = await settingsRepo.get<string>(DEFAULT_MODEL_KEY);

  // Available providers from config
  const availableProviders = getAvailableProviders();

  return apiResponse(c, {
      configuredProviders: allConfiguredProviders,
      localProviders: enabledLocalProviders,
      demoMode: allConfiguredProviders.length === 0,
      defaultProvider: defaultProvider ?? null,
      defaultModel: defaultModel ?? null,
      availableProviders,
    });
});

/**
 * Get data directory information
 */
settingsRoutes.get('/data-info', async (c) => {
  const dataInfo = getDataDirectoryInfo();
  const migrationStatus = getMigrationStatus();

  return apiResponse(c, {
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
    });
});

/**
 * Set default AI provider
 */
settingsRoutes.post('/default-provider', async (c) => {
  const body = await c.req.json<{ provider: string }>();

  if (!body.provider || typeof body.provider !== 'string') {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Provider is required' }, 400);
  }

  if (body.provider.length > 64) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Provider name too long (max 64 characters)' }, 400);
  }

  await settingsRepo.set(DEFAULT_PROVIDER_KEY, body.provider);

  return apiResponse(c, {
      defaultProvider: body.provider,
    });
});

/**
 * Set default AI model
 */
settingsRoutes.post('/default-model', async (c) => {
  const body = await c.req.json<{ model: string }>();

  if (!body.model || typeof body.model !== 'string') {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Model is required' }, 400);
  }

  if (body.model.length > 128) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Model name too long (max 128 characters)' }, 400);
  }

  await settingsRepo.set(DEFAULT_MODEL_KEY, body.model);

  return apiResponse(c, {
      defaultModel: body.model,
    });
});

/**
 * Set API key for a provider
 */
settingsRoutes.post('/api-keys', async (c) => {
  const body = await c.req.json<{ provider: string; apiKey: string }>();

  if (!body.provider || !body.apiKey) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'Provider and apiKey are required' }, 400);
  }

  if (body.provider.length > 64) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Provider name too long (max 64 characters)' }, 400);
  }

  // Store API key in database
  const key = `${API_KEY_PREFIX}${body.provider}`;
  await settingsRepo.set(key, body.apiKey);

  // Also set as environment variable for the current process
  // This allows providers to work immediately without restart
  const sanitizedProvider = body.provider.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase();
  if (sanitizedProvider) {
    const envVarName = `${sanitizedProvider}_API_KEY`;
    process.env[envVarName] = body.apiKey;
  }

  return apiResponse(c, {
      provider: body.provider,
      configured: true,
    });
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
  const sanitizedProvider = provider.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase();
  if (sanitizedProvider) {
    const envVarName = `${sanitizedProvider}_API_KEY`;
    delete process.env[envVarName];
  }

  return apiResponse(c, {
      provider,
      configured: false,
    });
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
 * Get all configured provider IDs in one query (batch version of hasApiKey).
 * Returns a Set of provider IDs that have API keys configured.
 */
export async function getConfiguredProviderIds(): Promise<Set<string>> {
  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);
  return new Set(apiKeySettings.map(s => s.key.replace(API_KEY_PREFIX, '')));
}

/**
 * Load all API keys from database into process.env for provider SDKs
 * Called at startup - this allows SDKs that read from env to work
 */
export async function loadApiKeysToEnvironment(): Promise<void> {
  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);

  for (const setting of apiKeySettings) {
    const provider = setting.key.replace(API_KEY_PREFIX, '');
    const sanitizedProvider = provider.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase();
    if (sanitizedProvider) {
      const envVarName = `${sanitizedProvider}_API_KEY`;
      process.env[envVarName] = setting.value as string;
    }
  }
}

/**
 * Get the default AI provider (database only, no hardcoded fallback)
 * Returns null if no provider is configured
 */
export async function getDefaultProvider(): Promise<string | null> {
  // Check database setting
  const savedProvider = await settingsRepo.get<string>(DEFAULT_PROVIDER_KEY);
  if (savedProvider) {
    // Check if it's a local provider
    const localProv = await localProvidersRepo.getProvider(savedProvider);
    if (localProv?.isEnabled) return savedProvider;
    // Check remote provider
    if (await hasApiKey(savedProvider)) return savedProvider;
  }

  // Check if a local provider is marked as default
  const localDefault = await localProvidersRepo.getDefault('default');
  if (localDefault?.isEnabled) return localDefault.id;

  // Fall back to first configured remote provider
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

    return apiResponse(c, {
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
      });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.SANDBOX_SETTINGS_ERROR, message: getErrorMessage(error, 'Failed to get sandbox settings') }, 500);
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
          return apiError(c, { code: ERROR_CODES.INVALID_VALUE, message: `${key} must be a boolean` }, 400);
        }

        if (
          ['defaultMemoryMB', 'defaultCpuCores', 'defaultTimeoutMs', 'maxWorkspacesPerUser', 'maxStoragePerUserGB'].includes(key) &&
          typeof value !== 'number'
        ) {
          return apiError(c, { code: ERROR_CODES.INVALID_VALUE, message: `${key} must be a number` }, 400);
        }

        if (key === 'defaultNetwork' && !['none', 'restricted', 'egress', 'full'].includes(value as string)) {
          return apiError(c, { code: ERROR_CODES.INVALID_VALUE, message: `${key} must be one of: none, restricted, egress, full` }, 400);
        }

        if (key === 'allowedImages' && !Array.isArray(value)) {
          return apiError(c, { code: ERROR_CODES.INVALID_VALUE, message: `${key} must be an array of strings` }, 400);
        }

        await setSandboxSetting(key, value as SandboxSettings[typeof key]);
        updated.push(key);
      }
    }

    const newSettings = await getSandboxSettings();

    return apiResponse(c, {
        updated,
        settings: newSettings,
      });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.SANDBOX_SETTINGS_ERROR, message: getErrorMessage(error, 'Failed to update sandbox settings') }, 500);
  }
});

/**
 * POST /sandbox/enable - Quick enable sandbox
 */
settingsRoutes.post('/sandbox/enable', async (c) => {
  try {
    const dockerAvailable = await isDockerAvailable();

    if (!dockerAvailable) {
      return apiError(c, { code: ERROR_CODES.DOCKER_UNAVAILABLE, message: 'Cannot enable sandbox: Docker is not available. Please install and start Docker first.' }, 400);
    }

    await setSandboxSetting('enabled', true);

    return apiResponse(c, {
        enabled: true,
        message: 'Sandbox has been enabled.',
      });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.SANDBOX_ENABLE_ERROR, message: getErrorMessage(error, 'Failed to enable sandbox') }, 500);
  }
});

/**
 * POST /sandbox/disable - Quick disable sandbox
 */
settingsRoutes.post('/sandbox/disable', async (c) => {
  try {
    await setSandboxSetting('enabled', false);

    return apiResponse(c, {
        enabled: false,
        message: 'Sandbox has been disabled.',
      });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.SANDBOX_DISABLE_ERROR, message: getErrorMessage(error, 'Failed to disable sandbox') }, 500);
  }
});

// ============================================
// Tool Group Settings
// ============================================

const TOOL_GROUPS_KEY = 'tool_groups';

/**
 * GET /tool-groups - Get all tool groups with enabled/disabled state
 */
settingsRoutes.get('/tool-groups', (c) => {
  const savedGroups = settingsRepo.get<string[]>(TOOL_GROUPS_KEY);
  const enabledGroupIds = savedGroups ?? DEFAULT_ENABLED_GROUPS;

  const groups = Object.values(TOOL_GROUPS).map((group) => ({
    id: group.id,
    name: group.name,
    description: group.description,
    toolCount: group.tools.length,
    tools: [...group.tools],
    enabled: enabledGroupIds.includes(group.id),
    alwaysOn: group.alwaysOn ?? false,
    defaultEnabled: group.defaultEnabled,
  }));

  return apiResponse(c, { groups, enabledGroupIds });
});

/**
 * PUT /tool-groups - Save enabled tool group IDs
 */
settingsRoutes.put('/tool-groups', async (c) => {
  const body = await c.req.json<{ enabledGroupIds: string[] }>();

  if (!Array.isArray(body.enabledGroupIds)) {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: 'enabledGroupIds must be an array' }, 400);
  }

  // Validate all IDs reference real groups
  const invalidIds = body.enabledGroupIds.filter((id) => !TOOL_GROUPS[id]);
  if (invalidIds.length > 0) {
    return apiError(c, {
      code: ERROR_CODES.INVALID_INPUT,
      message: `Unknown tool group IDs: ${invalidIds.join(', ')}`,
    }, 400);
  }

  // Ensure always-on groups are included
  const enabledSet = new Set(body.enabledGroupIds);
  for (const group of Object.values(TOOL_GROUPS)) {
    if (group.alwaysOn) {
      enabledSet.add(group.id);
    }
  }

  const enabledGroupIds = [...enabledSet];
  await settingsRepo.set(TOOL_GROUPS_KEY, enabledGroupIds);

  return apiResponse(c, { enabledGroupIds });
});

/**
 * Get enabled tool group IDs (for use by other modules)
 */
export function getEnabledToolGroupIds(): string[] {
  return settingsRepo.get<string[]>(TOOL_GROUPS_KEY) ?? DEFAULT_ENABLED_GROUPS;
}
