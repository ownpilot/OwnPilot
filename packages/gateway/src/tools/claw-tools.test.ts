/**
 * Claw Tools Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockGetClawContext, mockGetClawManager, mockGetArtifactService, mockGetClawsRepository } =
  vi.hoisted(() => {
    return {
      mockGetClawContext: vi.fn(),
      mockGetClawManager: vi.fn(),
      mockGetArtifactService: vi.fn(),
      mockGetClawsRepository: vi.fn(),
    };
  });

vi.mock('../services/claw-context.js', () => ({
  getClawContext: mockGetClawContext,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    generateId: vi.fn().mockReturnValue('generated-id'),
  };
});

vi.mock('../services/claw-manager.js', () => ({
  getClawManager: mockGetClawManager,
}));

vi.mock('../services/artifact-service.js', () => ({
  getArtifactService: mockGetArtifactService,
}));

vi.mock('../db/repositories/claws.js', () => ({
  getClawsRepository: mockGetClawsRepository,
}));

vi.mock('../workspace/file-workspace.js', () => ({
  getSessionWorkspacePath: vi.fn().mockReturnValue('/tmp/workspace/ws-1'),
  writeSessionWorkspaceFile: vi.fn(),
}));

const { executeClawTool, CLAW_TOOLS, CLAW_TOOL_NAMES } = await import('./claw-tools.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setClawContext(overrides = {}) {
  mockGetClawContext.mockReturnValue({
    clawId: 'claw-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    depth: 0,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Claw Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClawContext.mockReturnValue(undefined);
  });

  describe('CLAW_TOOLS', () => {
    it('should export 16 tool definitions', () => {
      expect(CLAW_TOOLS).toHaveLength(16);
    });

    it('should have correct tool names', () => {
      expect(CLAW_TOOL_NAMES).toEqual([
        'claw_install_package',
        'claw_run_script',
        'claw_create_tool',
        'claw_spawn_subclaw',
        'claw_publish_artifact',
        'claw_request_escalation',
        'claw_send_output',
        'claw_complete_report',
        'claw_emit_event',
        'claw_update_config',
        'claw_send_agent_message',
        'claw_reflect',
        'claw_list_subclaws',
        'claw_stop_subclaw',
        'claw_set_context',
        'claw_get_context',
      ]);
    });

    it('should have required fields on each definition', () => {
      for (const tool of CLAW_TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeTruthy();
        expect(tool.category).toBe('Claw');
      }
    });
  });

  describe('context requirement', () => {
    it('should fail when not inside a Claw context', async () => {
      mockGetClawContext.mockReturnValue(undefined);

      for (const toolName of CLAW_TOOL_NAMES) {
        const result = await executeClawTool(toolName, {}, 'user-1');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Claw context');
      }
    });
  });

  describe('claw_install_package', () => {
    it('should reject invalid package names', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_install_package',
        { package_name: 'pkg && rm -rf /' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid package name');
    });

    it('should reject empty package name', async () => {
      setClawContext();

      const result = await executeClawTool('claw_install_package', { package_name: '' }, 'user-1');
      expect(result.success).toBe(false);
    });

    it('should reject invalid package manager', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_install_package',
        { package_name: 'lodash', manager: 'yarn' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid package manager');
    });

    it('should require workspace', async () => {
      setClawContext({ workspaceId: undefined });

      const result = await executeClawTool(
        'claw_install_package',
        { package_name: 'lodash' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('No workspace');
    });
  });

  describe('claw_run_script', () => {
    it('should require workspace', async () => {
      setClawContext({ workspaceId: undefined });

      const result = await executeClawTool(
        'claw_run_script',
        { script: 'console.log("hi")' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('No workspace');
    });

    it('should reject empty script', async () => {
      setClawContext();

      const result = await executeClawTool('claw_run_script', { script: '' }, 'user-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject oversized script', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_run_script',
        { script: 'x'.repeat(100_001) },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('100KB');
    });
  });

  describe('claw_create_tool', () => {
    it('should validate tool name format', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_create_tool',
        { name: 'Invalid Name!', description: 'test', code: 'return 1' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid tool name');
    });

    it('should accept valid tool creation and execute', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_create_tool',
        {
          name: 'parse_csv',
          description: 'Parse CSV data',
          code: 'function parse_csv(args) { return { parsed: true, input: args.data }; }',
          args: { data: 'a,b,c' },
        },
        'user-1'
      );
      expect(result.success).toBe(true);
      expect(result.result).toEqual(
        expect.objectContaining({
          registered: true,
          name: 'parse_csv',
          output: { parsed: true, input: 'a,b,c' },
        })
      );
    });

    it('should reject empty code', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_create_tool',
        { name: 'my_tool', description: 'test', code: '' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject oversized code', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_create_tool',
        { name: 'my_tool', description: 'test', code: 'x'.repeat(50_001) },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('50KB');
    });
  });

  describe('claw_spawn_subclaw', () => {
    it('should enforce depth limit', async () => {
      setClawContext({ depth: 3 });

      const result = await executeClawTool(
        'claw_spawn_subclaw',
        { name: 'Deep sub', mission: 'Go deeper' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('nesting depth');
    });

    it('should require name and mission', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_spawn_subclaw',
        { name: '', mission: '' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should spawn subclaw with single-shot mode', async () => {
      setClawContext({ depth: 1 });

      const mockRepo = {
        create: vi.fn().mockResolvedValue({ id: 'sub-claw-1' }),
      };
      mockGetClawsRepository.mockReturnValue(mockRepo);

      const mockManager = {
        startClaw: vi.fn().mockResolvedValue({
          state: 'completed',
          lastCycleError: null,
        }),
      };
      mockGetClawManager.mockReturnValue(mockManager);

      const result = await executeClawTool(
        'claw_spawn_subclaw',
        { name: 'Sub task', mission: 'Do something', mode: 'single-shot' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(expect.objectContaining({ mode: 'single-shot' }));
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          depth: 2,
          parentClawId: 'claw-1',
          createdBy: 'claw',
        })
      );
    });

    it('should spawn subclaw with cyclic mode', async () => {
      setClawContext({ depth: 0 });

      const mockRepo = { create: vi.fn().mockResolvedValue({ id: 'sub-claw-2' }) };
      mockGetClawsRepository.mockReturnValue(mockRepo);

      const mockManager = { startClaw: vi.fn().mockResolvedValue({ state: 'running' }) };
      mockGetClawManager.mockReturnValue(mockManager);

      const result = await executeClawTool(
        'claw_spawn_subclaw',
        { name: 'Cyclic sub', mission: 'Monitor something', mode: 'continuous' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(expect.objectContaining({ mode: 'continuous' }));
    });
  });

  describe('claw_publish_artifact', () => {
    it('should create artifact via artifact service', async () => {
      setClawContext();

      const mockService = {
        createArtifact: vi.fn().mockResolvedValue({
          id: 'art-1',
          title: 'Report',
          type: 'markdown',
        }),
      };
      mockGetArtifactService.mockReturnValue(mockService);

      const result = await executeClawTool(
        'claw_publish_artifact',
        { title: 'Report', content: '# Hello', type: 'markdown' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(
        expect.objectContaining({ artifactId: 'art-1', title: 'Report' })
      );
      expect(mockService.createArtifact).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          title: 'Report',
          content: '# Hello',
          tags: ['claw', 'claw:claw-1'],
        })
      );
    });

    it('should require title and content', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_publish_artifact',
        { title: '', content: '' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject oversized content', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_publish_artifact',
        { title: 'Big', content: 'x'.repeat(500_001) },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('500KB');
    });
  });

  describe('claw_request_escalation', () => {
    it('should request escalation via manager', async () => {
      setClawContext();

      const mockManager = { requestEscalation: vi.fn().mockResolvedValue(undefined) };
      mockGetClawManager.mockReturnValue(mockManager);

      const result = await executeClawTool(
        'claw_request_escalation',
        { type: 'sandbox_upgrade', reason: 'Need Docker' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(
        expect.objectContaining({ type: 'sandbox_upgrade', reason: 'Need Docker' })
      );
      expect(mockManager.requestEscalation).toHaveBeenCalledWith(
        'claw-1',
        expect.objectContaining({ type: 'sandbox_upgrade', reason: 'Need Docker' })
      );
    });

    it('should reject invalid escalation type', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_request_escalation',
        { type: 'invalid_type', reason: 'test' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid escalation type');
    });

    it('should require type and reason', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_request_escalation',
        { type: '', reason: '' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });
  });

  describe('unknown tool', () => {
    it('should return error for unknown tool name', async () => {
      const result = await executeClawTool('claw_nonexistent', {}, 'user-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown claw tool');
    });
  });
});
