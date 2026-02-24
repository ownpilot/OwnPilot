/**
 * CRUD Route Factory
 *
 * Generates standard Hono CRUD routes from a declarative configuration.
 * Eliminates boilerplate across 35+ route files by encapsulating the
 * common patterns: userId extraction, service lookup, pagination,
 * validation, broadcasting, and error handling.
 *
 * Usage:
 *   import { createCrudRoutes } from './crud-factory.js';
 *   export const widgetsRoutes = createCrudRoutes({
 *     entity: 'widget',
 *     serviceToken: Services.Widget,
 *     schemas: { create: createWidgetSchema, update: updateWidgetSchema },
 *   });
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ZodType } from 'zod';
import { getServiceRegistry, type ServiceToken } from '@ownpilot/core';
import {
  getUserId,
  apiResponse,
  apiError,
  getErrorMessage,
  notFoundError,
  ERROR_CODES,
  getPaginationParams,
} from './helpers.js';
import { wsGateway } from '../ws/server.js';
import type { ServerEvents } from '../ws/types.js';

// =============================================================================
// Types
// =============================================================================

/** Valid entity names for data:changed broadcasts. */
export type DataChangedEntity = ServerEvents['data:changed']['entity'];

/** Available CRUD method names. */
export type CrudMethod = 'list' | 'get' | 'create' | 'update' | 'delete';

/** Configuration for the CRUD route factory. */
export interface CrudRouteConfig<TService = unknown> {
  /** Entity name used for error messages, broadcast events, and response keys. e.g. 'heartbeat' */
  entity: DataChangedEntity;

  /** ServiceToken to resolve the service from ServiceRegistry. */
  serviceToken: ServiceToken<TService>;

  /** Which CRUD methods to generate. Defaults to all five. */
  methods?: CrudMethod[];

  /** Optional Zod schemas for create and update validation. */
  schemas?: {
    create?: ZodType;
    update?: ZodType;
  };

  /** Whether to broadcast changes via wsGateway. Default: true. */
  broadcast?: boolean;

  /** Pagination defaults for the list endpoint. */
  pagination?: {
    defaultLimit?: number; // default 20
    maxLimit?: number; // default 100
  };

  /**
   * Override service method names if they differ from conventions.
   *
   * Defaults:
   *   list   -> 'list' (called as service.list(userId, { limit, offset }))
   *   get    -> 'get'  (called as service.get(userId, id))
   *   create -> 'create' (called as service.create(userId, body))
   *   update -> 'update' (called as service.update(userId, id, body))
   *   delete -> 'delete' (called as service.delete(userId, id))
   */
  serviceMethods?: {
    list?: string;
    get?: string;
    create?: string;
    update?: string;
    delete?: string;
  };

  /**
   * Optional hooks for customizing route behavior.
   * Each hook receives the Hono context and can transform data.
   */
  hooks?: {
    /** Transform list results before returning. Receives (items, context). */
    afterList?: (items: unknown[], c: Context) => unknown;
    /** Transform a single item before returning from GET /:id. */
    afterGet?: (item: unknown, c: Context) => unknown;
    /** Transform the body before passing to the create service method. */
    beforeCreate?: (body: unknown, c: Context) => unknown;
    /** Transform the body before passing to the update service method. */
    beforeUpdate?: (body: unknown, c: Context) => unknown;
  };
}

// =============================================================================
// Helpers
// =============================================================================

/** Capitalize the first letter of a string. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Parse and validate the request body as JSON. Returns null on failure. */
async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/**
 * Validate a body against a Zod schema.
 * Returns { data } on success, { error } on failure.
 */
function validateWithSchema(
  schema: ZodType,
  body: unknown
): { data: unknown; error?: undefined } | { data?: undefined; error: string } {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { error: `Validation failed: ${issues}` };
  }
  return { data: result.data };
}

/**
 * Call a method on the service object by name.
 * Uses unknown indexing since we work with arbitrary service shapes.
 */
function callServiceMethod(service: unknown, method: string, ...args: unknown[]): unknown {
  const fn = (service as Record<string, (...a: unknown[]) => unknown>)[method];
  if (typeof fn !== 'function') {
    throw new Error(`Service method '${method}' not found`);
  }
  return fn.call(service, ...args);
}

