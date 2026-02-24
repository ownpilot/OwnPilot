/**
 * Pricing, sync, and budget endpoints
 *
 * Handles syncing model data from models.dev, applying sync, full reset,
 * and per-provider config deletion.
 */

import { Hono } from 'hono';
import { modelConfigsRepo } from '../../db/repositories/index.js';
import { getAllProviderConfigs } from '@ownpilot/core';
import { getLog } from '../../services/log.js';
import { getUserId, apiResponse, apiError, ERROR_CODES, sanitizeId, notFoundError } from '../helpers.js';
import { wsGateway } from '../../ws/server.js';
import { fileURLToPath } from 'url';
import path from 'path';

const log = getLog('ModelConfigs');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pricingRoutes = new Hono();

// =============================================================================
// Sync Route
// =============================================================================

const MODELS_DEV_API_URL = 'https://models.dev/api.json';

interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  cost?: { input?: number; output?: number };
  limit?: { context?: number; output?: number };
  release_date?: string;
}

interface ModelsDevProvider {
  id: string;
  name: string;
  env?: string[];
  api?: string;
  doc?: string;
  models: Record<string, ModelsDevModel>;
}

/**
 * POST /api/v1/sync - Sync models from models.dev API
 * Updates pricing and adds new models while preserving user disabled state
 */
pricingRoutes.post('/sync', async (c) => {
  try {
    // Fetch models.dev API
    const response = await fetch(MODELS_DEV_API_URL);
    if (!response.ok) {
      return apiError(
        c,
        {
          code: ERROR_CODES.FETCH_FAILED,
          message: `Failed to fetch models.dev: ${response.status}`,
        },
        500
      );
    }

    const data = (await response.json()) as Record<string, ModelsDevProvider>;

    // Get current provider configs to compare
    const currentProviders = getAllProviderConfigs();
    const currentModelMap = new Map<string, { inputPrice: number; outputPrice: number }>();

    for (const provider of currentProviders) {
      for (const model of provider.models) {
        currentModelMap.set(`${provider.id}/${model.id}`, {
          inputPrice: model.inputPrice,
          outputPrice: model.outputPrice,
        });
      }
    }

    // Count changes
    let newModels = 0;
    let updatedPricing = 0;
    let totalModels = 0;

    for (const [providerId, provider] of Object.entries(data)) {
      if (!provider.models) continue;

      for (const [modelId, model] of Object.entries(provider.models)) {
        totalModels++;
        const key = `${providerId}/${modelId}`;
        const current = currentModelMap.get(key);

        if (!current) {
          newModels++;
        } else {
          const newInput = model.cost?.input ?? 0;
          const newOutput = model.cost?.output ?? 0;
          if (current.inputPrice !== newInput || current.outputPrice !== newOutput) {
            updatedPricing++;
          }
        }
      }
    }

    // Note: Actual file regeneration should be done via CLI script
    // This endpoint just reports what would change
    return apiResponse(c, {
      message:
        'Sync check complete. Run `npx tsx scripts/generate-provider-configs.ts` to apply changes.',
      stats: {
        providers: Object.keys(data).length,
        totalModels,
        newModels,
        updatedPricing,
      },
      note: 'User disabled models are preserved in database, not affected by sync.',
    });
  } catch (error) {
    log.error('Sync failed:', error);
    return apiError(c, { code: ERROR_CODES.SYNC_ERROR, message: 'Sync failed' }, 500);
  }
});

/**
 * POST /api/v1/sync/apply - Sync providers from models.dev using proper sync function
 * This uses the syncAllProviders function from core which applies CANONICAL_CONFIGS
 * to ensure correct provider types and base URLs
 */
pricingRoutes.post('/sync/apply', async (c) => {
  try {
    // Use the proper sync function from core which applies CANONICAL_CONFIGS
    const { syncAllProviders, clearConfigCache } = await import('@ownpilot/core');

    const result = await syncAllProviders();

    // Clear the provider config cache so new configs are loaded
    clearConfigCache();

    wsGateway.broadcast('data:changed', { entity: 'model_config', action: 'updated' });
    return apiResponse(c, {
      message: `Synced ${result.synced.length} providers from models.dev`,
      stats: {
        providers: result.synced.length,
        failed: result.failed.length,
        total: result.total,
        syncedProviders: result.synced,
        failedProviders: result.failed,
      },
    });
  } catch (error) {
    log.error('Sync apply failed:', error);
    return apiError(
      c,
      { code: ERROR_CODES.SYNC_ERROR, message: 'Sync apply failed: ' + String(error) },
      500
    );
  }
});

