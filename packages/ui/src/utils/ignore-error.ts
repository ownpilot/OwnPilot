/**
 * Fire-and-forget promise helpers for the UI.
 *
 * `ignoreError` and `runAndIgnore` replace the `.catch(() => {})` pattern that
 * silently swallows every async failure in event handlers, effects, and
 * "kick this off but don't await it" calls. The original pattern hides real
 * bugs (network errors, race conditions, stale tokens) and makes the UI feel
 * mysteriously broken with no console trail.
 *
 * Use the appropriate helper based on what you have:
 *  - `ignoreError(promise, tag?)`   — when you already have a Promise
 *  - `runAndIgnore(async fn, tag?)` — when you have an async function to call
 *
 * `tag` is a short string surfaced in the dev-tools warning so the source of a
 * swallowed failure is identifiable. Errors are logged at `console.warn`;
 * upgrade to `console.error` if you find a swallowed failure that breaks the
 * UI flow and should be louder.
 *
 * Example:
 *   ignoreError(api.savePrefs(prefs), 'savePrefs');
 *   runAndIgnore(() => api.savePrefs(prefs), 'savePrefs');
 */

/**
 * Swallow a rejection from a Promise. The error is still logged so failures
 * are visible in dev tools rather than completely silent.
 */
export function ignoreError<T>(promise: Promise<T> | undefined | null, tag?: string): void {
  if (!promise || typeof (promise as Promise<T>).catch !== 'function') return;
  (promise as Promise<T>).catch((err: unknown) => {
    console.warn(`[ignored${tag ? ` ${tag}` : ''}]`, err);
  });
}

/**
 * Returns a rejection handler suitable for the middle of a promise chain
 * (`.then(...).catch(silentCatch('tag')).finally(...)`), where `ignoreError`
 * doesn't fit because the chain continues past the catch.
 */
export function silentCatch(tag?: string): (err: unknown) => void {
  return (err: unknown) => {
    console.warn(`[ignored${tag ? ` ${tag}` : ''}]`, err);
  };
}

/**
 * Invoke a sync-or-async function and ignore any rejection. Convenient for
 * inline "fire and forget" calls inside effects or event handlers where you'd
 * otherwise need to wrap in an IIFE.
 */
export function runAndIgnore<T>(fn: () => Promise<T> | T, tag?: string): void {
  try {
    const result = fn();
    if (result && typeof (result as Promise<T>).catch === 'function') {
      (result as Promise<T>).catch((err: unknown) => {
        console.warn(`[ignored${tag ? ` ${tag}` : ''}]`, err);
      });
    }
  } catch (err) {
    console.warn(`[ignored${tag ? ` ${tag}` : ''}]`, err);
  }
}
