/**
 * Settings routes — HTTP handlers only.
 *
 * The pure helpers that read/write settings live in
 * `services/app-settings.ts` so non-route consumers don't reach back into
 * the routes/ layer. Route handlers import them from there.
 */

import { Hono } from 'hono';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  sanitizeProviderName,
} from './helpers.js';
import {
  validateBody,
  setDefaultProviderSchema,
  setDefaultModelSchema,
  setApiKeySchema,
  setAllowedDirsSchema,
  setToolGroupsSchema,
} from '../middleware/validation.js';
import { settingsRepo, localProvidersRepo } from '../db/repositories/index.js';
import { getAvailableProviders } from '@ownpilot/core/agent';
import { isDockerAvailable } from '@ownpilot/core/workspace';
import { type SandboxSettings, TOOL_GROUPS, DEFAULT_ENABLED_GROUPS } from '@ownpilot/core/agent';
import { getDataDirectoryInfo } from '../paths/index.js';
import { getMigrationStatus } from '../paths/migration.js';
import { getLlmSemaphore } from '../services/llm/semaphore.js';
import { DEFAULT_MAX_LLM_CONCURRENCY } from '../config/defaults.js';
import {
  API_KEY_PREFIX,
  DEFAULT_PROVIDER_KEY,
  DEFAULT_MODEL_KEY,
  TOOL_GROUPS_KEY,
  getAllowedDirs,
  setAllowedDirs,
  getSandboxSettings,
  setSandboxSetting,
} from '../services/app-settings.js';

export const settingsRoutes = new Hono();

// Re-exports for backward compatibility with existing route consumers.
// New code MUST import these directly from '../services/app-settings.js'.
export {
  hasApiKey,
  getApiKey,
  getConfiguredProviderIds,
  loadApiKeysToEnvironment,
  getDefaultProvider,
  setDefaultProvider,
  getDefaultModel,
  setDefaultModel,
  resolveDefaultProviderAndModel,
  isDemoModeFromSettings,
  getApiKeySource,
  getSandboxSettings,
  setSandboxSetting,
  isSandboxEnabled,
  getEnabledToolGroupIds,
} from '../services/app-settings.js';

/**
 * Get current settings (without exposing actual keys)
 */
