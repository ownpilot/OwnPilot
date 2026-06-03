/**
 * Isolated network access: domain allowlist, SSRF block, rate limiting,
 * size limits, and bounded redirect handling.
 */

import { lookup } from 'node:dns/promises';

import type { PluginId } from '../../types/branded.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { getErrorMessage } from '../../services/error-utils.js';
import type {
  IsolatedNetwork,
  IsolatedFetchOptions,
  IsolatedResponse,
  NetworkError,
} from './types.js';

class RateLimiter {
  private requests: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number = 60, windowMs: number = 60000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  canRequest(): boolean {
    this.cleanup();
    return this.requests.length < this.limit;
  }

  recordRequest(): void {
    this.requests.push(Date.now());
  }

  getStatus(): { remaining: number; resetAt: Date } {
    this.cleanup();
    const oldest = this.requests[0];
    const resetAt = oldest ? new Date(oldest + this.windowMs) : new Date();

    return {
      remaining: Math.max(0, this.limit - this.requests.length),
      resetAt,
    };
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    this.requests = this.requests.filter((t) => t > cutoff);
  }
}

export class PluginIsolatedNetwork implements IsolatedNetwork {
  private readonly pluginId: PluginId;
  private readonly allowedDomains: string[];
  private readonly rateLimiter: RateLimiter;
  private readonly maxResponseSize = 10 * 1024 * 1024; // 10MB
  private readonly defaultTimeout = 30000;
  private readonly maxRedirects = 5;

  constructor(pluginId: PluginId, allowedDomains: string[] = ['*']) {
    this.pluginId = pluginId;
    this.allowedDomains = allowedDomains;
    this.rateLimiter = new RateLimiter(60, 60000);
  }

  async fetch(
    url: string,
    options: IsolatedFetchOptions = {}
  ): Promise<Result<IsolatedResponse, NetworkError>> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return err({ type: 'network_error', message: 'Invalid URL' });
    }

    if (!isHttpProtocol(parsedUrl)) {
      return err({ type: 'protocol_not_allowed', protocol: parsedUrl.protocol });
    }

    if (await isPrivateAddressAsync(parsedUrl.hostname)) {
      return err({ type: 'private_address_blocked', host: parsedUrl.hostname });
    }

    if (!this.isDomainAllowed(parsedUrl.hostname)) {
      return err({
        type: 'domain_not_allowed',
        domain: parsedUrl.hostname,
        allowed: this.allowedDomains,
      });
    }

    if (!this.rateLimiter.canRequest()) {
      const status = this.rateLimiter.getStatus();
      return err({
        type: 'rate_limited',
        retryAfter: Math.ceil((status.resetAt.getTime() - Date.now()) / 1000),
      });
    }

    this.rateLimiter.recordRequest();

    const headers: Record<string, string> = {
      'User-Agent': `OwnPilot-Plugin/${this.pluginId}`,
      ...options.headers,
    };

    // Remove potentially dangerous headers
    delete headers['Authorization'];
    delete headers['Cookie'];
    delete headers['X-API-Key'];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeout ?? this.defaultTimeout);
      let currentUrl = parsedUrl;
      let response: Response | undefined;

      try {
        for (let attempt = 0; attempt <= this.maxRedirects; attempt++) {
          response = await fetch(currentUrl.toString(), {
            method: options.method ?? 'GET',
            headers,
            body: options.body
              ? typeof options.body === 'string'
                ? options.body
                : JSON.stringify(options.body)
              : undefined,
            signal: controller.signal,
            redirect: 'manual',
          });

          if (response.status < 300 || response.status > 399) {
            break;
          }

          const location = response.headers.get('location');
          if (!location) {
            break;
          }

          if (attempt >= this.maxRedirects) {
            return err({ type: 'network_error', message: 'Too many redirects' });
          }

          currentUrl = new URL(location, currentUrl);
          if (!isHttpProtocol(currentUrl)) {
            return err({ type: 'protocol_not_allowed', protocol: currentUrl.protocol });
          }
          if (await isPrivateAddressAsync(currentUrl.hostname)) {
            return err({ type: 'private_address_blocked', host: currentUrl.hostname });
          }
          if (!this.isDomainAllowed(currentUrl.hostname)) {
            return err({
              type: 'domain_not_allowed',
              domain: currentUrl.hostname,
              allowed: this.allowedDomains,
            });
          }
        }
      } finally {
        clearTimeout(timeout);
      }

      if (!response) {
        return err({ type: 'network_error', message: 'No response' });
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > this.maxResponseSize) {
        return err({ type: 'response_too_large', maxSize: this.maxResponseSize });
      }

      // Enforce the size cap WHILE streaming. response.text() buffers the entire
      // body into memory before returning, so a response that omits (or lies
      // about) content-length could exhaust process memory long before the
      // post-read body.length check fired — the limit existed but never actually
      // bounded memory. Read incrementally and abort the moment the accumulated
      // bytes exceed maxResponseSize.
      const body = await this.readBodyWithCap(response);
      if (body === null) {
        return err({ type: 'response_too_large', maxSize: this.maxResponseSize });
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return ok({
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body,
        json<T>(): T {
          return JSON.parse(body) as T;
        },
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return err({ type: 'timeout', timeoutMs: options.timeout ?? this.defaultTimeout });
      }
      return err({
        type: 'network_error',
        message: getErrorMessage(e),
      });
    }
  }

  /**
   * Read a response body to a string, enforcing {@link maxResponseSize} as bytes
   * arrive. Returns `null` (and cancels the stream) the moment the accumulated
   * size exceeds the cap, so an unbounded/undeclared response can't buffer the
   * whole payload into memory. Falls back to text() when the platform Response
   * has no readable stream (e.g. some mocked responses).
   */
  private async readBodyWithCap(response: Response): Promise<string | null> {
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      return text.length > this.maxResponseSize ? null : text;
    }

    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > this.maxResponseSize) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  }

  isDomainAllowed(domain: string): boolean {
    if (this.allowedDomains.includes('*')) return true;

    const normalizedDomain = domain.toLowerCase();

    for (const allowed of this.allowedDomains) {
      if (allowed.toLowerCase() === normalizedDomain) return true;

      // Wildcard subdomain match (*.example.com)
      if (allowed.startsWith('*.')) {
        const baseDomain = allowed.substring(2).toLowerCase();
        if (normalizedDomain === baseDomain || normalizedDomain.endsWith('.' + baseDomain)) {
          return true;
        }
      }
    }

    return false;
  }

  getAllowedDomains(): readonly string[] {
    return [...this.allowedDomains];
  }

  getRateLimitStatus(): { remaining: number; resetAt: Date } {
    return this.rateLimiter.getStatus();
  }
}

