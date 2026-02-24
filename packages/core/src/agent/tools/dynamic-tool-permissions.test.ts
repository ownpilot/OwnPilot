/**
 * Tests for dynamic tool permission and URL validation
 *
 * Covers: isToolCallAllowed, isPrivateUrl
 */

import { describe, it, expect } from 'vitest';

import { isToolCallAllowed, isPrivateUrl } from './dynamic-tool-permissions.js';
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
      const result = isToolCallAllowed('calculate', []);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows unknown qualified tool', () => {
      const result = isToolCallAllowed('core.get_time', []);
      expect(result.allowed).toBe(true);
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
