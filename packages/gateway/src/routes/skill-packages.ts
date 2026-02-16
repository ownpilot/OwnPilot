/**
 * Skill Packages Routes
 *
 * API for installing, managing, and inspecting skill packages.
 */

import { Hono } from 'hono';
import { getSkillPackageService, SkillPackageError } from '../services/skill-package-service.js';
import { getUserId, apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';

export const skillPackagesRoutes = new Hono();

// ============================================================================
// Routes
// ============================================================================

/**
 * GET / - List skill packages
 */
skillPackagesRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  const category = c.req.query('category');

  const service = getSkillPackageService();
  let packages = service.getAll();

  if (status) {
    packages = packages.filter(p => p.status === status);
  }
  if (category) {
    packages = packages.filter(p => p.category === category);
  }

  return apiResponse(c, { packages, total: packages.length });
});

/**
 * POST / - Install from inline manifest
 */
skillPackagesRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body || !(body as { manifest?: unknown }).manifest) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'manifest field is required' }, 400);
  }

  try {
    const service = getSkillPackageService();
    const record = await service.installFromManifest((body as { manifest: unknown }).manifest as never, userId);
    return apiResponse(c, { package: record, message: 'Skill package installed successfully.' }, 201);
  } catch (error) {
    if (error instanceof SkillPackageError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(c, { code: ERROR_CODES.CREATE_FAILED, message: getErrorMessage(error, 'Failed to install skill package') }, 500);
  }
});

/**
 * POST /install - Install from file path
 */
skillPackagesRoutes.post('/install', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body || typeof (body as { path?: string }).path !== 'string') {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'path field is required (string)' }, 400);
  }

  try {
    const service = getSkillPackageService();
    const record = await service.install((body as { path: string }).path, userId);
    return apiResponse(c, { package: record, message: 'Skill package installed successfully.' }, 201);
  } catch (error) {
    if (error instanceof SkillPackageError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(c, { code: ERROR_CODES.CREATE_FAILED, message: getErrorMessage(error, 'Failed to install skill package') }, 500);
  }
});

/**
 * POST /scan - Scan directory for packages
 */
skillPackagesRoutes.post('/scan', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => ({})) as { directory?: string };

  try {
    const service = getSkillPackageService();
    const result = await service.scanDirectory(body.directory, userId);
    return apiResponse(c, result);
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: getErrorMessage(error, 'Failed to scan directory') }, 500);
  }
});

/**
 * GET /:id - Get package details
 */
skillPackagesRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');

  const service = getSkillPackageService();
  const pkg = service.getById(id);

  if (!pkg) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Skill package not found' }, 404);
  }

  return apiResponse(c, { package: pkg });
});

/**
 * DELETE /:id - Uninstall package
 */
skillPackagesRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getSkillPackageService();
  const deleted = await service.uninstall(id, userId);

  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Skill package not found' }, 404);
  }

  return apiResponse(c, { message: 'Skill package uninstalled successfully.' });
});

/**
 * POST /:id/enable - Enable package + triggers
 */
skillPackagesRoutes.post('/:id/enable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const service = getSkillPackageService();
    const pkg = await service.enable(id, userId);

    if (!pkg) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Skill package not found' }, 404);
    }

    return apiResponse(c, { package: pkg, message: 'Skill package enabled.' });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: getErrorMessage(error, 'Failed to enable skill package') }, 500);
  }
});

/**
 * POST /:id/disable - Disable package + triggers
 */
skillPackagesRoutes.post('/:id/disable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const service = getSkillPackageService();
    const pkg = await service.disable(id, userId);

    if (!pkg) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Skill package not found' }, 404);
    }

    return apiResponse(c, { package: pkg, message: 'Skill package disabled.' });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: getErrorMessage(error, 'Failed to disable skill package') }, 500);
  }
});

/**
 * POST /:id/reload - Reload manifest from disk
 */
skillPackagesRoutes.post('/:id/reload', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const service = getSkillPackageService();
    const pkg = await service.reload(id, userId);

    if (!pkg) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Skill package not found' }, 404);
    }

    return apiResponse(c, { package: pkg, message: 'Skill package reloaded.' });
  } catch (error) {
    if (error instanceof SkillPackageError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: getErrorMessage(error, 'Failed to reload skill package') }, 500);
  }
});
