/**
 * Config Services Routes
 *
 * Centralized management of schema-driven service configurations.
 * Provides CRUD endpoints for config service definitions and their entries,
 * with automatic secret masking in all responses.
 */

import { Hono } from 'hono';
import { configServicesRepo } from '../db/repositories/config-services.js';
import type {
  CreateConfigServiceInput,
  UpdateConfigServiceInput,
  CreateConfigEntryInput,
  UpdateConfigEntryInput,
} from '../db/repositories/config-services.js';
import type {
  ConfigServiceDefinition,
  ConfigEntry,
  ConfigFieldDefinition,
  ConfigServiceRequiredBy,
} from '@ownpilot/core';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  sanitizeId,
  notFoundError,
  maskSecret,
  getErrorMessage,
} from './helpers.js';
import { wsGateway } from '../ws/server.js';
import {
  normalizeAndValidateEntryData,
  validateRequiredFields,
} from '../services/config-entry-validation.js';
import {
  validateBody,
  createConfigServiceSchema,
  updateConfigServiceSchema,
  createConfigEntrySchema,
  updateConfigEntrySchema,
} from '../middleware/validation.js';

export const configServicesRoutes = new Hono();

// =============================================================================
// HELPERS
// =============================================================================

function normalizeRequiredBy(
  requiredBy: Array<string | ConfigServiceRequiredBy> | undefined
): ConfigServiceRequiredBy[] | undefined {
  return requiredBy?.map((dep) =>
    typeof dep === 'string' ? { type: 'tool', name: dep, id: dep } : dep
  );
}

/**
 * Detect if a value looks like it was masked by maskSecret().
 * Matches patterns like "abcd...wxyz" or "****".
 */
function isMaskedValue(value: string): boolean {
  if (value === '****') return true;
  // Matches: 4 chars + "..." + 4 chars (total 11 chars)
  if (/^.{4}\.\.\..{4}$/.test(value)) return true;
  return false;
}

/**
 * Sanitize an entry's data by masking fields with type='secret' in the schema.
 * Returns a new object with masked values and metadata about secret fields.
 */
function sanitizeEntry(entry: ConfigEntry, schema: ConfigFieldDefinition[]) {
  const secretFields = schema.filter((f) => f.type === 'secret').map((f) => f.name);

  const maskedData: Record<string, unknown> = { ...entry.data };
  for (const field of secretFields) {
    if (maskedData[field] !== undefined && maskedData[field] !== null && maskedData[field] !== '') {
      maskedData[field] = maskSecret(maskedData[field]);
    }
  }

  return {
    ...entry,
    data: maskedData,
    hasSecrets: secretFields.length > 0,
    secretFields,
  };
}

/**
 * Sanitize a service definition for response.
 * Includes schema, entry count, configuration status, and sanitized entries.
 */
function sanitizeService(service: ConfigServiceDefinition) {
  const entries = configServicesRepo.getEntries(service.name);
  const configuredEntries = entries.filter((e) => {
    if (e.isActive === false) return false;
    const data = e.data;
    return Object.keys(data).some((k) => {
      const v = data[k];
      return v !== null && v !== undefined && v !== '';
    });
  });

  return {
    ...service,
    entryCount: entries.length,
    activeEntryCount: entries.filter((e) => e.isActive !== false).length,
    configuredEntryCount: configuredEntries.length,
    isConfigured: configuredEntries.length > 0,
    entries: entries.map((e) => sanitizeEntry(e, service.configSchema)),
  };
}

// =============================================================================
// SERVICE ROUTES
// =============================================================================

/**
 * GET / - List all config services
 */
configServicesRoutes.get('/', async (c) => {
  const category = c.req.query('category');
  const services = configServicesRepo.list(category ?? undefined);

  return apiResponse(c, {
    services: services.map(sanitizeService),
    count: services.length,
  });
});

/**
 * GET /stats - Service statistics
 */
configServicesRoutes.get('/stats', async (c) => {
  const stats = await configServicesRepo.getStats();

  return apiResponse(c, stats);
});

/**
 * GET /categories - List unique categories
 */
configServicesRoutes.get('/categories', async (c) => {
  const services = configServicesRepo.list();
  const categories = [...new Set(services.map((s) => s.category))].sort();

  return apiResponse(c, { categories });
});

/**
 * GET /needed - Services needed by tools but not yet configured
 */
configServicesRoutes.get('/needed', async (c) => {
  const services = configServicesRepo.list();
  const needed = services.filter(
    (s) => s.requiredBy.length > 0 && !configServicesRepo.isAvailable(s.name)
  );

  return apiResponse(c, {
    services: needed.map(sanitizeService),
    count: needed.length,
  });
});

