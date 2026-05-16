/**
 * Skills Routes
 *
 * REST API for skill discovery (npm search), npm-based installation,
 * permission management, and update checking.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { getUserId, apiResponse, apiError, ERROR_CODES, getIntParam } from './helpers.js';
import { getErrorMessage, getServiceRegistry, Services } from '@ownpilot/core';
import { getNpmInstaller } from '../services/skill-npm-installer.js';
import {
  getAllPermissions,
  getPermissionDescription,
  getPermissionSensitivity,
} from '../services/extension-permissions.js';
import type { SkillPermission } from '../services/extension-types.js';
import { extensionsRepo } from '../db/repositories/extensions.js';
import { validateBody } from '../middleware/validation.js';

const installNpmSchema = z.object({
  packageName: z.string().min(1).max(500),
});

const grantPermissionsSchema = z.object({
  grantedPermissions: z.array(z.string().max(200)),
});

export const skillsRoutes = new Hono();

// ============================================================================
// Skill Discovery (npm search)
// ============================================================================

skillsRoutes.get('/search', async (c) => {
  try {
    const q = c.req.query('q') ?? '';
    const limit = getIntParam(c, 'limit', 20, 1, 50);

    const installer = getNpmInstaller();
    const results = await installer.search(q, limit);
    return apiResponse(c, results);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ============================================================================
// Featured skills (top packages from npm — empty query)
// ============================================================================

skillsRoutes.get('/featured', async (c) => {
  try {
    const limit = getIntParam(c, 'limit', 20, 1, 50);
    const installer = getNpmInstaller();
    const results = await installer.search('', limit);
    return apiResponse(c, results);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ============================================================================
// npm Install
// ============================================================================

skillsRoutes.post('/install-npm', async (c) => {
  try {
    const userId = getUserId(c);
    const body = validateBody(installNpmSchema, await c.req.json());
    const { packageName } = body;

    const installer = getNpmInstaller();
    const service = getServiceRegistry().get(Services.Extension) as {
      install: (path: string, userId: string) => Promise<{ id: string }>;
    };

    const result = await installer.install(packageName, userId, service);

    if (!result.success) {
      return apiError(
        c,
        { code: ERROR_CODES.INTERNAL_ERROR, message: result.error ?? 'Installation failed' },
        500
      );
    }

    return apiResponse(c, result, 201);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ============================================================================
// npm Package Info
// ============================================================================

skillsRoutes.get('/npm/:name', async (c) => {
  try {
    const name = c.req.param('name');
    const installer = getNpmInstaller();
    const info = await installer.getPackageInfo(name);
    return apiResponse(c, info);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ============================================================================
// Update Check
// ============================================================================

skillsRoutes.post('/check-updates', async (c) => {
  try {
    const userId = getUserId(c);
    const allExtensions = extensionsRepo.getAll().filter((e) => e.userId === userId);
    const installer = getNpmInstaller();

    const updates: { id: string; name: string; current: string; latest: string }[] = [];

    for (const ext of allExtensions) {
      const settings = (ext.settings ?? {}) as Record<string, unknown>;
      const npmPkg = ext.manifest.npm_package ?? settings.npmPackage;
      const npmVersion = ext.manifest.npm_version ?? settings.npmVersion;
      if (typeof npmPkg === 'string' && typeof npmVersion === 'string') {
        const check = await installer.checkForUpdate(npmPkg, npmVersion);
        if (check.hasUpdate) {
          updates.push({
            id: ext.id,
            name: ext.name,
            current: npmVersion,
            latest: check.latestVersion,
          });
        }
      }
    }

    return apiResponse(c, { updates });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ============================================================================
// Permission Management
// ============================================================================

skillsRoutes.get('/permissions', (_c) => {
  const perms = getAllPermissions().map((p) => ({
    name: p,
    description: getPermissionDescription(p),
    sensitivity: getPermissionSensitivity(p),
  }));
  return apiResponse(_c, { permissions: perms });
});

skillsRoutes.get('/permissions/:id', (c) => {
  try {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const ext = extensionsRepo.getById(id);

    if (!ext || ext.userId !== userId) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Extension ${id} not found` },
        404
      );
    }

    const declaredPermissions = ext.manifest.permissions ?? { required: [], optional: [] };

    return apiResponse(c, {
      declared: declaredPermissions,
      granted: ext.grantedPermissions ?? [],
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

skillsRoutes.post('/permissions/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const body = validateBody(grantPermissionsSchema, await c.req.json());
    const grantedPermissions = body.grantedPermissions as SkillPermission[];

    const ext = extensionsRepo.getById(id);
    if (!ext || ext.userId !== userId) {
      return apiError(
        c,
        { code: ERROR_CODES.NOT_FOUND, message: `Extension ${id} not found` },
        404
      );
    }

    // Store granted permissions in dedicated DB column
    await extensionsRepo.updatePermissions(id, grantedPermissions);

    return apiResponse(c, { grantedPermissions });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
