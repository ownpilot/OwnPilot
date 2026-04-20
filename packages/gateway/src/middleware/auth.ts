/**
 * Authentication middleware
 * Supports API key and JWT authentication
 */

import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';
import { createSecretKey, timingSafeEqual } from 'node:crypto';
import type { AuthConfig } from '../types/index.js';
import { apiError, ERROR_CODES, getErrorMessage } from '../routes/helpers.js';

/**
 * Timing-safe API key check.
 * Returns true if `candidate` matches any key in `validKeys`.
 */
function apiKeyMatches(candidate: string, validKeys: string[]): boolean {
  const candidateBuf = Buffer.from(candidate);
  let result = false;

  for (const key of validKeys) {
    const keyBuf = Buffer.from(key);
    // Always perform timing-safe comparison to avoid leaking key length info
    // Pad shorter buffer to match longer one to prevent early return timing leaks
    const maxLen = Math.max(candidateBuf.length, keyBuf.length);
    const paddedCandidate = Buffer.alloc(maxLen);
    const paddedKey = Buffer.alloc(maxLen);
    candidateBuf.copy(paddedCandidate);
    keyBuf.copy(paddedKey);

    // Only mark as match if lengths are equal AND content matches
    const equal = timingSafeEqual(paddedCandidate, paddedKey);
    result = result || (candidateBuf.length === keyBuf.length && equal);
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
      const queryToken = c.req.query('token');

      if (config.type === 'api-key') {
        // Check for API key in header or query
        const apiKey = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : c.req.header('X-API-Key') || queryToken;

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

      if (!authHeader?.startsWith('Bearer ') && !queryToken) {
        return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'JWT token required' }, 401);
      }

      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken!;

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
    algorithms: ['HS256'], // Only allow HS256 to prevent algorithm confusion attacks
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
