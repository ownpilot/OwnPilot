/**
 * Tests for dynamic tool permission and URL validation
 *
 * Covers: isToolCallAllowed, isPrivateUrl
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DNS so isPrivateUrlAsync resolves test hostnames to controlled IPs.
const dnsLookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: dnsLookupMock }));

import { isToolCallAllowed, isPrivateUrl, isPrivateUrlAsync } from './dynamic-tool-permissions.js';
import type { DynamicToolPermission } from './dynamic-tool-types.js';

// =============================================================================
// isToolCallAllowed
// =============================================================================

describe('isToolCallAllowed', () => {
  // --- Blocked tools ---

  describe('blocked tools', () => {
    const blockedTools = [
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
      'git_branch',
      'create_tool',
      'delete_custom_tool',
      'toggle_custom_tool',
    ];

    for (const tool of blockedTools) {
      it(`blocks "${tool}" regardless of permissions`, () => {
        const allPerms: DynamicToolPermission[] = [
          'network',
          'filesystem',
          'shell',
          'database',
          'email',
          'scheduling',
          'local',
        ];
        const result = isToolCallAllowed(tool, allPerms);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('blocked for security');
      });
    }

    it('blocks tool with qualified name (uses baseName)', () => {
      const result = isToolCallAllowed('core.execute_shell', []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked for security');
    });
  });

  // --- Permission-gated tools ---

  describe('permission-gated tools', () => {
    it('allows http_request with network permission', () => {
      const result = isToolCallAllowed('http_request', ['network']);
      expect(result.allowed).toBe(true);
    });

    it('blocks http_request without network permission', () => {
      const result = isToolCallAllowed('http_request', []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("requires 'network' permission");
    });

    it('allows fetch_web_page with network permission', () => {
      const result = isToolCallAllowed('fetch_web_page', ['network']);
      expect(result.allowed).toBe(true);
    });

    it('blocks fetch_web_page without network permission', () => {
      const result = isToolCallAllowed('fetch_web_page', ['filesystem']);
      expect(result.allowed).toBe(false);
    });

    it('allows call_json_api with network permission', () => {
      const result = isToolCallAllowed('call_json_api', ['network']);
      expect(result.allowed).toBe(true);
    });

    it('blocks call_json_api without network permission', () => {
      const result = isToolCallAllowed('call_json_api', []);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("requires 'network' permission");
    });

    it('allows search_web with network permission', () => {
      const result = isToolCallAllowed('search_web', ['network']);
      expect(result.allowed).toBe(true);
    });

    it('blocks search_web without network permission', () => {
      const result = isToolCallAllowed('search_web', []);
      expect(result.allowed).toBe(false);
    });

    it('allows read_file with filesystem permission', () => {
      const result = isToolCallAllowed('read_file', ['filesystem']);
      expect(result.allowed).toBe(true);
    });

    it('blocks read_file without filesystem permission', () => {
      const result = isToolCallAllowed('read_file', ['network']);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("requires 'filesystem' permission");
    });

    it('allows list_directory with filesystem permission', () => {
      const result = isToolCallAllowed('list_directory', ['filesystem']);
      expect(result.allowed).toBe(true);
    });

    it('blocks list_directory without filesystem permission', () => {
      const result = isToolCallAllowed('list_directory', []);
      expect(result.allowed).toBe(false);
    });

    it('allows get_file_info with filesystem permission', () => {
      const result = isToolCallAllowed('get_file_info', ['filesystem']);
      expect(result.allowed).toBe(true);
    });

    it('blocks get_file_info without filesystem permission', () => {
      const result = isToolCallAllowed('get_file_info', []);
      expect(result.allowed).toBe(false);
    });

    it('handles qualified names for permission-gated tools', () => {
      const result = isToolCallAllowed('core.read_file', ['filesystem']);
      expect(result.allowed).toBe(true);
    });

    it('blocks qualified names for permission-gated tools without permission', () => {
      const result = isToolCallAllowed('core.http_request', []);
      expect(result.allowed).toBe(false);
    });
  });

  // --- Allowed tools ---

  describe('allowed tools', () => {
    it('allows unknown tool with no permissions', () => {
      const result = isToolCallAllowed('get_current_time', []);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows unknown qualified tool', () => {
      const result = isToolCallAllowed('core.get_time', []);
      expect(result.allowed).toBe(true);
    });
  });

  // --- Strict opt-in default-deny mode (OWNPILOT_STRICT_CALLTOOL) ---

  describe('strict callTool mode (opts.strict)', () => {
    it('still allows read-only-safe tools in strict mode', () => {
      for (const name of ['get_current_time', 'list_tasks', 'search_notes', 'read_setting']) {
        expect(isToolCallAllowed(name, [], { strict: true }).allowed).toBe(true);
      }
    });

    it('blocks powerful non-readonly tools in strict mode that are allowed by default', () => {
      for (const name of ['start_claw', 'send_channel_message', 'create_trigger', 'store_memory']) {
        // Default (non-strict): allowed.
        expect(isToolCallAllowed(name, []).allowed).toBe(true);
        // Strict: denied with a clear reason mentioning the flag.
        const strict = isToolCallAllowed(name, [], { strict: true });
        expect(strict.allowed).toBe(false);
        expect(strict.reason).toContain('strict callTool mode');
      }
    });

    it('still permits permission-gated tools in strict mode when the permission is granted', () => {
      expect(isToolCallAllowed('http_request', ['network'], { strict: true }).allowed).toBe(true);
      expect(isToolCallAllowed('read_file', ['filesystem'], { strict: true }).allowed).toBe(true);
    });

    it('still hard-blocks the blocklist in strict mode', () => {
      expect(isToolCallAllowed('execute_shell', [], { strict: true }).allowed).toBe(false);
    });

    it('honors qualified names in strict mode (base-name resolution)', () => {
      expect(isToolCallAllowed('core.start_claw', [], { strict: true }).allowed).toBe(false);
      expect(isToolCallAllowed('core.get_time', [], { strict: true }).allowed).toBe(true);
    });
  });

  // --- Key fixed tools are callable from custom extensions ---

  describe('fixed tools accessible via callTool', () => {
    const noPerms: never[] = [];

    it.each(['create_artifact', 'update_artifact', 'list_artifacts'])(
      'artifact tool %s is callable without special permissions',
      (name) => {
        expect(isToolCallAllowed(name, noPerms).allowed).toBe(true);
      }
    );

    it.each([
      'list_edge_devices',
      'get_device_status',
      'read_sensor',
      'send_device_command',
      'control_actuator',
    ])('edge tool %s is callable without special permissions', (name) => {
      expect(isToolCallAllowed(name, noPerms).allowed).toBe(true);
    });

    it.each(['create_plan', 'add_plan_step', 'list_plans', 'get_plan_details', 'execute_plan'])(
      'plan tool %s is callable without special permissions',
      (name) => {
        expect(isToolCallAllowed(name, noPerms).allowed).toBe(true);
      }
    );

    it('fetch_web_page requires network permission', () => {
      expect(isToolCallAllowed('fetch_web_page', noPerms).allowed).toBe(false);
      expect(isToolCallAllowed('fetch_web_page', ['network']).allowed).toBe(true);
    });

    it('call_json_api requires network permission', () => {
      expect(isToolCallAllowed('call_json_api', noPerms).allowed).toBe(false);
      expect(isToolCallAllowed('call_json_api', ['network']).allowed).toBe(true);
    });
  });
});

// =============================================================================
// isPrivateUrl
// =============================================================================

describe('isPrivateUrl', () => {
  // --- Public URLs ---

  describe('public URLs', () => {
    it('allows https://example.com', () => {
      expect(isPrivateUrl('https://example.com')).toBe(false);
    });

    it('allows http://api.example.com', () => {
      expect(isPrivateUrl('http://api.example.com')).toBe(false);
    });

    it('allows https://8.8.8.8', () => {
      expect(isPrivateUrl('https://8.8.8.8')).toBe(false);
    });

    it('allows https://1.2.3.4', () => {
      expect(isPrivateUrl('https://1.2.3.4')).toBe(false);
    });
  });

  // --- Non-HTTP protocols ---

  describe('non-HTTP protocols', () => {
    it('blocks file:// protocol', () => {
      expect(isPrivateUrl('file:///etc/passwd')).toBe(true);
    });

    it('blocks ftp:// protocol', () => {
      expect(isPrivateUrl('ftp://ftp.example.com')).toBe(true);
    });

    it('blocks data: protocol', () => {
      expect(isPrivateUrl('data:text/html,<h1>Hi</h1>')).toBe(true);
    });
  });

  // --- Localhost variants ---

  describe('localhost variants', () => {
    it('blocks localhost', () => {
      expect(isPrivateUrl('http://localhost')).toBe(true);
    });

    it('blocks localhost with port', () => {
      expect(isPrivateUrl('http://localhost:8080')).toBe(true);
    });

    it('blocks 127.0.0.1', () => {
      expect(isPrivateUrl('http://127.0.0.1')).toBe(true);
    });

    it('blocks 127.0.0.1 with port', () => {
      expect(isPrivateUrl('http://127.0.0.1:3000')).toBe(true);
    });

    it('blocks [::1]', () => {
      expect(isPrivateUrl('http://[::1]')).toBe(true);
    });

    it('blocks 0.0.0.0', () => {
      expect(isPrivateUrl('http://0.0.0.0')).toBe(true);
    });
  });

  // --- Private IPv4 ranges ---

  describe('private IPv4 ranges', () => {
    it('blocks 10.0.0.0/8', () => {
      expect(isPrivateUrl('http://10.0.0.1')).toBe(true);
    });

    it('blocks 10.255.255.255', () => {
      expect(isPrivateUrl('http://10.255.255.255')).toBe(true);
    });

    it('blocks 172.16.0.1 (172.16.0.0/12)', () => {
      expect(isPrivateUrl('http://172.16.0.1')).toBe(true);
    });

    it('blocks 172.31.255.255 (172.16.0.0/12)', () => {
      expect(isPrivateUrl('http://172.31.255.255')).toBe(true);
    });

    it('allows 172.15.0.1 (outside /12 range)', () => {
      expect(isPrivateUrl('http://172.15.0.1')).toBe(false);
    });

    it('allows 172.32.0.1 (outside /12 range)', () => {
      expect(isPrivateUrl('http://172.32.0.1')).toBe(false);
    });

    it('blocks 192.168.0.1', () => {
      expect(isPrivateUrl('http://192.168.0.1')).toBe(true);
    });

    it('blocks 192.168.255.255', () => {
      expect(isPrivateUrl('http://192.168.255.255')).toBe(true);
    });

    it('allows 192.169.0.1 (outside /16 range)', () => {
      expect(isPrivateUrl('http://192.169.0.1')).toBe(false);
    });

    it('blocks 169.254.0.0/16 (link-local)', () => {
      expect(isPrivateUrl('http://169.254.1.1')).toBe(true);
    });

    it('blocks 169.254.169.254 (cloud metadata)', () => {
      expect(isPrivateUrl('http://169.254.169.254')).toBe(true);
    });

    it('blocks 100.100.100.200 (Alibaba metadata)', () => {
      expect(isPrivateUrl('http://100.100.100.200')).toBe(true);
    });

    it('blocks 0.0.0.0/8', () => {
      expect(isPrivateUrl('http://0.1.2.3')).toBe(true);
    });
  });

  // --- Cloud metadata hostnames ---

  describe('cloud metadata hostnames', () => {
    it('blocks metadata.google.internal', () => {
      expect(isPrivateUrl('http://metadata.google.internal')).toBe(true);
    });

    it('blocks metadata.google.internal with path', () => {
      expect(isPrivateUrl('http://metadata.google.internal/computeMetadata/v1/')).toBe(true);
    });
  });

  // --- Invalid URLs ---

  describe('invalid URLs', () => {
    it('blocks invalid URL', () => {
      expect(isPrivateUrl('not-a-url')).toBe(true);
    });

    it('blocks empty string', () => {
      expect(isPrivateUrl('')).toBe(true);
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('handles HTTPS localhost', () => {
      expect(isPrivateUrl('https://localhost')).toBe(true);
    });

    it('allows public IP with HTTPS', () => {
      expect(isPrivateUrl('https://93.184.216.34')).toBe(false);
    });

    it('handles case-insensitive hostname', () => {
      expect(isPrivateUrl('http://LOCALHOST')).toBe(true);
    });

    it('handles case-insensitive metadata hostname', () => {
      expect(isPrivateUrl('http://METADATA.GOOGLE.INTERNAL')).toBe(true);
    });
  });
});

// =============================================================================
// isPrivateUrlAsync — DNS-resolution SSRF checks (incl. IPv4-mapped IPv6)
// =============================================================================
describe('isPrivateUrlAsync', () => {
  beforeEach(() => {
    dnsLookupMock.mockReset();
  });

  it('blocks a host that resolves to a normal private IPv4', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    expect(await isPrivateUrlAsync('https://rebind-a.example.com')).toBe(true);
  });

  it('blocks a host whose AAAA record is an IPv4-mapped IPv6 metadata address', async () => {
    // ::ffff:169.254.169.254 is the cloud-metadata endpoint in mapped form; the
    // dual-stack OS connects it to 169.254.169.254. It must be treated as private.
    dnsLookupMock.mockResolvedValue([{ address: '::ffff:169.254.169.254', family: 6 }]);
    expect(await isPrivateUrlAsync('https://rebind-b.example.com')).toBe(true);
  });

  it('blocks an IPv4-mapped IPv6 private (::ffff:10.x) address', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '::ffff:10.1.2.3', family: 6 }]);
    expect(await isPrivateUrlAsync('https://rebind-c.example.com')).toBe(true);
  });

  it('allows a host that resolves to a public IP', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    expect(await isPrivateUrlAsync('https://public-d.example.com')).toBe(false);
  });
});
