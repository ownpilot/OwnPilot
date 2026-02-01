/**
 * Plugin Security Middleware
 *
 * Provides security enforcement for non-trusted tools (plugin, custom).
 * Applied globally via ToolRegistry.use() — activates only for tools with
 * source === 'plugin' or source === 'custom'.
 *
 * Security measures:
 * - Argument validation (path traversal, injection patterns)
 * - Rate limiting per plugin/tool
 * - Output sanitization for untrusted tools
 */

import type { ToolMiddleware, ToolMiddlewareContext, ToolExecutionResult } from '../types.js';

// ---------------------------------------------------------------------------
// Rate limiter (simple in-memory token bucket)
// ---------------------------------------------------------------------------

const rateLimits = new Map<string, { tokens: number; lastRefill: number }>();
const MAX_TOKENS = 60;        // 60 calls per window
const REFILL_WINDOW_MS = 60_000; // 1 minute window

function checkRateLimit(key: string): void {
  const now = Date.now();
  let bucket = rateLimits.get(key);

  if (!bucket) {
    bucket = { tokens: MAX_TOKENS, lastRefill: now };
    rateLimits.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= REFILL_WINDOW_MS) {
    bucket.tokens = MAX_TOKENS;
    bucket.lastRefill = now;
  }

  if (bucket.tokens <= 0) {
    throw new Error(`Rate limit exceeded for '${key}'. Max ${MAX_TOKENS} calls per minute.`);
  }

  bucket.tokens--;
}

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

/** Patterns that indicate potential path traversal or injection */
const DANGEROUS_PATTERNS = [
  /\.\.[/\\]/,                      // Path traversal
  /[;&|`$]/,                         // Shell injection chars
  /<script[\s>]/i,                   // XSS attempts
  /javascript:/i,                    // JS protocol
];

function validateArguments(args: Record<string, unknown>): void {
  const values = Object.values(args);
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(value)) {
        throw new Error(
          `Potentially dangerous argument value detected. Pattern: ${pattern.source}`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Output sanitization
// ---------------------------------------------------------------------------

function sanitizeResult(result: ToolExecutionResult): ToolExecutionResult {
  // Ensure content doesn't exceed reasonable size (1MB)
  const content = result.content;
  if (typeof content === 'string' && content.length > 1_000_000) {
    return {
      content: content.slice(0, 1_000_000) + '\n... [output truncated]',
      isError: result.isError,
      metadata: { ...result.metadata, truncated: true },
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create a security middleware for plugin and custom tools.
 * Only activates for tools with trustLevel !== 'trusted'.
 */
export function createPluginSecurityMiddleware(): ToolMiddleware {
  return {
    name: 'plugin-security',

    async before(context: ToolMiddlewareContext): Promise<void> {
      // Only enforce for non-trusted tools
      if (!context.source || context.trustLevel === 'trusted') return;

      // 1. Validate arguments
      validateArguments(context.args);

      // 2. Rate limiting (keyed by pluginId or toolName)
      const rateLimitKey = context.pluginId ?? context.toolName;
      checkRateLimit(rateLimitKey);
    },

    async after(
      context: ToolMiddlewareContext,
      result: ToolExecutionResult
    ): Promise<ToolExecutionResult> {
      // Only enforce for non-trusted tools
      if (!context.source || context.trustLevel === 'trusted') return result;

      // Sanitize output
      return sanitizeResult(result);
    },
  };
}
