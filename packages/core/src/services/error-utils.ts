/**
 * Error Utility
 *
 * Extracts error messages from unknown catch values.
 */

/**
 * Extract error message from an unknown catch value.
 * Without a fallback, stringifies non-Error values via String().
 * With a fallback, returns the fallback for non-Error values.
 */
export function getErrorMessage(error: unknown, fallback?: string): string {
  return error instanceof Error ? error.message : (fallback ?? String(error));
}