/**
 * GET /:name - Get single service with its entries
 */
configServicesRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  const service = configServicesRepo.getByName(name);
  if (!service) {
    return notFoundError(c, 'Config service', name);
  }

  return apiResponse(c, sanitizeService(service));
});

/**
 * POST / - Create new config service
 */
configServicesRoutes.post('/', async (c) => {
  try {
    const body = validateBody(createConfigServiceSchema, await c.req.json()) as Omit<
      CreateConfigServiceInput,
      'requiredBy'
    > & {
      requiredBy?: Array<string | ConfigServiceRequiredBy>;
    };
    const normalizedBody: CreateConfigServiceInput = {
      ...body,
      requiredBy: normalizeRequiredBy(body.requiredBy),
    };

    // Check for duplicate
    const existing = configServicesRepo.getByName(normalizedBody.name);
    if (existing) {
      return apiError(
        c,
        {
          code: ERROR_CODES.ALREADY_EXISTS,
          message: `Config service '${sanitizeId(normalizedBody.name)}' already exists`,
        },
        409
      );
    }

    const service = await configServicesRepo.create(normalizedBody);

    wsGateway.broadcast('data:changed', {
      entity: 'config_service',
      action: 'created',
      id: service.name,
    });

    return apiResponse(c, sanitizeService(service), 201);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    throw err;
  }
});

/**
 * PUT /:name - Update service metadata
 */
configServicesRoutes.put('/:name', async (c) => {
  const name = c.req.param('name');
  let body: UpdateConfigServiceInput;
  try {
    body = validateBody(updateConfigServiceSchema, await c.req.json());
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: getErrorMessage(e) }, 400);
  }

  const updated = await configServicesRepo.update(name, body);
  if (!updated) {
    return notFoundError(c, 'Config service', name);
  }

  wsGateway.broadcast('data:changed', { entity: 'config_service', action: 'updated', id: name });

  return apiResponse(c, sanitizeService(updated));
});

/**
 * DELETE /:name - Delete service and all its entries
 */
configServicesRoutes.delete('/:name', async (c) => {
  const name = c.req.param('name');

  const deleted = await configServicesRepo.delete(name);
  if (!deleted) {
    return notFoundError(c, 'Config service', name);
  }

  wsGateway.broadcast('data:changed', { entity: 'config_service', action: 'deleted', id: name });

  return apiResponse(c, { deleted: true });
});

// =============================================================================
// ENTRY SUB-ROUTES
// =============================================================================

/**
 * GET /:name/entries - List entries for a service
 */
configServicesRoutes.get('/:name/entries', async (c) => {
  const name = c.req.param('name');
  const service = configServicesRepo.getByName(name);
  if (!service) {
    return notFoundError(c, 'Config service', name);
  }

  const entries = configServicesRepo.getEntries(name);

  return apiResponse(c, {
    entries: entries.map((e) => sanitizeEntry(e, service.configSchema)),
    count: entries.length,
  });
});

/**
 * POST /:name/entries - Create new entry for a service
 */
configServicesRoutes.post('/:name/entries', async (c) => {
  const name = c.req.param('name');
  const service = configServicesRepo.getByName(name);
  if (!service) {
    return notFoundError(c, 'Config service', name);
  }

  let body: CreateConfigEntryInput;
  try {
    body = validateBody(createConfigEntrySchema, await c.req.json());
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: getErrorMessage(e) }, 400);
  }

  const existingEntries = configServicesRepo.getEntries(name);
  if (!service.multiEntry && existingEntries.length > 0) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'This service supports only one config entry',
      },
      400
    );
  }

  const willBeDefault = body.isDefault === true || existingEntries.length === 0;
  if (willBeDefault && body.isActive === false) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Default config entries must stay active',
      },
      400
    );
  }

  // Validate required fields
  if (service.configSchema.length > 0) {
    const normalized = normalizeAndValidateEntryData(body.data ?? {}, service.configSchema);
    if (normalized.errors.length > 0) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Invalid fields: ${normalized.errors.join(', ')}`,
        },
        400
      );
    }
    body.data = normalized.data;

    const missing = validateRequiredFields(body.data, service.configSchema);
    if (missing.length > 0) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Missing required fields: ${missing.join(', ')}`,
        },
        400
      );
    }
  }

  const entry = await configServicesRepo.createEntry(name, body);

  wsGateway.broadcast('data:changed', { entity: 'config_service', action: 'updated', id: name });

  return apiResponse(c, sanitizeEntry(entry, service.configSchema), 201);
});

/**
 * PUT /:name/entries/:entryId - Update an entry
 */
