/**
 * Authentication middleware
 * Supports API key and JWT authentication
 */

import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';
import { createHash, createSecretKey, timingSafeEqual } from 'node:crypto';
import type { AuthConfig } from '../types/index.js';
import { apiError, ERROR_CODES, getErrorMessage } from '../routes/helpers.js';

// H-S14: bound candidate length so an attacker can't force megabyte-sized
// comparisons. Real API keys are <256 chars; longer values are rejected before
// reaching the comparison loop.
const MAX_API_KEY_LENGTH = 256;

/**
 * Timing-safe API key check.
 *
 * H-S14: hashes both candidate and each valid key to a fixed-size SHA-256
 * digest and compares the digests with `timingSafeEqual`. This removes the
 * length-dependent timing leak in the previous variable-length padded compare
 * (per-iteration buffer alloc + compare cost depended on max(candidate,key)
 * length, which leaked information about valid-key lengths to an attacker
 * controlling candidate length).
 *
 * The hash on its own is variable-time over the candidate length, but the
 * candidate is capped above and all keys hash to the same 32-byte digest, so
 * an attacker can't distinguish key lengths via comparison timing.
 *
 * Returns true if `candidate` matches any key in `validKeys`.
 */
function apiKeyMatches(candidate: string, validKeys: string[]): boolean {
  if (candidate.length === 0 || candidate.length > MAX_API_KEY_LENGTH) return false;
  const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest();
  let result = false;
  for (const key of validKeys) {
    if (!key) continue;
    const keyDigest = createHash('sha256').update(key, 'utf8').digest();
    // Both buffers are exactly 32 bytes — timingSafeEqual is constant-time
    // over its (fixed) input length.
    const equal = timingSafeEqual(candidateDigest, keyDigest);
    result = result || equal;
  }
  return result;
}

/**
 * Create authentication middleware
 */
export function createAuthMiddleware(config: AuthConfig) {
  return createMiddleware(async (c, next) => {
    // Skip auth if already authenticated via UI session
    if (c.get('sessionAuthenticated')) {
      return next();
    }

    // Skip auth if type is 'none'
    if (config.type === 'none') {
      return next();
    }

    const authHeader = c.req.header('Authorization');

    if (config.type === 'api-key') {
      // Check for API key in header
      const apiKey = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : c.req.header('X-API-Key');

      if (!apiKey) {
        return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'API key required' }, 401);
      }

      if (!config.apiKeys?.length || !apiKeyMatches(apiKey, config.apiKeys)) {
        return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message: 'Invalid API key' }, 403);
      }

      // Could extract user info from API key mapping
      c.set('userId', `apikey:${apiKey.slice(0, 8)}...`);
    } else if (config.type === 'jwt') {
      // JWT authentication
      if (!config.jwtSecret) {
        return apiError(
          c,
          {
            code: ERROR_CODES.SERVICE_UNAVAILABLE,
            message: 'JWT authentication is not configured',
          },
          503
        );
      }

      if (!authHeader?.startsWith('Bearer ')) {
        return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'JWT token required' }, 401);
      }

      const token = authHeader.slice(7);

      try {
        const payload = await validateJWT(token, config.jwtSecret);
        c.set('userId', payload.sub);
        c.set('jwtPayload', payload);
      } catch (error) {
        const message = getErrorMessage(error, 'Invalid or expired token');
        return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message }, 403);
      }
    }

    return next();
  });
}

// H-S18: bound JWT lifetime. jose enforces `exp` when present, but a token
// without `exp` would be valid forever. We require `exp` AND `iat`, and cap the
// age via `maxTokenAge`. Operators can adjust the ceiling via JWT_MAX_TOKEN_AGE
// (jose accepts "7d", "12h", "3600", etc.).
const JWT_MAX_TOKEN_AGE = process.env.JWT_MAX_TOKEN_AGE ?? '7d';
const JWT_CLOCK_TOLERANCE_SEC = parseInt(process.env.JWT_CLOCK_TOLERANCE_SEC ?? '30', 10);

/**
 * JWT validation with proper signature verification using jose
 */
async function validateJWT(
  token: string,
  secret: string
): Promise<{ sub: string; exp?: number; [key: string]: unknown }> {
  if (!secret || secret.length < 64) {
    throw new Error('JWT secret must be at least 64 characters');
  }

  const secretKey = createSecretKey(Buffer.from(secret, 'utf-8'));

  const { payload } = await jwtVerify(token, secretKey, {
    algorithms: ['HS256'], // Only allow HS256 to prevent algorithm confusion attacks
    requiredClaims: ['sub', 'exp', 'iat'], // H-S18: reject ever-valid tokens
    maxTokenAge: JWT_MAX_TOKEN_AGE, // H-S18: bound total lifetime relative to iat
    clockTolerance: JWT_CLOCK_TOLERANCE_SEC,
  });

  if (!payload.sub) {
    throw new Error('Token missing required "sub" claim');
  }

  return payload as { sub: string; exp?: number; [key: string]: unknown };
}

/**
 * Optional auth - sets user if present but doesn't require it
 */
export function createOptionalAuthMiddleware(config: AuthConfig) {
  return createMiddleware(async (c, next) => {
    if (config.type === 'none') {
      return next();
    }

    const authHeader = c.req.header('Authorization');

    if (config.type === 'api-key') {
      const apiKey = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : c.req.header('X-API-Key');

      if (apiKey && config.apiKeys?.length && apiKeyMatches(apiKey, config.apiKeys)) {
        c.set('userId', `apikey:${apiKey.slice(0, 8)}...`);
      }
    } else if (config.type === 'jwt' && config.jwtSecret && authHeader?.startsWith('Bearer ')) {
      try {
        const payload = await validateJWT(authHeader.slice(7), config.jwtSecret);
        c.set('userId', payload.sub);
        c.set('jwtPayload', payload);
      } catch {
        // Ignore invalid tokens in optional auth
      }
    }

    return next();
  });
}
