/**
 * Middleware exports
 *
 * Only middleware that's consumed by app.ts (request pipeline) or by the
 * gateway package barrel re-exports lives here. Anything else (pagination,
 * circuit-breaker primitives, etc.) should be imported directly from the
 * submodule that defines it.
 */

export { requestId } from './request-id.js';
export { timing } from './timing.js';
export { createAuthMiddleware, createOptionalAuthMiddleware } from './auth.js';
export { createRateLimitMiddleware, createSlidingWindowRateLimiter } from './rate-limit.js';
export { errorHandler, notFoundHandler } from './error-handler.js';
export { auditMiddleware } from './audit.js';
export { uiSessionMiddleware } from './ui-session.js';
