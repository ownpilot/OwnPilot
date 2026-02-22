/**
 * Structured error classes for OwnPilot
 * All errors are serializable and include metadata
 */

/**
 * Base application error with structured metadata
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  readonly timestamp: Date = new Date();
  override readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.cause = options?.cause;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    };
  }
}

/**
 * Validation error - invalid input data
 */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const;
  readonly statusCode = 400;
  readonly field?: string;
  readonly errors?: ReadonlyArray<{ path: string[]; message: string }>;

  constructor(
    message: string,
    options?: {
      field?: string;
      errors?: ReadonlyArray<{ path: string[]; message: string }>;
      cause?: unknown;
    }
  ) {
    super(message, options);
    this.field = options?.field;
    this.errors = options?.errors;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      field: this.field,
      errors: this.errors,
    };
  }
}

/**
 * Not found error - resource doesn't exist
 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
  readonly statusCode = 404;
  readonly resource: string;
  readonly id: string;

  constructor(resource: string, id: string, options?: { cause?: unknown }) {
    super(`${resource} not found: ${id}`, options);
    this.resource = resource;
    this.id = id;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      resource: this.resource,
      id: this.id,
    };
  }
}

/**
 * Permission denied error - access not allowed
 */
export class PermissionDeniedError extends AppError {
  readonly code = 'PERMISSION_DENIED' as const;
  readonly statusCode = 403;
  readonly permission: string;
  readonly actor?: string;

  constructor(permission: string, options?: { actor?: string; cause?: unknown }) {
    super(`Permission denied: ${permission}`, options);
    this.permission = permission;
    this.actor = options?.actor;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      permission: this.permission,
      actor: this.actor,
    };
  }
}

/**
 * Authentication error - not authenticated
 */
export class AuthenticationError extends AppError {
  readonly code = 'AUTHENTICATION_ERROR' as const;
  readonly statusCode = 401;

  constructor(message: string = 'Authentication required', options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * Timeout error - operation took too long
 */
export class TimeoutError extends AppError {
  readonly code = 'TIMEOUT' as const;
  readonly statusCode = 408;
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number, options?: { cause?: unknown }) {
    super(`Operation timed out after ${timeoutMs}ms: ${operation}`, options);
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      operation: this.operation,
      timeoutMs: this.timeoutMs,
    };
  }
}

/**
 * Rate limit error - too many requests
 */
export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMIT' as const;
  readonly statusCode = 429;
  readonly retryAfterMs?: number;

  constructor(
    message: string = 'Rate limit exceeded',
    options?: { retryAfterMs?: number; cause?: unknown }
  ) {
    super(message, options);
    this.retryAfterMs = options?.retryAfterMs;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      retryAfterMs: this.retryAfterMs,
    };
  }
}

/**
 * Conflict error - resource already exists or state conflict
 */
export class ConflictError extends AppError {
  readonly code = 'CONFLICT' as const;
  readonly statusCode = 409;
  readonly resource?: string;

  constructor(message: string, options?: { resource?: string; cause?: unknown }) {
    super(message, options);
    this.resource = options?.resource;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      resource: this.resource,
    };
  }
}

/**
 * Internal error - unexpected server error
 */
export class InternalError extends AppError {
  readonly code = 'INTERNAL_ERROR' as const;
  readonly statusCode = 500;

  constructor(message: string = 'An internal error occurred', options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * Crypto error - encryption/decryption failure
 */
export class CryptoError extends AppError {
  readonly code = 'CRYPTO_ERROR' as const;
  readonly statusCode = 500;
  readonly operation: 'encrypt' | 'decrypt' | 'derive' | 'verify';

  constructor(
    operation: 'encrypt' | 'decrypt' | 'derive' | 'verify',
    message: string,
    options?: { cause?: unknown }
  ) {
    super(`Crypto ${operation} failed: ${message}`, options);
    this.operation = operation;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      operation: this.operation,
    };
  }
}

/**
 * Plugin error - plugin execution failure
 */
export class PluginError extends AppError {
  readonly code = 'PLUGIN_ERROR' as const;
  readonly statusCode = 500;
  readonly pluginId: string;

  constructor(pluginId: string, message: string, options?: { cause?: unknown }) {
    super(`Plugin ${pluginId} error: ${message}`, options);
    this.pluginId = pluginId;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      pluginId: this.pluginId,
    };
  }
}

/**
 * Check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Convert unknown error to AppError
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return new InternalError(error.message, { cause: error });
  }
  return new InternalError(String(error));
}
