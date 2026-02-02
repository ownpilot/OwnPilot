/**
 * Route Helpers
 *
 * Shared utilities for Hono route handlers.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiResponse } from '../types/index.js';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';

// Re-export error codes for convenience
export { ERROR_CODES, type ErrorCode };

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

/**
 * Build and return an error API response with standard meta envelope.
 *
 * Replaces inconsistent error patterns with a standardized format:
 *   return c.json({ success: false, error: { code, message } }, status);
 *
 * @param c - Hono context
 * @param error - Error string (uses ERROR_CODES.ERROR) or error object with code and message
 * @param status - HTTP status code (default 400)
 *
 * @example
 * // Simple string error
 * return apiError(c, 'Invalid input', 400);
 *
 * // Structured error with code
 * return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Resource not found' }, 404);
 */
export function apiError(
  c: Context,
  error: string | { code: ErrorCode | string; message: string },
  status: ContentfulStatusCode = 400
) {
  const errorObj = typeof error === 'string'
    ? { code: ERROR_CODES.ERROR, message: error }
    : error;
  const response = {
    success: false,
    error: errorObj,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };
  return c.json(response, status);
}
