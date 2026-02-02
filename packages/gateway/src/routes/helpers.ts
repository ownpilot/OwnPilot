/**
 * Route Helpers
 *
 * Shared utilities for Hono route handlers.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiResponse } from '../types/index.js';

/**
 * Extract the authenticated user ID from a Hono context.
 *
 * Resolution order:
 *   1. Auth middleware (c.get('userId')) — set by JWT or API-key auth
 *   2. Query parameter (?userId=...)   — for unauthenticated/testing usage
 *   3. Fallback: 'default'
 */
export function getUserId(c: Context): string {
  return c.get('userId') ?? c.req.query('userId') ?? 'default';
}

/**
 * Build and return a success API response with standard meta envelope.
 *
 * Replaces the repeated pattern:
 *   const response: ApiResponse = { success: true, data, meta: { requestId, timestamp } };
 *   return c.json(response);
 */
export function apiResponse<T>(c: Context, data: T, status?: ContentfulStatusCode) {
  const response: ApiResponse<T> = {
    success: true,
    data,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };
  return status ? c.json(response, status) : c.json(response);
}
