/**
 * Authentication middleware
 * Supports API key and JWT authentication
 */

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AuthConfig } from '../types/index.js';

/**
 * Create authentication middleware
 */
export function createAuthMiddleware(config: AuthConfig) {
  return createMiddleware(async (c, next) => {
    // Skip auth if type is 'none'
    if (config.type === 'none') {
      await next();
      return;
    }

    const authHeader = c.req.header('Authorization');

    if (config.type === 'api-key') {
      // Check for API key in header
      const apiKey = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : c.req.header('X-API-Key');

      if (!apiKey) {
        throw new HTTPException(401, {
          message: 'API key required',
        });
      }

      if (!config.apiKeys?.includes(apiKey)) {
        throw new HTTPException(403, {
          message: 'Invalid API key',
        });
      }

      // Could extract user info from API key mapping
      c.set('userId', `apikey:${apiKey.slice(0, 8)}...`);
    } else if (config.type === 'jwt') {
      // JWT authentication
      if (!authHeader?.startsWith('Bearer ')) {
        throw new HTTPException(401, {
          message: 'JWT token required',
        });
      }

      const token = authHeader.slice(7);

      try {
        // Simple JWT validation (in production, use a proper library)
        const payload = validateJWT(token, config.jwtSecret ?? '');
        c.set('userId', payload.sub);
        c.set('jwtPayload', payload);
      } catch (error) {
        throw new HTTPException(403, {
          message: 'Invalid or expired token',
        });
      }
    }

    await next();
  });
}

/**
 * Simple JWT validation
 * In production, use a proper JWT library like jose
 */
function validateJWT(
  token: string,
  secret: string
): { sub: string; exp?: number; [key: string]: unknown } {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  try {
    // Decode payload (middle part)
    const payload = JSON.parse(
      Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')
    );

    // Check expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      throw new Error('Token expired');
    }

    // In production, verify signature with secret
    // For now, just return payload
    return payload;
  } catch {
    throw new Error('Invalid token');
  }
}

/**
 * Optional auth - sets user if present but doesn't require it
 */
export function createOptionalAuthMiddleware(config: AuthConfig) {
  return createMiddleware(async (c, next) => {
    if (config.type === 'none') {
      await next();
      return;
    }

    const authHeader = c.req.header('Authorization');

    if (config.type === 'api-key') {
      const apiKey = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : c.req.header('X-API-Key');

      if (apiKey && config.apiKeys?.includes(apiKey)) {
        c.set('userId', `apikey:${apiKey.slice(0, 8)}...`);
      }
    } else if (config.type === 'jwt' && authHeader?.startsWith('Bearer ')) {
      try {
        const payload = validateJWT(authHeader.slice(7), config.jwtSecret ?? '');
        c.set('userId', payload.sub);
        c.set('jwtPayload', payload);
      } catch {
        // Ignore invalid tokens in optional auth
      }
    }

    await next();
  });
}
