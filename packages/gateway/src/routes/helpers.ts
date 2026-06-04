/**
 * Route Helpers
 *
 * Shared utilities for Hono route handlers.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiResponse } from '../types/index.js';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';
import { getLog } from '../services/log.js';

const log = getLog('Helpers');

// Re-export error codes and log for test access
export { ERROR_CODES, type ErrorCode, log };

// Pure helpers live in utils/common.ts so non-route consumers don't have to
// reach back into the routes/ layer. Re-exported here for backward compat.
import {
  safeKeyCompare,
  sanitizeProviderName,
  clamp,
  sanitizeId,
  getErrorMessage,
  truncate,
  maskSecret,
  sanitizeText,
} from '../utils/common.js';
export {
  safeKeyCompare,
  sanitizeProviderName,
  clamp,
  sanitizeId,
  getErrorMessage,
  truncate,
  maskSecret,
  sanitizeText,
};

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
/**
 * H-D11: hard cap on OFFSET to bound worst-case scan cost on hot tables
 * (messages, channel_messages, request_logs, heartbeat_log, costs, ...).
 * Deep pagination with `?offset=1000000` forces the planner to discard a
 * million rows per request, so we clamp at 10000 (≥page 100 at limit=100,
 * page 500 at limit=20). Routes that genuinely need deeper paging should
 * switch to keyset/cursor pagination.
 */
const MAX_PAGINATION_OFFSET = 10000;

export function getPaginationParams(
  c: Context,
  defaultLimit: number = 20,
  maxLimit: number = 100
): { limit: number; offset: number } {
  const limitRaw = parseInt(c.req.query('limit') ?? String(defaultLimit), 10);
  const limit = Math.min(Math.max(1, Number.isNaN(limitRaw) ? defaultLimit : limitRaw), maxLimit);
  const offsetRaw = parseInt(c.req.query('offset') ?? '0', 10);
  const offset = Math.min(
    MAX_PAGINATION_OFFSET,
    Math.max(0, Number.isNaN(offsetRaw) ? 0 : offsetRaw)
  );

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
/**
 * Whether to redact 5xx error messages in user-facing responses.
 * On by default in production; opt out with `EXPOSE_INTERNAL_ERRORS=true`
 * (only do this in dev/staging — raw error messages routinely leak SQL,
 * paths, internal IDs, and provider URLs).
 */
const REDACT_5XX =
  process.env.NODE_ENV === 'production' && process.env.EXPOSE_INTERNAL_ERRORS !== 'true';

export function apiError(
  c: Context,
  error: string | { code: ErrorCode | string; message: string },
  status: ContentfulStatusCode = 400
) {
  let errorObj = typeof error === 'string' ? { code: ERROR_CODES.ERROR, message: error } : error;

  // EXPOSE-001 mitigation: redact raw 5xx error messages in production.
  // Route-level try/catch blocks routinely return `getErrorMessage(err)` which
  // leaks pg SQL text, file paths, hostnames, and provider error bodies.
  // Keep the original detail in the server logs (operators can correlate via
  // requestId) but never ship it to the client outside dev.
  if (REDACT_5XX && status >= 500 && status < 600) {
    const requestId = c.get('requestId') ?? 'unknown';
    // Surface the detail to operators but not the client.

    log.warn(`[apiError] redacted 5xx detail (requestId=${requestId}): ${errorObj.message}`);
    errorObj = {
      code: errorObj.code ?? ERROR_CODES.INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }

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
 * Return a standardized validation error response from a Zod safeParse failure.
 *
 * Replaces the repeated pattern:
 *   const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
 *   return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Validation failed: ${issues}` }, 400);
 */
export function zodValidationError(
  c: Context,
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>
) {
  const summary = issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  return apiError(
    c,
    { code: ERROR_CODES.VALIDATION_ERROR, message: `Validation failed: ${summary}` },
    400
  );
}

/**
 * Return a standardized 404 not-found error response.
 *
 * Replaces the repeated pattern:
 *   return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `X not found: ${sanitizeId(id)}` }, 404);
 */
export function notFoundError(c: Context, resourceType: string, id: string) {
  return apiError(
    c,
    { code: ERROR_CODES.NOT_FOUND, message: `${resourceType} not found: ${sanitizeId(id)}` },
    404
  );
}

/**
 * Validate a query parameter against an allowed set of string values.
 * Returns the value narrowed to the union type if valid, otherwise undefined.
 *
 * @example
 *   const period = validateQueryEnum(c.req.query('period'), ['day', 'week', 'month', 'year'] as const) ?? 'month';
 */
export function validateQueryEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Validate Content-Type header for JSON requests.
 * Returns true if Content-Type is application/json or application/*+json.
 */
function isJsonContentType(c: Context): boolean {
  const contentType = c.req.header('content-type');
  if (!contentType) return false;
  // Match application/json or application/vnd.api+json, etc.
  return (
    contentType.startsWith('application/json') ||
    (contentType.includes('application/') && contentType.includes('+json'))
  );
}

/**
 * Require JSON Content-Type header, returning 415 if not present.
 * Use this in POST/PUT/PATCH handlers that require JSON bodies.
 */
function requireJsonContent(c: Context): Response | null {
  if (!isJsonContentType(c)) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_CONTENT_TYPE, message: 'Content-Type must be application/json' },
      415
    );
  }
  return null;
}

/**
 * Parse and optionally validate JSON request body.
 * Returns an error response if parsing fails.
 *
 * @param c - Hono context
 * @param validator - Optional Zod schema or validation function
 * @returns Object with validated data, or calls c.json() with error and returns null
 *
 * @example
 * // Simple usage
 * const body = await parseJsonBody(c);
 * if (!body) return; // Error response already sent
 *
 * // With Zod validation
 * const body = await parseJsonBody(c, CreateAgentSchema);
 * if (!body) return; // Error response already sent
 *
 * // Manual validation
 * const body = await parseJsonBody(c, (data) => {
 *   if (!data.name) throw new Error('name required');
 *   return data;
 * });
 */
export async function parseJsonBody<T = unknown>(
  c: Context,
  validator?: (data: unknown) => T
): Promise<T | null> {
  // Validate Content-Type first
  const contentTypeError = requireJsonContent(c);
  if (contentTypeError) {
    return contentTypeError && null;
  }

  try {
    const data = await c.req.json();

    if (validator) {
      try {
        return validator(data);
      } catch (validationError) {
        const message =
          validationError instanceof Error ? validationError.message : 'Validation failed';
        return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message }, 400) && null;
      }
    }

    return data as T;
  } catch {
    return (
      apiError(
        c,
        { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON in request body' },
        400
      ) && null
    );
  }
}