configServicesRoutes.put('/:name/entries/:entryId', async (c) => {
  const name = c.req.param('name');
  const entryId = c.req.param('entryId');

  const service = configServicesRepo.getByName(name);
  if (!service) {
    return notFoundError(c, 'Config service', name);
  }

  let body: UpdateConfigEntryInput;
  try {
    body = validateBody(updateConfigEntrySchema, await c.req.json());
  } catch (e) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: getErrorMessage(e) }, 400);
  }

  const existingEntry = configServicesRepo.getEntries(name).find((e) => e.id === entryId);
  if (!existingEntry) {
    return notFoundError(c, 'Config entry', entryId);
  }
  if (
    (body.isDefault === true && (body.isActive === false || existingEntry.isActive === false)) ||
    (body.isActive === false && (body.isDefault === true || existingEntry.isDefault))
  ) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Default config entries must stay active',
      },
      400
    );
  }

  // Protect against masked secret values being written back to DB.
  // If a secret field's value looks like a masked string, preserve the original.
  if (body.data) {
    const secretFields = service.configSchema.filter((f) => f.type === 'secret').map((f) => f.name);

    if (secretFields.length > 0) {
      for (const field of secretFields) {
        const incoming = body.data[field];
        if (typeof incoming === 'string' && isMaskedValue(incoming)) {
          // Restore original value — the client sent back a masked string
          body.data[field] = existingEntry.data[field];
        }
      }
    }
  }

  // Validate required fields (merge with existing data to allow partial updates)
  if (body.data && service.configSchema.length > 0) {
    const normalized = normalizeAndValidateEntryData(body.data, service.configSchema);
    if (normalized.errors.length > 0) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Invalid fields: ${normalized.errors.join(', ')}`,
        },
        400
      );
    }
    const mergedData = { ...existingEntry.data, ...normalized.data };
    const missing = validateRequiredFields(mergedData, service.configSchema);
    if (missing.length > 0) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Missing required fields: ${missing.join(', ')}`,
        },
        400
      );
    }
    body.data = mergedData;
  }

  const updated = await configServicesRepo.updateEntry(entryId, body);
  if (!updated) {
    return notFoundError(c, 'Config entry', entryId);
  }

  wsGateway.broadcast('data:changed', { entity: 'config_service', action: 'updated', id: name });

  return apiResponse(c, sanitizeEntry(updated, service.configSchema));
});

/**
 * DELETE /:name/entries/:entryId - Delete an entry
 */
configServicesRoutes.delete('/:name/entries/:entryId', async (c) => {
  const name = c.req.param('name');
  const entryId = c.req.param('entryId');

  const service = configServicesRepo.getByName(name);
  if (!service) {
    return notFoundError(c, 'Config service', name);
  }

  const entries = configServicesRepo.getEntries(name);
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) {
    return notFoundError(c, 'Config entry', entryId);
  }

  const hasActiveSibling = entries.some((e) => e.id !== entryId && e.isActive !== false);
  if (entry.isDefault && hasActiveSibling) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Set another active entry as default before deleting this one',
      },
      400
    );
  }

  const deleted = await configServicesRepo.deleteEntry(entryId);
  if (!deleted) {
    return notFoundError(c, 'Config entry', entryId);
  }

  wsGateway.broadcast('data:changed', { entity: 'config_service', action: 'updated', id: name });

  return apiResponse(c, { deleted: true });
});

/**
 * PUT /:name/entries/:entryId/default - Set entry as default
 */
configServicesRoutes.put('/:name/entries/:entryId/default', async (c) => {
  const name = c.req.param('name');
  const entryId = c.req.param('entryId');

  const service = configServicesRepo.getByName(name);
  if (!service) {
    return notFoundError(c, 'Config service', name);
  }

  // Verify the entry exists for this service
  const entries = configServicesRepo.getEntries(name);
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) {
    return notFoundError(c, 'Config entry', entryId);
  }
  if (entry.isActive === false) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Inactive config entries cannot be set as default',
      },
      400
    );
  }

  const didSetDefault = await configServicesRepo.setDefaultEntry(name, entryId);
  if (!didSetDefault) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Config entry could not be set as default',
      },
      400
    );
  }

  wsGateway.broadcast('data:changed', { entity: 'config_service', action: 'updated', id: name });

  // Fetch the updated entry from cache
  const updatedEntries = configServicesRepo.getEntries(name);
  const updatedEntry = updatedEntries.find((e) => e.id === entryId);

  return apiResponse(
    c,
    updatedEntry
      ? sanitizeEntry(updatedEntry, service.configSchema)
      : { id: entryId, isDefault: true }
  );
});
