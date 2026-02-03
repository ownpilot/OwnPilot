/**
 * Authentication middleware
 * Supports API key and JWT authentication
 */

import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';
import { createSecretKey, timingSafeEqual } from 'node:crypto';
import type { AuthConfig } from '../types/index.js';
import { apiError, ERROR_CODES } from '../routes/helpers.js';

/**
 * Timing-safe API key check.
 * Returns true if `candidate` matches any key in `validKeys`.
 */
function apiKeyMatches(candidate: string, validKeys: string[]): boolean {
  const candidateBuf = Buffer.from(candidate);
  for (const key of validKeys) {
    const keyBuf = Buffer.from(key);
    // timingSafeEqual requires equal-length buffers
    if (candidateBuf.length === keyBuf.length && timingSafeEqual(candidateBuf, keyBuf)) {
      return true;
    }
  }
  return false;
}

/**
 * Create authentication middleware
 */
export function createAuthMiddleware(config: AuthConfig) {
  return createMiddleware(async (c, next) => {
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
      if (!authHeader?.startsWith('Bearer ')) {
        return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'JWT token required' }, 401);
      }

      const token = authHeader.slice(7);

      try {
        const payload = await validateJWT(token, config.jwtSecret ?? '');
        c.set('userId', payload.sub);
        c.set('jwtPayload', payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid or expired token';
        return apiError(c, { code: ERROR_CODES.ACCESS_DENIED, message }, 403);
      }
    }

    return next();
  });
}

/**
 * JWT validation with proper signature verification using jose
 */
async function validateJWT(
  token: string,
  secret: string
): Promise<{ sub: string; exp?: number; [key: string]: unknown }> {
  if (!secret || secret.length < 32) {
    throw new Error('JWT secret must be at least 32 characters');
  }

  const secretKey = createSecretKey(Buffer.from(secret, 'utf-8'));

  const { payload } = await jwtVerify(token, secretKey, {
    algorithms: ['HS256', 'HS384', 'HS512'],
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
    } else if (config.type === 'jwt' && authHeader?.startsWith('Bearer ')) {
      try {
        const payload = await validateJWT(authHeader.slice(7), config.jwtSecret ?? '');
        c.set('userId', payload.sub);
        c.set('jwtPayload', payload);
      } catch {
        // Ignore invalid tokens in optional auth
      }
    }

    return next();
  });
}
