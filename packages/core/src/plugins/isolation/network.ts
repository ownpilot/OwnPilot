/**
 * Isolated network access: domain allowlist, SSRF block, rate limiting,
 * size limits, and bounded redirect handling.
 */

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

    if (isPrivateHostname(parsedUrl.hostname)) {
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
          if (isPrivateHostname(currentUrl.hostname)) {
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

      const body = await response.text();

      if (body.length > this.maxResponseSize) {
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

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;

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
    (a === 192 && b === 168)
  );
}
