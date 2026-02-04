/**
 * Request ID middleware
 * Adds a unique request ID to each request
 */

import { createMiddleware } from 'hono/factory';
import { randomUUID } from 'node:crypto';

// Accept alphanumeric, hyphens, underscores, dots, colons (up to 128 chars)
const VALID_REQUEST_ID = /^[a-zA-Z0-9._:=-]{1,128}$/;

export const requestId = createMiddleware(async (c, next) => {
  const header = c.req.header('X-Request-ID');
  const id = header && VALID_REQUEST_ID.test(header) ? header : randomUUID();
  c.set('requestId', id);
  c.header('X-Request-ID', id);
  await next();
});
