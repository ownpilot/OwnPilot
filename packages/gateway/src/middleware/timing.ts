/**
 * Request timing middleware
 * Tracks request processing time
 */

import { createMiddleware } from 'hono/factory';

export const timing = createMiddleware(async (c, next) => {
  const start = performance.now();
  c.set('startTime', start);

  await next();

  const duration = performance.now() - start;
  c.header('X-Response-Time', `${duration.toFixed(2)}ms`);
});
