/**
 * Dynamic Tools — Permission and URL validation
 *
 * Security checks for tool call authorization and SSRF protection.
 */

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

/**
 * Check if a URL targets a private/internal network address (SSRF protection).
 * Blocks: localhost, private IPs, link-local, cloud metadata endpoints, file://, ftp://
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

    // Block private IPv4 ranges
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      // 10.0.0.0/8
      if (a === 10) return true;
      // 172.16.0.0/12
      if (a === 172 && b! >= 16 && b! <= 31) return true;
      // 192.168.0.0/16
      if (a === 192 && b === 168) return true;
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return true;
      // Cloud metadata endpoints
      if (a === 169 && b === 254 && ipv4Match[3] === '169' && ipv4Match[4] === '254') return true;
      // 100.100.100.200 (Alibaba cloud metadata)
      if (hostname === '100.100.100.200') return true;
      // 0.0.0.0/8
      if (a === 0) return true;
    }

    // Block cloud metadata hostnames
    if (hostname === 'metadata.google.internal') return true;

    return false;
  } catch {
    // If URL parsing fails, block it
    return true;
  }
}
