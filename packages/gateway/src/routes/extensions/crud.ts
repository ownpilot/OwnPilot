/**
 * Extensions CRUD Routes
 *
 * GET /, POST /, GET /:id, DELETE /:id,
 * POST /:id/enable, POST /:id/disable, POST /:id/reload
 */

import { Hono } from 'hono';
import { getServiceRegistry, Services } from '@ownpilot/core';
import { type ExtensionService, ExtensionError } from '../../services/extension-service.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  notFoundError,
  getErrorMessage,
  parseJsonBody,
} from '../helpers.js';
import { wsGateway } from '../../ws/server.js';

export const crudRoutes = new Hono();

/** Get ExtensionService from registry (cast needed for ExtensionError-specific methods). */
const getExtService = () => getServiceRegistry().get(Services.Extension) as ExtensionService;

/**
 * GET / - List extensions
 */
crudRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const status = c.req.query('status');
  const category = c.req.query('category');
  const format = c.req.query('format'); // 'ownpilot' | 'agentskills'

  const service = getExtService();
  let packages = service.getAll().filter((p) => p.userId === userId);

  if (format) {
    packages = packages.filter((p) => (p.manifest.format ?? 'ownpilot') === format);
  }
  if (status) {
    packages = packages.filter((p) => p.status === status);
  }
  if (category) {
    packages = packages.filter((p) => p.category === category);
  }

  return apiResponse(c, { packages, total: packages.length });
});

/**
 * POST / - Install from inline manifest
 */
crudRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await parseJsonBody(c);

  if (!body || !(body as { manifest?: unknown }).manifest) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'manifest field is required' },
      400
    );
  }

  try {
    const service = getExtService();
    const record = await service.installFromManifest(
      (body as { manifest: unknown }).manifest as never,
      userId
    );
    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'created', id: record.id });
    return apiResponse(c, { package: record, message: 'Extension installed successfully.' }, 201);
  } catch (error) {
    if (error instanceof ExtensionError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(
      c,
      {
        code: ERROR_CODES.CREATE_FAILED,
        message: getErrorMessage(error, 'Failed to install extension'),
      },
      500
    );
  }
});

/**
 * GET /:id - Get package details
 */
crudRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getExtService();
  const pkg = service.getById(id);

  if (!pkg || pkg.userId !== userId) {
    return notFoundError(c, 'Extension', id);
  }

  return apiResponse(c, { package: pkg });
});

/**
 * DELETE /:id - Uninstall package
 */
crudRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getExtService();
  const deleted = await service.uninstall(id, userId);

  if (!deleted) {
    return notFoundError(c, 'Extension', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'extension', action: 'deleted', id });
  return apiResponse(c, { message: 'Extension uninstalled successfully.' });
});

/**
 * POST /:id/enable - Enable package + triggers
 */
crudRoutes.post('/:id/enable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const service = getExtService();
    const pkg = await service.enable(id, userId);

    if (!pkg) {
      return notFoundError(c, 'Extension', id);
    }

    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'updated', id });
    return apiResponse(c, { package: pkg, message: 'Extension enabled.' });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.UPDATE_FAILED,
        message: getErrorMessage(error, 'Failed to enable extension'),
      },
      500
    );
  }
});

/**
 * POST /:id/disable - Disable package + triggers
 */
crudRoutes.post('/:id/disable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const service = getExtService();
    const pkg = await service.disable(id, userId);

    if (!pkg) {
      return notFoundError(c, 'Extension', id);
    }

    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'updated', id });
    return apiResponse(c, { package: pkg, message: 'Extension disabled.' });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.UPDATE_FAILED,
        message: getErrorMessage(error, 'Failed to disable extension'),
      },
      500
    );
  }
});

/**
 * POST /:id/reload - Reload manifest from disk
 */
crudRoutes.post('/:id/reload', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const service = getExtService();
    const pkg = await service.reload(id, userId);

    if (!pkg) {
      return notFoundError(c, 'Extension', id);
    }

    return apiResponse(c, { package: pkg, message: 'Extension reloaded.' });
  } catch (error) {
    if (error instanceof ExtensionError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(
      c,
      {
        code: ERROR_CODES.UPDATE_FAILED,
        message: getErrorMessage(error, 'Failed to reload extension'),
      },
      500
    );
  }
});
