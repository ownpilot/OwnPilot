/**
 * Route Helpers
 *
 * Shared utilities for Hono route handlers.
 */

import { timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiResponse } from '../types/index.js';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';

// Re-export error codes for convenience
export { ERROR_CODES, type ErrorCode };

/**
 * Timing-safe comparison of two strings (e.g. API keys, admin keys).
 * Returns false if either value is undefined/empty or lengths differ.
 */
export function safeKeyCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Extract the authenticated user ID from a Hono context.
 *
 * Returns the authenticated user ID from context (set by auth middleware),
 * or 'default' if no authentication is configured.
 */
export function getUserId(c: Context): string {
  return c.get('userId') ?? 'default';
}

/**
 * Parse pagination parameters from query string with defaults.
 *
 * Replaces repeated pattern:
 *   const limit = parseInt(c.req.query('limit') ?? '20', 10);
 *   const offset = parseInt(c.req.query('offset') ?? '0', 10);
 *
 * @param c - Hono context
 * @param defaultLimit - Default limit value (default: 20)
 * @param maxLimit - Maximum allowed limit (default: 100)
 * @returns Object with limit and offset
 */
export function getPaginationParams(
  c: Context,
  defaultLimit: number = 20,
  maxLimit: number = 100
): { limit: number; offset: number } {
  const limitRaw = parseInt(c.req.query('limit') ?? String(defaultLimit), 10);
  const limit = Math.min(Math.max(1, Number.isNaN(limitRaw) ? defaultLimit : limitRaw), maxLimit);
  const offsetRaw = parseInt(c.req.query('offset') ?? '0', 10);
  const offset = Math.max(0, Number.isNaN(offsetRaw) ? 0 : offsetRaw);

  return { limit, offset };
}

/**
 * Parse integer query parameter with default and optional min/max bounds.
 *
 * Replaces repeated pattern:
 *   const days = parseInt(c.req.query('days') ?? '30', 10);
 *
 * @param c - Hono context
 * @param name - Query parameter name
 * @param defaultValue - Default value if parameter is missing
 * @param min - Minimum allowed value (optional)
 * @param max - Maximum allowed value (optional)
 * @returns Parsed and bounded integer
 */
export function getIntParam(
  c: Context,
  name: string,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  let value = parseInt(c.req.query(name) ?? String(defaultValue), 10);
  if (Number.isNaN(value)) value = defaultValue;

  if (min !== undefined) value = Math.max(min, value);
  if (max !== undefined) value = Math.min(max, value);

  return value;
}

/**
 * Parse optional integer query parameter. Returns undefined if parameter is missing or invalid.
 * If present, applies bounds checking.
 *
 * Replaces repeated pattern:
 *   const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
 *
 * @param c - Hono context
 * @param name - Query parameter name
 * @param min - Minimum allowed value (optional)
 * @param max - Maximum allowed value (optional)
 * @returns Parsed and bounded integer, or undefined if parameter is absent/invalid
 */
export function getOptionalIntParam(
  c: Context,
  name: string,
  min?: number,
  max?: number
): number | undefined {
  const raw = c.req.query(name);
  if (raw === undefined) return undefined;

  let value = parseInt(raw, 10);
  if (Number.isNaN(value)) return undefined;

  if (min !== undefined) value = Math.max(min, value);
  if (max !== undefined) value = Math.min(max, value);

  return value;
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

/**
 * Sanitize a user-provided ID string for safe use in database queries.
 * Strips all characters except word chars and hyphens, then truncates to 100 chars.
 */
export function sanitizeId(id: string): string {
  return id.replace(/[^\w-]/g, '').slice(0, 100);
}

/**
 * Return a standardized validation error response from a Zod safeParse failure.
 *
 * Replaces the repeated pattern:
 *   const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
 *   return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Validation failed: ${issues}` }, 400);
 */
export function zodValidationError(
  c: Context,
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
) {
  const summary = issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
  return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Validation failed: ${summary}` }, 400);
}

/**
 * Return a standardized 404 not-found error response.
 *
 * Replaces the repeated pattern:
 *   return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `X not found: ${sanitizeId(id)}` }, 404);
 */
export function notFoundError(c: Context, resourceType: string, id: string) {
  return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `${resourceType} not found: ${sanitizeId(id)}` }, 404);
}

/**
 * Extract error message from an unknown catch value.
 * Accepts an optional fallback for context-specific defaults.
 */
export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Sanitize user-supplied text for safe interpolation in messages.
 * Strips special characters and truncates to 200 chars.
 */
export function sanitizeText(text: string): string {
  return text.replace(/[^\w\s-]/g, '').slice(0, 200);
}
