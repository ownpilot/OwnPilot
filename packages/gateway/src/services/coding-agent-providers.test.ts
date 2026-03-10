/**
 * Coding Agent Providers Tests
 *
 * Tests for provider constants, API key resolution, skills preamble,
 * permission args, and provider adapters.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DEFAULT_MAX_TURNS,
  DEFAULT_MAX_BUDGET_USD,
  CONFIG_SERVICE_NAMES,
  API_KEY_ENV_VARS,
  DISPLAY_NAMES,
  CLI_BINARIES,
  INSTALL_COMMANDS,
  AUTH_METHODS,
  resolveBuiltinApiKey,
  resolveCustomApiKey,
  buildSkillsPreamble,
  buildClaudeCodePermissionArgs,
  resolvePermissions,
} from './coding-agent-providers.js';

// Mock dependencies
const mockGetApiKey = vi.fn();

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
  },
}));

describe('coding-agent-providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear environment variables
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CODEX_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  describe('Constants', () => {
    it('has correct default timeout values', () => {
      expect(DEFAULT_TIMEOUT_MS).toBe(300_000); // 5 minutes
      expect(MAX_TIMEOUT_MS).toBe(1_800_000); // 30 minutes
    });

    it('has correct default max turns and budget', () => {
      expect(DEFAULT_MAX_TURNS).toBe(10);
      expect(DEFAULT_MAX_BUDGET_USD).toBe(1.0);
    });

    it('has config service names for all providers', () => {
      expect(CONFIG_SERVICE_NAMES['claude-code']).toBe('coding-claude-code');
      expect(CONFIG_SERVICE_NAMES['codex']).toBe('coding-codex');
      expect(CONFIG_SERVICE_NAMES['gemini-cli']).toBe('coding-gemini');
    });

    it('has API key env var names for all providers', () => {
      expect(API_KEY_ENV_VARS['claude-code']).toBe('ANTHROPIC_API_KEY');
      expect(API_KEY_ENV_VARS['codex']).toBe('CODEX_API_KEY');
      expect(API_KEY_ENV_VARS['gemini-cli']).toBe('GEMINI_API_KEY');
    });

    it('has display names for all providers', () => {
      expect(DISPLAY_NAMES['claude-code']).toBe('Claude Code');
      expect(DISPLAY_NAMES['codex']).toBe('OpenAI Codex');
      expect(DISPLAY_NAMES['gemini-cli']).toBe('Gemini CLI');
    });

    it('has CLI binary names for all providers', () => {
      expect(CLI_BINARIES['claude-code']).toBe('claude');
      expect(CLI_BINARIES['codex']).toBe('codex');
      expect(CLI_BINARIES['gemini-cli']).toBe('gemini');
    });

    it('has install commands for all providers', () => {
      expect(INSTALL_COMMANDS['claude-code']).toContain('@anthropic-ai/claude-code');
      expect(INSTALL_COMMANDS['codex']).toContain('@openai/codex');
      expect(INSTALL_COMMANDS['gemini-cli']).toContain('@google/gemini-cli');
    });

    it('has auth methods for all providers', () => {
      expect(AUTH_METHODS['claude-code']).toBe('both');
      expect(AUTH_METHODS['codex']).toBe('both');
      expect(AUTH_METHODS['gemini-cli']).toBe('both');
    });
  });

  describe('resolveBuiltinApiKey', () => {
    it('returns key from config center when available', () => {
      mockGetApiKey.mockReturnValue('config-center-key');

      const result = resolveBuiltinApiKey('claude-code');

      expect(result).toBe('config-center-key');
      expect(mockGetApiKey).toHaveBeenCalledWith('coding-claude-code');
    });

    it('falls back to environment variable when config center has no key', () => {
      mockGetApiKey.mockReturnValue(null);
      process.env.ANTHROPIC_API_KEY = 'env-api-key';

      const result = resolveBuiltinApiKey('claude-code');

      expect(result).toBe('env-api-key');
    });

    it('returns undefined when no key is configured', () => {
      mockGetApiKey.mockReturnValue(null);

      const result = resolveBuiltinApiKey('claude-code');

      expect(result).toBeUndefined();
    });

    it('works for all builtin providers', () => {
      const providers = ['claude-code', 'codex', 'gemini-cli'] as const;

      for (const provider of providers) {
        mockGetApiKey.mockReturnValue(`${provider}-key`);
        const result = resolveBuiltinApiKey(provider);
        expect(result).toBe(`${provider}-key`);
      }
    });
  });

  describe('resolveCustomApiKey', () => {
    it('returns key from config center for config_center auth method', () => {
      mockGetApiKey.mockReturnValue('custom-config-key');

      const result = resolveCustomApiKey({
        authMethod: 'config_center',
        configServiceName: 'my-custom-service',
      } as { authMethod: 'config_center'; configServiceName: string | null; apiKeyEnvVar?: string });

      expect(result).toBe('custom-config-key');
      expect(mockGetApiKey).toHaveBeenCalledWith('my-custom-service');
    });

    it('returns key from environment variable when specified', () => {
      mockGetApiKey.mockReturnValue(null);
      process.env.MY_CUSTOM_KEY = 'custom-env-key';

      const result = resolveCustomApiKey({
        authMethod: 'env',
        apiKeyEnvVar: 'MY_CUSTOM_KEY',
      } as { authMethod: 'env'; configServiceName: string | null; apiKeyEnvVar?: string });

      expect(result).toBe('custom-env-key');
    });

    it('returns undefined when no key source is configured', () => {
      mockGetApiKey.mockReturnValue(null);

      const result = resolveCustomApiKey({
        authMethod: 'none',
        configServiceName: null,
      } as { authMethod: 'none'; configServiceName: string | null; apiKeyEnvVar?: string });

      expect(result).toBeUndefined();
    });
  });

  describe('buildSkillsPreamble', () => {
    it('returns empty string for empty skills array', () => {
      const result = buildSkillsPreamble([]);
      expect(result).toBe('');
    });

    it('builds preamble for single skill', () => {
      const result = buildSkillsPreamble([{ name: 'Test Skill', content: 'Skill content here' }]);

      expect(result).toContain('# Instructions & Skills');
      expect(result).toContain('## Skill: Test Skill');
      expect(result).toContain('Skill content here');
      expect(result).toContain('# Task');
    });

    it('builds preamble for multiple skills with separators', () => {
      const result = buildSkillsPreamble([
        { name: 'Skill 1', content: 'Content 1' },
        { name: 'Skill 2', content: 'Content 2' },
      ]);

      expect(result).toContain('## Skill: Skill 1');
      expect(result).toContain('## Skill: Skill 2');
      expect(result).toContain('Content 1');
      expect(result).toContain('Content 2');
      expect(result).toContain('---'); // Separator between skills
    });
  });

  describe('buildClaudeCodePermissionArgs', () => {
    it('returns empty array for default permissions', () => {
      const result = buildClaudeCodePermissionArgs({
        fileAccess: 'full',
        autonomy: 'confirm',
        networkAccess: true,
      });

      expect(result).toEqual([]);
    });

    it('adds disallowed tools for read-only file access', () => {
      const result = buildClaudeCodePermissionArgs({
        fileAccess: 'read-only',
        autonomy: 'confirm',
        networkAccess: true,
      });

      expect(result).toContain('--disallowed-tools');
      expect(result).toContain('Edit,Write,MultiEdit,Bash(rm|mv|cp|mkdir)');
    });

    it('adds disallowed tools for no file access', () => {
      const result = buildClaudeCodePermissionArgs({
        fileAccess: 'none',
        autonomy: 'confirm',
        networkAccess: true,
      });

      expect(result).toContain('--disallowed-tools');
      expect(result).toContain('Edit,Write,MultiEdit');
    });

    it('adds dangerously-skip-permissions for full-auto autonomy', () => {
      const result = buildClaudeCodePermissionArgs({
        fileAccess: 'full',
        autonomy: 'full-auto',
        networkAccess: true,
      });

      expect(result).toContain('--dangerously-skip-permissions');
    });

    it('adds disallowed tools for no network access', () => {
      const result = buildClaudeCodePermissionArgs({
        fileAccess: 'full',
        autonomy: 'confirm',
        networkAccess: false,
      });

      expect(result).toContain('--disallowed-tools');
      expect(result).toContain('WebFetch,WebSearch');
    });

    it('combines multiple permission restrictions', () => {
      const result = buildClaudeCodePermissionArgs({
        fileAccess: 'read-only',
        autonomy: 'full-auto',
        networkAccess: false,
      });

      expect(result).toContain('--disallowed-tools');
      expect(result).toContain('--dangerously-skip-permissions');
    });
  });

  describe('resolvePermissions', () => {
    it('returns default permissions when none provided', () => {
      const result = resolvePermissions();

      expect(result.fileAccess).toBe('read-write');
      expect(result.autonomy).toBe('semi-auto');
      expect(result.networkAccess).toBe(true);
    });

    it('merges user permissions with defaults', () => {
      const result = resolvePermissions({
        fileAccess: 'read-only',
      });

      expect(result.fileAccess).toBe('read-only');
      expect(result.autonomy).toBe('semi-auto'); // default
      expect(result.networkAccess).toBe(true); // default
    });

    it('overrides all defaults when specified', () => {
      const result = resolvePermissions({
        fileAccess: 'none',
        autonomy: 'full-auto',
        networkAccess: false,
      });

      expect(result.fileAccess).toBe('none');
      expect(result.autonomy).toBe('full-auto');
      expect(result.networkAccess).toBe(false);
    });
  });
});
