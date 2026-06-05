/**
 * Safe Fetch — SSRF-aware fetch with manual redirect following.
 *
 * - Uses redirect: 'manual' so Node.js never auto-follows redirects
 * - On each redirect hop, re-checks isPrivateUrlAsync before following
 * - Caps total redirects to prevent infinite redirect loops
 */

import { isBlockedUrl, isPrivateUrlAsync, isPrivateUrlAsyncFresh } from './ssrf.js';
import { getLog } from '../services/log.js';

const log = getLog('safeFetch');

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;
// Default 10MB max request body — declared before safeFetch so the
// destructuring default `maxRequestBodySize = DEFAULT_MAX_REQUEST_BODY_SIZE`
// (line ~48) is never evaluated in the Temporal Dead Zone.
export const DEFAULT_MAX_REQUEST_BODY_SIZE = 10 * 1024 * 1024;

/**
 * Options for safeFetch.
 *
 * `redirect` is forced to `'manual'` internally and cannot be overridden.
 * `signal` is honored when provided; otherwise safeFetch installs its own
 * AbortController tied to `timeoutMs`.
 */
interface SafeFetchOptions extends Omit<RequestInit, 'redirect'> {
  /** Maximum redirects to follow (default 5). 0 = no redirects. */
  maxRedirects?: number;
  /** Request timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Outbound request body size cap in bytes (default 10MB). */
  maxRequestBodySize?: number;
}

interface RedirectChain {
  urls: string[];
}

/**
 * Perform an SSRF-safe fetch with manual redirect following.
 *
 * @param url  The URL to fetch
 * @param options  Fetch options (redirect is forced to 'manual')
 * @returns  The fetch Response, or throws on SSRF block / redirect loop / timeout
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const {
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRequestBodySize = DEFAULT_MAX_REQUEST_BODY_SIZE,
    ...fetchOptions
  } = options;

  // Validate request body size before any network activity
  if (fetchOptions.body && typeof fetchOptions.body === 'string') {
    const bodyBytes = Buffer.byteLength(fetchOptions.body, 'utf8');
    if (maxRequestBodySize && bodyBytes > maxRequestBodySize) {
      throw new SafeFetchError(
        `Request body too large: ${bodyBytes} bytes (max: ${maxRequestBodySize})`,
        'BODY_TOO_LARGE'
      );
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs).unref?.() ?? undefined;

  let currentUrl = url;
  const chain: RedirectChain = { urls: [url] };

  const signal = fetchOptions.signal ?? controller.signal;

  try {
    for (let attempt = 0; attempt <= maxRedirects; attempt++) {
      // H-S17 fix: synchronous policy gate on EVERY hop. Catches blocked
      // protocols, embedded credentials in the URL, and numeric-IP
      // obfuscation in redirects — the original code only checked these on
      // the entry URL and re-checked `isPrivateUrl` (DNS) on redirects.
      if (isBlockedUrl(currentUrl)) {
        log.warn('safeFetch: blocked URL by sync policy', { url: currentUrl });
        throw new SafeFetchError(`Request to blocked URL: ${currentUrl}`, 'SSRF_BLOCKED');
      }

      // H-S4 fix: SSRF check on every hop, with a FRESH uncached DNS lookup
      // immediately before fetch. The cached `isPrivateUrlAsync` still
      // applies first (cheap shortcut), but the fresh check is what matters
      // here — it minimises the window in which an attacker DNS can return a
      // public IP to our check and a private IP to the fetch's own lookup.
      if (await isPrivateUrlAsync(currentUrl)) {
        log.warn('safeFetch: blocked private URL (cached)', { url: currentUrl });
        throw new SafeFetchError(
          `Request to private/internal address not allowed: ${currentUrl}`,
          'SSRF_BLOCKED'
        );
      }
      if (await isPrivateUrlAsyncFresh(currentUrl)) {
        log.warn('safeFetch: blocked private URL (fresh lookup — possible DNS rebinding)', {
          url: currentUrl,
        });
        throw new SafeFetchError(
          `Request to private/internal address not allowed (post-rebind check): ${currentUrl}`,
          'SSRF_BLOCKED'
        );
      }

      const response = await fetch(currentUrl, {
        ...fetchOptions,
        redirect: 'manual' as const,
        signal,
      });

      // Not a redirect — return directly
      if (response.status < 300 || response.status > 399) {
        return response;
      }

      // Too many redirects
      if (attempt >= maxRedirects) {
        throw new SafeFetchError(
          `Too many redirects (${attempt}) following URL chain: ${chain.urls.join(' → ')}`,
          'TOO_MANY_REDIRECTS'
        );
      }

      const location = response.headers.get('location');
      if (!location) {
        // 3xx with no Location header — treat as terminal
        return response;
      }

      // Resolve relative redirects (e.g. Location: /path)
      const base = new URL(currentUrl);
      currentUrl = new URL(location, base).toString();
      chain.urls.push(currentUrl);
    }

    // Should not reach here, but guard just in case
    throw new SafeFetchError('Redirect loop detected', 'TOO_MANY_REDIRECTS');
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * SafeFetch error codes — use these rather than string matching on message.
 */
export class SafeFetchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'SSRF_BLOCKED'
      | 'TOO_MANY_REDIRECTS'
      | 'BODY_TOO_LARGE'
      | 'TIMEOUT'
      | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}