settingsRoutes.get('/', async (c) => {
  const apiKeySettings = await settingsRepo.getByPrefix(API_KEY_PREFIX);
  const configuredProviders = apiKeySettings.map((s) => s.key.replace(API_KEY_PREFIX, ''));

  const localProviders = await localProvidersRepo.listProviders();
  const enabledLocalProviders = localProviders
    .filter((lp) => lp.isEnabled)
    .map((lp) => ({ id: lp.id, name: lp.name, type: 'local' as const }));
  const localProviderIds = enabledLocalProviders.map((lp) => lp.id);

  const allConfiguredProviders = [...configuredProviders, ...localProviderIds];

  const defaultProvider = await settingsRepo.get<string>(DEFAULT_PROVIDER_KEY);
  const defaultModel = await settingsRepo.get<string>(DEFAULT_MODEL_KEY);

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
  try {
    const body = validateBody(setDefaultProviderSchema, await c.req.json());

    await settingsRepo.set(DEFAULT_PROVIDER_KEY, body.provider);

    return apiResponse(c, {
      defaultProvider: body.provider,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * Set default AI model
 */
settingsRoutes.post('/default-model', async (c) => {
  try {
    const body = validateBody(setDefaultModelSchema, await c.req.json());

    await settingsRepo.set(DEFAULT_MODEL_KEY, body.model);

    return apiResponse(c, {
      defaultModel: body.model,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * Set API key for a provider
 */
settingsRoutes.post('/api-keys', async (c) => {
  try {
    const body = validateBody(setApiKeySchema, await c.req.json());

    const key = `${API_KEY_PREFIX}${body.provider}`;
    await settingsRepo.set(key, body.apiKey);

    const sanitizedProvider = sanitizeProviderName(body.provider);
    if (sanitizedProvider) {
      const envVarName = `${sanitizedProvider}_API_KEY`;
      process.env[envVarName] = body.apiKey;
    }

    return apiResponse(c, {
      provider: body.provider,
      configured: true,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

/**
 * Delete API key for a provider
 */
settingsRoutes.delete('/api-keys/:provider', async (c) => {
  const provider = c.req.param('provider');

  const key = `${API_KEY_PREFIX}${provider}`;
  await settingsRepo.delete(key);

  const sanitizedProvider = sanitizeProviderName(provider);
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
 * GET /coding-agents/allowed-dirs
 */
settingsRoutes.get('/coding-agents/allowed-dirs', async (c) => {
  const dirs = await getAllowedDirs();
  return apiResponse(c, { dirs });
});

/**
 * PUT /coding-agents/allowed-dirs
 */
settingsRoutes.put('/coding-agents/allowed-dirs', async (c) => {
  try {
    const body = validateBody(setAllowedDirsSchema, await c.req.json());
    const dirs = body.dirs.filter((d: string): d is string => d.trim().length > 0);
    await setAllowedDirs(dirs);
    return apiResponse(c, { dirs });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

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
    return apiError(
      c,
      {
        code: ERROR_CODES.SANDBOX_SETTINGS_ERROR,
        message: getErrorMessage(error, 'Failed to get sandbox settings'),
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

        if (key === 'enabled' && typeof value !== 'boolean') {
          return apiError(
            c,
            { code: ERROR_CODES.INVALID_VALUE, message: `${key} must be a boolean` },
            400
          );
        }

        if (
          [
            'defaultMemoryMB',
            'defaultCpuCores',
            'defaultTimeoutMs',
            'maxWorkspacesPerUser',
            'maxStoragePerUserGB',
          ].includes(key) &&
          typeof value !== 'number'
        ) {
          return apiError(
            c,
            { code: ERROR_CODES.INVALID_VALUE, message: `${key} must be a number` },
            400
          );
        }

        if (
          key === 'defaultNetwork' &&
          !['none', 'restricted', 'egress', 'full'].includes(value as string)
        ) {
          return apiError(
            c,
            {
              code: ERROR_CODES.INVALID_VALUE,
              message: `${key} must be one of: none, restricted, egress, full`,
            },
            400
          );
        }

        if (key === 'allowedImages' && !Array.isArray(value)) {
          return apiError(
            c,
            { code: ERROR_CODES.INVALID_VALUE, message: `${key} must be an array of strings` },
            400
          );
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
    return apiError(
      c,
      {
        code: ERROR_CODES.SANDBOX_SETTINGS_ERROR,
        message: getErrorMessage(error, 'Failed to update sandbox settings'),
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
      return apiError(
        c,
        {
          code: ERROR_CODES.DOCKER_UNAVAILABLE,
          message:
            'Cannot enable sandbox: Docker is not available. Please install and start Docker first.',
        },
        400
      );
    }

    await setSandboxSetting('enabled', true);

    return apiResponse(c, {
      enabled: true,
      message: 'Sandbox has been enabled.',
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.SANDBOX_ENABLE_ERROR,
        message: getErrorMessage(error, 'Failed to enable sandbox'),
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

    return apiResponse(c, {
      enabled: false,
      message: 'Sandbox has been disabled.',
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.SANDBOX_DISABLE_ERROR,
        message: getErrorMessage(error, 'Failed to disable sandbox'),
      },
      500
    );
  }
});

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
  try {
    const body = validateBody(setToolGroupsSchema, await c.req.json());

    const invalidIds = body.enabledGroupIds.filter((id) => !TOOL_GROUPS[id]);
    if (invalidIds.length > 0) {
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_INPUT,
          message: `Unknown tool group IDs: ${invalidIds.join(', ')}`,
        },
        400
      );
    }

    const enabledSet = new Set(body.enabledGroupIds);
    for (const group of Object.values(TOOL_GROUPS)) {
      if (group.alwaysOn) {
        enabledSet.add(group.id);
      }
    }

    const enabledGroupIds = [...enabledSet];
    await settingsRepo.set(TOOL_GROUPS_KEY, enabledGroupIds);

    return apiResponse(c, { enabledGroupIds });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ============================================
// LLM Concurrency Settings
// ============================================

const MAX_LLM_CONCURRENCY_KEY = 'gateway.max_llm_concurrency';

/**
 * GET /settings/max-llm-concurrency
 */
settingsRoutes.get('/max-llm-concurrency', async (c) => {
  const stored = settingsRepo.get<number>(MAX_LLM_CONCURRENCY_KEY);
  const semaphore = getLlmSemaphore();
  return apiResponse(c, {
    maxConcurrency: stored ?? DEFAULT_MAX_LLM_CONCURRENCY,
    activeCalls: semaphore.activeCount,
    queuedCalls: semaphore.queuedCount,
  });
});

/**
 * PUT /settings/max-llm-concurrency
 */
settingsRoutes.put('/max-llm-concurrency', async (c) => {
  try {
    const body = await c.req.json<{ maxConcurrency?: number }>();
    const val = body?.maxConcurrency;

    if (val === undefined || typeof val !== 'number' || !Number.isInteger(val) || val < 1) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'maxConcurrency must be a positive integer',
        },
        400
      );
    }

    await settingsRepo.set(MAX_LLM_CONCURRENCY_KEY, val);
    getLlmSemaphore().setMaxSlots(val);

    return apiResponse(c, {
      maxConcurrency: val,
      activeCalls: getLlmSemaphore().activeCount,
      queuedCalls: getLlmSemaphore().queuedCount,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
