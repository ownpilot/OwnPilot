/**
 * Config Services Routes
 *
 * Centralized management of schema-driven service configurations.
 * Provides CRUD endpoints for config service definitions and their entries,
 * with automatic secret masking in all responses.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { configServicesRepo } from '../db/repositories/config-services.js';
import type { CreateConfigServiceInput, UpdateConfigServiceInput, CreateConfigEntryInput, UpdateConfigEntryInput } from '../db/repositories/config-services.js';
import type { ApiResponse } from '../types/index.js';
import type { ConfigServiceDefinition, ConfigEntry, ConfigFieldDefinition } from '@ownpilot/core';

export const configServicesRoutes = new Hono();

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Mask a secret value for safe display.
 * If the string is 8+ characters, show first 4 + '...' + last 4.
 * Otherwise return '****'.
 */
function maskSecret(value: unknown): string {
  if (typeof value === 'string' && value.length >= 8) {
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

  const response: ApiResponse = {
    success: true,
    data: {
      services: services.map(sanitizeService),
      count: services.length,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * GET /stats - Service statistics
 */
configServicesRoutes.get('/stats', async (c) => {
  const stats = await configServicesRepo.getStats();

  const response: ApiResponse = {
    success: true,
    data: stats,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * GET /categories - List unique categories
 */
configServicesRoutes.get('/categories', async (c) => {
  const services = configServicesRepo.list();
  const categories = [...new Set(services.map(s => s.category))].sort();

  const response: ApiResponse = {
    success: true,
    data: { categories },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * GET /needed - Services needed by tools but not yet configured
 */
configServicesRoutes.get('/needed', async (c) => {
  const services = configServicesRepo.list();
  const needed = services.filter(
    s => s.requiredBy.length > 0 && !configServicesRepo.isAvailable(s.name),
  );

  const response: ApiResponse = {
    success: true,
    data: {
      services: needed.map(sanitizeService),
      count: needed.length,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * GET /:name - Get single service with its entries
 */
configServicesRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  const service = configServicesRepo.getByName(name);
  if (!service) {
    throw new HTTPException(404, { message: `Config service not found: ${name}` });
  }

  const response: ApiResponse = {
    success: true,
    data: sanitizeService(service),
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * POST / - Create new config service
 */
configServicesRoutes.post('/', async (c) => {
  const body = await c.req.json<CreateConfigServiceInput>();

  if (!body.name || !body.displayName || !body.category) {
    throw new HTTPException(400, {
      message: 'Missing required fields: name, displayName, category',
    });
  }

  // Validate name format
  if (!/^[a-z][a-z0-9_]*$/.test(body.name)) {
    throw new HTTPException(400, {
      message: 'Invalid service name. Must start with lowercase letter and contain only lowercase letters, numbers, and underscores.',
    });
  }

  // Check for duplicate
  const existing = configServicesRepo.getByName(body.name);
  if (existing) {
    throw new HTTPException(409, {
      message: `Config service '${body.name}' already exists`,
    });
  }

  const service = await configServicesRepo.create(body);

  const response: ApiResponse = {
    success: true,
    data: sanitizeService(service),
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response, 201);
});

/**
 * PUT /:name - Update service metadata
 */
configServicesRoutes.put('/:name', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json<UpdateConfigServiceInput>();

  const updated = await configServicesRepo.update(name, body);
  if (!updated) {
    throw new HTTPException(404, { message: `Config service not found: ${name}` });
  }

  const response: ApiResponse = {
    success: true,
    data: sanitizeService(updated),
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * DELETE /:name - Delete service and all its entries
 */
configServicesRoutes.delete('/:name', async (c) => {
  const name = c.req.param('name');

  const deleted = await configServicesRepo.delete(name);
  if (!deleted) {
    throw new HTTPException(404, { message: `Config service not found: ${name}` });
  }

  const response: ApiResponse = {
    success: true,
    data: { deleted: true },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
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
    throw new HTTPException(404, { message: `Config service not found: ${name}` });
  }

  const entries = configServicesRepo.getEntries(name);

  const response: ApiResponse = {
    success: true,
    data: {
      entries: entries.map(e => sanitizeEntry(e, service.configSchema)),
      count: entries.length,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * POST /:name/entries - Create new entry for a service
 */
configServicesRoutes.post('/:name/entries', async (c) => {
  const name = c.req.param('name');
  const service = configServicesRepo.getByName(name);
  if (!service) {
    throw new HTTPException(404, { message: `Config service not found: ${name}` });
  }

  const body = await c.req.json<CreateConfigEntryInput>();
  const entry = await configServicesRepo.createEntry(name, body);

  const response: ApiResponse = {
    success: true,
    data: sanitizeEntry(entry, service.configSchema),
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response, 201);
});

/**
 * PUT /:name/entries/:entryId - Update an entry
 */
configServicesRoutes.put('/:name/entries/:entryId', async (c) => {
  const name = c.req.param('name');
  const entryId = c.req.param('entryId');

  const service = configServicesRepo.getByName(name);
  if (!service) {
    throw new HTTPException(404, { message: `Config service not found: ${name}` });
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
    throw new HTTPException(404, { message: `Config entry not found: ${entryId}` });
  }

  const response: ApiResponse = {
    success: true,
    data: sanitizeEntry(updated, service.configSchema),
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * DELETE /:name/entries/:entryId - Delete an entry
 */
configServicesRoutes.delete('/:name/entries/:entryId', async (c) => {
  const name = c.req.param('name');
  const entryId = c.req.param('entryId');

  const service = configServicesRepo.getByName(name);
  if (!service) {
    throw new HTTPException(404, { message: `Config service not found: ${name}` });
  }

  const deleted = await configServicesRepo.deleteEntry(entryId);
  if (!deleted) {
    throw new HTTPException(404, { message: `Config entry not found: ${entryId}` });
  }

  const response: ApiResponse = {
    success: true,
    data: { deleted: true },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * PUT /:name/entries/:entryId/default - Set entry as default
 */
configServicesRoutes.put('/:name/entries/:entryId/default', async (c) => {
  const name = c.req.param('name');
  const entryId = c.req.param('entryId');

  const service = configServicesRepo.getByName(name);
  if (!service) {
    throw new HTTPException(404, { message: `Config service not found: ${name}` });
  }

  // Verify the entry exists for this service
  const entries = configServicesRepo.getEntries(name);
  const entry = entries.find(e => e.id === entryId);
  if (!entry) {
    throw new HTTPException(404, { message: `Config entry not found: ${entryId}` });
  }

  await configServicesRepo.setDefaultEntry(name, entryId);

  // Fetch the updated entry from cache
  const updatedEntries = configServicesRepo.getEntries(name);
  const updatedEntry = updatedEntries.find(e => e.id === entryId);

  const response: ApiResponse = {
    success: true,
    data: updatedEntry
      ? sanitizeEntry(updatedEntry, service.configSchema)
      : { id: entryId, isDefault: true },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});
