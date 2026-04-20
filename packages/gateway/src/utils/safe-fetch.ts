/**
 * Safe Fetch — SSRF-aware fetch with manual redirect following.
 *
 * - Uses redirect: 'manual' so Node.js never auto-follows redirects
 * - On each redirect hop, re-checks isPrivateUrlAsync before following
 * - Caps total redirects to prevent infinite redirect loops
 */

import { isPrivateUrlAsync } from './ssrf.js';
import { getLog } from '../services/log.js';

const log = getLog('safeFetch');

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Options for safeFetch.
 */
export interface SafeFetchOptions extends Omit<RequestInit, 'signal' | 'redirect'> {
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
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signal = ((fetchOptions as any).signal as AbortSignal | undefined) ?? controller.signal;

  try {
    for (let attempt = 0; attempt <= maxRedirects; attempt++) {
      // SSRF check on every hop
      if (await isPrivateUrlAsync(currentUrl)) {
        log.warn('safeFetch: blocked private URL in redirect chain', { url: currentUrl });
        throw new SafeFetchError(
          `Request to private/internal address not allowed: ${currentUrl}`,
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
    clearTimeout(timeout);
  }
}

/**
 * SafeFetch error codes — use these rather than string matching on message.
 */
export class SafeFetchError extends Error {
  constructor(
    message: string,
    public readonly code: 'SSRF_BLOCKED' | 'TOO_MANY_REDIRECTS' | 'BODY_TOO_LARGE' | 'TIMEOUT' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

// Default 10MB max request body
export const DEFAULT_MAX_REQUEST_BODY_SIZE = 10 * 1024 * 1024;
