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
  'edit_file',
  'delete_file',
  'copy_file',
  'move_file',
  'create_directory',
  'send_email',
  'git_commit',
  'git_checkout',
  'git_add',
  'git_push',
  'git_reset',
  // git_stash mutates working-tree state (save can lose untracked work, pop
  // can produce merge conflicts). Read-only git_show / git_blame stay
  // outside the block list — they belong with status/diff/log.
  'git_stash',
  // H-S11: git_branch supports create/delete/rename actions — it's a mutation
  // tool and was missed in the original block list. Read-only git tools
  // (git_status, git_diff, git_log) are intentionally left allowed since
  // filesystem permission already lets the extension read the same content.
  'git_branch',
  'create_tool',
  'delete_custom_tool',
  'toggle_custom_tool',
  // Defense-in-depth: `calculate` once shipped a vm-based evaluator; keep it on
  // the hard-block list so a future regression cannot re-introduce a sandbox
  // escape via the `utils.callTool` path.
  'calculate',
]);

/**
 * Returns true if a tool is on the unconditional callTool blocklist.
 * Used by extension and custom-tool sandboxes to guarantee that shell, file
 * mutation, email, git, and code-execution tools are never reachable via
 * `utils.callTool(...)`, regardless of granted permissions.
 */
export function isCallToolHardBlocked(toolName: string): boolean {
  return BLOCKED_CALLABLE_TOOLS.has(getBaseName(toolName));
}

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
 * Verb prefixes that denote read-only / inspection tools. In strict mode these
 * remain callable without a declared permission; everything else (mutation,
 * outbound messaging, autonomy/agent control, scheduling) is denied by default.
 */
const SAFE_READONLY_PREFIXES = [
  'get_',
  'list_',
  'read_',
  'search_',
  'find_',
  'fetch_',
  'check_',
  'count_',
  'query_',
  'describe_',
  'show_',
  'lookup_',
  'inspect_',
  'preview_',
];

/**
 * Whether strict callTool gating is enabled. In the DEFAULT (non-strict) mode,
 * a custom tool may call any built-in tool that is not hard-blocked and not
 * permission-gated (allow-by-default). Strict mode flips that to default-deny:
 * only read-only-safe and explicitly-permissioned tools are reachable, which
 * closes powerful-but-unblocked tools (start_claw, channel send, memory/goal/
 * trigger mutation, etc.) from being invoked by sandbox code with zero
 * permissions. Opt in with OWNPILOT_STRICT_CALLTOOL=true.
 */
function strictCallToolEnabled(): boolean {
  return process.env.OWNPILOT_STRICT_CALLTOOL === 'true';
}

/**
 * Check if a custom tool is allowed to call a given built-in tool.
 *
 * @param opts.strict Force strict mode regardless of env (testing/explicit use).
 */
export function isToolCallAllowed(
  toolName: string,
  permissions: DynamicToolPermission[],
  opts?: { strict?: boolean }
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

  // Strict opt-in default-deny: a tool that is neither permission-gated nor a
  // read-only-safe inspection tool is blocked. Read-only tools (get_/list_/
  // read_/search_/…) and permission-gated tools that passed the check above
  // remain callable; mutating/outbound/autonomy tools do not.
  const strict = opts?.strict ?? strictCallToolEnabled();
  if (strict && !requiredPerm) {
    const isSafeReadOnly = SAFE_READONLY_PREFIXES.some((p) => baseName.startsWith(p));
    if (!isSafeReadOnly) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' is blocked in strict callTool mode (OWNPILOT_STRICT_CALLTOOL): custom tools may only call read-only or explicitly-permissioned tools`,
      };
    }
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
  let addr = ip.toLowerCase();

  // IPv4-mapped / IPv4-compatible IPv6 (e.g. ::ffff:169.254.169.254, ::10.0.0.1).
  // Reduce to the embedded IPv4 so the IPv4 rules below catch ANY mapped private
  // address — not just mapped loopback. A hostname can publish an AAAA record of
  // ::ffff:169.254.169.254 and the dual-stack OS will connect it to the IPv4
  // metadata endpoint, so a mapped form must not bypass the private-range check.
  const mappedV4 = addr.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedV4) addr = mappedV4[1]!;

  // IPv6 loopback
  if (addr === '::1') return true;

  // IPv6 unique local addresses (fc00::/7)
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true;

  // IPv6 link-local (fe80::/10)
  if (addr.startsWith('fe80')) return true;

  // IPv4 checks
  const ipv4Match = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
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
