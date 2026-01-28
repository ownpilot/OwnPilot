/**
 * Authentication middleware
 * Supports API key and JWT authentication
 */

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { jwtVerify } from 'jose';
import { createSecretKey } from 'node:crypto';
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
        const payload = await validateJWT(token, config.jwtSecret ?? '');
        c.set('userId', payload.sub);
        c.set('jwtPayload', payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid or expired token';
        throw new HTTPException(403, { message });
      }
    }

    await next();
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
        const payload = await validateJWT(authHeader.slice(7), config.jwtSecret ?? '');
        c.set('userId', payload.sub);
        c.set('jwtPayload', payload);
      } catch {
        // Ignore invalid tokens in optional auth
      }
    }

    await next();
  });
}
