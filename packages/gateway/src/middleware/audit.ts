/**
 * Audit Middleware
 *
 * Logs every API request through the ServiceRegistry's AuditService.
 * Captures method, path, route template, status, duration, and optional user
 * context.
 *
 * Sampling: deliberately none. Every non-excluded request under `/api/*`
 * produces a row. Sampling reads would cut write volume, but an audit log with
 * holes in it cannot answer "what did this actor touch?", which is the only
 * question it exists to answer. Exclusions are limited to endpoints that carry
 * no security signal and fire on a timer (health probes, metrics scrapes).
 * Records carry both the raw `path` and the matched `route` template so audit
 * queries can group by route without the raw path driving cardinality.
 */

import type { MiddlewareHandler } from 'hono';
import { hasAuditService, getAuditService } from '@ownpilot/core/services';
import { recordHttpRequest } from '../services/metric/service.js';

/**
 * Hono middleware that logs each request via AuditService.logAudit().
 * Skipped when AuditService is not yet initialized (e.g. during tests).
 */
export const auditMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();

  await next();

  // Skip if audit service not yet registered (early startup, tests)
  if (!hasAuditService()) return;
  const audit = getAuditService();

  const method = c.req.method;
  const path = c.req.path;
  const status = c.res.status;
  const durationMs = Date.now() - start;

  // The matched route template (`/api/v1/agents/:id`), not the raw URL.
  //
  // Read *after* `await next()` — before it, routeIndex still points at this
  // middleware and the getter returns its own pattern (`/api/*`). Afterwards
  // it resolves to the handler that matched; on a 404 it falls back to
  // `/api/*`, which conveniently collapses all unmatched/scanner traffic into
  // one series. Metric cardinality is therefore bounded by the number of
  // registered routes rather than by the number of distinct URLs.
  //
  // NOTE: `c.req.routePath` is deprecated in favour of the `routePath()`
  // helper from `hono/route`, but that module does not exist in hono 4.12.x.
  // Switch when hono is upgraded to a version that ships it.
  const routeTemplate = c.req.routePath;

  // Skip logging health checks and the metrics scrape endpoint. Without the
  // latter, every Prometheus scrape writes an audit row and counts itself.
  if (path === '/health' || path.startsWith('/api/v1/health')) return;
  if (path === '/api/v1/metrics') return;

  // Record metrics
  recordHttpRequest(method, routeTemplate, status, durationMs);

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
      route: routeTemplate,
      status,
      durationMs,
    },
  });
};
