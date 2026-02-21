/**
 * Comprehensive unit tests for authentication middleware.
 *
 * Covers:
 *   - createAuthMiddleware: type 'none', 'api-key', 'jwt'
 *   - createOptionalAuthMiddleware: type 'none', 'api-key', 'jwt'
 *   - apiKeyMatches timing-safe behavior
 *   - validateJWT secret length, algorithm, sub-claim enforcement
 *
 * Uses real Hono app.request(), real jose/crypto — mocks only helpers.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';

// ---------------------------------------------------------------------------
// Mock only the route helpers — real jose, crypto, and hono are used
// ---------------------------------------------------------------------------

vi.mock('../routes/helpers.js', () => ({
  apiError: vi.fn((c, error, status) => {
    const errorObj = typeof error === 'string' ? { code: 'ERROR', message: error } : error;
    return c.json({ success: false, error: errorObj }, status);
  }),
  ERROR_CODES: {
    UNAUTHORIZED: 'UNAUTHORIZED',
    ACCESS_DENIED: 'ACCESS_DENIED',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  },
  getErrorMessage: vi.fn((err, fallback) =>
    err instanceof Error ? err.message : (fallback ?? String(err))
  ),
}));

// ---------------------------------------------------------------------------
// SUT imports (after mocks)
// ---------------------------------------------------------------------------

import { createAuthMiddleware, createOptionalAuthMiddleware } from './auth.js';
import type { AuthConfig } from '../types/index.js';

// ---------------------------------------------------------------------------
// Shared test constants
// ---------------------------------------------------------------------------

const JWT_SECRET_32 = 'abcdefghijklmnopqrstuvwxyz123456'; // exactly 32 chars
const JWT_SECRET_LONG = 'this-is-a-long-jwt-secret-for-testing-purposes-only-2026!!';

// ---------------------------------------------------------------------------
// JWT builder helpers
// ---------------------------------------------------------------------------

async function buildJWT(
  claims: Record<string, unknown>,
  secret: string = JWT_SECRET_LONG,
  alg: 'HS256' | 'HS384' | 'HS512' = 'HS256',
  expiresIn?: string | number
): Promise<string> {
  const key = createSecretKey(Buffer.from(secret, 'utf-8'));
  let builder = new SignJWT(claims).setProtectedHeader({ alg });
  if (expiresIn !== undefined) {
    builder = builder.setExpirationTime(expiresIn);
  } else {
    builder = builder.setExpirationTime('1h');
  }
  return builder.sign(key);
}

/** Build an already-expired JWT (expiry = 1 hour in the past). */
async function buildExpiredJWT(sub: string, secret: string = JWT_SECRET_LONG): Promise<string> {
  const key = createSecretKey(Buffer.from(secret, 'utf-8'));
  const pastExp = Math.floor(Date.now() / 1000) - 3600;
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(pastExp)
    .sign(key);
}

