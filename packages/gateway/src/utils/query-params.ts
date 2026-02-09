/**
 * Query parameter parsing utilities
 *
 * Safe parsing of common query parameters with validation.
 */

/** Default limits for pagination */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const DEFAULT_OFFSET = 0;

/**
 * Parse and validate a limit query parameter
 *
 * @param value - Raw query string value
 * @param defaultLimit - Default limit if not provided (default: 50)
 * @param maxLimit - Maximum allowed limit (default: 1000)
 * @returns Validated limit value
 */
export function parseLimit(
  value: string | undefined,
  defaultLimit = DEFAULT_LIMIT,
  maxLimit = MAX_LIMIT
): number {
  if (!value) return defaultLimit;

  const parsed = parseInt(value, 10);

  // Handle NaN or invalid values
  if (isNaN(parsed) || parsed < 1) return defaultLimit;

  // Clamp to max limit
  return Math.min(parsed, maxLimit);
}

/**
 * Parse and validate an offset query parameter
 *
 * @param value - Raw query string value
 * @param defaultOffset - Default offset if not provided (default: 0)
 * @returns Validated offset value (always >= 0)
 */
export function parseOffset(value: string | undefined, defaultOffset = DEFAULT_OFFSET): number {
  if (!value) return defaultOffset;

  const parsed = parseInt(value, 10);

  // Handle NaN or negative values
  if (isNaN(parsed) || parsed < 0) return defaultOffset;

  return parsed;
}

/**
 * Parse pagination parameters from query string
 *
 * @param limitValue - Raw limit query string value
 * @param offsetValue - Raw offset query string value
 * @param options - Optional configuration
 * @returns Validated pagination object
 */
export function parsePagination(
  limitValue: string | undefined,
  offsetValue: string | undefined,
  options: {
    defaultLimit?: number;
    maxLimit?: number;
    defaultOffset?: number;
  } = {}
): { limit: number; offset: number } {
  return {
    limit: parseLimit(limitValue, options.defaultLimit, options.maxLimit),
    offset: parseOffset(offsetValue, options.defaultOffset),
  };
}

