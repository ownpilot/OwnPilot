/**
 * Config Services Routes
 *
 * Centralized management of schema-driven service configurations.
 * Provides CRUD endpoints for config service definitions and their entries,
 * with automatic secret masking in all responses.
 */

import { Hono } from 'hono';
import { configServicesRepo } from '../db/repositories/config-services.js';
import type { CreateConfigServiceInput, UpdateConfigServiceInput, CreateConfigEntryInput, UpdateConfigEntryInput } from '../db/repositories/config-services.js';
import type { ConfigServiceDefinition, ConfigEntry, ConfigFieldDefinition } from '@ownpilot/core';
import { apiResponse, apiError, ERROR_CODES } from './helpers.js'

/** Sanitize user-supplied IDs for safe interpolation in error messages */
const sanitizeId = (id: string) => id.replace(/[^\w-]/g, '').slice(0, 100);

export const configServicesRoutes = new Hono();

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Mask a secret value for safe display.
 * If the string is 12+ characters, show first 4 + '...' + last 4
 * (guarantees at least 4 hidden characters).
 * Otherwise return '****'.
 */
function maskSecret(value: unknown): string {
  if (typeof value === 'string' && value.length >= 12) {
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }
  return '****';
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
function sanitizeEntry(
  entry: ConfigEntry,
  schema: ConfigFieldDefinition[],
) {
  const secretFields = schema
    .filter(f => f.type === 'secret')
    .map(f => f.name);

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
  const isConfigured = entries.some(e => {
    const data = e.data;
    return Object.keys(data).some(k => {
      const v = data[k];
      return v !== null && v !== undefined && v !== '';
    });
  });

  return {
    ...service,
    entryCount: entries.length,
    isConfigured,
    entries: entries.map(e => sanitizeEntry(e, service.configSchema)),
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
  const categories = [...new Set(services.map(s => s.category))].sort();

  return apiResponse(c, { categories });
});

/**
 * GET /needed - Services needed by tools but not yet configured
 */
configServicesRoutes.get('/needed', async (c) => {
  const services = configServicesRepo.list();
  const needed = services.filter(
    s => s.requiredBy.length > 0 && !configServicesRepo.isAvailable(s.name),
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Config service not found: ${name}` }, 404);
  }

  return apiResponse(c, sanitizeService(service));
});

/**
 * POST / - Create new config service
 */
configServicesRoutes.post('/', async (c) => {
  const body = await c.req.json<CreateConfigServiceInput>();

  if (!body.name || !body.displayName || !body.category) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing required fields: name, displayName, category' }, 400);
  }

  // Validate name format
  if (!/^[a-z][a-z0-9_]*$/.test(body.name)) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid service name. Must start with lowercase letter and contain only lowercase letters, numbers, and underscores.' }, 400);
  }

  // Check for duplicate
  const existing = configServicesRepo.getByName(body.name);
  if (existing) {
    return apiError(c, { code: ERROR_CODES.ALREADY_EXISTS, message: `Config service '${sanitizeId(body.name)}' already exists` }, 409);
  }

  const service = await configServicesRepo.create(body);

  return apiResponse(c, sanitizeService(service), 201);
});

/**
 * PUT /:name - Update service metadata
 */
configServicesRoutes.put('/:name', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json<UpdateConfigServiceInput>();

  const updated = await configServicesRepo.update(name, body);
  if (!updated) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Config service not found: ${name}` }, 404);
  }

  return apiResponse(c, sanitizeService(updated));
});

/**
 * DELETE /:name - Delete service and all its entries
 */
configServicesRoutes.delete('/:name', async (c) => {
  const name = c.req.param('name');

  const deleted = await configServicesRepo.delete(name);
  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Config service not found: ${name}` }, 404);
  }

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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Config service not found: ${name}` }, 404);
  }

  const entries = configServicesRepo.getEntries(name);

  return apiResponse(c, {
      entries: entries.map(e => sanitizeEntry(e, service.configSchema)),
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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Config service not found: ${name}` }, 404);
  }

  const body = await c.req.json<CreateConfigEntryInput>();
  const entry = await configServicesRepo.createEntry(name, body);

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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Config service not found: ${name}` }, 404);
  }

  const body = await c.req.json<UpdateConfigEntryInput>();

  // Protect against masked secret values being written back to DB.
  // If a secret field's value looks like a masked string, preserve the original.
  if (body.data) {
    const secretFields = service.configSchema
      .filter(f => f.type === 'secret')
      .map(f => f.name);

    if (secretFields.length > 0) {
      const existingEntry = configServicesRepo.getEntries(name).find(e => e.id === entryId);
      if (existingEntry) {
        for (const field of secretFields) {
          const incoming = body.data[field];
          if (typeof incoming === 'string' && isMaskedValue(incoming)) {
            // Restore original value — the client sent back a masked string
            body.data[field] = existingEntry.data[field];
          }
        }
      }
    }
  }

  const updated = await configServicesRepo.updateEntry(entryId, body);
  if (!updated) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Config entry not found: ${sanitizeId(entryId)}` }, 404);
  }

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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Config service not found: ${name}` }, 404);
  }

  const deleted = await configServicesRepo.deleteEntry(entryId);
  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Config entry not found: ${sanitizeId(entryId)}` }, 404);
  }

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
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Config service not found: ${name}` }, 404);
  }

  // Verify the entry exists for this service
  const entries = configServicesRepo.getEntries(name);
  const entry = entries.find(e => e.id === entryId);
  if (!entry) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Config entry not found: ${sanitizeId(entryId)}` }, 404);
  }

  await configServicesRepo.setDefaultEntry(name, entryId);

  // Fetch the updated entry from cache
  const updatedEntries = configServicesRepo.getEntries(name);
  const updatedEntry = updatedEntries.find(e => e.id === entryId);

  return apiResponse(c, updatedEntry
      ? sanitizeEntry(updatedEntry, service.configSchema)
      : { id: entryId, isDefault: true });
});
