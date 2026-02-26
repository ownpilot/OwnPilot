import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionPermissions } from '@ownpilot/core';

// Mock dependencies before importing the module under test
vi.mock('../routes/settings.js', () => ({
  getEnabledToolGroupIds: vi.fn(() => [
    'core', 'filesystem', 'personalData', 'customData', 'memory', 'goals', 'utilities', 'customTools',
  ]),
}));

vi.mock('../db/repositories/cli-tool-policies.js', () => ({
  cliToolPoliciesRepo: {
    getPolicy: vi.fn(() => null),
  },
}));

vi.mock('./custom-tool-registry.js', () => ({
  getCustomToolDynamicRegistry: vi.fn(() => ({
    tools: new Map(),
  })),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  checkToolPermission,
  filterAllowedTools,
  resetToolPermissionService,
} from './tool-permission-service.js';
import type { ToolExecContext } from './permission-utils.js';

// Access mocks
const { getEnabledToolGroupIds } = await import('../routes/settings.js');
const { cliToolPoliciesRepo } = await import('../db/repositories/cli-tool-policies.js');
const { getCustomToolDynamicRegistry } = await import('./custom-tool-registry.js');

const mockGetEnabledToolGroupIds = getEnabledToolGroupIds as ReturnType<typeof vi.fn>;
const mockGetPolicy = cliToolPoliciesRepo.getPolicy as ReturnType<typeof vi.fn>;
const mockGetDynamicRegistry = getCustomToolDynamicRegistry as ReturnType<typeof vi.fn>;

describe('tool-permission-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetToolPermissionService();

    // Default: all standard groups enabled
    mockGetEnabledToolGroupIds.mockReturnValue([
      'core', 'filesystem', 'personalData', 'customData', 'memory', 'goals', 'utilities', 'customTools',
    ]);
    mockGetPolicy.mockResolvedValue(null);
    mockGetDynamicRegistry.mockReturnValue({ tools: new Map() });
  });

  // ===========================================================================
  // 1. Tool Group Check
  // ===========================================================================

  describe('tool group check', () => {
    it('allows tool when its group is enabled', async () => {
      const result = await checkToolPermission('user1', 'get_current_time', { source: 'chat' });
      expect(result.allowed).toBe(true);
    });

    it('blocks tool when its group is disabled', async () => {
      mockGetEnabledToolGroupIds.mockReturnValue(['core']); // Only core enabled
      const result = await checkToolPermission('user1', 'execute_shell', { source: 'chat' });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.code).toBe('TOOL_GROUP_DISABLED');
        expect(result.reason).toContain('Code Execution');
      }
    });

    it('blocks tool in trigger context when group is disabled', async () => {
      mockGetEnabledToolGroupIds.mockReturnValue(['core']); // No codeExecution group
      const result = await checkToolPermission('user1', 'execute_shell', { source: 'trigger' });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.code).toBe('TOOL_GROUP_DISABLED');
      }
    });

    it('blocks tool in plan context when group is disabled', async () => {
      mockGetEnabledToolGroupIds.mockReturnValue(['core']);
      const result = await checkToolPermission('user1', 'execute_python', { source: 'plan' });
      expect(result.allowed).toBe(false);
    });

    it('blocks tool in workflow context when group is disabled', async () => {
      mockGetEnabledToolGroupIds.mockReturnValue(['core']);
      const result = await checkToolPermission('user1', 'http_request', { source: 'workflow' });
      expect(result.allowed).toBe(false);
    });

    it('allows tool not in any group (custom/extension/mcp)', async () => {
      const result = await checkToolPermission('user1', 'my_custom_tool', { source: 'chat' });
      expect(result.allowed).toBe(true);
    });
  });

  // ===========================================================================
  // 2. Execution Permissions Check
  // ===========================================================================

  describe('execution permissions check', () => {
    const enabledPerms: ExecutionPermissions = {
      enabled: true,
      mode: 'local',
      execute_javascript: 'allowed',
      execute_python: 'prompt',
      execute_shell: 'blocked',
      compile_code: 'allowed',
      package_manager: 'prompt',
    };

    const disabledPerms: ExecutionPermissions = {
      ...enabledPerms,
      enabled: false,
    };

    // Enable codeExecution group for these tests
    beforeEach(() => {
      mockGetEnabledToolGroupIds.mockReturnValue([
        'core', 'filesystem', 'personalData', 'customData', 'memory',
        'goals', 'utilities', 'customTools', 'codeExecution',
      ]);
    });

    it('allows code execution tool with allowed permission in chat', async () => {
      const result = await checkToolPermission('user1', 'execute_javascript', {
        source: 'chat',
        executionPermissions: enabledPerms,
      });
      expect(result.allowed).toBe(true);
    });

    it('blocks code execution tool with blocked permission', async () => {
      const result = await checkToolPermission('user1', 'execute_shell', {
        source: 'chat',
        executionPermissions: enabledPerms,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.code).toBe('EXECUTION_BLOCKED');
      }
    });

    it('allows prompt permission in chat (approval handled downstream)', async () => {
      const result = await checkToolPermission('user1', 'execute_python', {
        source: 'chat',
        executionPermissions: enabledPerms,
      });
      expect(result.allowed).toBe(true);
    });

    it('blocks prompt permission in trigger context', async () => {
      const result = await checkToolPermission('user1', 'execute_python', {
        source: 'trigger',
        executionPermissions: enabledPerms,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.code).toBe('EXECUTION_BLOCKED');
      }
    });

    it('blocks prompt permission in plan context', async () => {
      const result = await checkToolPermission('user1', 'package_manager', {
        source: 'plan',
        executionPermissions: enabledPerms,
      });
      expect(result.allowed).toBe(false);
    });

    it('blocks when code execution is globally disabled', async () => {
      const result = await checkToolPermission('user1', 'execute_javascript', {
        source: 'chat',
        executionPermissions: disabledPerms,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain('globally disabled');
      }
    });
  });

  // ===========================================================================
  // 3. CLI Tool Policy Check
  // ===========================================================================

  describe('CLI tool policy check', () => {
    it('allows run_cli_tool when no policy is set', async () => {
      mockGetPolicy.mockResolvedValue(null);
      const result = await checkToolPermission('user1', 'run_cli_tool', {
        source: 'chat',
        cliToolName: 'eslint',
      });
      expect(result.allowed).toBe(true);
    });

    it('allows run_cli_tool with allowed policy', async () => {
      mockGetPolicy.mockResolvedValue('allowed');
      const result = await checkToolPermission('user1', 'run_cli_tool', {
        source: 'chat',
        cliToolName: 'eslint',
      });
      expect(result.allowed).toBe(true);
    });

    it('blocks run_cli_tool with blocked policy', async () => {
      mockGetPolicy.mockResolvedValue('blocked');
      const result = await checkToolPermission('user1', 'run_cli_tool', {
        source: 'chat',
        cliToolName: 'rm',
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.code).toBe('CLI_POLICY_BLOCKED');
      }
    });

    it('allows prompt policy in chat context', async () => {
      mockGetPolicy.mockResolvedValue('prompt');
      const result = await checkToolPermission('user1', 'run_cli_tool', {
        source: 'chat',
        cliToolName: 'docker',
      });
      expect(result.allowed).toBe(true);
    });

    it('blocks prompt policy in trigger context', async () => {
      mockGetPolicy.mockResolvedValue('prompt');
      const result = await checkToolPermission('user1', 'run_cli_tool', {
        source: 'trigger',
        cliToolName: 'docker',
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.code).toBe('CLI_POLICY_BLOCKED');
      }
    });

    it('skips CLI policy check when cliToolName is not provided', async () => {
      mockGetPolicy.mockResolvedValue('blocked');
      const result = await checkToolPermission('user1', 'run_cli_tool', {
        source: 'chat',
        // No cliToolName
      });
      expect(result.allowed).toBe(true);
    });
  });

  // ===========================================================================
  // 4. Skill Allowed-Tools Check
  // ===========================================================================

  describe('skill allowed-tools check', () => {
    it('allows tool in skill allowed-tools list', async () => {
      // Use tools from enabled groups (core) so group check passes
      const result = await checkToolPermission('user1', 'get_current_time', {
        source: 'chat',
        skillAllowedTools: ['get_current_time', 'calculate'],
        skillId: 'math-skill',
      });
      expect(result.allowed).toBe(true);
    });

    it('blocks tool NOT in skill allowed-tools list', async () => {
      // add_task is in personalData (enabled), but not in skill's allowed-tools
      const result = await checkToolPermission('user1', 'add_task', {
        source: 'chat',
        skillAllowedTools: ['get_current_time', 'calculate'],
        skillId: 'math-skill',
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.code).toBe('SKILL_NOT_ALLOWED');
      }
    });

    it('allows all tools with wildcard (*)', async () => {
      const result = await checkToolPermission('user1', 'get_current_time', {
        source: 'chat',
        skillAllowedTools: ['*'],
        skillId: 'full-access-skill',
      });
      expect(result.allowed).toBe(true);
    });

    it('allows all tools when skillAllowedTools is undefined', async () => {
      const result = await checkToolPermission('user1', 'get_current_time', {
        source: 'chat',
        // No skillAllowedTools
      });
      expect(result.allowed).toBe(true);
    });

    it('allows all tools when skillAllowedTools is empty array', async () => {
      const result = await checkToolPermission('user1', 'get_current_time', {
        source: 'chat',
        skillAllowedTools: [],
      });
      expect(result.allowed).toBe(true);
    });
  });

  // ===========================================================================
  // 5. Custom Tool requiresApproval Check
  // ===========================================================================

  describe('custom tool requiresApproval check', () => {
    it('allows custom tool without requiresApproval in trigger context', async () => {
      mockGetDynamicRegistry.mockReturnValue({
        tools: new Map([['safe_tool', { requiresApproval: false }]]),
      });
      const result = await checkToolPermission('user1', 'safe_tool', { source: 'trigger' });
      expect(result.allowed).toBe(true);
    });

    it('blocks custom tool with requiresApproval in trigger context', async () => {
      mockGetDynamicRegistry.mockReturnValue({
        tools: new Map([['danger_tool', { requiresApproval: true }]]),
      });
      const result = await checkToolPermission('user1', 'danger_tool', { source: 'trigger' });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.code).toBe('REQUIRES_APPROVAL');
      }
    });

    it('allows custom tool with requiresApproval in chat context', async () => {
      mockGetDynamicRegistry.mockReturnValue({
        tools: new Map([['danger_tool', { requiresApproval: true }]]),
      });
      const result = await checkToolPermission('user1', 'danger_tool', { source: 'chat' });
      expect(result.allowed).toBe(true);
    });

    it('blocks requiresApproval tool in plan context', async () => {
      mockGetDynamicRegistry.mockReturnValue({
        tools: new Map([['danger_tool', { requiresApproval: true }]]),
      });
      const result = await checkToolPermission('user1', 'danger_tool', { source: 'plan' });
      expect(result.allowed).toBe(false);
    });

    it('blocks requiresApproval tool in workflow context', async () => {
      mockGetDynamicRegistry.mockReturnValue({
        tools: new Map([['danger_tool', { requiresApproval: true }]]),
      });
      const result = await checkToolPermission('user1', 'danger_tool', { source: 'workflow' });
      expect(result.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // filterAllowedTools
  // ===========================================================================

  describe('filterAllowedTools', () => {
    it('filters out tools in disabled groups', async () => {
      mockGetEnabledToolGroupIds.mockReturnValue(['core']); // Only core enabled
      const result = await filterAllowedTools('user1', [
        'get_current_time',
        'execute_shell',
        'http_request',
      ], { source: 'chat' });
      expect(result).toContain('get_current_time');
      expect(result).not.toContain('execute_shell');
      expect(result).not.toContain('http_request');
    });

    it('returns all tools when their groups are enabled', async () => {
      // All three tools are in always-on groups (core, filesystem, personalData)
      const result = await filterAllowedTools('user1', [
        'get_current_time',
        'read_file',
        'add_task',
      ], { source: 'chat' });
      expect(result).toHaveLength(3);
    });

    it('passes toggleable groups when enabled', async () => {
      mockGetEnabledToolGroupIds.mockReturnValue([
        'core', 'filesystem', 'personalData', 'customData', 'memory',
        'goals', 'utilities', 'customTools', 'codeExecution', 'webFetch',
      ]);
      const r1 = await checkToolPermission('user1', 'execute_shell', { source: 'chat' });
      expect(r1.allowed).toBe(true);
      const r2 = await checkToolPermission('user1', 'http_request', { source: 'chat' });
      expect(r2.allowed).toBe(true);
    });
  });
});
