/**
 * Utility types for OwnPilot
 */

/**
 * JSON-serializable value
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * JSON object type
 */
export type JsonObject = { [key: string]: JsonValue };

/**
 * Deep readonly - makes all nested properties readonly
 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/**
 * Deep partial - makes all nested properties optional
 */
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/**
 * Make specific properties required
 */
export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

/**
 * Make specific properties optional
 */
export type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Make all properties mutable (remove readonly)
 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Extract keys of type V from object T
 */
export type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];

/**
 * Omit properties of type V from object T
 */
export type OmitByType<T, V> = Pick<T, { [K in keyof T]: T[K] extends V ? never : K }[keyof T]>;

/**
 * Async state for UI loading states
 */
export type AsyncState<T, E = Error> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'success'; readonly data: T }
  | { readonly status: 'error'; readonly error: E };

/**
 * Timestamp in ISO 8601 format
 */
export type ISOTimestamp = string;

/**
 * Duration in milliseconds
 */
export type DurationMs = number;

/**
 * Bytes count
 */
export type Bytes = number;

/**
 * Non-empty array type
 */
export type NonEmptyArray<T> = [T, ...T[]];

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run function with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutError?: Error
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(timeoutError ?? new Error(`Timeout after ${ms}ms`));
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 100,
    maxDelayMs = 5000,
    factor = 2,
    shouldRetry = () => true,
  } = options;

  let lastError: unknown;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      await sleep(delay);
      delay = Math.min(delay * factor, maxDelayMs);
    }
  }

  throw lastError;
}
