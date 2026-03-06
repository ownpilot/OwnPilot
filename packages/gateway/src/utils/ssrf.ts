/**
 * SSRF Protection Utilities
 *
 * Shared hostname and DNS-rebinding checks for any gateway code that
 * makes outbound HTTP requests on behalf of users.
 */

import { lookup } from 'node:dns/promises';

/** Private/loopback/metadata hostname prefixes that are always blocked */
const BLOCKED_HOSTS = [
  'localhost',
  '127.',
  '0.0.0.0',
  '10.',
  '192.168.',
  '169.254.',
  '[::1]',
  '[fe80:',
  '[fc00:',
  '[fd00:',
  'metadata.google.internal',
];

/**
 * Quick synchronous check: blocks private hostnames, credentials in URLs,
 * non-HTTP(S) protocols, and numeric IP obfuscation tricks.
 */
export function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    if (parsed.username || parsed.password) return true;
    const h = parsed.hostname.toLowerCase();
    // Block numeric-only hostnames (IP obfuscation: 0x7f000001, 0177.0.0.1, 2130706433)
    if (/^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(h)) return true;
    // Block 172.16.0.0/12 range
    const m172 = h.match(/^172\.(\d+)\./);
    if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
    return BLOCKED_HOSTS.some((b) => h === b || h.startsWith(b));
  } catch {
    return true;
  }
}

/**
 * Async DNS-rebinding protection: resolves the hostname and checks whether
 * any returned IP is a private/loopback address.
 *
 * Uses a 1-minute cache to avoid repeated DNS lookups for the same host.
 */
const dnsCache = new Map<string, { ips: string[]; ts: number }>();
const DNS_TTL = 60_000;

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

export async function isPrivateUrlAsync(urlString: string): Promise<boolean> {
  try {
    const hostname = new URL(urlString).hostname;
    const now = Date.now();
    const cached = dnsCache.get(hostname);
    let ips: string[];

    if (cached && now - cached.ts < DNS_TTL) {
      ips = cached.ips;
    } else {
      const records = await lookup(hostname, { all: true });
      ips = records.map((r) => r.address);
      dnsCache.set(hostname, { ips, ts: now });
    }

    return ips.some((ip) => PRIVATE_RANGES.some((re) => re.test(ip)));
  } catch {
    return false; // DNS failure: let the request proceed, will fail at fetch
  }
}
