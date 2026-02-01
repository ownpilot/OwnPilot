/**
 * Route Helpers
 *
 * Shared utilities for Hono route handlers.
 */

import type { Context } from 'hono';

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
