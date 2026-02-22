/**
 * Global error handler middleware
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiResponse } from '../types/index.js';
import { ERROR_CODES } from '../routes/helpers.js';
import { getLog } from '../services/log.js';

const log = getLog('ErrorHandler');

/**
 * Map HTTP status to error code
 */
function statusToErrorCode(status: number): string {
  switch (status) {
    case 400:
      return ERROR_CODES.BAD_REQUEST;
    case 401:
      return ERROR_CODES.UNAUTHORIZED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 422:
      return ERROR_CODES.VALIDATION_ERROR;
    case 429:
      return ERROR_CODES.RATE_LIMITED;
    case 503:
      return ERROR_CODES.SERVICE_UNAVAILABLE;
    default:
      return ERROR_CODES.INTERNAL_ERROR;
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
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Invalid JSON in request body',
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };
    return c.json(response, 400);
  }

  // Handle validation errors thrown as plain Errors (from validateBody)
  if (err.message?.startsWith('Validation failed:')) {
    const response: ApiResponse = {
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
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
  log.error(`[${requestId}] Unexpected error:`, err);

  // Return generic error response
  const response: ApiResponse = {
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      // Only expose error message in development — never stack traces
      details: process.env.NODE_ENV === 'development' ? { message: err.message } : undefined,
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
      code: ERROR_CODES.NOT_FOUND,
      message: `Route not found: ${c.req.method} ${c.req.path.replace(/[^\w/.\-~%]/g, '')}`,
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response, 404);
}
