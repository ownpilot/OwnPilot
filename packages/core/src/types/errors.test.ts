import { describe, it, expect } from 'vitest';
import {
  ValidationError,
  NotFoundError,
  PermissionDeniedError,
  AuthenticationError,
  TimeoutError,
  RateLimitError,
  ConflictError,
  InternalError,
  CryptoError,
  PluginError,
  AppError,
  isAppError,
  toAppError,
} from './errors.js';

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------
describe('ValidationError', () => {
  it('has correct code and statusCode', () => {
    const e = new ValidationError('bad input');
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.statusCode).toBe(400);
    expect(e.message).toBe('bad input');
    expect(e.name).toBe('ValidationError');
  });

  it('stores field and errors', () => {
    const e = new ValidationError('invalid', {
      field: 'email',
      errors: [{ path: ['email'], message: 'invalid format' }],
    });
    expect(e.field).toBe('email');
    expect(e.errors).toHaveLength(1);
    expect(e.errors![0]!.message).toBe('invalid format');
  });

  it('toJSON includes field and errors', () => {
    const e = new ValidationError('bad', { field: 'name' });
    const json = e.toJSON();
    expect(json.field).toBe('name');
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('stores cause', () => {
    const cause = new Error('root');
    const e = new ValidationError('bad', { cause });
    expect(e.cause).toBe(cause);
  });
});

// ---------------------------------------------------------------------------
// NotFoundError
// ---------------------------------------------------------------------------
describe('NotFoundError', () => {
  it('has correct code and statusCode', () => {
    const e = new NotFoundError('User', '123');
    expect(e.code).toBe('NOT_FOUND');
    expect(e.statusCode).toBe(404);
    expect(e.message).toBe('User not found: 123');
  });

  it('stores resource and id', () => {
    const e = new NotFoundError('Task', 'abc');
    expect(e.resource).toBe('Task');
    expect(e.id).toBe('abc');
  });

  it('toJSON includes resource and id', () => {
    const e = new NotFoundError('Task', 'abc');
    const json = e.toJSON();
    expect(json.resource).toBe('Task');
    expect(json.id).toBe('abc');
  });
});

// ---------------------------------------------------------------------------
// PermissionDeniedError
// ---------------------------------------------------------------------------
describe('PermissionDeniedError', () => {
  it('has correct code and statusCode', () => {
    const e = new PermissionDeniedError('admin:write');
    expect(e.code).toBe('PERMISSION_DENIED');
    expect(e.statusCode).toBe(403);
    expect(e.message).toBe('Permission denied: admin:write');
  });

  it('stores permission and actor', () => {
    const e = new PermissionDeniedError('delete', { actor: 'user1' });
    expect(e.permission).toBe('delete');
    expect(e.actor).toBe('user1');
  });

  it('toJSON includes permission and actor', () => {
    const e = new PermissionDeniedError('read', { actor: 'bob' });
    const json = e.toJSON();
    expect(json.permission).toBe('read');
    expect(json.actor).toBe('bob');
  });
});

// ---------------------------------------------------------------------------
// AuthenticationError
// ---------------------------------------------------------------------------
describe('AuthenticationError', () => {
  it('has correct code and statusCode', () => {
    const e = new AuthenticationError();
    expect(e.code).toBe('AUTHENTICATION_ERROR');
    expect(e.statusCode).toBe(401);
    expect(e.message).toBe('Authentication required');
  });

  it('accepts custom message', () => {
    const e = new AuthenticationError('Token expired');
    expect(e.message).toBe('Token expired');
  });
});

// ---------------------------------------------------------------------------
// TimeoutError
// ---------------------------------------------------------------------------
describe('TimeoutError', () => {
  it('has correct code and statusCode', () => {
    const e = new TimeoutError('fetch', 5000);
    expect(e.code).toBe('TIMEOUT');
    expect(e.statusCode).toBe(408);
    expect(e.message).toBe('Operation timed out after 5000ms: fetch');
  });

  it('stores operation and timeoutMs', () => {
    const e = new TimeoutError('db query', 3000);
    expect(e.operation).toBe('db query');
    expect(e.timeoutMs).toBe(3000);
  });

  it('toJSON includes operation and timeoutMs', () => {
    const json = new TimeoutError('op', 1000).toJSON();
    expect(json.operation).toBe('op');
    expect(json.timeoutMs).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// RateLimitError
// ---------------------------------------------------------------------------
describe('RateLimitError', () => {
  it('has correct code and statusCode', () => {
    const e = new RateLimitError();
    expect(e.code).toBe('RATE_LIMIT');
    expect(e.statusCode).toBe(429);
    expect(e.message).toBe('Rate limit exceeded');
  });

  it('stores retryAfterMs', () => {
    const e = new RateLimitError('slow down', { retryAfterMs: 60000 });
    expect(e.retryAfterMs).toBe(60000);
  });

  it('toJSON includes retryAfterMs', () => {
    const json = new RateLimitError('x', { retryAfterMs: 100 }).toJSON();
    expect(json.retryAfterMs).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// ConflictError
// ---------------------------------------------------------------------------
describe('ConflictError', () => {
  it('has correct code and statusCode', () => {
    const e = new ConflictError('duplicate key');
    expect(e.code).toBe('CONFLICT');
    expect(e.statusCode).toBe(409);
  });

  it('stores resource', () => {
    const e = new ConflictError('exists', { resource: 'User' });
    expect(e.resource).toBe('User');
  });

  it('toJSON includes resource', () => {
    const json = new ConflictError('dup', { resource: 'Plan' }).toJSON();
    expect(json.resource).toBe('Plan');
  });
});

// ---------------------------------------------------------------------------
// InternalError
// ---------------------------------------------------------------------------
describe('InternalError', () => {
  it('has correct code and statusCode', () => {
    const e = new InternalError();
    expect(e.code).toBe('INTERNAL_ERROR');
    expect(e.statusCode).toBe(500);
    expect(e.message).toBe('An internal error occurred');
  });

  it('accepts custom message', () => {
    const e = new InternalError('crash');
    expect(e.message).toBe('crash');
  });
});

// ---------------------------------------------------------------------------
// CryptoError
// ---------------------------------------------------------------------------
describe('CryptoError', () => {
  it('has correct code and statusCode', () => {
    const e = new CryptoError('encrypt', 'bad key');
    expect(e.code).toBe('CRYPTO_ERROR');
    expect(e.statusCode).toBe(500);
    expect(e.message).toBe('Crypto encrypt failed: bad key');
  });

  it('stores operation', () => {
    const e = new CryptoError('decrypt', 'corrupt');
    expect(e.operation).toBe('decrypt');
  });

  it('toJSON includes operation', () => {
    const json = new CryptoError('derive', 'fail').toJSON();
    expect(json.operation).toBe('derive');
  });
});

// ---------------------------------------------------------------------------
// PluginError
// ---------------------------------------------------------------------------
describe('PluginError', () => {
  it('has correct code and statusCode', () => {
    const e = new PluginError('my-plugin', 'crashed');
    expect(e.code).toBe('PLUGIN_ERROR');
    expect(e.statusCode).toBe(500);
    expect(e.message).toBe('Plugin my-plugin error: crashed');
  });

  it('stores pluginId', () => {
    const e = new PluginError('p1', 'err');
    expect(e.pluginId).toBe('p1');
  });

  it('toJSON includes pluginId', () => {
    const json = new PluginError('p2', 'err').toJSON();
    expect(json.pluginId).toBe('p2');
  });
});

// ---------------------------------------------------------------------------
// isAppError
// ---------------------------------------------------------------------------
describe('isAppError', () => {
  it('returns true for all AppError subclasses', () => {
    expect(isAppError(new ValidationError('x'))).toBe(true);
    expect(isAppError(new NotFoundError('a', 'b'))).toBe(true);
    expect(isAppError(new PermissionDeniedError('x'))).toBe(true);
    expect(isAppError(new AuthenticationError())).toBe(true);
    expect(isAppError(new TimeoutError('x', 1))).toBe(true);
    expect(isAppError(new RateLimitError())).toBe(true);
    expect(isAppError(new ConflictError('x'))).toBe(true);
    expect(isAppError(new InternalError())).toBe(true);
    expect(isAppError(new CryptoError('encrypt', 'x'))).toBe(true);
    expect(isAppError(new PluginError('x', 'y'))).toBe(true);
  });

  it('returns false for non-AppError values', () => {
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError(42)).toBe(false);
    expect(isAppError({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toAppError
// ---------------------------------------------------------------------------
describe('toAppError', () => {
  it('returns AppError as-is', () => {
    const e = new ValidationError('x');
    expect(toAppError(e)).toBe(e);
  });

  it('wraps Error into InternalError', () => {
    const e = new Error('boom');
    const result = toAppError(e);
    expect(result).toBeInstanceOf(InternalError);
    expect(result.message).toBe('boom');
    expect(result.cause).toBe(e);
  });

  it('wraps string into InternalError', () => {
    const result = toAppError('something');
    expect(result).toBeInstanceOf(InternalError);
    expect(result.message).toBe('something');
  });

  it('wraps null into InternalError', () => {
    const result = toAppError(null);
    expect(result).toBeInstanceOf(InternalError);
    expect(result.message).toBe('null');
  });

  it('wraps number into InternalError', () => {
    const result = toAppError(42);
    expect(result).toBeInstanceOf(InternalError);
    expect(result.message).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// toJSON common fields
// ---------------------------------------------------------------------------
describe('toJSON common fields', () => {
  it('includes name, code, message, statusCode, timestamp, stack', () => {
    const e = new ValidationError('test');
    const json = e.toJSON();
    expect(json.name).toBe('ValidationError');
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.message).toBe('test');
    expect(json.statusCode).toBe(400);
    expect(typeof json.timestamp).toBe('string');
    expect(typeof json.stack).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// instanceof checks
// ---------------------------------------------------------------------------
describe('instanceof checks', () => {
  it('all errors are instanceof AppError', () => {
    const errors = [
      new ValidationError('x'),
      new NotFoundError('a', 'b'),
      new PermissionDeniedError('x'),
      new AuthenticationError(),
      new TimeoutError('x', 1),
      new RateLimitError(),
      new ConflictError('x'),
      new InternalError(),
      new CryptoError('encrypt', 'x'),
      new PluginError('x', 'y'),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(AppError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});
