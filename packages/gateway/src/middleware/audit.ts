/**
 * Audit Middleware
 *
 * Logs every API request through the ServiceRegistry's AuditService.
 * Captures method, path, status, duration, and optional user context.
 */

import type { MiddlewareHandler } from 'hono';
import { hasServiceRegistry, getServiceRegistry, Services } from '@ownpilot/core';
import type { IAuditService } from '@ownpilot/core';

/**
 * Hono middleware that logs each request via AuditService.logAudit().
 * Skipped when ServiceRegistry is not yet initialized (e.g. during tests).
 */
export const auditMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();

  await next();

  // Skip if registry not available (early startup, tests)
  if (!hasServiceRegistry()) return;

  const registry = getServiceRegistry();
  const audit = registry.tryGet<IAuditService>(Services.Audit);
  if (!audit) return;

  const method = c.req.method;
  const path = c.req.path;
  const status = c.res.status;
  const durationMs = Date.now() - start;

  // Skip logging health checks and static asset requests
  if (path === '/health' || path.startsWith('/api/v1/health')) return;

  audit.logAudit({
    userId: c.get('userId') ?? 'default',
    action: `${method} ${path}`,
    resource: 'api',
    resourceId: path,
    ip:
      process.env.TRUSTED_PROXY === 'true'
        ? (c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
          c.req.header('x-real-ip') ??
          'unknown')
        : 'direct',
    details: {
      method,
      path,
      status,
      durationMs,
    },
  });
};
