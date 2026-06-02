/**
 * Pure utility helpers — no HTTP / Hono dependency.
 *
 * Extracted from `routes/helpers.ts` so non-route consumers (services,
 * channels, middleware, plans, scheduler, db) don't have to reach back into
 * the routes/ layer for plain functions like `getErrorMessage` or `truncate`.
 *
 * `routes/helpers.ts` re-exports everything here so route handlers don't have
 * to change their import path; they still pull HTTP-aware helpers from there.
 *
 * New service-layer code MUST import from this module, not from
 * `routes/helpers.js`.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Timing-safe comparison of two strings (e.g. API keys, admin keys).
 * Returns false if either value is undefined/empty or lengths differ.
 */
export function safeKeyCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Sanitize a provider name for safe use as environment variable key.
 * Strips all non-alphanumeric/underscore characters and uppercases.
 */
export function sanitizeProviderName(provider: string): string {
  return provider.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase();
}

/**
 * Clamp a value between min and max bounds, with fallback for non-numeric input.
 */
export function clamp(
  val: unknown,
  limits: { min: number; max: number },
  fallback: number
): number {
  return typeof val === 'number' && !Number.isNaN(val)
    ? Math.max(limits.min, Math.min(limits.max, val))
    : fallback;
}

/**
 * Sanitize a user-provided ID string for safe use in database queries.
 * Strips all characters except word chars and hyphens.
 * For IDs longer than 100 chars, uses a hash suffix to prevent collisions.
 */
export function sanitizeId(id: string): string {
  const sanitized = id.replace(/[^\w-]/g, '');
  if (sanitized.length > 100) {
    const hash = createHash('sha256').update(sanitized).digest('hex').slice(0, 32);
    return sanitized.slice(0, 67) + '-' + hash;
  }
  return sanitized;
}

/**
 * Extract error message from an unknown catch value.
 * Accepts an optional fallback for context-specific defaults.
 */
export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Truncate a string to maxLength, appending '...' if truncated.
 */
export function truncate(text: string, maxLength = 50): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
}

/**
 * Mask a secret value for safe display.
 * Shows first 4 + '...' + last 4 for strings >= 12 chars,
 * otherwise returns '****'.
 */
export function maskSecret(value: unknown): string {
  if (typeof value === 'string' && value.length >= 12) {
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }
  return '****';
}

/**
 * Sanitize user-supplied text for safe interpolation in messages.
 * Strips special characters and truncates to 200 chars.
 */
export function sanitizeText(text: string): string {
  return text.replace(/[^\w\s-]/g, '').slice(0, 200);
}

/**
 * Canonical JSON serialization for use as a cache or hash key.
 *
 * Unlike `JSON.stringify`, the property order of objects is irrelevant:
 * `{a: 1, b: 2}` and `{b: 2, a: 1}` produce the same string. Arrays
 * preserve element order (semantic order matters), and the handling of
 * `undefined` matches `JSON.stringify` exactly: keys with `undefined`
 * values are dropped from objects, `undefined` in arrays becomes `null`,
 * and a top-level `undefined` returns the string `"null"` so the function
 * always produces a non-empty key.
 *
 * Used by the tool executor's idempotency cache so that semantically
 * equivalent invocations with permuted argument keys hit the same cache
 * entry (Plan 11 IDEMP-001).
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) {
    // Match JSON.stringify's array-element convention (becomes `null` when
    // placed in an array) and avoid an empty cache key at the top level.
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    // Primitives, null, functions, symbols — defer to JSON.stringify. It
    // returns `undefined` (not a string) for function/symbol values; coerce
    // to `null` to keep cache keys well-formed.
    const s = JSON.stringify(value);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .filter((k) => obj[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}
