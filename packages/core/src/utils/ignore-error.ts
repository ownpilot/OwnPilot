/**
 * Fire-and-forget promise helpers for core and gateway code.
 *
 * These helpers make intentional rejection swallowing explicit without forcing
 * every low-level package to depend on a logger. Callers that want visibility
 * can pass `onError`; otherwise behavior matches a deliberate no-op catch.
 */

export type IgnoredErrorHandler = (error: unknown, tag?: string) => void;

export function silentCatch(tag?: string, onError?: IgnoredErrorHandler): (error: unknown) => void {
  return (error: unknown) => {
    onError?.(error, tag);
  };
}

export function ignoreError<T>(
  promise: Promise<T> | undefined | null,
  tag?: string,
  onError?: IgnoredErrorHandler
): void {
  if (!promise || typeof promise.catch !== 'function') return;
  void promise.catch(silentCatch(tag, onError));
}
