/**
 * Claw Tools Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const { executeClawTool, CLAW_TOOLS, CLAW_TOOL_NAMES, buildSandboxEnv } = await import(
  './claw-tools.js'
);

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

    it('writes scripts with unique names so concurrent calls do not collide', async () => {
      setClawContext();
      const fileWorkspace = await import('../workspace/file-workspace.js');
      const writeMock = fileWorkspace.writeSessionWorkspaceFile as ReturnType<typeof vi.fn>;
      writeMock.mockClear();

      // execFile will fail (not mocked) — we only care that the script was
      // written first; uniqueness is what we're verifying.
      await executeClawTool(
        'claw_run_script',
        { script: 'console.log(1)', language: 'javascript' },
        'user-1'
      );
      await executeClawTool(
        'claw_run_script',
        { script: 'console.log(2)', language: 'javascript' },
        'user-1'
      );

      // Either both calls reached writeSessionWorkspaceFile (with distinct
      // paths) or one fell through earlier — but if both wrote, paths must differ.
      const writePaths = writeMock.mock.calls
        .map((call) => call[1] as string)
        .filter((p) => p?.startsWith('scripts/script_'));
      if (writePaths.length === 2) {
        expect(writePaths[0]).not.toBe(writePaths[1]);
      }
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
          executed: true,
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

    it('should respect autonomy policy when subclaws are disabled', async () => {
      setClawContext();

      const mockRepo = {
        getById: vi.fn().mockResolvedValue({ autonomyPolicy: { allowSubclaws: false } }),
        create: vi.fn(),
      };
      mockGetClawsRepository.mockReturnValue(mockRepo);

      const result = await executeClawTool(
        'claw_spawn_subclaw',
        { name: 'Sub task', mission: 'Do something' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sub-claws are disabled');
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('should spawn subclaw with single-shot mode', async () => {
      setClawContext({ depth: 1 });

      const mockRepo = {
        getById: vi.fn().mockResolvedValue({ autonomyPolicy: { allowSubclaws: true } }),
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

      const mockRepo = {
        getById: vi.fn().mockResolvedValue({ autonomyPolicy: { allowSubclaws: true } }),
        create: vi.fn().mockResolvedValue({ id: 'sub-claw-2' }),
      };
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

  describe('claw_update_config', () => {
    it('should respect autonomy policy when self-modification is disabled', async () => {
      setClawContext();

      const mockRepo = {
        getById: vi.fn().mockResolvedValue({ autonomyPolicy: { allowSelfModify: false } }),
        update: vi.fn(),
      };
      mockGetClawsRepository.mockReturnValue(mockRepo);

      const result = await executeClawTool(
        'claw_update_config',
        { mission: 'New mission' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Self-modification is disabled');
      expect(mockRepo.update).not.toHaveBeenCalled();
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

    it('rejects title over 200 chars', async () => {
      setClawContext();
      const result = await executeClawTool(
        'claw_publish_artifact',
        { title: 'x'.repeat(201), content: 'c' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('title');
    });

    it('rejects invalid type at runtime (not just at type-check)', async () => {
      setClawContext();
      const result = await executeClawTool(
        'claw_publish_artifact',
        { title: 't', content: 'c', type: 'image/exe' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid type');
    });

    it('rejects publishing when claw has reached the artifact lifetime cap', async () => {
      setClawContext();
      // Mock manager to return a session with 1000 artifacts already
      const fullSession = {
        artifacts: Array.from({ length: 1000 }, (_, i) => `art-${i}`),
      };
      mockGetClawManager.mockReturnValue({
        getSession: vi.fn().mockReturnValue(fullSession),
      });

      const result = await executeClawTool(
        'claw_publish_artifact',
        { title: 't', content: 'c', type: 'markdown' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('artifact limit');
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

  describe('claw_emit_event reserved prefixes', () => {
    const reservedExamples = [
      'claw.cycle.complete',
      'claw:update',
      'data:write',
      'crew:broadcast',
      'subagent:done',
      'fleet:task',
      'workflow:complete',
      'soul.heartbeat',
      'system.reboot',
    ];

    for (const eventType of reservedExamples) {
      it(`should reject reserved event type "${eventType}"`, async () => {
        setClawContext();

        const result = await executeClawTool(
          'claw_emit_event',
          { event_type: eventType, payload: {} },
          'user-1'
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('reserved prefix');
      });
    }

    it('should accept custom event types', async () => {
      setClawContext();

      const result = await executeClawTool(
        'claw_emit_event',
        { event_type: 'app.user.action', payload: { foo: 'bar' } },
        'user-1'
      );
      expect(result.success).toBe(true);
    });

    it('should reject when event_type is missing', async () => {
      setClawContext();

      const result = await executeClawTool('claw_emit_event', { payload: {} }, 'user-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('event_type is required');
    });
  });

  describe('claw_set_context bounds', () => {
    function setupSessionWithContext(initial: Record<string, unknown> = {}) {
      setClawContext();
      const mockManager = {
        getSession: vi.fn().mockReturnValue({ persistentContext: initial }),
        flushSession: vi.fn().mockResolvedValue(undefined),
      };
      mockGetClawManager.mockReturnValue(mockManager);
      return mockManager;
    }

    it('rejects keys with invalid characters', async () => {
      setupSessionWithContext();
      const result = await executeClawTool(
        'claw_set_context',
        { updates: { 'bad key!': 'v' } },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid characters');
    });

    it('rejects keys longer than 64 chars', async () => {
      setupSessionWithContext();
      const result = await executeClawTool(
        'claw_set_context',
        { updates: { ['x'.repeat(65)]: 'v' } },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('length');
    });

    it('rejects values larger than 8KB', async () => {
      setupSessionWithContext();
      const result = await executeClawTool(
        'claw_set_context',
        { updates: { big: 'x'.repeat(8 * 1024 + 1) } },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds');
    });

    it('rejects when total context would exceed 64KB', async () => {
      // Pre-fill near the cap with valid 7KB values
      const initial: Record<string, string> = {};
      for (let i = 0; i < 9; i++) initial[`k${i}`] = 'x'.repeat(7000);
      setupSessionWithContext(initial);

      const result = await executeClawTool(
        'claw_set_context',
        { updates: { k9: 'x'.repeat(7000) } },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceed');
    });

    it('rejects when key count would exceed 100', async () => {
      const initial: Record<string, string> = {};
      for (let i = 0; i < 100; i++) initial[`k${i}`] = 'v';
      setupSessionWithContext(initial);

      const result = await executeClawTool(
        'claw_set_context',
        { updates: { k100: 'v' } },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('100 keys');
    });

    it('accepts a valid update', async () => {
      const mockManager = setupSessionWithContext();
      const result = await executeClawTool(
        'claw_set_context',
        { updates: { foo: 'bar', count: 42 } },
        'user-1'
      );
      expect(result.success).toBe(true);
      expect(mockManager.flushSession).toHaveBeenCalled();
    });

    it('null values delete keys without size check', async () => {
      const mockManager = setupSessionWithContext({ foo: 'bar', baz: 'qux' });
      const result = await executeClawTool(
        'claw_set_context',
        { updates: { foo: null } },
        'user-1'
      );
      expect(result.success).toBe(true);
      const session = mockManager.getSession() as { persistentContext: Record<string, unknown> };
      expect(session.persistentContext.foo).toBeUndefined();
      expect(session.persistentContext.baz).toBe('qux');
    });
  });

  describe('size caps', () => {
    it('claw_send_output rejects messages over 10K chars', async () => {
      setClawContext();
      const result = await executeClawTool(
        'claw_send_output',
        { message: 'x'.repeat(10_001), urgency: 'low' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('10,000');
    });

    it('claw_complete_report rejects title over 200 chars', async () => {
      setClawContext();
      const result = await executeClawTool(
        'claw_complete_report',
        { title: 'x'.repeat(201), report: 'r', summary: 's' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('title');
    });

    it('claw_complete_report rejects summary over 2000 chars', async () => {
      setClawContext();
      const result = await executeClawTool(
        'claw_complete_report',
        { title: 't', report: 'r', summary: 'x'.repeat(2001) },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('summary');
    });

    it('claw_send_agent_message rejects subject over 200 chars', async () => {
      setClawContext({ clawId: 'claw-A', userId: 'user-1' });
      const result = await executeClawTool(
        'claw_send_agent_message',
        { target_claw_id: 'claw-B', subject: 'x'.repeat(201), content: 'c' },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('subject');
    });

    it('claw_send_agent_message rejects content over 10K chars', async () => {
      setClawContext({ clawId: 'claw-A', userId: 'user-1' });
      const result = await executeClawTool(
        'claw_send_agent_message',
        { target_claw_id: 'claw-B', subject: 's', content: 'x'.repeat(10_001) },
        'user-1'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('content');
    });
  });

  describe('claw_send_agent_message ownership', () => {
    it('should reject sending to a claw owned by another user', async () => {
      setClawContext({ clawId: 'claw-A', userId: 'user-1' });

      const mockRepo = {
        getByIdAnyUser: vi.fn().mockResolvedValue({
          id: 'claw-B',
          userId: 'user-2',
        }),
        appendToInbox: vi.fn(),
      };
      mockGetClawsRepository.mockReturnValue(mockRepo);

      const result = await executeClawTool(
        'claw_send_agent_message',
        { target_claw_id: 'claw-B', subject: 'hi', content: 'hello' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('different user');
      expect(mockRepo.appendToInbox).not.toHaveBeenCalled();
    });

    it('should reject when target claw does not exist', async () => {
      setClawContext({ clawId: 'claw-A', userId: 'user-1' });

      const mockRepo = {
        getByIdAnyUser: vi.fn().mockResolvedValue(null),
        appendToInbox: vi.fn(),
      };
      mockGetClawsRepository.mockReturnValue(mockRepo);

      const result = await executeClawTool(
        'claw_send_agent_message',
        { target_claw_id: 'claw-missing', subject: 'hi', content: 'hello' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject self-messaging', async () => {
      setClawContext({ clawId: 'claw-A', userId: 'user-1' });

      const result = await executeClawTool(
        'claw_send_agent_message',
        { target_claw_id: 'claw-A', subject: 'hi', content: 'hello' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('yourself');
    });

    it('should deliver to inbox when target belongs to same user but is not running', async () => {
      setClawContext({ clawId: 'claw-A', userId: 'user-1' });

      const mockRepo = {
        getByIdAnyUser: vi.fn().mockResolvedValue({ id: 'claw-B', userId: 'user-1' }),
        appendToInbox: vi.fn().mockResolvedValue(undefined),
      };
      mockGetClawsRepository.mockReturnValue(mockRepo);

      const mockManager = { sendMessage: vi.fn().mockResolvedValue(false) };
      mockGetClawManager.mockReturnValue(mockManager);

      const result = await executeClawTool(
        'claw_send_agent_message',
        { target_claw_id: 'claw-B', subject: 'task', content: 'please review' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(mockRepo.appendToInbox).toHaveBeenCalledWith(
        'claw-B',
        expect.stringContaining('From claw:claw-A')
      );
    });
  });

  describe('unknown tool', () => {
    it('should return error for unknown tool name', async () => {
      const result = await executeClawTool('claw_nonexistent', {}, 'user-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown claw tool');
    });
  });

  describe('buildSandboxEnv', () => {
    const SECRETS = [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'DATABASE_URL',
      'GITHUB_TOKEN',
    ];

    beforeEach(() => {
      for (const k of SECRETS) {
        process.env[k] = `secret-${k}`;
      }
    });

    afterEach(() => {
      for (const k of SECRETS) {
        delete process.env[k];
      }
    });

    it('does not leak common secret env vars to child processes', () => {
      const env = buildSandboxEnv({ HOME: '/tmp/ws' });
      for (const k of SECRETS) {
        expect(env[k]).toBeUndefined();
      }
    });

    it('forwards PATH so interpreters can resolve', () => {
      process.env.PATH = '/usr/bin:/bin';
      const env = buildSandboxEnv({});
      expect(env.PATH).toBe('/usr/bin:/bin');
    });

    it('lets overrides win over allowlisted vars', () => {
      const env = buildSandboxEnv({ HOME: '/sandbox/ws', NODE_PATH: '/sandbox/node_modules' });
      expect(env.HOME).toBe('/sandbox/ws');
      expect(env.NODE_PATH).toBe('/sandbox/node_modules');
    });
  });
});
