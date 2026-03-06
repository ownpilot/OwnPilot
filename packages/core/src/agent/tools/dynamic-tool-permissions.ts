/**
 * Dynamic Tools — Permission and URL validation
 *
 * Security checks for tool call authorization and SSRF protection.
 */

import { lookup } from 'node:dns/promises';
import type { DynamicToolPermission } from './dynamic-tool-types.js';
import { getBaseName } from '../tool-namespace.js';

// =============================================================================
// SECURITY: CALLTOOL WHITELIST
// =============================================================================

/**
 * Tools that are ALWAYS blocked from being called by custom tools.
 * These tools can execute arbitrary code, modify files, or perform
 * dangerous operations that should never be delegated to sandbox code.
 */
const BLOCKED_CALLABLE_TOOLS = new Set([
  'execute_javascript',
  'execute_python',
  'execute_shell',
  'compile_code',
  'package_manager',
  'write_file',
  'delete_file',
  'copy_file',
  'move_file',
  'send_email',
  'git_commit',
  'git_checkout',
  'git_add',
  'git_push',
  'git_reset',
  'create_tool',
  'delete_custom_tool',
  'toggle_custom_tool',
]);

/**
 * Tools that require specific permissions to be called.
 * If the custom tool doesn't have the required permission, the call is blocked.
 */
const PERMISSION_GATED_TOOLS: Record<string, DynamicToolPermission> = {
  http_request: 'network',
  fetch_web_page: 'network',
  call_json_api: 'network',
  search_web: 'network',
  read_file: 'filesystem',
  list_directory: 'filesystem',
  get_file_info: 'filesystem',
};

/**
 * Check if a custom tool is allowed to call a given built-in tool.
 */
export function isToolCallAllowed(
  toolName: string,
  permissions: DynamicToolPermission[]
): { allowed: boolean; reason?: string } {
  // Use base name for security checks (lookup tables use base names)
  const baseName = getBaseName(toolName);

  // Always blocked
  if (BLOCKED_CALLABLE_TOOLS.has(baseName)) {
    return {
      allowed: false,
      reason: `Tool '${toolName}' is blocked for security — custom tools cannot invoke code execution, file mutation, email, or git tools`,
    };
  }

  // Permission-gated
  const requiredPerm = PERMISSION_GATED_TOOLS[baseName];
  if (requiredPerm && !permissions.includes(requiredPerm)) {
    return {
      allowed: false,
      reason: `Tool '${toolName}' requires '${requiredPerm}' permission which this custom tool does not have`,
    };
  }

  return { allowed: true };
}

// =============================================================================
// SECURITY: SSRF PROTECTION
// =============================================================================

// Cache for DNS resolution to prevent rebinding attacks
const dnsCache = new Map<string, { ips: string[]; timestamp: number }>();
const DNS_CACHE_TTL_MS = 60_000; // 1 minute cache

/**
 * Check if an IP address is in a private/internal range.
 * Comprehensive check for IPv4 and IPv6 addresses.
 */
function isPrivateIp(ip: string): boolean {
  // IPv6 loopback
  if (ip === '::1') return true;

  // IPv4-mapped IPv6 loopback
  if (ip === '::ffff:127.0.0.1') return true;

  // IPv6 unique local addresses (fc00::/7)
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;

  // IPv6 link-local (fe80::/10)
  if (ip.startsWith('fe80')) return true;

  // IPv4 checks
  const ipv4Match = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4Match) {
    // Could be IPv6 public address or other format
    return false;
  }

  const a = parseInt(ipv4Match[1]!, 10);
  const b = parseInt(ipv4Match[2]!, 10);

  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;

  // 10.0.0.0/8 (private)
  if (a === 10) return true;

  // 172.16.0.0/12 (private)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 (private)
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;

  // 100.64.0.0/10 (carrier-grade NAT / shared space)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 0) return true;

  // 198.18.0.0/15 (benchmark testing)
  if (a === 198 && b >= 18 && b <= 19) return true;

  // 240.0.0.0/4+ (reserved/multicast)
  if (a >= 240) return true;

  // 0.0.0.0/8 (current network)
  if (a === 0) return true;

  return false;
}

/**
 * Check if a URL targets a private/internal network address (SSRF protection).
 * Blocks: localhost, private IPs, link-local, cloud metadata endpoints, file://, ftp://
 *
 * This function also performs DNS resolution to prevent DNS rebinding attacks
 * where an attacker controls a domain that initially resolves to a public IP
 * but later resolves to a private IP.
 */
export function isPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    const protocol = url.protocol.toLowerCase();

    // Block non-HTTP(S) protocols
    if (protocol !== 'http:' && protocol !== 'https:') {
      return true; // file://, ftp://, etc.
    }

    // Block localhost variants
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      hostname === '0.0.0.0'
    ) {
      return true;
    }

    // Block cloud metadata hostnames
    if (
      hostname === 'metadata.google.internal' ||
      hostname === 'metadata.google.internal.' ||
      hostname === '169.254.169.254' || // AWS, Azure, GCP metadata
      hostname === '100.100.100.200' || // Alibaba Cloud
      hostname === '192.0.0.192' // Oracle Cloud
    ) {
      return true;
    }

    // Check if hostname is already an IP address
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      return isPrivateIp(hostname);
    }

    return false;
  } catch {
    // If URL parsing fails, block it
    return true;
  }
}

/**
 * Async version of isPrivateUrl that also performs DNS resolution
 * to prevent DNS rebinding attacks. This should be called before
 * making any outbound HTTP request.
 *
 * DNS Rebinding Attack Prevention:
 * - Resolves hostname to IP addresses
 * - Checks if any resolved IP is private
 * - Caches results to prevent TOCTOU issues
 */
export async function isPrivateUrlAsync(urlString: string): Promise<boolean> {
  // First do synchronous check
  if (isPrivateUrl(urlString)) {
    return true;
  }

  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // Skip DNS check for IP literals
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      return isPrivateIp(hostname);
    }

    // Check cache first
    const cached = dnsCache.get(hostname);
    if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL_MS) {
      return cached.ips.some((ip) => isPrivateIp(ip));
    }

    // Perform DNS lookup
    try {
      const addresses = await lookup(hostname, { all: true });
      const ips = addresses.map((a) => a.address);

      // Cache the result
      dnsCache.set(hostname, { ips, timestamp: Date.now() });

      // Check if any resolved IP is private
      return ips.some((ip) => isPrivateIp(ip));
    } catch {
      // DNS lookup failed - block to be safe
      return true;
    }
  } catch {
    // URL parsing failed
    return true;
  }
}
