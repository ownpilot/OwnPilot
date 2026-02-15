/**
 * Rate limiting middleware
 * Flexible rate limiter with soft limits and burst support
 */

import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { RateLimitConfig } from '../types/index.js';
import { apiError, ERROR_CODES } from '../routes/helpers.js';
import { getLog } from '../services/log.js';

const log = getLog('RateLimit');

/**
 * Whether to trust proxy headers (X-Forwarded-For, X-Real-IP).
 * Only enable when running behind a reverse proxy (nginx, CloudFlare, etc.).
 * Set TRUSTED_PROXY=true to enable.
 */
const TRUST_PROXY = process.env.TRUSTED_PROXY === 'true';

/**
 * Get client IP for rate limiting.
 * Only trusts proxy headers when TRUSTED_PROXY=true.
 */
function getClientIp(c: Context): string {
  if (TRUST_PROXY) {
    return (
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
      c.req.header('X-Real-IP') ??
      'unknown'
    );
  }
  // Direct connection: ignore spoofable headers
  return 'direct';
}

interface RateLimitEntry {
  count: number;
  burstCount: number;
  resetAt: number;
  warned: boolean;
}

/**
 * Track active cleanup intervals for graceful shutdown
 */
const activeIntervals: Set<NodeJS.Timeout> = new Set();

/**
 * Stop all rate limiter cleanup intervals (call on shutdown)
 */
export function stopAllRateLimiters(): void {
  for (const interval of activeIntervals) {
    clearInterval(interval);
  }
  activeIntervals.clear();
}

/**
 * Create rate limiting middleware
 *
 * Features:
 * - Soft limit mode: warns but doesn't block
 * - Burst allowance: allows temporary spikes
 * - Path exclusions: skip certain endpoints
 * - Disabled mode: for development
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  // Skip if disabled
  if (config.disabled) {
    return createMiddleware(async (_c, next) => {
      return next();
    });
  }

  const store = new Map<string, RateLimitEntry>();
  const burstLimit = config.burstLimit ?? Math.floor(config.maxRequests * 1.5);
  const excludePaths = config.excludePaths ?? ['/health', '/api/v1/health'];
  const maxStoreSize = 10_000;

  // Clean up expired entries periodically
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt < now) {
        store.delete(key);
      }
    }
  }, config.windowMs);

  // Don't prevent process exit and track for cleanup
  cleanupInterval.unref();
  activeIntervals.add(cleanupInterval);

  return createMiddleware(async (c, next) => {
    const path = c.req.path;

    // Check if path is excluded
    if (excludePaths.some((p) => path.startsWith(p))) {
      return next();
    }

    // Use user ID if available, otherwise fall back to IP
    const userId = c.get('userId');
    const ip = getClientIp(c);
    const key = userId ?? `ip:${ip}`;

    const now = Date.now();
    let entry = store.get(key);

    // Reset if window expired
    if (!entry || entry.resetAt < now) {
      // Prevent unbounded growth from many unique IPs
      if (!entry && store.size >= maxStoreSize) {
        log.warn(`Rate limit store full (${maxStoreSize} entries), rejecting new client`);
        return apiError(c, { code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests' }, 429);
      }
      entry = {
        count: 0,
        burstCount: 0,
        resetAt: now + config.windowMs,
        warned: false,
      };
      store.set(key, entry);
    }

    // Increment count
    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, config.maxRequests - entry.count);
    const reset = Math.ceil((entry.resetAt - now) / 1000);

    c.header('X-RateLimit-Limit', String(config.maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(reset));

    // Check if over normal limit but within burst
    if (entry.count > config.maxRequests && entry.count <= burstLimit) {
      entry.burstCount++;
      c.header('X-RateLimit-Burst', 'true');
      c.header('X-RateLimit-Burst-Remaining', String(burstLimit - entry.count));

      // Log warning (first time only)
      if (!entry.warned) {
        entry.warned = true;
        log.warn(`[RateLimit] User ${key} is using burst allowance`);
      }

      // Continue in soft mode or burst mode
      return next();
    }

    // Check if over burst limit
    if (entry.count > burstLimit) {
      c.header('Retry-After', String(reset));

      // Soft limit: warn but don't block
      if (config.softLimit) {
        c.header('X-RateLimit-SoftLimit', 'true');
        c.header('X-RateLimit-Warning', 'Rate limit exceeded, but soft limit is enabled');
        log.warn(`[RateLimit] Soft limit exceeded for ${key}: ${entry.count} requests`);
        return next();
      }

      // Hard limit: block
      return apiError(c, { code: ERROR_CODES.RATE_LIMITED, message: `Rate limit exceeded. Please wait ${reset} seconds.` }, 429);
    }

    return next();
  });
}

/**
 * Create a sliding window rate limiter
 * More accurate but uses more memory
 */
export function createSlidingWindowRateLimiter(config: RateLimitConfig) {
  if (config.disabled) {
    return createMiddleware(async (_c, next) => {
      return next();
    });
  }

  const requests = new Map<string, number[]>();
  const burstLimit = config.burstLimit ?? Math.floor(config.maxRequests * 1.5);
  const excludePaths = config.excludePaths ?? ['/health', '/api/v1/health'];
  const maxStoreSize = 10_000;

  // Clean up old entries
  const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - config.windowMs;
    for (const [key, timestamps] of requests.entries()) {
      const filtered = timestamps.filter((t) => t > cutoff);
      if (filtered.length === 0) {
        requests.delete(key);
      } else {
        requests.set(key, filtered);
      }
    }
  }, config.windowMs / 4);

  // Don't prevent process exit and track for cleanup
  cleanupInterval.unref();
  activeIntervals.add(cleanupInterval);

  return createMiddleware(async (c, next) => {
    const path = c.req.path;

    if (excludePaths.some((p) => path.startsWith(p))) {
      return next();
    }

    const userId = c.get('userId');
    const ip = getClientIp(c);
    const key = userId ?? `ip:${ip}`;

    const now = Date.now();
    const cutoff = now - config.windowMs;

    // Get or create timestamps array
    let timestamps = requests.get(key);

    // Prevent unbounded growth from many unique IPs
    if (!timestamps && requests.size >= maxStoreSize) {
      log.warn(`Sliding window store full (${maxStoreSize} entries), rejecting new client`);
      return apiError(c, { code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests' }, 429);
    }

    // Filter out old timestamps
    timestamps = (timestamps ?? []).filter((t) => t > cutoff);

    // Set headers
    const remaining = Math.max(0, config.maxRequests - timestamps.length);
    c.header('X-RateLimit-Limit', String(config.maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));

    // Check if over burst limit
    if (timestamps.length >= burstLimit) {
      const oldestInWindow = timestamps[0] ?? now;
      const retryAfter = Math.ceil((oldestInWindow + config.windowMs - now) / 1000);

      c.header('X-RateLimit-Reset', String(retryAfter));
      c.header('Retry-After', String(retryAfter));

      if (config.softLimit) {
        c.header('X-RateLimit-SoftLimit', 'true');
        // Cap array size to prevent unbounded growth within a single window
        // Allow only a small buffer beyond burst limit for accurate tracking
        if (timestamps.length < burstLimit + 50) {
          timestamps.push(now);
        }
        requests.set(key, timestamps);
        return next();
      }

      return apiError(c, { code: ERROR_CODES.RATE_LIMITED, message: `Rate limit exceeded. Please wait ${retryAfter} seconds.` }, 429);
    }

    // Add current timestamp
    timestamps.push(now);
    requests.set(key, timestamps);

    return next();
  });
}
