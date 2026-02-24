/**
 * Pagination Middleware
 *
 * Parses `limit` and `offset` query parameters, applies bounds,
 * and stores the result on `c.var.pagination` for downstream handlers.
 *
 * Usage:
 *   // Per-route with custom defaults
 *   app.get('/items', pagination({ defaultLimit: 50, maxLimit: 200 }), handler);
 *
 *   // In handler
 *   const { limit, offset } = c.get('pagination');
 */

import { createMiddleware } from 'hono/factory';
import { MAX_PAGINATION_OFFSET } from '../config/defaults.js';

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginationConfig {
  /** Default limit when query param is missing (default: 20) */
  defaultLimit?: number;
  /** Maximum allowed limit value (default: 100) */
  maxLimit?: number;
  /** Maximum allowed offset value (default: MAX_PAGINATION_OFFSET) */
  maxOffset?: number;
}

/**
 * Create a pagination middleware that parses `limit` and `offset` query
 * parameters, clamps them to the configured bounds, and sets
 * `c.var.pagination` ({ limit, offset }).
 */
export const pagination = (config?: PaginationConfig) => {
  const defaultLimit = config?.defaultLimit ?? 20;
  const maxLimit = config?.maxLimit ?? 100;
  const maxOffset = config?.maxOffset ?? MAX_PAGINATION_OFFSET;

  return createMiddleware(async (c, next) => {
    const limitRaw = parseInt(c.req.query('limit') ?? String(defaultLimit), 10);
    const limit = Math.min(Math.max(1, Number.isNaN(limitRaw) ? defaultLimit : limitRaw), maxLimit);

    const offsetRaw = parseInt(c.req.query('offset') ?? '0', 10);
    const offset = Math.min(Math.max(0, Number.isNaN(offsetRaw) ? 0 : offsetRaw), maxOffset);

    c.set('pagination', { limit, offset } satisfies PaginationParams);
    await next();
  });
};
