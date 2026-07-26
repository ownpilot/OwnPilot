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
    // Block dot-separated decimal shorthand: 127.1 → 127.0.0.1, 127.2, 127.255, etc.
    // Must check BEFORE the 172 check since all-decimal strings pass the 172 regex too.
    if (/^\d{1,3}(\.\d{1,3})+$/.test(h)) {
      const octets = h.split('.').map((o) => Number(o));
      // Block any octet >= 224 ( multicast / reserved ) or leading-zero forms
      // that survived the regex. Also block 127.x (loopback shorthand).
      if (octets.some((o) => o > 255) || octets[0] === 127) return true;
    }
    // Block 172.16.0.0/12 range — parse octets to avoid zero-padding bypass:
    // "016" → Number("016") = 14 (not >= 16), but 172.016.0.0 is still 172.16.0.0.
    const m172 = h.match(/^172\.(\d+)\./);
    if (m172) {
      const second = Number(m172[1]); // Number("016") = 14 — strips leading zeros
      if (second >= 16 && second <= 31) return true;
    }
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

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (normalized === '::' || normalized.startsWith('ff')) return true;
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  const candidate = mappedIpv4 ?? normalized;
  const octets = candidate.split('.').map(Number);

  if (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [a, b] = octets as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  return PRIVATE_RANGES.some((re) => re.test(candidate));
}

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

    return ips.some(isPrivateAddress);
  } catch {
    return true; // DNS failure: block the request (fail-closed for safety)
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Resolve every address for a URL and return it only when the whole answer set
 * is public. Callers can pin their socket lookup to one of these exact results,
 * eliminating the DNS-validation-to-connect race.
 */
export async function resolvePublicAddressesFresh(
  urlString: string
): Promise<ResolvedAddress[] | null> {
  try {
    const hostname = new URL(urlString).hostname;
    const records = await lookup(hostname, { all: true });
    if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) {
      return null;
    }

    const addresses = records
      .filter((record): record is typeof record & { family: 4 | 6 } =>
        [4, 6].includes(record.family)
      )
      .map(({ address, family }) => ({ address, family }));
    if (addresses.length === 0) return null;

    dnsCache.set(hostname, { ips: addresses.map((record) => record.address), ts: Date.now() });
    return addresses;
  } catch {
    return null;
  }
}

/**
 * Uncached variant of {@link isPrivateUrlAsync} — performs a fresh DNS lookup
 * every call. Retained for compatibility; network callers that need to remove
 * DNS-rebinding TOCTOU entirely should use {@link resolvePublicAddressesFresh}
 * and pin the returned addresses in their socket lookup.
 */
export async function isPrivateUrlAsyncFresh(urlString: string): Promise<boolean> {
  return (await resolvePublicAddressesFresh(urlString)) === null;
}