/** Broadcast a data change event via WebSocket gateway. */
function broadcastChange(
  entity: DataChangedEntity,
  action: 'created' | 'updated' | 'deleted',
  id: string
): void {
  wsGateway.broadcast('data:changed', { entity, action, id });
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a Hono app with standard CRUD routes based on the provided configuration.
 *
 * Generated routes:
 *   GET /        - List with pagination (limit, offset query params)
 *   GET /:id     - Get by ID
 *   POST /       - Create with optional Zod validation
 *   PATCH /:id   - Update with optional Zod validation
 *   DELETE /:id  - Delete by ID
 */
export function createCrudRoutes<TService = unknown>(config: CrudRouteConfig<TService>): Hono {
  const app = new Hono();

  const {
    entity,
    serviceToken,
    methods = ['list', 'get', 'create', 'update', 'delete'],
    schemas = {},
    broadcast = true,
    pagination = {},
    serviceMethods = {},
    hooks = {},
  } = config;

  const defaultLimit = pagination.defaultLimit ?? 20;
  const maxLimit = pagination.maxLimit ?? 100;

  // Resolve service method names with defaults
  const listMethod = serviceMethods.list ?? 'list';
  const getMethod = serviceMethods.get ?? 'get';
  const createMethod = serviceMethods.create ?? 'create';
  const updateMethod = serviceMethods.update ?? 'update';
  const deleteMethod = serviceMethods.delete ?? 'delete';

  const entityCapitalized = capitalize(entity);

  /** Get the service from the registry. */
  const getService = () => getServiceRegistry().get(serviceToken);

  // -------------------------------------------------------------------------
  // GET / - List
  // -------------------------------------------------------------------------
  if (methods.includes('list')) {
    app.get('/', async (c) => {
      try {
        const userId = getUserId(c);
        const { limit, offset } = getPaginationParams(c, defaultLimit, maxLimit);
        const service = getService();

        const items = (await callServiceMethod(service, listMethod, userId, {
          limit,
          offset,
        })) as unknown[];

        if (hooks.afterList) {
          const transformed = hooks.afterList(items, c);
          return apiResponse(c, transformed);
        }

        return apiResponse(c, {
          [entity + 's']: items,
          total: items.length,
          limit,
          offset,
        });
      } catch (error) {
        return apiError(
          c,
          {
            code: ERROR_CODES.LIST_FAILED,
            message: getErrorMessage(error, `Failed to list ${entity}s`),
          },
          500
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // GET /:id - Get by ID
  // -------------------------------------------------------------------------
  if (methods.includes('get')) {
    app.get('/:id', async (c) => {
      try {
        const userId = getUserId(c);
        const id = c.req.param('id');
        const service = getService();

        const item = await callServiceMethod(service, getMethod, userId, id);

        if (!item) {
          return notFoundError(c, entityCapitalized, id);
        }

        if (hooks.afterGet) {
          const transformed = hooks.afterGet(item, c);
          return apiResponse(c, transformed);
        }

        return apiResponse(c, { [entity]: item });
      } catch (error) {
        return apiError(
          c,
          {
            code: ERROR_CODES.FETCH_FAILED,
            message: getErrorMessage(error, `Failed to get ${entity}`),
          },
          500
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // POST / - Create
  // -------------------------------------------------------------------------
  if (methods.includes('create')) {
    app.post('/', async (c) => {
      const body = await parseJsonBody(c);

      if (!body) {
        return apiError(
          c,
          { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' },
          400
        );
      }

      // Schema validation
      let validatedBody: unknown = body;
      if (schemas.create) {
        const validation = validateWithSchema(schemas.create, body);
        if (validation.error) {
          return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: validation.error }, 400);
        }
        validatedBody = validation.data;
      }

      // Pre-create hook
      if (hooks.beforeCreate) {
        validatedBody = hooks.beforeCreate(validatedBody, c);
      }

      try {
        const userId = getUserId(c);
        const service = getService();
        const created = await callServiceMethod(service, createMethod, userId, validatedBody);

        const createdId =
          created && typeof created === 'object' && 'id' in created
            ? (created as { id: string }).id
            : undefined;

        if (broadcast && createdId) {
          broadcastChange(entity, 'created', createdId);
        }

        return apiResponse(
          c,
          { [entity]: created, message: `${entityCapitalized} created successfully.` },
          201
        );
      } catch (error) {
        return apiError(
          c,
          {
            code: ERROR_CODES.CREATE_FAILED,
            message: getErrorMessage(error, `Failed to create ${entity}`),
          },
          500
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // PATCH /:id - Update
  // -------------------------------------------------------------------------
  if (methods.includes('update')) {
    app.patch('/:id', async (c) => {
      const body = await parseJsonBody(c);

      if (!body) {
        return apiError(
          c,
          { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' },
          400
        );
      }

      // Schema validation
      let validatedBody: unknown = body;
      if (schemas.update) {
        const validation = validateWithSchema(schemas.update, body);
        if (validation.error) {
          return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: validation.error }, 400);
        }
        validatedBody = validation.data;
      }

      // Pre-update hook
      if (hooks.beforeUpdate) {
        validatedBody = hooks.beforeUpdate(validatedBody, c);
      }

      try {
        const userId = getUserId(c);
        const id = c.req.param('id');
        const service = getService();
        const updated = await callServiceMethod(service, updateMethod, userId, id, validatedBody);

        if (!updated) {
          return notFoundError(c, entityCapitalized, id);
        }

        if (broadcast) {
          broadcastChange(entity, 'updated', id);
        }

        return apiResponse(c, {
          [entity]: updated,
          message: `${entityCapitalized} updated successfully.`,
        });
      } catch (error) {
        return apiError(
          c,
          {
            code: ERROR_CODES.UPDATE_FAILED,
            message: getErrorMessage(error, `Failed to update ${entity}`),
          },
          500
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // DELETE /:id - Delete
  // -------------------------------------------------------------------------
  if (methods.includes('delete')) {
    app.delete('/:id', async (c) => {
      try {
        const userId = getUserId(c);
        const id = c.req.param('id');
        const service = getService();
        const deleted = await callServiceMethod(service, deleteMethod, userId, id);

        if (!deleted) {
          return notFoundError(c, entityCapitalized, id);
        }

        if (broadcast) {
          broadcastChange(entity, 'deleted', id);
        }

        return apiResponse(c, { message: `${entityCapitalized} deleted successfully.` });
      } catch (error) {
        return apiError(
          c,
          {
            code: ERROR_CODES.DELETE_FAILED,
            message: getErrorMessage(error, `Failed to delete ${entity}`),
          },
          500
        );
      }
    });
  }

  return app;
}
