/**
 * Global error handler middleware
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiResponse } from '../types/index.js';

/**
 * Error codes
 */
export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  BAD_REQUEST: 'BAD_REQUEST',
} as const;

/**
 * Map HTTP status to error code
 */
function statusToErrorCode(status: number): string {
  switch (status) {
    case 400:
      return ErrorCodes.BAD_REQUEST;
    case 401:
      return ErrorCodes.UNAUTHORIZED;
    case 403:
      return ErrorCodes.FORBIDDEN;
    case 404:
      return ErrorCodes.NOT_FOUND;
    case 422:
      return ErrorCodes.VALIDATION_ERROR;
    case 429:
      return ErrorCodes.RATE_LIMITED;
    case 503:
      return ErrorCodes.SERVICE_UNAVAILABLE;
    default:
      return ErrorCodes.INTERNAL_ERROR;
  }
}

/**
 * Global error handler
 */
export function errorHandler(err: Error, c: Context): Response {
  const requestId = c.get('requestId') ?? 'unknown';

  // Handle HTTP exceptions (from Hono)
  if (err instanceof HTTPException) {
    const response: ApiResponse = {
      success: false,
      error: {
        code: statusToErrorCode(err.status),
        message: err.message,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    return c.json(response, err.status);
  }

  // Handle JSON parse errors (malformed request body)
  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    const response: ApiResponse = {
      success: false,
      error: {
        code: ErrorCodes.BAD_REQUEST,
        message: 'Invalid JSON in request body',
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };
    return c.json(response, 400);
  }

  // Handle validation errors thrown as plain Errors (legacy path)
  if (err.message?.startsWith('Validation failed:')) {
    const response: ApiResponse = {
      success: false,
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: err.message,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };
    return c.json(response, 400);
  }

  // Log unexpected errors
  console.error(`[${requestId}] Unexpected error:`, err);

  // Return generic error response
  const response: ApiResponse = {
    success: false,
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      details:
        process.env.NODE_ENV === 'development'
          ? { message: err.message, stack: err.stack }
          : undefined,
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response, 500);
}

/**
 * Not found handler
 */
export function notFoundHandler(c: Context): Response {
  const requestId = c.get('requestId') ?? 'unknown';

  const response: ApiResponse = {
    success: false,
    error: {
      code: ErrorCodes.NOT_FOUND,
      message: `Route not found: ${c.req.method} ${c.req.path}`,
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response, 404);
}
