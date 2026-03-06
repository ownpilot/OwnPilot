/**
 * ExtensionService Tests
 *
 * Comprehensive coverage for install, uninstall, enable/disable,
 * tool definitions, system prompt sections, scan, reload, and singleton.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Hoisted mocks
// =============================================================================

const {
  mockEmit,
  mockESEmit,
  mockTrigSvc,
  mockRepo,
  mockReadFile,
  mockReaddir,
  mockExists,
  mockRegReqs,
  mockUnregDeps,
  mockParseMd,
  mockParseSkill,
  mockAudit,
  mockValidateManifest,
  mockValidateAgentSkills,
} = vi.hoisted(() => ({
  mockEmit: vi.fn(),
  mockESEmit: vi.fn(),
  mockTrigSvc: {
    createTrigger: vi.fn(async (_u: string, i: Record<string, unknown>) => ({
      id: 't1',
      name: i.name,
    })),
    listTriggers: vi.fn(async () => [] as Array<{ id: string; name: string }>),
    deleteTrigger: vi.fn(async () => true),
  },
  mockRepo: {
    getById: vi.fn(),
    getAll: vi.fn(() => [] as unknown[]),
    getEnabled: vi.fn(() => [] as unknown[]),
    upsert: vi.fn(),
    updateStatus: vi.fn(),
    delete: vi.fn(),
  },
  mockReadFile: vi.fn(),
  mockReaddir: vi.fn(() => [] as unknown[]),
  mockExists: vi.fn(() => false),
  mockRegReqs: vi.fn(),
  mockUnregDeps: vi.fn(),
  mockParseMd: vi.fn(),
  mockParseSkill: vi.fn(),
  mockAudit: vi.fn(() => ({
    blocked: false,
    reasons: [],
    riskLevel: 'low',
    warnings: [],
    undeclaredTools: [],
  })),
  mockValidateManifest: vi.fn(() => ({ valid: true, errors: [] })),
  mockValidateAgentSkills: vi.fn(() => ({ valid: true, errors: [] })),
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFile,
  readdirSync: mockReaddir,
  existsSync: mockExists,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEventBus: () => ({ emit: mockEmit }),
    getEventSystem: () => ({ emit: mockESEmit }),
    createEvent: vi.fn((_type: string, _cat: string, _src: string, payload: unknown) => ({
      type: _type,
      payload,
    })),
    EventTypes: {
      RESOURCE_CREATED: 'resource.created',
      RESOURCE_UPDATED: 'resource.updated',
      RESOURCE_DELETED: 'resource.deleted',
    },
    getServiceRegistry: () => ({ get: () => mockTrigSvc }),
    Services: { Trigger: 'Trigger' },
  };
});

vi.mock('../db/repositories/extensions.js', () => ({
  extensionsRepo: mockRepo,
}));

vi.mock('./extension-types.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    validateManifest: mockValidateManifest,
    validateAgentSkillsFrontmatter: mockValidateAgentSkills,
  };
});

vi.mock('./extension-markdown.js', () => ({
  parseExtensionMarkdown: mockParseMd,
}));

vi.mock('./agentskills-parser.js', () => ({
  parseAgentSkillsMd: mockParseSkill,
}));

vi.mock('./skill-security-audit.js', () => ({
  auditSkillSecurity: mockAudit,
}));

vi.mock('./api-service-registrar.js', () => ({
  registerToolConfigRequirements: mockRegReqs,
  unregisterDependencies: mockUnregDeps,
}));

vi.mock('../paths/index.js', () => ({
  getDataDirectoryInfo: () => ({ root: '/data' }),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// =============================================================================
// Import SUT after mocks
// =============================================================================

import { ExtensionService, ExtensionError, getExtensionService } from './extension-service.js';
import type { ExtensionManifest } from './extension-types.js';

// =============================================================================
// Helpers
// =============================================================================

function makeManifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'test-ext',
    name: 'Test Extension',
    version: '1.0.0',
    description: 'A test extension',
    tools: [],
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<{
    id: string;
    userId: string;
    name: string;
    status: string;
    sourcePath: string;
    manifest: ExtensionManifest;
  }> = {}
) {
  return {
    id: 'test-ext',
    userId: 'default',
    name: 'Test Extension',
    version: '1.0.0',
    description: 'A test extension',
    status: 'enabled',
    sourcePath: '/path/to/extension.json',
    manifest: makeManifest(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ExtensionService', () => {
  let svc: ExtensionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAudit.mockReturnValue({
      blocked: false,
      reasons: [],
      riskLevel: 'low',
      warnings: [],
      undeclaredTools: [],
    });
    mockValidateManifest.mockReturnValue({ valid: true, errors: [] });
    mockValidateAgentSkills.mockReturnValue({ valid: true, errors: [] });
    mockRepo.upsert.mockResolvedValue(makeRecord());
    mockRepo.updateStatus.mockResolvedValue(makeRecord());
    mockRepo.delete.mockResolvedValue(true);
    mockTrigSvc.listTriggers.mockResolvedValue([]);
    svc = new ExtensionService();
  });

  // ==========================================================================
  // install()
  // ==========================================================================

  describe('install()', () => {
    it('throws IO_ERROR when file cannot be read', async () => {
      mockReadFile.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      await expect(svc.install('/bad/path.json')).rejects.toThrow(ExtensionError);
      await expect(svc.install('/bad/path.json')).rejects.toMatchObject({ code: 'IO_ERROR' });
    });

    it('parses SKILL.md via parseAgentSkillsMd', async () => {
      const manifest = makeManifest({ format: 'agentskills' });
      mockReadFile.mockReturnValue('# skill content');
      mockParseSkill.mockReturnValue(manifest);

      await svc.install('/some/dir/SKILL.md');

      expect(mockParseSkill).toHaveBeenCalledWith('# skill content', '/some/dir');
    });

    it('throws VALIDATION_ERROR when SKILL.md parse fails', async () => {
      mockReadFile.mockReturnValue('bad content');
      mockParseSkill.mockImplementation(() => {
        throw new Error('parse error');
      });

      await expect(svc.install('/dir/SKILL.md')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('parses .md via parseExtensionMarkdown', async () => {
      const manifest = makeManifest();
      mockReadFile.mockReturnValue('# extension');
      mockParseMd.mockReturnValue(manifest);

      await svc.install('/ext/extension.md');

      expect(mockParseMd).toHaveBeenCalledWith('# extension');
    });

    it('throws VALIDATION_ERROR when .md parse fails', async () => {
      mockReadFile.mockReturnValue('bad');
      mockParseMd.mockImplementation(() => {
        throw new Error('bad md');
      });

      await expect(svc.install('/ext/extension.md')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('parses JSON manifest for .json files', async () => {
      const manifest = makeManifest();
      mockReadFile.mockReturnValue(JSON.stringify(manifest));

      await svc.install('/ext/extension.json');

      expect(mockRepo.upsert).toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR for invalid JSON', async () => {
      mockReadFile.mockReturnValue('not-json{');

      await expect(svc.install('/ext/extension.json')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });

  // ==========================================================================
  // installFromManifest()
  // ==========================================================================

  describe('installFromManifest()', () => {
    it('installs valid ownpilot extension and emits events', async () => {
      const manifest = makeManifest();
      const record = makeRecord();
      mockRepo.upsert.mockResolvedValue(record);

      const result = await svc.installFromManifest(manifest);

      expect(result).toEqual(record);
      expect(mockEmit).toHaveBeenCalled();
      expect(mockESEmit).toHaveBeenCalledWith(
        'extension.installed',
        'extension-service',
        expect.any(Object)
      );
    });

    it('throws VALIDATION_ERROR when ownpilot manifest is invalid', async () => {
      mockValidateManifest.mockReturnValue({ valid: false, errors: ['missing name'] });

      await expect(svc.installFromManifest(makeManifest())).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('throws VALIDATION_ERROR when agentskills manifest is invalid', async () => {
      mockValidateAgentSkills.mockReturnValue({ valid: false, errors: ['bad frontmatter'] });

      await expect(
        svc.installFromManifest(makeManifest({ format: 'agentskills' }))
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('throws VALIDATION_ERROR when security audit blocks extension', async () => {
      mockAudit.mockReturnValue({
        blocked: true,
        reasons: ['malicious code'],
        riskLevel: 'critical',
        warnings: [],
        undeclaredTools: [],
      });

      await expect(svc.installFromManifest(makeManifest())).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('logs warning when security audit has warnings (non-blocking)', async () => {
      mockAudit.mockReturnValue({
        blocked: false,
        reasons: [],
        riskLevel: 'medium',
        warnings: ['uses eval'],
        undeclaredTools: [],
      });

      const result = await svc.installFromManifest(makeManifest());
      expect(result).toBeDefined(); // Still installs
    });

    it('registers required_services in Config Center', async () => {
      const manifest = makeManifest({
        required_services: [
          {
            name: 'openai',
            display_name: 'OpenAI',
            description: 'AI service',
            category: 'ai',
            config_schema: [
              {
                name: 'api_key',
                label: 'API Key',
                type: 'secret',
                required: true,
                description: 'Key',
              },
            ],
          },
        ],
      });

      await svc.installFromManifest(manifest);

      expect(mockRegReqs).toHaveBeenCalled();
    });

    it('continues even when Config Center registration fails', async () => {
      const manifest = makeManifest({
        required_services: [
          { name: 'svc', display_name: 'Svc', description: 'x', category: 'other' },
        ],
      });
      mockRegReqs.mockRejectedValue(new Error('Config Center error'));

      const result = await svc.installFromManifest(manifest);
      expect(result).toBeDefined();
    });

    it('activates triggers when record is enabled', async () => {
      const manifest = makeManifest({
        triggers: [
          {
            name: 'daily',
            type: 'schedule' as never,
            config: { expression: '0 9 * * *' } as never,
            action: { type: 'run_tool' } as never,
          },
        ],
      });
      mockRepo.upsert.mockResolvedValue(makeRecord({ status: 'enabled' }));

      await svc.installFromManifest(manifest);

      expect(mockTrigSvc.createTrigger).toHaveBeenCalled();
    });

    it('does not activate triggers when record is disabled', async () => {
      const manifest = makeManifest({
        triggers: [
          { name: 'daily', type: 'schedule' as never, config: {} as never, action: {} as never },
        ],
      });
      mockRepo.upsert.mockResolvedValue(makeRecord({ status: 'disabled' }));

      await svc.installFromManifest(manifest);

      expect(mockTrigSvc.createTrigger).not.toHaveBeenCalled();
    });

    it('continues when trigger activation fails (non-fatal)', async () => {
      const manifest = makeManifest({
        triggers: [
          { name: 'daily', type: 'schedule' as never, config: {} as never, action: {} as never },
        ],
      });
      mockRepo.upsert.mockResolvedValue(makeRecord({ status: 'enabled' }));
      mockTrigSvc.createTrigger.mockRejectedValue(new Error('trigger DB error'));

      const result = await svc.installFromManifest(manifest);
      expect(result).toBeDefined();
    });

    it('stores security metadata on manifest', async () => {
      const manifest = makeManifest();
      await svc.installFromManifest(manifest);
      expect(manifest._security).toBeDefined();
      expect(manifest._security!.blocked).toBe(false);
    });
  });

  // ==========================================================================
  // uninstall()
  // ==========================================================================

  describe('uninstall()', () => {
    it('returns false when extension not found', async () => {
      mockRepo.getById.mockReturnValue(null);
      const result = await svc.uninstall('no-such-id');
      expect(result).toBe(false);
    });

    it('returns false when userId does not match', async () => {
      mockRepo.getById.mockReturnValue(makeRecord({ userId: 'other-user' }));
      const result = await svc.uninstall('test-ext', 'default');
      expect(result).toBe(false);
    });

    it('deletes extension and emits events on success', async () => {
      mockRepo.getById.mockReturnValue(makeRecord());
      mockRepo.delete.mockResolvedValue(true);

      const result = await svc.uninstall('test-ext');

      expect(result).toBe(true);
      expect(mockRepo.delete).toHaveBeenCalledWith('test-ext');
      expect(mockESEmit).toHaveBeenCalledWith(
        'extension.uninstalled',
        'extension-service',
        expect.any(Object)
      );
    });

    it('does not emit events when delete returns false', async () => {
      mockRepo.getById.mockReturnValue(makeRecord());
      mockRepo.delete.mockResolvedValue(false);

      const result = await svc.uninstall('test-ext');
      expect(result).toBe(false);
      expect(mockESEmit).not.toHaveBeenCalled();
    });

    it('deactivates triggers before delete', async () => {
      mockRepo.getById.mockReturnValue(makeRecord());
      mockTrigSvc.listTriggers.mockResolvedValue([
        { id: 'tr-1', name: '[Ext:test-ext] daily' },
        { id: 'tr-2', name: '[Ext:other] weekly' },
      ]);

      await svc.uninstall('test-ext');

      expect(mockTrigSvc.deleteTrigger).toHaveBeenCalledWith('default', 'tr-1');
      expect(mockTrigSvc.deleteTrigger).not.toHaveBeenCalledWith('default', 'tr-2');
    });

    it('unregisters Config Center dependencies', async () => {
      mockRepo.getById.mockReturnValue(makeRecord());

      await svc.uninstall('test-ext');

      expect(mockUnregDeps).toHaveBeenCalledWith('test-ext');
    });

    it('continues when unregister dependencies fails', async () => {
      mockRepo.getById.mockReturnValue(makeRecord());
      mockUnregDeps.mockRejectedValue(new Error('Config Center error'));

      const result = await svc.uninstall('test-ext');
      expect(result).toBe(true); // Still succeeds
    });
  });

  // ==========================================================================
  // enable() / disable()
  // ==========================================================================

  describe('enable()', () => {
    it('returns null when extension not found', async () => {
      mockRepo.getById.mockReturnValue(null);
      const result = await svc.enable('no-such-id');
      expect(result).toBeNull();
    });

    it('returns null when userId does not match', async () => {
      mockRepo.getById.mockReturnValue(makeRecord({ userId: 'other-user' }));
      const result = await svc.enable('test-ext', 'default');
      expect(result).toBeNull();
    });

    it('returns existing record when already enabled', async () => {
      const record = makeRecord({ status: 'enabled' });
      mockRepo.getById.mockReturnValue(record);
      const result = await svc.enable('test-ext');
      expect(result).toEqual(record);
      expect(mockRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('activates triggers, updates status, and emits events', async () => {
      mockRepo.getById.mockReturnValue(makeRecord({ status: 'disabled' }));
      const updatedRecord = makeRecord({ status: 'enabled' });
      mockRepo.updateStatus.mockResolvedValue(updatedRecord);

      const result = await svc.enable('test-ext');

      expect(result).toEqual(updatedRecord);
      expect(mockRepo.updateStatus).toHaveBeenCalledWith('test-ext', 'enabled');
      expect(mockESEmit).toHaveBeenCalledWith(
        'extension.enabled',
        'extension-service',
        expect.any(Object)
      );
    });

    it('does not emit when updateStatus returns null', async () => {
      mockRepo.getById.mockReturnValue(makeRecord({ status: 'disabled' }));
      mockRepo.updateStatus.mockResolvedValue(null);

      await svc.enable('test-ext');
      expect(mockESEmit).not.toHaveBeenCalled();
    });
  });

  describe('disable()', () => {
    it('returns null when extension not found', async () => {
      mockRepo.getById.mockReturnValue(null);
      const result = await svc.disable('no-such-id');
      expect(result).toBeNull();
    });

    it('returns null when userId does not match', async () => {
      mockRepo.getById.mockReturnValue(makeRecord({ userId: 'other-user' }));
      const result = await svc.disable('test-ext', 'default');
      expect(result).toBeNull();
    });

    it('returns existing record when already disabled', async () => {
      const record = makeRecord({ status: 'disabled' });
      mockRepo.getById.mockReturnValue(record);
      const result = await svc.disable('test-ext');
      expect(result).toEqual(record);
      expect(mockRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('deactivates triggers, updates status, and emits events', async () => {
      mockRepo.getById.mockReturnValue(makeRecord({ status: 'enabled' }));
      const updatedRecord = makeRecord({ status: 'disabled' });
      mockRepo.updateStatus.mockResolvedValue(updatedRecord);

      const result = await svc.disable('test-ext');

      expect(result).toEqual(updatedRecord);
      expect(mockRepo.updateStatus).toHaveBeenCalledWith('test-ext', 'disabled');
      expect(mockESEmit).toHaveBeenCalledWith(
        'extension.disabled',
        'extension-service',
        expect.any(Object)
      );
    });

    it('does not emit events when updateStatus returns null', async () => {
      mockRepo.getById.mockReturnValue(makeRecord({ status: 'enabled' }));
      mockRepo.updateStatus.mockResolvedValue(null);

      await svc.disable('test-ext');
      expect(mockESEmit).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Read methods
  // ==========================================================================

  describe('getById()', () => {
    it('delegates to extensionsRepo.getById', () => {
      const record = makeRecord();
      mockRepo.getById.mockReturnValue(record);
      expect(svc.getById('test-ext')).toEqual(record);
      expect(mockRepo.getById).toHaveBeenCalledWith('test-ext');
    });

    it('returns null when not found', () => {
      mockRepo.getById.mockReturnValue(null);
      expect(svc.getById('no-such')).toBeNull();
    });
  });

  describe('getAll()', () => {
    it('delegates to extensionsRepo.getAll', () => {
      const records = [makeRecord()];
      mockRepo.getAll.mockReturnValue(records);
      expect(svc.getAll()).toEqual(records);
    });
  });

  describe('getEnabled()', () => {
    it('delegates to extensionsRepo.getEnabled', () => {
      const records = [makeRecord({ status: 'enabled' })];
      mockRepo.getEnabled.mockReturnValue(records);
      expect(svc.getEnabled()).toEqual(records);
    });
  });

  // ==========================================================================
  // getToolDefinitions()
  // ==========================================================================

  describe('getToolDefinitions()', () => {
    it('returns empty array when no enabled extensions', () => {
      mockRepo.getEnabled.mockReturnValue([]);
      expect(svc.getToolDefinitions()).toEqual([]);
    });

    it('returns tool definitions for ownpilot extensions', () => {
      const manifest = makeManifest({
        tools: [
          {
            name: 'search_web',
            description: 'Search the web',
            parameters: { type: 'object', properties: {} },
            code: 'return {};',
          },
        ],
      });
      mockRepo.getEnabled.mockReturnValue([makeRecord({ manifest })]);

      const defs = svc.getToolDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0].name).toBe('search_web');
      expect(defs[0].extensionId).toBe('test-ext');
      expect(defs[0].format).toBe('ownpilot');
    });

    it('creates script tools for agentskills extensions with script_paths', () => {
      const manifest = makeManifest({
        format: 'agentskills',
        tools: [],
        script_paths: ['scripts/analyze.py'],
      });
      const record = makeRecord({ manifest, sourcePath: '/skills/mypkg/SKILL.md' });
      mockRepo.getEnabled.mockReturnValue([record]);
      mockExists.mockReturnValue(true);

      const defs = svc.getToolDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0].name).toBe('test_ext_analyze');
      expect(defs[0].extensionTool.code).toContain('execute_python');
    });

    it('creates shell script tool for .sh extension', () => {
      const manifest = makeManifest({
        format: 'agentskills',
        tools: [],
        script_paths: ['scripts/run.sh'],
      });
      const record = makeRecord({ manifest, sourcePath: '/skills/mypkg/SKILL.md' });
      mockRepo.getEnabled.mockReturnValue([record]);

      const defs = svc.getToolDefinitions();
      expect(defs[0].extensionTool.code).toContain('execute_shell');
    });

    it('creates JavaScript tool for .js extension', () => {
      const manifest = makeManifest({
        format: 'agentskills',
        tools: [],
        script_paths: ['scripts/helper.js'],
      });
      const record = makeRecord({ manifest, sourcePath: '/skills/mypkg/SKILL.md' });
      mockRepo.getEnabled.mockReturnValue([record]);

      const defs = svc.getToolDefinitions();
      expect(defs[0].extensionTool.code).toContain('execute_javascript');
    });

    it('creates JavaScript tool for .mjs extension', () => {
      const manifest = makeManifest({
        format: 'agentskills',
        tools: [],
        script_paths: ['scripts/module.mjs'],
      });
      const record = makeRecord({ manifest, sourcePath: '/skills/mypkg/SKILL.md' });
      mockRepo.getEnabled.mockReturnValue([record]);

      const defs = svc.getToolDefinitions();
      expect(defs[0].extensionTool.code).toContain('execute_javascript');
    });

    it('skips unsupported script types (.txt)', () => {
      const manifest = makeManifest({
        format: 'agentskills',
        tools: [],
        script_paths: ['scripts/readme.txt'],
      });
      const record = makeRecord({ manifest, sourcePath: '/skills/mypkg/SKILL.md' });
      mockRepo.getEnabled.mockReturnValue([record]);

      const defs = svc.getToolDefinitions();
      expect(defs).toHaveLength(0);
    });

    it('skips agentskills extension with no script_paths', () => {
      const manifest = makeManifest({
        format: 'agentskills',
        tools: [],
        script_paths: [],
      });
      const record = makeRecord({ manifest, sourcePath: '/skills/mypkg/SKILL.md' });
      mockRepo.getEnabled.mockReturnValue([record]);

      const defs = svc.getToolDefinitions();
      expect(defs).toHaveLength(0);
    });

    it('skips agentskills extension with no sourcePath', () => {
      const manifest = makeManifest({
        format: 'agentskills',
        tools: [],
        script_paths: ['scripts/run.py'],
      });
      const record = makeRecord({ manifest, sourcePath: undefined as unknown as string });
      mockRepo.getEnabled.mockReturnValue([record]);

      const defs = svc.getToolDefinitions();
      expect(defs).toHaveLength(0);
    });

    it('skips scripts with path traversal', () => {
      const manifest = makeManifest({
        format: 'agentskills',
        tools: [],
        script_paths: ['../../../etc/passwd.py'],
      });
      const record = makeRecord({ manifest, sourcePath: '/skills/mypkg/SKILL.md' });
      mockRepo.getEnabled.mockReturnValue([record]);

      const defs = svc.getToolDefinitions();
      // Path traversal should be detected and skipped
      expect(defs).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getSystemPromptSections()
  // ==========================================================================

  describe('getSystemPromptSections()', () => {
    it('returns empty array when no enabled extensions', () => {
      mockRepo.getEnabled.mockReturnValue([]);
      expect(svc.getSystemPromptSections()).toEqual([]);
    });

    it('returns agentskills instructions as system prompt', () => {
      const manifest = makeManifest({
        format: 'agentskills',
        tools: [],
        instructions: 'Use this skill to analyze PDFs.',
      });
      mockRepo.getEnabled.mockReturnValue([makeRecord({ manifest })]);

      const sections = svc.getSystemPromptSections();
      expect(sections).toHaveLength(1);
      expect(sections[0]).toContain('## Skill: Test Extension');
      expect(sections[0]).toContain('Use this skill to analyze PDFs.');
    });

    it('skips agentskills extension with no instructions', () => {
      const manifest = makeManifest({
        format: 'agentskills',
        tools: [],
        instructions: '',
      });
      mockRepo.getEnabled.mockReturnValue([makeRecord({ manifest })]);

      const sections = svc.getSystemPromptSections();
      expect(sections).toHaveLength(0);
    });

    it('returns ownpilot system_prompt sections', () => {
      const manifest = makeManifest({ system_prompt: 'You are a coding assistant.' });
      mockRepo.getEnabled.mockReturnValue([makeRecord({ manifest })]);

      const sections = svc.getSystemPromptSections();
      expect(sections).toHaveLength(1);
      expect(sections[0]).toContain('## Extension: Test Extension');
      expect(sections[0]).toContain('You are a coding assistant.');
    });

    it('skips ownpilot extension with empty system_prompt', () => {
      const manifest = makeManifest({ system_prompt: '   ' });
      mockRepo.getEnabled.mockReturnValue([makeRecord({ manifest })]);

      const sections = svc.getSystemPromptSections();
      expect(sections).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getAvailableSkillsMetadata()
  // ==========================================================================

  describe('getAvailableSkillsMetadata()', () => {
    it('returns empty array when no agentskills extensions', () => {
      const manifest = makeManifest(); // ownpilot format
      mockRepo.getEnabled.mockReturnValue([makeRecord({ manifest })]);

      expect(svc.getAvailableSkillsMetadata()).toEqual([]);
    });

    it('returns metadata for agentskills extensions only', () => {
      const manifest = makeManifest({ format: 'agentskills', tools: [] });
      mockRepo.getEnabled.mockReturnValue([makeRecord({ manifest })]);

      const metadata = svc.getAvailableSkillsMetadata();
      expect(metadata).toHaveLength(1);
      expect(metadata[0].id).toBe('test-ext');
      expect(metadata[0].name).toBe('Test Extension');
    });
  });

  // ==========================================================================
  // getSystemPromptSectionsForIds()
  // ==========================================================================

  describe('getSystemPromptSectionsForIds()', () => {
    it('returns empty array for empty ids', () => {
      expect(svc.getSystemPromptSectionsForIds([])).toEqual([]);
    });

    it('returns sections only for matching ids', () => {
      const manifest1 = makeManifest({
        id: 'ext-1',
        name: 'Ext 1',
        format: 'agentskills',
        tools: [],
        instructions: 'Skill 1 instructions.',
      });
      const manifest2 = makeManifest({
        id: 'ext-2',
        name: 'Ext 2',
        format: 'agentskills',
        tools: [],
        instructions: 'Skill 2 instructions.',
      });
      mockRepo.getEnabled.mockReturnValue([
        { ...makeRecord({ manifest: manifest1 }), id: 'ext-1' },
        { ...makeRecord({ manifest: manifest2 }), id: 'ext-2' },
      ]);

      const sections = svc.getSystemPromptSectionsForIds(['ext-1']);
      expect(sections).toHaveLength(1);
      expect(sections[0]).toContain('Skill 1 instructions.');
    });

    it('returns ownpilot system_prompt for matching ids', () => {
      const manifest = makeManifest({ system_prompt: 'Code helper.' });
      mockRepo.getEnabled.mockReturnValue([{ ...makeRecord({ manifest }), id: 'test-ext' }]);

      const sections = svc.getSystemPromptSectionsForIds(['test-ext']);
      expect(sections).toHaveLength(1);
      expect(sections[0]).toContain('Code helper.');
    });
  });

  // ==========================================================================
  // getEnabledMetadata()
  // ==========================================================================

  describe('getEnabledMetadata()', () => {
    it('returns empty array when nothing enabled', () => {
      mockRepo.getEnabled.mockReturnValue([]);
      expect(svc.getEnabledMetadata()).toEqual([]);
    });

    it('returns metadata for enabled extensions', () => {
      const manifest = makeManifest({
        tools: [{ name: 'my_tool', description: 'a tool', parameters: {}, code: '' }],
        keywords: ['search'],
      });
      mockRepo.getEnabled.mockReturnValue([makeRecord({ manifest })]);

      const metadata = svc.getEnabledMetadata();
      expect(metadata).toHaveLength(1);
      expect(metadata[0].id).toBe('test-ext');
      expect(metadata[0].toolNames).toContain('my_tool');
      expect(metadata[0].keywords).toEqual(['search']);
    });

    it('falls back to tags when keywords absent', () => {
      const manifest = makeManifest({ tags: ['tag1', 'tag2'] });
      mockRepo.getEnabled.mockReturnValue([makeRecord({ manifest })]);

      const metadata = svc.getEnabledMetadata();
      expect(metadata[0].keywords).toEqual(['tag1', 'tag2']);
    });
  });

  // ==========================================================================
  // reload()
  // ==========================================================================

  describe('reload()', () => {
    it('returns null when extension not found', async () => {
      mockRepo.getById.mockReturnValue(null);
      const result = await svc.reload('no-such-id');
      expect(result).toBeNull();
    });

    it('returns null when userId does not match', async () => {
      mockRepo.getById.mockReturnValue(makeRecord({ userId: 'other-user' }));
      const result = await svc.reload('test-ext', 'default');
      expect(result).toBeNull();
    });

    it('throws IO_ERROR when no sourcePath', async () => {
      mockRepo.getById.mockReturnValue(makeRecord({ sourcePath: undefined as unknown as string }));
      await expect(svc.reload('test-ext')).rejects.toMatchObject({ code: 'IO_ERROR' });
    });

    it('re-installs from sourcePath and returns updated record', async () => {
      const manifest = makeManifest();
      mockRepo.getById.mockReturnValue(makeRecord({ sourcePath: '/path/ext.json' }));
      mockReadFile.mockReturnValue(JSON.stringify(manifest));
      const updated = makeRecord({ version: '2.0.0' });
      mockRepo.upsert.mockResolvedValue(updated);

      const result = await svc.reload('test-ext');
      expect(result).toEqual(updated);
    });
  });

  // ==========================================================================
  // scanDirectory()
  // ==========================================================================

  describe('scanDirectory()', () => {
    it('returns 0 installed when directory does not exist', async () => {
      mockExists.mockReturnValue(false);
      const result = await svc.scanDirectory('/nonexistent');
      expect(result.installed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('returns error when readdirSync throws', async () => {
      mockExists.mockReturnValue(true);
      mockReaddir.mockImplementation(() => {
        throw new Error('perm denied');
      });

      const result = await svc.scanDirectory('/bad-dir');
      expect(result.installed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe('Cannot read directory');
    });

    // Helper: normalize backslashes to forward slashes for cross-platform checks
    function norm(p: string) {
      return p.replace(/\\/g, '/');
    }

    it('installs extension.json from subdirectory', async () => {
      mockExists.mockImplementation((p: string) => {
        const n = norm(p);
        if (n.endsWith('/scan-dir') || n === '/scan-dir') return true;
        if (n.includes('/ext1/') && n.endsWith('extension.json')) return true;
        return false;
      });
      mockReaddir.mockReturnValue([{ isDirectory: () => true, name: 'ext1' }]);
      const manifest = makeManifest();
      mockReadFile.mockReturnValue(JSON.stringify(manifest));

      const result = await svc.scanDirectory('/scan-dir');
      expect(result.installed).toBe(1);
    });

    it('installs SKILL.md first (highest priority) over extension.json', async () => {
      mockExists.mockImplementation((p: string) => {
        const n = norm(p);
        if (n.endsWith('/scan-dir') || n === '/scan-dir') return true;
        if (n.includes('/skill1/') && n.endsWith('SKILL.md')) return true;
        if (n.includes('/skill1/') && n.endsWith('extension.json')) return true;
        return false;
      });
      mockReaddir.mockReturnValue([{ isDirectory: () => true, name: 'skill1' }]);
      mockReadFile.mockReturnValue('# Skill');
      mockParseSkill.mockReturnValue(makeManifest({ format: 'agentskills' }));

      const result = await svc.scanDirectory('/scan-dir');
      expect(result.installed).toBe(1);
      expect(mockParseSkill).toHaveBeenCalled(); // SKILL.md was chosen
    });

    it('collects errors without stopping scan', async () => {
      mockExists.mockImplementation((p: string) => {
        const n = norm(p);
        if (n.endsWith('/scan-dir') || n === '/scan-dir') return true;
        if (n.includes('/bad/') && n.endsWith('extension.json')) return true;
        return false;
      });
      mockReaddir.mockReturnValue([{ isDirectory: () => true, name: 'bad' }]);
      mockReadFile.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = await svc.scanDirectory('/scan-dir');
      expect(result.installed).toBe(0);
      expect(result.errors).toHaveLength(1);
    });

    it('scans multiple directories when no directory specified', async () => {
      // All directory existence checks return false — just ensure no throw
      mockExists.mockReturnValue(false);
      const result = await svc.scanDirectory();
      expect(result.installed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('installs extension.md when no extension.json exists', async () => {
      mockExists.mockImplementation((p: string) => {
        const n = norm(p);
        if (n.endsWith('/scan-dir') || n === '/scan-dir') return true;
        if (n.includes('/ext/') && n.endsWith('extension.md')) return true;
        return false;
      });
      mockReaddir.mockReturnValue([{ isDirectory: () => true, name: 'ext' }]);
      const manifest = makeManifest();
      mockReadFile.mockReturnValue('# ext');
      mockParseMd.mockReturnValue(manifest);

      const result = await svc.scanDirectory('/scan-dir');
      expect(result.installed).toBe(1);
    });

    it('installs legacy skill.json when no other manifest found', async () => {
      mockExists.mockImplementation((p: string) => {
        const n = norm(p);
        if (n.endsWith('/scan-dir') || n === '/scan-dir') return true;
        if (n.includes('/ext/') && n.endsWith('skill.json')) return true;
        return false;
      });
      mockReaddir.mockReturnValue([{ isDirectory: () => true, name: 'ext' }]);
      const manifest = makeManifest();
      mockReadFile.mockReturnValue(JSON.stringify(manifest));

      const result = await svc.scanDirectory('/scan-dir');
      expect(result.installed).toBe(1);
    });

    it('installs legacy skill.md when no other manifest found', async () => {
      mockExists.mockImplementation((p: string) => {
        const n = norm(p);
        if (n.endsWith('/scan-dir') || n === '/scan-dir') return true;
        if (n.includes('/ext/') && n.endsWith('skill.md')) return true;
        return false;
      });
      mockReaddir.mockReturnValue([{ isDirectory: () => true, name: 'ext' }]);
      const manifest = makeManifest();
      mockReadFile.mockReturnValue('# skill');
      mockParseMd.mockReturnValue(manifest);

      const result = await svc.scanDirectory('/scan-dir');
      expect(result.installed).toBe(1);
    });

    it('skips directory with no manifest', async () => {
      mockExists.mockImplementation((p: string) => {
        const n = norm(p);
        if (n.endsWith('/scan-dir') || n === '/scan-dir') return true;
        return false; // No manifest files
      });
      mockReaddir.mockReturnValue([{ isDirectory: () => true, name: 'no-manifest' }]);

      const result = await svc.scanDirectory('/scan-dir');
      expect(result.installed).toBe(0);
    });
  });

  // ==========================================================================
  // Trigger management
  // ==========================================================================

  describe('activateExtensionTriggers()', () => {
    it('does nothing when manifest has no triggers', async () => {
      const manifest = makeManifest({ triggers: [] });
      mockRepo.upsert.mockResolvedValue(makeRecord({ status: 'enabled', manifest }));

      await svc.installFromManifest(manifest);

      expect(mockTrigSvc.createTrigger).not.toHaveBeenCalled();
    });

    it('continues when one trigger creation fails', async () => {
      const manifest = makeManifest({
        triggers: [
          { name: 'good', type: 'schedule' as never, config: {} as never, action: {} as never },
          { name: 'bad', type: 'schedule' as never, config: {} as never, action: {} as never },
        ],
      });
      mockRepo.upsert.mockResolvedValue(makeRecord({ status: 'enabled', manifest }));
      mockTrigSvc.createTrigger
        .mockResolvedValueOnce({ id: 't1', name: 'good' })
        .mockRejectedValueOnce(new Error('DB error'));

      // Should not throw
      await expect(svc.installFromManifest(manifest)).resolves.toBeDefined();
    });
  });

  describe('deactivateExtensionTriggers()', () => {
    it('continues gracefully when trigger listing fails', async () => {
      mockRepo.getById.mockReturnValue(makeRecord());
      mockTrigSvc.listTriggers.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(svc.uninstall('test-ext')).resolves.toBeDefined();
    });
  });

  // ==========================================================================
  // getExtensionService() singleton
  // ==========================================================================

  describe('getExtensionService()', () => {
    it('returns an ExtensionService instance', () => {
      const instance = getExtensionService();
      expect(instance).toBeInstanceOf(ExtensionService);
    });

    it('returns the same instance on repeated calls', () => {
      const a = getExtensionService();
      const b = getExtensionService();
      expect(a).toBe(b);
    });
  });

  // ==========================================================================
  // ExtensionError
  // ==========================================================================

  describe('ExtensionError', () => {
    it('has correct name and code', () => {
      const err = new ExtensionError('test message', 'NOT_FOUND');
      expect(err.name).toBe('ExtensionError');
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe('test message');
      expect(err).toBeInstanceOf(Error);
    });

    it('supports all error codes', () => {
      const codes = ['VALIDATION_ERROR', 'NOT_FOUND', 'ALREADY_EXISTS', 'IO_ERROR'] as const;
      for (const code of codes) {
        expect(new ExtensionError('msg', code).code).toBe(code);
      }
    });
  });
});
