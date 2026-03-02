/**
 * Safe JSON parsing utilities
 *
 * Provides error-handled JSON parsing to prevent application crashes
 * from malformed JSON input.
 */

/**
 * Safely parse JSON string with error handling
 * @param jsonString - The JSON string to parse
 * @param options - Options for fallback behavior
 * @returns Parsed value or fallback on error
 */
export function safeJsonParse<T>(
  jsonString: string | null | undefined,
  options: {
    fallback?: T;
    onError?: (error: Error, input: string) => void;
  } = {}
): T | undefined {
  const { fallback, onError } = options;

  if (jsonString == null) {
    return fallback;
  }

  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    if (onError && error instanceof Error) {
      onError(error, jsonString);
    }
    return fallback;
  }
}

/**
 * Safely parse JSON string with guaranteed fallback value
 * @param jsonString - The JSON string to parse
 * @param defaultValue - Value to return on parse error (required)
 * @returns Parsed value or defaultValue on error
 */
export function safeJsonParseWithDefault<T>(
  jsonString: string | null | undefined,
  defaultValue: T
): T {
  if (jsonString == null) {
    return defaultValue;
  }

  try {
    return JSON.parse(jsonString) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Safely stringify value to JSON with error handling
 * @param value - Value to stringify
 * @param options - Options for fallback behavior
 * @returns JSON string or fallback on error
 */
export function safeJsonStringify(
  value: unknown,
  options: {
    fallback?: string;
    space?: string | number;
    onError?: (error: Error) => void;
  } = {}
): string | undefined {
  const { fallback, space, onError } = options;

  try {
    return JSON.stringify(value, null, space);
  } catch (error) {
    if (onError && error instanceof Error) {
      onError(error);
    }
    return fallback;
  }
}

/**
 * Type guard to check if a string is valid JSON
 * @param str - String to check
 * @returns True if valid JSON
 */
export function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}
