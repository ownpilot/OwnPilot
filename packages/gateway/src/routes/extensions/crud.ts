/**
 * Extensions CRUD Routes
 *
 * GET /, POST /, GET /:id, DELETE /:id,
 * POST /:id/enable, POST /:id/disable, POST /:id/reload
 *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */

import { LOCAL_OWNER_ID } from '../../config/defaults.js';
import { Hono, type Context } from 'hono';
import { getExtensionService } from '@ownpilot/core/services';
import { type ExtensionService, ExtensionError } from '../../services/extension/service.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  notFoundError,
  getErrorMessage,
  parseJsonBody,
} from '../helpers.js';
import { wsGateway } from '../../ws/server.js';
import { extensionsRepo } from '../../db/repositories/extensions.js';
import { getEventSystem } from '@ownpilot/core/events';
import { getClientIp } from '../../utils/client-ip.js';

export const crudRoutes = new Hono();

/** Get ExtensionService from registry (cast needed for ExtensionError-specific methods).  *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
const getExtService = () => getExtensionService() as unknown as ExtensionService;

async function uninstallExtension(c: Context) {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  if (!id) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'Extension id is required' },
      400
    );
  }

  const service = getExtService();
  const deleted = await service.uninstall(id, userId);

  if (!deleted) {
    return notFoundError(c, 'Extension', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'extension', action: 'deleted', id });
  // Audit extension uninstall — removes code, triggers, granted
  // permissions, and any DB state the extension owned.
  getEventSystem().emit('audit.extension.uninstalled', 'extensions', {
    ip: getClientIp(c.req),
    extensionId: id,
    userId,
  });
  return apiResponse(c, {
    deleted: true,
    uninstalled: true,
    removed: true,
    message: 'Extension uninstalled and removed successfully.',
  });
}

/**
 * GET / - List extensions
 *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.get('/', async (c) => {
  const userId = LOCAL_OWNER_ID;
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
 * GET /gate-status - Host-gate status for installed extensions.
 * Reports which extensions are active vs gated out (unmet OS/binary/env
 * requirements on this machine) and why.
 *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.get('/gate-status', async (c) => {
  const service = getExtService();
  const status = service.getGateStatus();
  return apiResponse(c, { gates: status, total: status.length });
});

/**
 * POST / - Install from inline manifest
 *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.post('/', async (c) => {
  const userId = LOCAL_OWNER_ID;
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
    const security = (record.manifest as unknown as Record<string, unknown>)?._security ?? null;
    return apiResponse(
      c,
      { package: record, security, message: 'Extension installed successfully.' },
      201
    );
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
 *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.get('/:id', async (c) => {
  const userId = LOCAL_OWNER_ID;
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
 *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.delete('/:id', async (c) => {
  return uninstallExtension(c);
});

/** POST /:id/uninstall - Uninstall package (alias for clients that avoid DELETE)  *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.post('/:id/uninstall', async (c) => uninstallExtension(c));

/** POST /:id/remove - Remove package (alias of uninstall)  *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.post('/:id/remove', async (c) => uninstallExtension(c));

/**
 * PATCH /:id - Update extension metadata (name, description, version)
 *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.patch('/:id', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  const service = getExtService();
  const pkg = service.getById(id);

  if (!pkg || pkg.userId !== userId) {
    return notFoundError(c, 'Extension', id);
  }

  const body =
    (await parseJsonBody<{
      name?: string;
      description?: string;
      version?: string;
    }>(c)) ?? {};

  const updates: Record<string, unknown> = {};
  if (typeof body.name === 'string') updates.name = body.name;
  if (typeof body.description === 'string') updates.description = body.description;
  if (typeof body.version === 'string') updates.version = body.version;

  if (Object.keys(updates).length === 0) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'No valid fields to update' },
      400
    );
  }

  try {
    // Upsert the record with updated metadata fields
    const record = extensionsRepo.getById(id);
    if (!record) return notFoundError(c, 'Extension', id);

    const newName = (updates.name as string | undefined) ?? record.name;
    const newDesc = (updates.description as string | undefined) ?? record.description ?? '';
    const newVersion = (updates.version as string | undefined) ?? record.version;

    await extensionsRepo.upsert({
      id: record.id,
      userId: userId, // [SECURITY] Use authenticated userId, not record.userId (AUTH-003)
      name: newName,
      description: newDesc,
      version: newVersion,
      category: record.category,
      format: record.format,
      icon: record.icon,
      authorName: record.authorName,
      manifest: { ...record.manifest, name: newName, description: newDesc, version: newVersion },
      status: record.status,
      sourcePath: record.sourcePath,
      settings: record.settings,
      toolCount: record.toolCount,
      triggerCount: record.triggerCount,
    });

    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'updated', id });

    const updatedPkg = service.getById(id);
    return apiResponse(c, { package: updatedPkg, message: 'Extension updated.' });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.UPDATE_FAILED,
        message: getErrorMessage(error, 'Failed to update extension'),
      },
      500
    );
  }
});

/**
 * POST /:id/enable - Enable package + triggers
 *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.post('/:id/enable', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  try {
    const service = getExtService();
    const pkg = await service.enable(id, userId);

    if (!pkg) {
      return notFoundError(c, 'Extension', id);
    }

    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'updated', id });
    // Audit extension enable — re-activates tools, triggers, and any
    // granted permissions the extension holds.
    getEventSystem().emit('audit.extension.enabled', 'extensions', {
      ip: getClientIp(c.req),
      extensionId: id,
      userId,
    });
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
 *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.post('/:id/disable', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  try {
    const service = getExtService();
    const pkg = await service.disable(id, userId);

    if (!pkg) {
      return notFoundError(c, 'Extension', id);
    }

    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'updated', id });
    // Audit extension disable — silences tools/triggers but does not
    // remove the extension or its DB state.
    getEventSystem().emit('audit.extension.disabled', 'extensions', {
      ip: getClientIp(c.req),
      extensionId: id,
      userId,
    });
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
 * POST /:id/recover - Recover from error status
 *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.post('/:id/recover', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const id = c.req.param('id');

  try {
    const service = getExtService();
    const pkg = await service.recover(id, userId);

    if (!pkg) {
      return notFoundError(c, 'Extension', id);
    }

    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'updated', id });
    return apiResponse(c, { package: pkg, message: 'Extension recovered from error state.' });
  } catch (error) {
    if (error instanceof ExtensionError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(
      c,
      {
        code: ERROR_CODES.UPDATE_FAILED,
        message: getErrorMessage(error, 'Failed to recover extension'),
      },
      500
    );
  }
});

/**
 * POST /:id/reload - Reload manifest from disk
 *
 * Trust boundary: Extension record updates carry a flexible config payload; the casts below read typed fields off the validated body. The Zod schema is the trust boundary.
 */
crudRoutes.post('/:id/reload', async (c) => {
  const userId = LOCAL_OWNER_ID;
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