function isHttpProtocol(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/**
 * Synchronous check for hostnames that are obviously private (literal IPs or
 * known reserved names). This is the fast path; {@link isPrivateAddressAsync}
 * is the authoritative check because it resolves DNS — without that, a
 * hostname like `evil.com` whose A record points at `169.254.169.254`
 * (cloud metadata endpoint) sails right past this function.
 */
function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;

  // IPv4-mapped IPv6: `::ffff:a.b.c.d` reaches the same v4 address.
  const v4mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4mapped) return isPrivateIpv4(v4mapped[1]!);

  return isPrivateIpv4(host);
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // CGNAT — 100.64.0.0/10
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * Resolve `hostname` to all A/AAAA records and reject if any address is
 * private. Without this, `evil.com -> 169.254.169.254` would pass the
 * literal-IP-only static check and reach the cloud metadata endpoint.
 * Results are cached briefly to keep redirect loops cheap, and DNS
 * failures fail-closed.
 */
const dnsBlockCache = new Map<string, { blocked: boolean; expiresAt: number }>();
const DNS_CACHE_TTL_MS = 60_000;

async function isPrivateAddressAsync(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

  if (isPrivateHostname(host)) return true;

  const now = Date.now();
  const cached = dnsBlockCache.get(host);
  if (cached && cached.expiresAt > now) return cached.blocked;

  try {
    const addrs = await lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateHostname(a.address)) {
        dnsBlockCache.set(host, { blocked: true, expiresAt: now + DNS_CACHE_TTL_MS });
        return true;
      }
    }
  } catch {
    return true;
  }

  dnsBlockCache.set(host, { blocked: false, expiresAt: now + DNS_CACHE_TTL_MS });
  return false;
}
