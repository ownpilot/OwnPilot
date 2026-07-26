/**
 * SSRF Protection Utilities Tests
 *
 * Unit tests for isBlockedUrl() (sync) and isPrivateUrlAsync() (async + DNS).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DNS before importing the module under test
const mockLookup = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

// Import AFTER mock is in place
const { isBlockedUrl, isPrivateUrlAsync, resolvePublicAddressesFresh } = await import('./ssrf.js');

// ---------------------------------------------------------------------------
// isBlockedUrl — synchronous checks
// ---------------------------------------------------------------------------

describe('isBlockedUrl', () => {
  // --- Valid public URLs ---

  it('allows a normal public HTTPS URL', () => {
    expect(isBlockedUrl('https://example.com/page')).toBe(false);
  });

  it('allows a normal public HTTP URL', () => {
    expect(isBlockedUrl('http://example.com')).toBe(false);
  });

  it('allows a public IP address', () => {
    expect(isBlockedUrl('https://93.184.216.34/path')).toBe(false);
  });

  // --- Protocol checks ---

  it('blocks ftp:// protocol', () => {
    expect(isBlockedUrl('ftp://example.com')).toBe(true);
  });

  it('blocks file:// protocol', () => {
    expect(isBlockedUrl('file:///etc/passwd')).toBe(true);
  });

  it('blocks data: protocol', () => {
    expect(isBlockedUrl('data:text/html,<h1>hi</h1>')).toBe(true);
  });

  // --- Credentials in URL ---

  it('blocks URL with username', () => {
    expect(isBlockedUrl('https://user@example.com')).toBe(true);
  });

  it('blocks URL with username and password', () => {
    expect(isBlockedUrl('https://user:pass@example.com')).toBe(true);
  });

  // --- Localhost / loopback ---

  it('blocks localhost', () => {
    expect(isBlockedUrl('http://localhost/admin')).toBe(true);
  });

  it('blocks 127.0.0.1', () => {
    expect(isBlockedUrl('http://127.0.0.1:8080')).toBe(true);
  });

  it('blocks 127.x.x.x range', () => {
    expect(isBlockedUrl('http://127.99.0.1')).toBe(true);
  });

  it('blocks IPv6 loopback [::1]', () => {
    expect(isBlockedUrl('http://[::1]/path')).toBe(true);
  });

  // --- Private RFC-1918 ranges ---

  it('blocks 10.0.0.0/8', () => {
    expect(isBlockedUrl('http://10.0.0.1')).toBe(true);
  });

  it('blocks 10.255.255.255', () => {
    expect(isBlockedUrl('http://10.255.255.255')).toBe(true);
  });

  it('blocks 192.168.0.0/16', () => {
    expect(isBlockedUrl('http://192.168.1.100')).toBe(true);
  });

  it('blocks 172.16.0.0/12 start (172.16.x.x)', () => {
    expect(isBlockedUrl('http://172.16.0.1')).toBe(true);
  });

  it('blocks 172.31.x.x (last of /12)', () => {
    expect(isBlockedUrl('http://172.31.255.255')).toBe(true);
  });

  it('allows 172.15.x.x (just below /12)', () => {
    expect(isBlockedUrl('http://172.15.0.1')).toBe(false);
  });

  it('allows 172.32.x.x (just above /12)', () => {
    expect(isBlockedUrl('http://172.32.0.1')).toBe(false);
  });

  // --- Link-local / metadata ---

  it('blocks 169.254.x.x (link-local)', () => {
    expect(isBlockedUrl('http://169.254.169.254')).toBe(true);
  });

  it('blocks metadata.google.internal', () => {
    expect(isBlockedUrl('http://metadata.google.internal/computeMetadata/v1/')).toBe(true);
  });

  it('blocks 0.0.0.0', () => {
    expect(isBlockedUrl('http://0.0.0.0')).toBe(true);
  });

  // --- IPv6 private ranges ---

  it('blocks fe80:: link-local IPv6', () => {
    expect(isBlockedUrl('http://[fe80::1]')).toBe(true);
  });

  it('blocks fc00:: unique-local IPv6', () => {
    expect(isBlockedUrl('http://[fc00::1]')).toBe(true);
  });

  it('blocks fd00:: unique-local IPv6', () => {
    expect(isBlockedUrl('http://[fd00::1]')).toBe(true);
  });

  // --- Numeric IP obfuscation ---

  it('blocks decimal-encoded IP (2130706433 = 127.0.0.1)', () => {
    expect(isBlockedUrl('http://2130706433')).toBe(true);
  });

  it('blocks octal-encoded IP (0177.0.0.1 = 127.0.0.1)', () => {
    expect(isBlockedUrl('http://0177.0.0.1')).toBe(true);
  });

  it('blocks hex-encoded IP (0x7f000001 = 127.0.0.1)', () => {
    expect(isBlockedUrl('http://0x7f000001')).toBe(true);
  });

  // --- Invalid URL ---

  it('blocks completely invalid URL string', () => {
    expect(isBlockedUrl('not a url')).toBe(true);
  });

  it('blocks empty string', () => {
    expect(isBlockedUrl('')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isPrivateUrlAsync — DNS-based checks
// ---------------------------------------------------------------------------

describe('isPrivateUrlAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false for a public IP resolved from hostname', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const result = await isPrivateUrlAsync('https://public-host-a.example.com');
    expect(result).toBe(false);
  });

  it('returns true when hostname resolves to 10.x.x.x', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
    const result = await isPrivateUrlAsync('https://private-10-host.example.com');
    expect(result).toBe(true);
  });

  it('returns true when hostname resolves to 127.x.x.x', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const result = await isPrivateUrlAsync('https://loopback-host.example.com');
    expect(result).toBe(true);
  });

  it('returns true when hostname resolves to 192.168.x.x', async () => {
    mockLookup.mockResolvedValue([{ address: '192.168.1.50', family: 4 }]);
    const result = await isPrivateUrlAsync('https://lan-host.example.com');
    expect(result).toBe(true);
  });

  it('returns true when hostname resolves to 172.16.x.x', async () => {
    mockLookup.mockResolvedValue([{ address: '172.16.0.1', family: 4 }]);
    const result = await isPrivateUrlAsync('https://vpn-host.example.com');
    expect(result).toBe(true);
  });

  it('returns true when hostname resolves to 169.254.x.x (link-local)', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const result = await isPrivateUrlAsync('https://metadata-host.example.com');
    expect(result).toBe(true);
  });

  it('returns true when hostname resolves to IPv6 loopback ::1', async () => {
    mockLookup.mockResolvedValue([{ address: '::1', family: 6 }]);
    const result = await isPrivateUrlAsync('https://ipv6-loopback-host.example.com');
    expect(result).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 loopback addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '::ffff:127.0.0.1', family: 6 }]);
    const result = await isPrivateUrlAsync('https://mapped-loopback.example.com');
    expect(result).toBe(true);
  });

  it('blocks carrier-grade NAT addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '100.64.10.20', family: 4 }]);
    const result = await isPrivateUrlAsync('https://cgnat-host.example.com');
    expect(result).toBe(true);
  });

  it.each([
    ['IPv6 unspecified', '::', 6],
    ['IPv6 multicast', 'ff02::1', 6],
    ['IPv4 multicast', '224.0.0.1', 4],
  ])('blocks %s DNS answers', async (_label, address, family) => {
    mockLookup.mockResolvedValue([{ address, family }]);
    const hostSuffix = address.replace(/[^a-z0-9]/gi, '-');
    const result = await isPrivateUrlAsync(`https://reserved-${hostSuffix}.example.com`);
    expect(result).toBe(true);
  });

  it('returns true if ANY resolved IP is private (multi-A-record)', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 }, // public
      { address: '10.0.0.1', family: 4 }, // private
    ]);
    const result = await isPrivateUrlAsync('https://multi-record-host.example.com');
    expect(result).toBe(true);
  });

  it('returns true when DNS lookup throws (fail closed for safety)', async () => {
    mockLookup.mockRejectedValue(new Error('DNS NXDOMAIN'));
    const result = await isPrivateUrlAsync('https://nonexistent-domain-xyz.example.com');
    expect(result).toBe(true);
  });

  it('caches DNS results — only calls lookup once for same hostname', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await isPrivateUrlAsync('https://cached-host-abc.example.com');
    await isPrivateUrlAsync('https://cached-host-abc.example.com');
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it('returns true for malformed URL string (fail closed)', async () => {
    const result = await isPrivateUrlAsync('not-a-url');
    expect(result).toBe(true);
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

describe('resolvePublicAddressesFresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the exact public addresses that a socket can pin', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);

    await expect(resolvePublicAddressesFresh('https://example.com/resource')).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it('fails closed when any fresh answer is private', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '::ffff:169.254.169.254', family: 6 },
    ]);

    await expect(
      resolvePublicAddressesFresh('https://rebind.example.com/resource')
    ).resolves.toBeNull();
  });

  it('fails closed for empty or failed DNS answers', async () => {
    mockLookup.mockResolvedValueOnce([]);
    await expect(resolvePublicAddressesFresh('https://empty.example.com')).resolves.toBeNull();

    mockLookup.mockRejectedValueOnce(new Error('DNS failure'));
    await expect(resolvePublicAddressesFresh('https://failed.example.com')).resolves.toBeNull();
  });
});
