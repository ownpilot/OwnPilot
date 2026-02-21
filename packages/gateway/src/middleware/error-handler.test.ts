import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../routes/helpers.js', () => ({
  ERROR_CODES: {
    BAD_REQUEST: 'BAD_REQUEST',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    RATE_LIMITED: 'RATE_LIMITED',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  },
}));

const { errorHandler, notFoundHandler } = await import('./error-handler.js');

function mockContext(overrides: Record<string, unknown> = {}) {
  const jsonFn = vi.fn((body: unknown, status?: number) => {
    return new Response(JSON.stringify(body), { status: status ?? 200 });
  });
  return {
    get: vi.fn((key: string) => {
      if (key === 'requestId') return overrides.requestId ?? 'req_123';
      return undefined;
    }),
    json: jsonFn,
    req: {
      method: (overrides.method as string) ?? 'GET',
      path: (overrides.path as string) ?? '/api/v1/test',
    },
  } as any;
}

/** Extract the response body and status from c.json mock */
function getJsonCall(c: any): { body: any; status: number } {
  const call = c.json.mock.calls[0]!;
  return { body: call[0], status: call[1] ?? 200 };
}

describe('errorHandler', () => {
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
  });

  it('handles HTTPException 400 as BAD_REQUEST', () => {
    const c = mockContext();
    errorHandler(new HTTPException(400, { message: 'Bad input' }), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('Bad input');
  });

  it('handles HTTPException 401 as UNAUTHORIZED', () => {
    const c = mockContext();
    errorHandler(new HTTPException(401, { message: 'Not authenticated' }), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('handles HTTPException 403 as FORBIDDEN', () => {
    const c = mockContext();
    errorHandler(new HTTPException(403, { message: 'Access denied' }), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('handles HTTPException 404 as NOT_FOUND', () => {
    const c = mockContext();
    errorHandler(new HTTPException(404, { message: 'Missing' }), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('handles HTTPException 422 as VALIDATION_ERROR', () => {
    const c = mockContext();
    errorHandler(new HTTPException(422, { message: 'Unprocessable' }), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(422);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('handles HTTPException 429 as RATE_LIMITED', () => {
    const c = mockContext();
    errorHandler(new HTTPException(429, { message: 'Too fast' }), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(429);
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('handles HTTPException 503 as SERVICE_UNAVAILABLE', () => {
    const c = mockContext();
    errorHandler(new HTTPException(503, { message: 'Down' }), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(503);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('handles HTTPException 500 as INTERNAL_ERROR', () => {
    const c = mockContext();
    errorHandler(new HTTPException(500, { message: 'Server broke' }), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('handles HTTPException with unmapped status as INTERNAL_ERROR', () => {
    const c = mockContext();
    errorHandler(new HTTPException(418, { message: 'I am a teapot' }), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(418);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('handles JSON SyntaxError as 400 BAD_REQUEST', () => {
    const c = mockContext();
    errorHandler(new SyntaxError('Unexpected token in JSON at position 0'), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('Invalid JSON in request body');
  });

  it('handles regular SyntaxError without JSON as 500 INTERNAL_ERROR', () => {
    const c = mockContext();
    errorHandler(new SyntaxError('Unexpected identifier'), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('handles validation error as 400 VALIDATION_ERROR', () => {
    const c = mockContext();
    errorHandler(new Error('Validation failed: name is required'), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Validation failed');
  });

  it('handles generic error as 500 INTERNAL_ERROR', () => {
    const c = mockContext();
    errorHandler(new Error('Something broke'), c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred');
  });

  it('includes error details in development mode', () => {
    process.env.NODE_ENV = 'development';
    const c = mockContext();
    errorHandler(new Error('Debug me'), c);
    const { body } = getJsonCall(c);
    expect(body.error.details).toBeDefined();
    expect(body.error.details.message).toBe('Debug me');
  });

  it('hides error details in production mode', () => {
    process.env.NODE_ENV = 'production';
    const c = mockContext();
    errorHandler(new Error('Secret internal detail'), c);
    const { body } = getJsonCall(c);
    expect(body.error.details).toBeUndefined();
    expect(body.error.message).not.toContain('Secret internal detail');
  });

  it('sets success to false on all error responses', () => {
    const c = mockContext();
    errorHandler(new Error('fail'), c);
    const { body } = getJsonCall(c);
    expect(body.success).toBe(false);
  });

  it('includes requestId and timestamp in meta', () => {
    const c = mockContext({ requestId: 'req_abc' });
    errorHandler(new Error('fail'), c);
    const { body } = getJsonCall(c);
    expect(body.meta.requestId).toBe('req_abc');
    expect(body.meta.timestamp).toBeDefined();
  });

  it('defaults requestId to unknown when not set', () => {
    const c = mockContext();
    c.get = vi.fn(() => undefined);
    errorHandler(new Error('fail'), c);
    const { body } = getJsonCall(c);
    expect(body.meta.requestId).toBe('unknown');
  });
});

describe('notFoundHandler', () => {
  it('returns 404 with NOT_FOUND code', () => {
    const c = mockContext({ path: '/api/v1/missing' });
    notFoundHandler(c);
    const { body, status } = getJsonCall(c);
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.success).toBe(false);
  });

  it('includes method and path in the message', () => {
    const c = mockContext({ method: 'POST', path: '/api/v1/widgets' });
    notFoundHandler(c);
    const { body } = getJsonCall(c);
    expect(body.error.message).toContain('POST');
    expect(body.error.message).toContain('/api/v1/widgets');
  });

  it('sanitizes path by stripping special characters', () => {
    const c = mockContext({ path: '/api/v1/<script>alert(1)</script>' });
    notFoundHandler(c);
    const { body } = getJsonCall(c);
    expect(body.error.message).not.toContain('<');
    expect(body.error.message).not.toContain('>');
    expect(body.error.message).not.toContain('(');
    expect(body.error.message).not.toContain(')');
  });

  it('preserves valid path characters after sanitization', () => {
    const c = mockContext({ path: '/api/v1/items/test-item.json' });
    notFoundHandler(c);
    const { body } = getJsonCall(c);
    expect(body.error.message).toContain('/api/v1/items/test-item.json');
  });

  it('includes requestId in meta', () => {
    const c = mockContext({ requestId: 'req_xyz' });
    notFoundHandler(c);
    const { body } = getJsonCall(c);
    expect(body.meta.requestId).toBe('req_xyz');
  });
});
