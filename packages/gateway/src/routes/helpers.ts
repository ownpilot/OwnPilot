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