/** Build a JWT with no "sub" claim. */
async function buildJWTWithoutSub(secret: string = JWT_SECRET_LONG): Promise<string> {
  const key = createSecretKey(Buffer.from(secret, 'utf-8'));
  return new SignJWT({ role: 'admin', extra: 'data' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(key);
}

// ---------------------------------------------------------------------------
// App factory helpers
// ---------------------------------------------------------------------------

function makeApiKeyApp(apiKeys: string[] | undefined, extraConfig: Partial<AuthConfig> = {}) {
  const app = new Hono();
  const config: AuthConfig = { type: 'api-key', apiKeys, ...extraConfig };
  app.use('*', createAuthMiddleware(config));
  app.get('/test', (c) =>
    c.json({ ok: true, userId: c.get('userId') ?? null })
  );
  return app;
}

function makeJwtApp(jwtSecret: string | undefined, extraConfig: Partial<AuthConfig> = {}) {
  const app = new Hono();
  const config: AuthConfig = { type: 'jwt', jwtSecret, ...extraConfig };
  app.use('*', createAuthMiddleware(config));
  app.get('/test', (c) =>
    c.json({
      ok: true,
      userId: c.get('userId') ?? null,
      payload: c.get('jwtPayload') ?? null,
    })
  );
  return app;
}

function makeOptionalApiKeyApp(apiKeys: string[] | undefined) {
  const app = new Hono();
  app.use('*', createOptionalAuthMiddleware({ type: 'api-key', apiKeys }));
  app.get('/test', (c) =>
    c.json({ ok: true, userId: c.get('userId') ?? null })
  );
  return app;
}

function makeOptionalJwtApp(jwtSecret: string | undefined) {
  const app = new Hono();
  app.use('*', createOptionalAuthMiddleware({ type: 'jwt', jwtSecret }));
  app.get('/test', (c) =>
    c.json({
      ok: true,
      userId: c.get('userId') ?? null,
      payload: c.get('jwtPayload') ?? null,
    })
  );
  return app;
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// createAuthMiddleware — type: 'none'
// ===========================================================================

describe('createAuthMiddleware — type: none', () => {
  function makeApp() {
    const app = new Hono();
    app.use('*', createAuthMiddleware({ type: 'none' }));
    app.get('/test', (c) => c.json({ ok: true, userId: c.get('userId') ?? null }));
    return app;
  }

  it('passes through with no headers at all', async () => {
    const res = await makeApp().request('/test');
    expect(res.status).toBe(200);
  });

  it('passes through even with an Authorization header present', async () => {
    const res = await makeApp().request('/test', {
      headers: { Authorization: 'Bearer some-token' },
    });
    expect(res.status).toBe(200);
  });

  it('passes through even with an X-API-Key header present', async () => {
    const res = await makeApp().request('/test', {
      headers: { 'X-API-Key': 'some-key' },
    });
    expect(res.status).toBe(200);
  });

  it('does not set userId on context', async () => {
    const res = await makeApp().request('/test');
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('calls the next handler (route executes)', async () => {
    const res = await makeApp().request('/test');
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 404 for unregistered routes (middleware does not block routing)', async () => {
    const res = await makeApp().request('/does-not-exist');
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// createAuthMiddleware — type: 'api-key'
// ===========================================================================

describe('createAuthMiddleware — type: api-key', () => {
  const VALID_KEY_A = 'key-alpha-abcdefgh'; // 18 chars
  const VALID_KEY_B = 'key-bravo-12345678'; // 18 chars

  // ---- Valid key scenarios ------------------------------------------------

  it('accepts a valid key via X-API-Key header', async () => {
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', { headers: { 'X-API-Key': VALID_KEY_A } });
    expect(res.status).toBe(200);
  });

  it('accepts a valid key via Authorization: Bearer header', async () => {
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${VALID_KEY_A}` },
    });
    expect(res.status).toBe(200);
  });

  it('sets userId to apikey:{first8chars}... for X-API-Key', async () => {
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', { headers: { 'X-API-Key': VALID_KEY_A } });
    const body = await res.json();
    expect(body.userId).toBe(`apikey:${VALID_KEY_A.slice(0, 8)}...`);
  });

  it('sets userId to apikey:{first8chars}... for Bearer key', async () => {
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${VALID_KEY_A}` },
    });
    const body = await res.json();
    expect(body.userId).toBe(`apikey:${VALID_KEY_A.slice(0, 8)}...`);
  });

  it('matches the second key in a multi-key config', async () => {
    const app = makeApiKeyApp([VALID_KEY_A, VALID_KEY_B]);
    const res = await app.request('/test', { headers: { 'X-API-Key': VALID_KEY_B } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(`apikey:${VALID_KEY_B.slice(0, 8)}...`);
  });

  it('accepts first key when multiple valid keys are configured', async () => {
    const app = makeApiKeyApp([VALID_KEY_A, VALID_KEY_B]);
    const res = await app.request('/test', { headers: { 'X-API-Key': VALID_KEY_A } });
    expect(res.status).toBe(200);
  });

  it('prefers Authorization Bearer over X-API-Key when both are provided', async () => {
    const app = makeApiKeyApp([VALID_KEY_A, VALID_KEY_B]);
    const res = await app.request('/test', {
      headers: {
        Authorization: `Bearer ${VALID_KEY_A}`,
        'X-API-Key': VALID_KEY_B,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Bearer is extracted first — userId reflects VALID_KEY_A
    expect(body.userId).toBe(`apikey:${VALID_KEY_A.slice(0, 8)}...`);
  });

  it('accepts a key with special characters (e.g. underscores, dots)', async () => {
    const specialKey = 'key_with.special-chars_OK!';
    const app = makeApiKeyApp([specialKey]);
    const res = await app.request('/test', { headers: { 'X-API-Key': specialKey } });
    expect(res.status).toBe(200);
  });

  // ---- Missing key scenarios ---------------------------------------------

  it('returns 401 when no auth header is provided', async () => {
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test');
    expect(res.status).toBe(401);
  });

  it('returns error code UNAUTHORIZED when key is missing', async () => {
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test');
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('API key required');
  });

  it('returns 401 when Authorization header is present but lacks Bearer prefix', async () => {
    // A bare Authorization header (not Bearer) is not treated as an API key
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', {
      headers: { Authorization: VALID_KEY_A }, // no "Bearer " prefix
    });
    // Bearer check fails, then falls through to X-API-Key check which is also absent -> 401
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is "Token ..." (non-Bearer scheme)', async () => {
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', {
      headers: { Authorization: `Token ${VALID_KEY_A}` },
    });
    expect(res.status).toBe(401);
  });

  // ---- Invalid key scenarios ---------------------------------------------

  it('returns 403 for a completely wrong key', async () => {
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', { headers: { 'X-API-Key': 'totally-wrong-key' } });
    expect(res.status).toBe(403);
  });

  it('returns error code ACCESS_DENIED for an invalid key', async () => {
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', { headers: { 'X-API-Key': 'wrong-key-value!!' } });
    const body = await res.json();
    expect(body.error.code).toBe('ACCESS_DENIED');
    expect(body.error.message).toBe('Invalid API key');
  });

  it('returns 403 when key has correct prefix but wrong suffix (different length)', async () => {
    // key-alpha-abcdefgh + extra char
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', {
      headers: { 'X-API-Key': VALID_KEY_A + 'X' },
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 when key is one character shorter (different length)', async () => {
    const app = makeApiKeyApp([VALID_KEY_A]);
    const shorter = VALID_KEY_A.slice(0, -1);
    const res = await app.request('/test', { headers: { 'X-API-Key': shorter } });
    expect(res.status).toBe(403);
  });

  it('returns 403 for a key that is correct length but wrong content', async () => {
    // Same length as VALID_KEY_A (18 chars), different content
    const wrongSameLength = 'key-alpha-XXXXXXXX';
    expect(wrongSameLength.length).toBe(VALID_KEY_A.length);
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', { headers: { 'X-API-Key': wrongSameLength } });
    expect(res.status).toBe(403);
  });

  it('treats comparison as case-sensitive (uppercase variant rejected)', async () => {
    const app = makeApiKeyApp([VALID_KEY_A]);
    const upperKey = VALID_KEY_A.toUpperCase();
    const res = await app.request('/test', { headers: { 'X-API-Key': upperKey } });
    // Different lengths might apply here, but semantically the comparison must fail
    expect(res.status).toBe(403);
  });

  it('returns 403 when apiKeys array is empty', async () => {
    const app = makeApiKeyApp([]);
    const res = await app.request('/test', { headers: { 'X-API-Key': VALID_KEY_A } });
    expect(res.status).toBe(403);
  });

  it('returns 403 when apiKeys is undefined in config', async () => {
    const app = makeApiKeyApp(undefined);
    const res = await app.request('/test', { headers: { 'X-API-Key': VALID_KEY_A } });
    expect(res.status).toBe(403);
  });

  it('does not set userId when authentication fails (missing key)', async () => {
    const handledUserId: (string | undefined)[] = [];
    const app = new Hono();
    app.use('*', createAuthMiddleware({ type: 'api-key', apiKeys: [VALID_KEY_A] }));
    // This handler is only reached if middleware calls next() — which it does NOT on 401
    app.get('/test', (c) => {
      handledUserId.push(c.get('userId'));
      return c.json({ ok: true });
    });
    const res = await app.request('/test');
    expect(res.status).toBe(401);
    expect(handledUserId).toHaveLength(0);
  });

  it('does not set userId when authentication fails (wrong key)', async () => {
    const handledUserId: (string | undefined)[] = [];
    const app = new Hono();
    app.use('*', createAuthMiddleware({ type: 'api-key', apiKeys: [VALID_KEY_A] }));
    app.get('/test', (c) => {
      handledUserId.push(c.get('userId'));
      return c.json({ ok: true });
    });
    const res = await app.request('/test', { headers: { 'X-API-Key': 'bad-key-xyz!!!!!' } });
    expect(res.status).toBe(403);
    expect(handledUserId).toHaveLength(0);
  });

  it('succeeds on /api/* path-scoped middleware', async () => {
    const app = new Hono();
    app.use('/api/*', createAuthMiddleware({ type: 'api-key', apiKeys: [VALID_KEY_A] }));
    app.get('/api/data', (c) => c.json({ secure: true }));
    app.get('/public', (c) => c.json({ open: true }));

    const secureRes = await app.request('/api/data', {
      headers: { 'X-API-Key': VALID_KEY_A },
    });
    expect(secureRes.status).toBe(200);

    const publicRes = await app.request('/public');
    expect(publicRes.status).toBe(200);
  });

  it('supports very short API keys (1 character)', async () => {
    const shortKey = 'x';
    const app = makeApiKeyApp([shortKey]);
    const res = await app.request('/test', { headers: { 'X-API-Key': shortKey } });
    expect(res.status).toBe(200);
    const body = await res.json();
    // slice(0,8) of 'x' is 'x'
    expect(body.userId).toBe('apikey:x...');
  });

  it('supports very long API keys (256 characters)', async () => {
    const longKey = 'k'.repeat(256);
    const app = makeApiKeyApp([longKey]);
    const res = await app.request('/test', { headers: { 'X-API-Key': longKey } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(`apikey:${'k'.repeat(8)}...`);
  });

  it('accepts a key delivered with trailing whitespace (HTTP header trimming)', async () => {
    // HTTP header values are trimmed by Hono/fetch — trailing whitespace is stripped
    // before the middleware sees the value, so VALID_KEY_A + ' ' resolves to VALID_KEY_A.
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', {
      headers: { 'X-API-Key': VALID_KEY_A + ' ' },
    });
    // The implementation receives the trimmed key — matching succeeds
    expect(res.status).toBe(200);
  });

  it('accepts a key with leading whitespace (HTTP header whitespace is trimmed by fetch)', async () => {
    // HTTP/fetch trims both leading and trailing OWS (optional whitespace) from header values.
    // Hono's c.req.header() returns the trimmed value, so ' key' becomes 'key' before
    // the middleware compares it — the trimmed value matches the stored key.
    const app = makeApiKeyApp([VALID_KEY_A]);
    const res = await app.request('/test', {
      headers: { 'X-API-Key': ' ' + VALID_KEY_A },
    });
    // fetch/Hono trims leading whitespace — comparison succeeds
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// createAuthMiddleware — type: 'jwt'
// ===========================================================================

describe('createAuthMiddleware — type: jwt', () => {
  // ---- Valid JWT scenarios ------------------------------------------------

  it('accepts a valid JWT with sub claim and returns 200', async () => {
    const token = await buildJWT({ sub: 'user-001' });
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('sets userId to the sub claim value', async () => {
    const token = await buildJWT({ sub: 'user-abc-123' });
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.userId).toBe('user-abc-123');
  });

  it('sets jwtPayload on context for downstream handlers', async () => {
    const token = await buildJWT({ sub: 'user-payload-test', role: 'admin', tier: 'pro' });
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.payload).not.toBeNull();
    expect(body.payload.sub).toBe('user-payload-test');
    expect(body.payload.role).toBe('admin');
    expect(body.payload.tier).toBe('pro');
  });

  it('accepts a JWT signed with HS384 algorithm', async () => {
    const token = await buildJWT({ sub: 'user-384' }, JWT_SECRET_LONG, 'HS384');
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user-384');
  });

  it('accepts a JWT signed with HS512 algorithm', async () => {
    const token = await buildJWT({ sub: 'user-512' }, JWT_SECRET_LONG, 'HS512');
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user-512');
  });

  it('accepts a JWT with a secret of exactly 32 characters', async () => {
    const token = await buildJWT({ sub: 'user-32' }, JWT_SECRET_32);
    const app = makeJwtApp(JWT_SECRET_32);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('includes additional claims in jwtPayload', async () => {
    const token = await buildJWT({
      sub: 'user-claims',
      email: 'user@example.com',
      permissions: ['read', 'write'],
      custom: { nested: true },
    });
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.payload.email).toBe('user@example.com');
    expect(body.payload.permissions).toEqual(['read', 'write']);
    expect(body.payload.custom).toEqual({ nested: true });
  });

  // ---- Missing / malformed Authorization header --------------------------

  it('returns 401 when no Authorization header is provided', async () => {
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test');
    expect(res.status).toBe(401);
  });

  it('returns error code UNAUTHORIZED when no token is provided', async () => {
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test');
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('JWT token required');
  });

  it('returns 401 when Authorization header has a non-Bearer scheme', async () => {
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is "Token <value>"', async () => {
    const app = makeJwtApp(JWT_SECRET_LONG);
    const token = await buildJWT({ sub: 'user-1' });
    const res = await app.request('/test', {
      headers: { Authorization: `Token ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization is the bare token string (no scheme)', async () => {
    const app = makeJwtApp(JWT_SECRET_LONG);
    const token = await buildJWT({ sub: 'user-1' });
    const res = await app.request('/test', {
      headers: { Authorization: token },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when X-API-Key is provided instead of Authorization in JWT mode', async () => {
    const app = makeJwtApp(JWT_SECRET_LONG);
    const token = await buildJWT({ sub: 'user-1' });
    const res = await app.request('/test', {
      headers: { 'X-API-Key': token },
    });
    expect(res.status).toBe(401);
  });

  // ---- Invalid token scenarios -------------------------------------------

  it('returns 403 for a completely invalid token string', async () => {
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer this.is.not.a.valid.jwt' },
    });
    expect(res.status).toBe(403);
  });

  it('returns error code ACCESS_DENIED for an invalid token', async () => {
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer garbage-token-data' },
    });
    const body = await res.json();
    expect(body.error.code).toBe('ACCESS_DENIED');
  });

  it('returns 403 for a JWT signed with the wrong secret', async () => {
    const wrongSecret = 'wrong-secret-completely-different-value-here!!';
    const token = await buildJWT({ sub: 'user-1' }, wrongSecret);
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 for an expired JWT', async () => {
    const token = await buildExpiredJWT('user-expired');
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 with ACCESS_DENIED for an expired token', async () => {
    const token = await buildExpiredJWT('user-expired');
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.error.code).toBe('ACCESS_DENIED');
  });

  it('returns 403 for a JWT that is missing the "sub" claim', async () => {
    const token = await buildJWTWithoutSub();
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('returns an error message mentioning "sub" for a token without sub claim', async () => {
    const token = await buildJWTWithoutSub();
    const app = makeJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.error.message).toContain('sub');
  });

  it('returns 403 when secret is 31 characters (one char below minimum)', async () => {
    const shortSecret = 'a'.repeat(31);
    const token = await buildJWT({ sub: 'user-1' }, JWT_SECRET_LONG);
    const app = makeJwtApp(shortSecret);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('returns an error message mentioning "32 characters" for too-short secret', async () => {
    const shortSecret = 'too-short-secret'; // 16 chars
    const token = await buildJWT({ sub: 'user-1' }, JWT_SECRET_LONG);
    const app = makeJwtApp(shortSecret);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.error.message).toContain('32 characters');
  });

  it('returns 503 for an empty jwtSecret string (falsy check matches undefined)', async () => {
    // Empty string is falsy in JS — !'' === true — so the same 503 path is taken
    // as when jwtSecret is completely absent from config.
    const token = await buildJWT({ sub: 'user-1' }, JWT_SECRET_LONG);
    const app = makeJwtApp('');
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  // ---- Missing jwtSecret configuration -----------------------------------

  it('returns 503 when jwtSecret is not provided in config', async () => {
    const app = makeJwtApp(undefined);
    const res = await app.request('/test');
    expect(res.status).toBe(503);
  });

  it('returns error code SERVICE_UNAVAILABLE when jwtSecret is missing', async () => {
    const app = makeJwtApp(undefined);
    const res = await app.request('/test');
    const body = await res.json();
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.error.message).toBe('JWT authentication is not configured');
  });

  it('returns 503 even when a valid-looking Bearer token is supplied but secret is missing', async () => {
    const token = await buildJWT({ sub: 'user-1' });
    const app = makeJwtApp(undefined);
    // jwtSecret check happens before Authorization header extraction
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(503);
  });

  // ---- Next-handler execution verification --------------------------------

  it('does not call the route handler when JWT is invalid', async () => {
    const handlerCalls: string[] = [];
    const app = new Hono();
    app.use('*', createAuthMiddleware({ type: 'jwt', jwtSecret: JWT_SECRET_LONG }));
    app.get('/test', (c) => {
      handlerCalls.push('called');
      return c.json({ ok: true });
    });
    await app.request('/test', {
      headers: { Authorization: 'Bearer not.a.valid.jwt' },
    });
    expect(handlerCalls).toHaveLength(0);
  });

  it('calls the route handler exactly once for a valid JWT', async () => {
    const handlerCalls: string[] = [];
    const token = await buildJWT({ sub: 'user-once' });
    const app = new Hono();
    app.use('*', createAuthMiddleware({ type: 'jwt', jwtSecret: JWT_SECRET_LONG }));
    app.get('/test', (c) => {
      handlerCalls.push('called');
      return c.json({ ok: true });
    });
    await app.request('/test', { headers: { Authorization: `Bearer ${token}` } });
    expect(handlerCalls).toHaveLength(1);
  });
});

// ===========================================================================
// createOptionalAuthMiddleware — type: 'none'
// ===========================================================================

describe('createOptionalAuthMiddleware — type: none', () => {
  function makeApp() {
    const app = new Hono();
    app.use('*', createOptionalAuthMiddleware({ type: 'none' }));
    app.get('/test', (c) =>
      c.json({ ok: true, userId: c.get('userId') ?? null })
    );
    return app;
  }

  it('passes through with no headers', async () => {
    const res = await makeApp().request('/test');
    expect(res.status).toBe(200);
  });

  it('does not set userId', async () => {
    const res = await makeApp().request('/test');
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('passes through even with Authorization and X-API-Key headers present', async () => {
    const res = await makeApp().request('/test', {
      headers: {
        Authorization: 'Bearer some-token',
        'X-API-Key': 'some-key',
      },
    });
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// createOptionalAuthMiddleware — type: 'api-key'
// ===========================================================================

describe('createOptionalAuthMiddleware — type: api-key', () => {
  const VALID_KEY = 'opt-valid-key-abc';

  it('sets userId when a valid key is provided via X-API-Key', async () => {
    const app = makeOptionalApiKeyApp([VALID_KEY]);
    const res = await app.request('/test', { headers: { 'X-API-Key': VALID_KEY } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(`apikey:${VALID_KEY.slice(0, 8)}...`);
  });

  it('sets userId when a valid key is provided via Authorization Bearer', async () => {
    const app = makeOptionalApiKeyApp([VALID_KEY]);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${VALID_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(`apikey:${VALID_KEY.slice(0, 8)}...`);
  });

  it('passes through with no auth header — does not set userId', async () => {
    const app = makeOptionalApiKeyApp([VALID_KEY]);
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('passes through for an invalid key — does not set userId', async () => {
    const app = makeOptionalApiKeyApp([VALID_KEY]);
    const res = await app.request('/test', { headers: { 'X-API-Key': 'wrong-key-xyz!' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('passes through when apiKeys is empty — does not set userId', async () => {
    const app = makeOptionalApiKeyApp([]);
    const res = await app.request('/test', { headers: { 'X-API-Key': VALID_KEY } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('passes through when apiKeys is undefined — does not set userId', async () => {
    const app = makeOptionalApiKeyApp(undefined);
    const res = await app.request('/test', { headers: { 'X-API-Key': VALID_KEY } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('does NOT return 401 or 403 for any auth failure — always 200', async () => {
    const app = makeOptionalApiKeyApp([VALID_KEY]);

    const noHeader = await app.request('/test');
    expect(noHeader.status).toBe(200);

    const badKey = await app.request('/test', { headers: { 'X-API-Key': 'bad-key-long!!' } });
    expect(badKey.status).toBe(200);

    const wrongBearer = await app.request('/test', {
      headers: { Authorization: 'Bearer wrong-bearer!!' },
    });
    expect(wrongBearer.status).toBe(200);
  });

  it('sets userId for the second key in a multi-key array', async () => {
    const KEY_B = 'opt-valid-key-def';
    const app = makeOptionalApiKeyApp([VALID_KEY, KEY_B]);
    const res = await app.request('/test', { headers: { 'X-API-Key': KEY_B } });
    const body = await res.json();
    expect(body.userId).toBe(`apikey:${KEY_B.slice(0, 8)}...`);
  });

  it('does not block downstream handler even for invalid credentials', async () => {
    let handlerReached = false;
    const app = new Hono();
    app.use('*', createOptionalAuthMiddleware({ type: 'api-key', apiKeys: [VALID_KEY] }));
    app.get('/test', (c) => {
      handlerReached = true;
      return c.json({ ok: true });
    });
    await app.request('/test', { headers: { 'X-API-Key': 'invalid-key-xyz' } });
    expect(handlerReached).toBe(true);
  });
});

// ===========================================================================
// createOptionalAuthMiddleware — type: 'jwt'
// ===========================================================================

describe('createOptionalAuthMiddleware — type: jwt', () => {
  it('sets userId and jwtPayload for a valid JWT', async () => {
    const token = await buildJWT({ sub: 'opt-user-1', role: 'editor' });
    const app = makeOptionalJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('opt-user-1');
    expect(body.payload.role).toBe('editor');
  });

  it('passes through without setting userId when no auth header is present', async () => {
    const app = makeOptionalJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
    expect(body.payload).toBeNull();
  });

  it('passes through without setting userId for an invalid JWT', async () => {
    const app = makeOptionalJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer invalid.token.here' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('passes through for a JWT signed with the wrong secret', async () => {
    const wrongSecret = 'completely-different-secret-value-long-enough!!';
    const token = await buildJWT({ sub: 'user-1' }, wrongSecret);
    const app = makeOptionalJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('passes through for an expired JWT', async () => {
    const token = await buildExpiredJWT('opt-expired-user');
    const app = makeOptionalJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('passes through for a JWT missing the "sub" claim', async () => {
    const token = await buildJWTWithoutSub();
    const app = makeOptionalJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('passes through when jwtSecret is not configured', async () => {
    const token = await buildJWT({ sub: 'user-1' });
    const app = makeOptionalJwtApp(undefined);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('passes through when Authorization is non-Bearer scheme', async () => {
    const app = makeOptionalJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  it('does not return 401, 403, or 503 for any failure scenario', async () => {
    const app = makeOptionalJwtApp(JWT_SECRET_LONG);

    const scenarios = [
      {}, // no headers
      { headers: { Authorization: 'Bearer bad.jwt.token' } },
      { headers: { Authorization: 'Basic abc' } },
    ];

    for (const opts of scenarios) {
      const res = await app.request('/test', opts);
      expect(res.status).toBe(200);
    }
  });

  it('sets jwtPayload with all custom claims when valid', async () => {
    const token = await buildJWT({
      sub: 'full-payload-user',
      email: 'test@example.com',
      roles: ['admin', 'user'],
      iat: Math.floor(Date.now() / 1000),
    });
    const app = makeOptionalJwtApp(JWT_SECRET_LONG);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.payload.email).toBe('test@example.com');
    expect(body.payload.roles).toEqual(['admin', 'user']);
  });

  it('does not block the downstream handler on any auth failure', async () => {
    let handlerCalls = 0;
    const app = new Hono();
    app.use('*', createOptionalAuthMiddleware({ type: 'jwt', jwtSecret: JWT_SECRET_LONG }));
    app.get('/test', (c) => {
      handlerCalls++;
      return c.json({ ok: true });
    });

    await app.request('/test'); // no header
    await app.request('/test', { headers: { Authorization: 'Bearer bad.token' } });
    await app.request('/test', { headers: { Authorization: 'Basic dXNlcjpwYXNz' } });

    expect(handlerCalls).toBe(3);
  });

  it('works correctly when jwtSecret is exactly 32 characters', async () => {
    const token = await buildJWT({ sub: 'opt-user-32' }, JWT_SECRET_32);
    const app = makeOptionalJwtApp(JWT_SECRET_32);
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('opt-user-32');
  });
});

// ===========================================================================
// Cross-cutting: middleware composition
// ===========================================================================

describe('createAuthMiddleware — middleware composition', () => {
  it('auth middleware can be stacked with other middleware', async () => {
    const app = new Hono();
    const VALID_KEY = 'compose-key-12345';
    const log: string[] = [];

    app.use('*', async (c, next) => {
      log.push('before-auth');
      await next();
      log.push('after-auth');
    });
    app.use('*', createAuthMiddleware({ type: 'api-key', apiKeys: [VALID_KEY] }));
    app.use('*', async (c, next) => {
      log.push('after-auth-middleware');
      await next();
    });
    app.get('/test', (c) => {
      log.push('handler');
      return c.json({ ok: true });
    });

    const res = await app.request('/test', { headers: { 'X-API-Key': VALID_KEY } });
    expect(res.status).toBe(200);
    expect(log).toEqual(['before-auth', 'after-auth-middleware', 'handler', 'after-auth']);
  });

  it('optional auth middleware does not prevent subsequent middleware from running', async () => {
    const app = new Hono();
    const log: string[] = [];

    app.use('*', createOptionalAuthMiddleware({ type: 'api-key', apiKeys: ['key-x'] }));
    app.use('*', async (c, next) => {
      log.push('second-middleware');
      await next();
    });
    app.get('/test', (c) => {
      log.push('handler');
      return c.json({ ok: true });
    });

    // Even with no auth header, both subsequent middleware and handler should run
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(log).toContain('second-middleware');
    expect(log).toContain('handler');
  });
});