/**
 * POST /api/v1/sync/reset - FULL RESET: Delete ALL provider data and resync
 * Deletes:
 * 1. All JSON config files from configs directory
 * 2. All user provider configs from database
 * 3. All user model configs from database
 * 4. All custom providers from database
 * Then syncs fresh from models.dev.
 */
pricingRoutes.post('/sync/reset', async (c) => {
  try {
    const fs = await import('fs');

    // 1. Clear database records first
    const userId = getUserId(c);
    const dbResult = await modelConfigsRepo.fullReset(userId);

    // 2. Delete all JSON config files
    const configsDir = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'core',
      'src',
      'agent',
      'providers',
      'configs'
    );

    const deletedFiles: string[] = [];

    if (fs.existsSync(configsDir)) {
      const files = fs.readdirSync(configsDir).filter((f: string) => f.endsWith('.json'));

      for (const file of files) {
        const providerId = file.replace('.json', '');
        try {
          fs.unlinkSync(path.join(configsDir, file));
          deletedFiles.push(providerId);
        } catch {
          // Ignore delete errors
        }
      }
    }

    // 3. Sync fresh from models.dev
    const { syncAllProviders, clearConfigCache } = await import('@ownpilot/core');
    const syncResult = await syncAllProviders();

    // 4. Clear all caches
    clearConfigCache();

    wsGateway.broadcast('data:changed', { entity: 'model_config', action: 'updated' });
    return apiResponse(c, {
      message: `FULL RESET complete! Cleared ${deletedFiles.length} config files, ${dbResult.providerConfigs} provider overrides, ${dbResult.modelConfigs} model configs, ${dbResult.customProviders} custom providers. Synced ${syncResult.synced.length} providers fresh from models.dev`,
      stats: {
        deletedFiles: deletedFiles.length,
        deletedFilesList: deletedFiles,
        database: {
          providerConfigs: dbResult.providerConfigs,
          modelConfigs: dbResult.modelConfigs,
          customProviders: dbResult.customProviders,
        },
        synced: syncResult.synced.length,
        syncedProviders: syncResult.synced,
        failed: syncResult.failed,
      },
    });
  } catch (error) {
    log.error('Full reset failed:', error);
    return apiError(c, { code: ERROR_CODES.DELETE_FAILED, message: 'Full reset failed' }, 500);
  }
});

/**
 * DELETE /api/v1/sync/provider/:id - Delete a specific provider config and optionally resync
 */
pricingRoutes.delete('/sync/provider/:id', async (c) => {
  const providerId = c.req.param('id');
  const resync = c.req.query('resync') === 'true';

  // Validate providerId to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(providerId)) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid provider ID format' },
      400
    );
  }

  try {
    const fs = await import('fs');

    const configPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'core',
      'src',
      'agent',
      'providers',
      'configs',
      `${providerId}.json`
    );

    if (!fs.existsSync(configPath)) {
      return notFoundError(c, 'Provider config', providerId);
    }

    // Delete the config file
    fs.unlinkSync(configPath);

    const { clearConfigCache, syncProviders } = await import('@ownpilot/core');

    // Optionally resync this provider from models.dev
    let syncResult = null;
    if (resync) {
      syncResult = await syncProviders([providerId]);
    }

    // Clear cache
    clearConfigCache();

    wsGateway.broadcast('data:changed', {
      entity: 'model_provider',
      action: 'deleted',
      id: providerId,
    });
    return apiResponse(c, {
      message: resync
        ? `Deleted and resynced provider '${sanitizeId(providerId)}'`
        : `Deleted provider '${sanitizeId(providerId)}'`,
      data: {
        providerId,
        deleted: true,
        resynced: resync,
        syncResult,
      },
    });
  } catch (error) {
    log.error('Delete provider failed:', error);
    return apiError(
      c,
      { code: ERROR_CODES.DELETE_FAILED, message: 'Delete provider failed: ' + String(error) },
      500
    );
  }
});
