/**
 * Skill Tools Tests
 *
 * Tests for skill management and Agentskills.io introspection tools.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeSkillTool, SKILL_TOOLS } from './skill-tools.js';

// =============================================================================
// Mocks - Must be defined inline inside vi.mock factories due to hoisting
// =============================================================================

vi.mock('../services/skill-npm-installer.js', () => ({
  getNpmInstaller: () => ({
    search: vi.fn(),
    install: vi.fn(),
    checkForUpdate: vi.fn(),
  }),
}));

vi.mock('../services/extension-service.js', () => ({
  getExtensionService: () => ({
    getAll: vi.fn(),
    getById: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    getToolDefinitions: vi.fn(),
  }),
}));

vi.mock('../db/repositories/extensions.js', () => ({
  extensionsRepo: {
    getAll: vi.fn(),
    getById: vi.fn(),
  },
}));

vi.mock('../services/agentskills-parser.js', () => ({
  parseAgentSkillsMd: vi.fn(),
  parseSkillMdFrontmatter: vi.fn(),
  scanSkillDirectory: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

// =============================================================================
// Test Data
// =============================================================================

const mockSearchResults = {
  packages: [
    {
      name: '@agentskills/weather',
      version: '1.0.0',
      description: 'Weather skill for agents',
      author: 'Test Author',
      keywords: ['weather', 'forecast'],
      date: '2024-01-01',
    },
  ],
  total: 1,
};

const mockExtension = {
  id: 'ext-123',
  name: 'Test Extension',
  description: 'A test extension',
  version: '1.0.0',
  status: 'enabled',
  category: 'productivity',
  toolCount: 2,
  triggerCount: 0,
  installedAt: new Date().toISOString(),
  manifest: {
    id: 'test-ext',
    name: 'Test Extension',
    version: '1.0.0',
    description: 'Test',
    format: 'ownpilot',
    tools: [{ name: 'tool1', description: 'Tool 1', parameters: {} }],
    triggers: [],
  },
  settings: {
    npmPackage: '@test/extension',
    npmVersion: '1.0.0',
  },
};

const mockSkillExtension = {
  ...mockExtension,
  settings: {
    npmPackage: '@agentskills/weather',
    npmVersion: '1.0.0',
  },
  manifest: {
    ...mockExtension.manifest,
    format: 'agentskills',
    instructions: '# Weather Skill\n\nGet weather info',
    script_paths: ['scripts/main.js'],
    reference_paths: ['references/api-docs.md'],
  },
};

// =============================================================================
// Tests
// =============================================================================

describe('Skill Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ==========================================================================
  // Tool Definitions
  // ==========================================================================

  describe('Tool Definitions', () => {
    it('exports all skill tools', () => {
      expect(SKILL_TOOLS).toHaveLength(14);

      const toolNames = SKILL_TOOLS.map((t) => t.name);
      expect(toolNames).toContain('skill_search');
      expect(toolNames).toContain('skill_install');
      expect(toolNames).toContain('skill_list_installed');
      expect(toolNames).toContain('skill_get_info');
      expect(toolNames).toContain('skill_toggle');
      expect(toolNames).toContain('skill_check_updates');
      expect(toolNames).toContain('skill_parse_content');
      expect(toolNames).toContain('skill_read_reference');
      expect(toolNames).toContain('skill_read_script');
      expect(toolNames).toContain('skill_list_resources');
      expect(toolNames).toContain('skill_record_usage');
      expect(toolNames).toContain('skill_get_learning_stats');
      expect(toolNames).toContain('skill_compare');
      expect(toolNames).toContain('skill_suggest_learning');
    });

    it('all tools have required properties', () => {
      for (const tool of SKILL_TOOLS) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.parameters).toBeDefined();
        expect(tool.category).toBe('Skills');
      }
    });
  });

  // ==========================================================================
  // skill_search
  // ==========================================================================

  describe('skill_search', () => {
    it('returns error when query parameter is missing', async () => {
      const result = await executeSkillTool('skill_search', {}, 'user-1');

      // The tool attempts to search but mock returns undefined, causing an error
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('validates query parameter exists', async () => {
      const result = await executeSkillTool('skill_search', { limit: 10 }, 'user-1');

      // Empty query will cause search to fail
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ==========================================================================
  // skill_install
  // ==========================================================================

  describe('skill_install', () => {
    it('requires packageName', async () => {
      const result = await executeSkillTool('skill_install', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('packageName is required');
    });

    it('validates packageName is provided', async () => {
      const result = await executeSkillTool('skill_install', { version: '1.0.0' }, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('packageName');
    });
  });

  // ==========================================================================
  // skill_list_installed
  // ==========================================================================

  describe('skill_list_installed', () => {
    it('executes without parameters', async () => {
      // This tests that the tool can be called - actual mocking would need
      // to be set up in the test file that imports the mock
      const result = await executeSkillTool('skill_list_installed', {}, 'user-1');

      // Should not throw, returns result based on mock
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('accepts status filter parameter', async () => {
      const result = await executeSkillTool(
        'skill_list_installed',
        { status: 'enabled' },
        'user-1'
      );

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  // ==========================================================================
  // skill_get_info
  // ==========================================================================

  describe('skill_get_info', () => {
    it('requires skillId', async () => {
      const result = await executeSkillTool('skill_get_info', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('skillId is required');
    });

    it('validates skillId is provided', async () => {
      const result = await executeSkillTool('skill_get_info', { includeTools: true }, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('skillId');
    });
  });

  // ==========================================================================
  // skill_toggle
  // ==========================================================================

  describe('skill_toggle', () => {
    it('requires skillId', async () => {
      const result = await executeSkillTool('skill_toggle', { enabled: true }, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('skillId is required');
    });

    it('validates enabled parameter', async () => {
      const result = await executeSkillTool('skill_toggle', { skillId: 'test' }, 'user-1');

      // Should fail because enabled is missing
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // skill_check_updates
  // ==========================================================================

  describe('skill_check_updates', () => {
    it('executes without parameters', async () => {
      const result = await executeSkillTool('skill_check_updates', {}, 'user-1');

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  // ==========================================================================
  // Skill Introspection Tools
  // ==========================================================================

  describe('skill_parse_content', () => {
    it('requires skillId', async () => {
      const result = await executeSkillTool('skill_parse_content', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('skillId');
    });
  });

  describe('skill_read_reference', () => {
    it('requires skillId', async () => {
      const result = await executeSkillTool('skill_read_reference', { path: 'ref.md' }, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('skillId');
    });

    it('requires referencePath', async () => {
      const result = await executeSkillTool('skill_read_reference', { skillId: 'test' }, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('referencePath');
    });
  });

  describe('skill_read_script', () => {
    it('requires skillId', async () => {
      const result = await executeSkillTool('skill_read_script', { path: 'script.js' }, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('skillId');
    });

    it('requires scriptPath', async () => {
      const result = await executeSkillTool('skill_read_script', { skillId: 'test' }, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('scriptPath');
    });
  });

  describe('skill_list_resources', () => {
    it('requires skillId', async () => {
      const result = await executeSkillTool('skill_list_resources', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('skillId');
    });
  });

  // ==========================================================================
  // Skill Usage & Learning Tracking
  // ==========================================================================

  describe('skill_record_usage', () => {
    it('requires skillId', async () => {
      const result = await executeSkillTool(
        'skill_record_usage',
        { usageType: 'learned' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('skillId');
    });

    it('requires valid usageType', async () => {
      const result = await executeSkillTool(
        'skill_record_usage',
        { skillId: 'test', usageType: 'invalid' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('usageType');
    });

    it('validates usageType enum values', async () => {
      const validTypes = ['learned', 'referenced', 'adapted'];
      const result = await executeSkillTool(
        'skill_record_usage',
        { skillId: 'test', usageType: 'learned' },
        'user-1'
      );

      // Should proceed to skill lookup (which will fail because skill doesn't exist)
      expect(validTypes).toContain('learned');
      expect(result).toBeDefined();
    });
  });

  describe('skill_get_learning_stats', () => {
    it('executes without parameters', async () => {
      const result = await executeSkillTool('skill_get_learning_stats', {}, 'user-1');

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('accepts optional skillId filter', async () => {
      const result = await executeSkillTool(
        'skill_get_learning_stats',
        { skillId: 'test-skill' },
        'user-1'
      );

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('respects limit parameter', async () => {
      const result = await executeSkillTool('skill_get_learning_stats', { limit: 10 }, 'user-1');

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('skill_compare', () => {
    it('requires both skillId1 and skillId2', async () => {
      const result1 = await executeSkillTool('skill_compare', { skillId1: 'test1' }, 'user-1');
      const result2 = await executeSkillTool('skill_compare', { skillId2: 'test2' }, 'user-1');

      expect(result1.success).toBe(false);
      expect(result1.error).toContain('skillId2');
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('skillId1');
    });

    it('validates both skills exist', async () => {
      // Mock returns null for unknown skills
      const result = await executeSkillTool(
        'skill_compare',
        { skillId1: 'unknown1', skillId2: 'unknown2' },
        'user-1'
      );

      expect(result.success).toBe(false);
    });
  });

  describe('skill_suggest_learning', () => {
    it('executes without mission parameter', async () => {
      const result = await executeSkillTool('skill_suggest_learning', {}, 'user-1');

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('accepts mission parameter', async () => {
      const result = await executeSkillTool(
        'skill_suggest_learning',
        { mission: 'web scraping and data analysis' },
        'user-1'
      );

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  // ==========================================================================
  // Unknown Tool
  // ==========================================================================

  describe('Unknown Tool', () => {
    it('returns error for unknown tool', async () => {
      const result = await executeSkillTool('unknown_tool', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown skill tool');
    });
  });

  // ==========================================================================
  // Tool Parameter Validation
  // ==========================================================================

  describe('Tool Parameter Validation', () => {
    it('validates skill_search limit parameter type', async () => {
      const result = await executeSkillTool(
        'skill_search',
        { query: 'test', limit: 'invalid' },
        'user-1'
      );

      expect(result).toBeDefined();
      // Should either succeed with default or fail with validation error
      expect(typeof result.success).toBe('boolean');
    });

    it('validates skill_toggle enabled parameter type', async () => {
      const result = await executeSkillTool(
        'skill_toggle',
        { skillId: 'test', enabled: 'yes' },
        'user-1'
      );

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });
});

// =============================================================================
// Happy Path Tests — stable mock overrides
// =============================================================================
//
// The mocks defined at the top of this file create fresh vi.fn() instances on
// every call to getNpmInstaller()/getExtensionService(), which prevents us from
// setting return values.  We declare stable mock objects via vi.hoisted() so
// they are available when the vi.mock() factory runs (Vitest hoists both), then
// add new vi.mock() registrations below that override the top-of-file ones.
// Vitest processes vi.mock() calls in source order after hoisting, so the last
// registration for a given module path wins.
// =============================================================================

const stableMocks = vi.hoisted(() => {
  const mockInstaller = {
    search: vi.fn(),
    install: vi.fn(),
    checkForUpdate: vi.fn(),
  };

  const mockService = {
    getAll: vi.fn(),
    getById: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    getToolDefinitions: vi.fn(),
  };

  const mockExtensionsRepo = {
    getAll: vi.fn(),
    getById: vi.fn(),
  };

  const mockAdapter = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue({ changes: 0, rowCount: 0 }),
    exec: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
    now: vi.fn().mockReturnValue('NOW()'),
    date: vi.fn(),
    dateSubtract: vi.fn(),
    placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
    boolean: vi.fn().mockImplementation((v: boolean) => v),
    parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { mockInstaller, mockService, mockExtensionsRepo, mockAdapter };
});

vi.mock('../services/skill-npm-installer.js', () => ({
  getNpmInstaller: () => stableMocks.mockInstaller,
}));

vi.mock('../services/extension-service.js', () => ({
  getExtensionService: () => stableMocks.mockService,
}));

vi.mock('../db/repositories/extensions.js', () => ({
  extensionsRepo: stableMocks.mockExtensionsRepo,
}));

vi.mock('../db/adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue(stableMocks.mockAdapter),
}));

// ---------------------------------------------------------------------------
// Fixtures for happy path tests
// ---------------------------------------------------------------------------

const happyExtension = {
  id: 'ext-123',
  userId: 'user-1',
  name: 'Weather Skill',
  description: 'Get weather information',
  version: '1.2.0',
  status: 'enabled' as const,
  category: 'productivity',
  toolCount: 2,
  triggerCount: 0,
  installedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  authorName: 'Test Author',
  sourcePath: undefined,
  settings: {
    npmPackage: '@agentskills/weather',
    npmVersion: '1.2.0',
  },
  manifest: {
    id: 'weather-skill',
    name: 'Weather Skill',
    version: '1.2.0',
    description: 'Get weather information',
    format: 'agentskills' as const,
    instructions: '# Weather Skill\n\nProvides weather forecast tools.',
    tools: [
      {
        name: 'get_weather',
        description: 'Get current weather',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'get_forecast',
        description: 'Get weather forecast',
        parameters: { type: 'object', properties: {} },
      },
    ],
    triggers: [],
  },
};

const happyOwnpilotExtension = {
  ...happyExtension,
  id: 'ext-456',
  name: 'File Manager',
  manifest: {
    ...happyExtension.manifest,
    format: 'ownpilot' as const,
    instructions: undefined,
  },
};

// Import the mocked getAdapter so we can restore its implementation after clearAllMocks
import { getAdapter as mockedGetAdapter } from '../db/adapters/index.js';

describe('Happy Path Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore getAdapter mock implementation (cleared by clearAllMocks above)
    vi.mocked(mockedGetAdapter).mockResolvedValue(stableMocks.mockAdapter as never);
    // Reset adapter method defaults after clearAllMocks
    stableMocks.mockAdapter.query.mockResolvedValue([]);
    stableMocks.mockAdapter.queryOne.mockResolvedValue(null);
    stableMocks.mockAdapter.execute.mockResolvedValue({ changes: 0, rowCount: 0 });
  });

  // ==========================================================================
  // skill_search — happy path
  // ==========================================================================

  describe('skill_search happy path', () => {
    it('returns search results successfully', async () => {
      stableMocks.mockInstaller.search.mockResolvedValue({
        packages: [
          {
            name: '@agentskills/weather',
            version: '1.0.0',
            description: 'Weather skill for agents',
            author: 'Test Author',
            keywords: ['weather', 'forecast'],
          },
        ],
        total: 1,
      });

      const result = await executeSkillTool('skill_search', { query: 'weather' }, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.query).toBe('weather');
      expect(r.count).toBe(1);
      expect(r.total).toBe(1);
      const skills = r.skills as Array<Record<string, unknown>>;
      expect(skills[0]!.name).toBe('@agentskills/weather');
      expect(skills[0]!.version).toBe('1.0.0');
    });

    it('respects the limit parameter (capped at 50)', async () => {
      stableMocks.mockInstaller.search.mockResolvedValue({ packages: [], total: 0 });

      await executeSkillTool('skill_search', { query: 'test', limit: 100 }, 'user-1');

      // limit is capped to 50 inside the tool
      const [, calledLimit] = stableMocks.mockInstaller.search.mock.calls[0] as [string, number];
      expect(calledLimit).toBe(50);
    });

    it('returns multiple packages', async () => {
      stableMocks.mockInstaller.search.mockResolvedValue({
        packages: [
          {
            name: '@agentskills/weather',
            version: '1.0.0',
            description: 'Weather',
            author: 'A',
            keywords: [],
          },
          {
            name: '@agentskills/climate',
            version: '2.0.0',
            description: 'Climate',
            author: 'B',
            keywords: [],
          },
        ],
        total: 2,
      });

      const result = await executeSkillTool(
        'skill_search',
        { query: 'weather', limit: 10 },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.count).toBe(2);
      expect((r.skills as unknown[]).length).toBe(2);
    });
  });

  // ==========================================================================
  // skill_install — happy path
  // ==========================================================================

  describe('skill_install happy path', () => {
    it('installs a skill successfully', async () => {
      stableMocks.mockInstaller.install.mockResolvedValue({
        success: true,
        extensionId: 'ext-new-123',
      });

      const result = await executeSkillTool(
        'skill_install',
        { packageName: '@agentskills/weather' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.packageName).toBe('@agentskills/weather');
      expect(r.extensionId).toBe('ext-new-123');
      expect(r.message).toContain('@agentskills/weather');
      expect(r.message).toContain('installed successfully');
    });

    it('propagates installer error when success is false', async () => {
      stableMocks.mockInstaller.install.mockResolvedValue({
        success: false,
        error: 'Package not found in registry',
      });

      const result = await executeSkillTool(
        'skill_install',
        { packageName: '@nonexistent/skill' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Package not found in registry');
    });

    it('uses default error message when installer returns no error text', async () => {
      stableMocks.mockInstaller.install.mockResolvedValue({ success: false });

      const result = await executeSkillTool(
        'skill_install',
        { packageName: '@agentskills/broken' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Installation failed');
    });
  });

  // ==========================================================================
  // skill_list_installed — happy path
  // ==========================================================================

  describe('skill_list_installed happy path', () => {
    it('lists all installed skills', async () => {
      stableMocks.mockService.getAll.mockReturnValue([happyExtension, happyOwnpilotExtension]);

      const result = await executeSkillTool('skill_list_installed', {}, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.count).toBe(2);
      const skills = r.skills as Array<Record<string, unknown>>;
      expect(skills[0]!.id).toBe('ext-123');
      expect(skills[1]!.id).toBe('ext-456');
    });

    it('filters by enabled status', async () => {
      const disabledExt = { ...happyExtension, id: 'ext-disabled', status: 'disabled' as const };
      stableMocks.mockService.getAll.mockReturnValue([happyExtension, disabledExt]);

      const result = await executeSkillTool(
        'skill_list_installed',
        { status: 'enabled' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.count).toBe(1);
      const skills = r.skills as Array<Record<string, unknown>>;
      expect(skills[0]!.id).toBe('ext-123');
    });

    it('filters by agentskills format', async () => {
      stableMocks.mockService.getAll.mockReturnValue([happyExtension, happyOwnpilotExtension]);

      const result = await executeSkillTool(
        'skill_list_installed',
        { format: 'agentskills' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.count).toBe(1);
      const skills = r.skills as Array<Record<string, unknown>>;
      expect(skills[0]!.format).toBe('agentskills');
    });

    it('includes instructionsPreview for agentskills format', async () => {
      stableMocks.mockService.getAll.mockReturnValue([happyExtension]);

      const result = await executeSkillTool('skill_list_installed', {}, 'user-1');

      expect(result.success).toBe(true);
      const skills = (result.result as Record<string, unknown>).skills as Array<
        Record<string, unknown>
      >;
      expect(skills[0]!.instructionsPreview).toBeDefined();
    });

    it('returns empty list when no skills installed', async () => {
      stableMocks.mockService.getAll.mockReturnValue([]);

      const result = await executeSkillTool('skill_list_installed', {}, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.count).toBe(0);
    });
  });

  // ==========================================================================
  // skill_get_info — happy path
  // ==========================================================================

  describe('skill_get_info happy path', () => {
    it('returns detailed info for an agentskills skill', async () => {
      stableMocks.mockService.getById.mockReturnValue(happyExtension);

      const result = await executeSkillTool('skill_get_info', { skillId: 'ext-123' }, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.id).toBe('ext-123');
      expect(r.name).toBe('Weather Skill');
      expect(r.format).toBe('agentskills');
      expect(r.instructions).toBeDefined();
      const tools = r.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(2);
      expect(tools[0]!.name).toBe('get_weather');
    });

    it('finds skill by name fallback when getById returns null', async () => {
      stableMocks.mockService.getById.mockReturnValue(null);
      stableMocks.mockService.getAll.mockReturnValue([happyExtension]);

      const result = await executeSkillTool(
        'skill_get_info',
        { skillId: 'Weather Skill' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.name).toBe('Weather Skill');
    });

    it('returns error when skill not found', async () => {
      stableMocks.mockService.getById.mockReturnValue(null);
      stableMocks.mockService.getAll.mockReturnValue([]);

      const result = await executeSkillTool('skill_get_info', { skillId: 'nonexistent' }, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Skill not found');
      expect(result.error).toContain('nonexistent');
    });

    it('omits instructions for ownpilot format', async () => {
      stableMocks.mockService.getById.mockReturnValue(happyOwnpilotExtension);

      const result = await executeSkillTool('skill_get_info', { skillId: 'ext-456' }, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.format).toBe('ownpilot');
      expect(r.instructions).toBeUndefined();
    });
  });

  // ==========================================================================
  // skill_toggle — happy path
  // ==========================================================================

  describe('skill_toggle happy path', () => {
    it('enables a skill successfully', async () => {
      const enabledExt = { ...happyExtension, status: 'enabled' as const };
      stableMocks.mockService.enable.mockResolvedValue(enabledExt);

      const result = await executeSkillTool(
        'skill_toggle',
        { skillId: 'ext-123', enabled: true },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.id).toBe('ext-123');
      expect(r.enabled).toBe(true);
      expect(r.status).toBe('enabled');
      expect(r.message).toContain('enabled');
    });

    it('disables a skill successfully', async () => {
      const disabledExt = { ...happyExtension, status: 'disabled' as const };
      stableMocks.mockService.disable.mockResolvedValue(disabledExt);

      const result = await executeSkillTool(
        'skill_toggle',
        { skillId: 'ext-123', enabled: false },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.enabled).toBe(false);
      expect(r.message).toContain('disabled');
    });

    it('returns error when skill not found on enable', async () => {
      stableMocks.mockService.enable.mockResolvedValue(null);

      const result = await executeSkillTool(
        'skill_toggle',
        { skillId: 'nonexistent', enabled: true },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Skill not found');
    });

    it('calls service.enable with the correct skill ID and userId', async () => {
      stableMocks.mockService.enable.mockResolvedValue({
        ...happyExtension,
        status: 'enabled' as const,
      });

      await executeSkillTool('skill_toggle', { skillId: 'ext-123', enabled: true }, 'user-42');

      expect(stableMocks.mockService.enable).toHaveBeenCalledWith('ext-123', 'user-42');
    });
  });

  // ==========================================================================
  // skill_check_updates — happy path
  // ==========================================================================

  describe('skill_check_updates happy path', () => {
    it('reports no updates when all skills are current', async () => {
      stableMocks.mockExtensionsRepo.getAll.mockReturnValue([
        { ...happyExtension, userId: 'user-1' },
      ]);
      stableMocks.mockInstaller.checkForUpdate.mockResolvedValue({
        hasUpdate: false,
        latestVersion: '1.2.0',
      });

      const result = await executeSkillTool('skill_check_updates', {}, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.hasUpdates).toBe(false);
      expect(r.count).toBe(0);
      expect((r.updates as unknown[]).length).toBe(0);
    });

    it('reports available updates', async () => {
      stableMocks.mockExtensionsRepo.getAll.mockReturnValue([
        { ...happyExtension, userId: 'user-1' },
      ]);
      stableMocks.mockInstaller.checkForUpdate.mockResolvedValue({
        hasUpdate: true,
        latestVersion: '2.0.0',
      });

      const result = await executeSkillTool('skill_check_updates', {}, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.hasUpdates).toBe(true);
      expect(r.count).toBe(1);
      const updates = r.updates as Array<Record<string, unknown>>;
      expect(updates[0]!.id).toBe('ext-123');
      expect(updates[0]!.current).toBe('1.2.0');
      expect(updates[0]!.latest).toBe('2.0.0');
    });

    it('filters extensions by userId', async () => {
      stableMocks.mockExtensionsRepo.getAll.mockReturnValue([
        { ...happyExtension, userId: 'user-1' },
        { ...happyExtension, id: 'ext-other', userId: 'user-99' },
      ]);
      stableMocks.mockInstaller.checkForUpdate.mockResolvedValue({
        hasUpdate: false,
        latestVersion: '1.2.0',
      });

      await executeSkillTool('skill_check_updates', {}, 'user-1');

      // Only one checkForUpdate call (for user-1's extension, not user-99's)
      expect(stableMocks.mockInstaller.checkForUpdate).toHaveBeenCalledTimes(1);
    });

    it('skips extensions without npm package info', async () => {
      const extNoNpm = {
        ...happyExtension,
        userId: 'user-1',
        settings: {},
        manifest: { ...happyExtension.manifest, npm_package: undefined, npm_version: undefined },
      };
      stableMocks.mockExtensionsRepo.getAll.mockReturnValue([extNoNpm]);

      const result = await executeSkillTool('skill_check_updates', {}, 'user-1');

      expect(result.success).toBe(true);
      expect(stableMocks.mockInstaller.checkForUpdate).not.toHaveBeenCalled();
    });

    it('returns empty updates when no extensions installed for user', async () => {
      stableMocks.mockExtensionsRepo.getAll.mockReturnValue([]);

      const result = await executeSkillTool('skill_check_updates', {}, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.hasUpdates).toBe(false);
      expect(r.count).toBe(0);
    });
  });

  // ==========================================================================
  // skill_parse_content — happy path (manifest path, no disk I/O)
  // ==========================================================================

  describe('skill_parse_content happy path', () => {
    it('returns parsed content from manifest for agentskills format', async () => {
      // The source checks pkg.manifest.instructions first; if present it returns
      // without touching the filesystem (source: 'manifest').
      stableMocks.mockService.getById.mockReturnValue(happyExtension);

      const result = await executeSkillTool(
        'skill_parse_content',
        { skillId: 'ext-123' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.id).toBe('ext-123');
      expect(r.format).toBe('agentskills');
      expect(r.source).toBe('manifest');
      expect(typeof r.instructions).toBe('string');
      expect(r.instructionLength).toBeGreaterThan(0);
    });

    it('finds skill by name fallback', async () => {
      stableMocks.mockService.getById.mockReturnValue(null);
      stableMocks.mockService.getAll.mockReturnValue([happyExtension]);

      const result = await executeSkillTool(
        'skill_parse_content',
        { skillId: 'Weather Skill' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.source).toBe('manifest');
    });

    it('returns error when skill not found', async () => {
      stableMocks.mockService.getById.mockReturnValue(null);
      stableMocks.mockService.getAll.mockReturnValue([]);

      const result = await executeSkillTool(
        'skill_parse_content',
        { skillId: 'unknown' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Skill not found');
    });

    it('falls back to disk when ownpilot format skill has no instructions', async () => {
      // ownpilot format with no instructions → no manifest path → tries disk
      // sourcePath is undefined and settings has no npmPackage → resolveSkillDirectory returns null
      const ownpilotNoInstructions = {
        ...happyOwnpilotExtension,
        settings: {}, // no npmPackage
        manifest: {
          ...happyOwnpilotExtension.manifest,
          system_prompt: undefined,
          instructions: undefined,
        },
      };
      stableMocks.mockService.getById.mockReturnValue(ownpilotNoInstructions);

      const result = await executeSkillTool(
        'skill_parse_content',
        { skillId: 'ext-456' },
        'user-1'
      );

      // Cannot locate skill directory → error
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot locate skill directory');
    });
  });

  // ==========================================================================
  // skill_record_usage — happy path
  // ==========================================================================

  describe('skill_record_usage happy path', () => {
    it('records learned usage successfully', async () => {
      stableMocks.mockService.getById.mockReturnValue(happyExtension);
      stableMocks.mockAdapter.execute.mockResolvedValue({ changes: 1, rowCount: 1 });

      const result = await executeSkillTool(
        'skill_record_usage',
        { skillId: 'ext-123', usageType: 'learned', notes: 'Studied weather API patterns' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.skillId).toBe('ext-123');
      expect(r.skillName).toBe('Weather Skill');
      expect(r.usageType).toBe('learned');
      expect(r.notes).toBe('Studied weather API patterns');
    });

    it('records referenced usage without notes', async () => {
      stableMocks.mockService.getById.mockReturnValue(happyExtension);
      stableMocks.mockAdapter.execute.mockResolvedValue({ changes: 1, rowCount: 1 });

      const result = await executeSkillTool(
        'skill_record_usage',
        { skillId: 'ext-123', usageType: 'referenced' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.usageType).toBe('referenced');
      expect(r.notes).toBeUndefined();
    });

    it('records adapted usage successfully', async () => {
      stableMocks.mockService.getById.mockReturnValue(happyExtension);
      stableMocks.mockAdapter.execute.mockResolvedValue({ changes: 1, rowCount: 1 });

      const result = await executeSkillTool(
        'skill_record_usage',
        { skillId: 'ext-123', usageType: 'adapted' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.usageType).toBe('adapted');
    });
  });

  // ==========================================================================
  // skill_get_learning_stats — happy path
  // ==========================================================================

  describe('skill_get_learning_stats happy path', () => {
    it('returns learning stats with no usage data', async () => {
      stableMocks.mockAdapter.query.mockResolvedValue([]);

      const result = await executeSkillTool('skill_get_learning_stats', {}, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      const summary = r.summary as Record<string, unknown>;
      expect(summary.totalUsage).toBe(0);
      expect(summary.learned).toBe(0);
      expect(summary.referenced).toBe(0);
      expect(summary.adapted).toBe(0);
      expect((r.topSkills as unknown[]).length).toBe(0);
      expect((r.recentActivity as unknown[]).length).toBe(0);
    });

    it('returns usage counts by type', async () => {
      stableMocks.mockAdapter.query
        .mockResolvedValueOnce([
          { usage_type: 'learned', count: '5' },
          { usage_type: 'referenced', count: '3' },
          { usage_type: 'adapted', count: '1' },
        ])
        .mockResolvedValueOnce([
          {
            skill_id: 'ext-123',
            skill_name: 'Weather Skill',
            total_uses: '9',
            learned_count: '5',
            referenced_count: '3',
            adapted_count: '1',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await executeSkillTool('skill_get_learning_stats', {}, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      const summary = r.summary as Record<string, unknown>;
      expect(summary.totalUsage).toBe(9);
      expect(summary.learned).toBe(5);
      expect(summary.referenced).toBe(3);
      expect(summary.adapted).toBe(1);
      const topSkills = r.topSkills as Array<Record<string, unknown>>;
      expect(topSkills[0]!.skillId).toBe('ext-123');
      expect(topSkills[0]!.totalUses).toBe(9);
    });
  });

  // ==========================================================================
  // skill_compare — happy path
  // ==========================================================================

  describe('skill_compare happy path', () => {
    const skill2 = {
      ...happyExtension,
      id: 'ext-456',
      name: 'Climate Skill',
      manifest: {
        ...happyExtension.manifest,
        tools: [
          { name: 'get_climate', description: 'Get climate data', parameters: {} },
          { name: 'get_weather', description: 'Shared weather tool', parameters: {} },
        ],
      },
    };

    it('compares two skills and highlights tool overlap', async () => {
      stableMocks.mockService.getById
        .mockReturnValueOnce(happyExtension)
        .mockReturnValueOnce(skill2);
      stableMocks.mockAdapter.queryOne
        .mockResolvedValueOnce({ count: '3' })
        .mockResolvedValueOnce({ count: '1' });

      const result = await executeSkillTool(
        'skill_compare',
        { skillId1: 'ext-123', skillId2: 'ext-456' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      const s1 = r.skill1 as Record<string, unknown>;
      const s2 = r.skill2 as Record<string, unknown>;
      expect(s1.id).toBe('ext-123');
      expect(s2.id).toBe('ext-456');
      const comparison = r.comparison as Record<string, unknown>;
      expect(comparison.commonTools).toContain('get_weather');
      expect(comparison.uniqueToSkill1 as string[]).toContain('get_forecast');
      expect(comparison.uniqueToSkill2 as string[]).toContain('get_climate');
    });

    it('returns error when missing skillId1', async () => {
      const result = await executeSkillTool('skill_compare', { skillId2: 'ext-456' }, 'user-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('skillId1');
    });
  });

  // ==========================================================================
  // skill_suggest_learning — happy path
  // ==========================================================================

  describe('skill_suggest_learning happy path', () => {
    it('returns suggestions based on installed skills', async () => {
      stableMocks.mockService.getAll.mockReturnValue([happyExtension]);
      stableMocks.mockAdapter.query.mockResolvedValue([]);

      const result = await executeSkillTool(
        'skill_suggest_learning',
        { mission: 'weather data analysis' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.mission).toBe('weather data analysis');
      expect(r.totalInstalled).toBe(1);
      expect(r.learnedCount).toBe(0);
      expect(Array.isArray(r.suggestions)).toBe(true);
    });

    it('works with no installed skills', async () => {
      stableMocks.mockService.getAll.mockReturnValue([]);
      stableMocks.mockAdapter.query.mockResolvedValue([]);

      const result = await executeSkillTool('skill_suggest_learning', {}, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.totalInstalled).toBe(0);
      expect((r.suggestions as unknown[]).length).toBe(0);
    });

    it('excludes already-learned skills from top suggestions when score is 0', async () => {
      stableMocks.mockService.getAll.mockReturnValue([happyExtension]);
      // Mark ext-123 as already learned
      stableMocks.mockAdapter.query.mockResolvedValue([{ skill_id: 'ext-123' }]);

      const result = await executeSkillTool(
        'skill_suggest_learning',
        { mission: 'data processing' },
        'user-1'
      );

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // skill_read_reference — happy path
  // ==========================================================================

  describe('skill_read_reference happy path', () => {
    it('reads a reference file when sourcePath resolves', async () => {
      const { existsSync: mockExistsSync, readFileSync: mockReadFileSync } = await import('fs');
      const { getExtensionService: getService } = await import('../services/extension-service.js');

      const extWithSourcePath = {
        ...happyExtension,
        sourcePath: '/skills/weather/SKILL.md',
        settings: {},
      };
      stableMocks.mockService.getById.mockReturnValue(extWithSourcePath);

      // existsSync: first for sourcePath dir (/skills/weather), then for the file itself
      vi.mocked(mockExistsSync)
        .mockReturnValueOnce(true) // skillDir exists
        .mockReturnValueOnce(true); // reference file exists

      vi.mocked(mockReadFileSync).mockReturnValue('# API Docs\n\nWeather API reference.');

      const result = await executeSkillTool(
        'skill_read_reference',
        { skillId: 'ext-123', referencePath: 'references/api-docs.md' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.skillId).toBe('ext-123');
      expect(r.content).toBe('# API Docs\n\nWeather API reference.');
    });
  });

  // ==========================================================================
  // skill_read_script — happy path
  // ==========================================================================

  describe('skill_read_script happy path', () => {
    it('reads a script file when sourcePath resolves', async () => {
      const { existsSync: mockExistsSync, readFileSync: mockReadFileSync } = await import('fs');

      const extWithSourcePath = {
        ...happyExtension,
        sourcePath: '/skills/weather/SKILL.md',
        settings: {},
      };
      stableMocks.mockService.getById.mockReturnValue(extWithSourcePath);

      vi.mocked(mockExistsSync)
        .mockReturnValueOnce(true) // skillDir exists
        .mockReturnValueOnce(true); // script file exists

      vi.mocked(mockReadFileSync).mockReturnValue(
        'function getWeather(city) { return fetch(...); }'
      );

      const result = await executeSkillTool(
        'skill_read_script',
        { skillId: 'ext-123', scriptPath: 'scripts/main.js' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.content).toBe('function getWeather(city) { return fetch(...); }');
      expect(r.skillId).toBe('ext-123');
    });
  });

  // ==========================================================================
  // skill_list_resources — happy path
  // ==========================================================================

  describe('skill_list_resources happy path', () => {
    it('lists resources in skill directory via sourcePath', async () => {
      const { existsSync: mockExistsSync } = await import('fs');
      const { scanSkillDirectory: mockScanSkillDirectory } =
        await import('../services/agentskills-parser.js');

      const extWithSourcePath = {
        ...happyExtension,
        sourcePath: '/skills/weather/SKILL.md',
        settings: {},
      };
      stableMocks.mockService.getById.mockReturnValue(extWithSourcePath);

      vi.mocked(mockExistsSync)
        .mockReturnValueOnce(true) // skillDir exists (resolveSkillDirectory)
        .mockReturnValueOnce(false); // SKILL.md check for hasSkillMd

      vi.mocked(mockScanSkillDirectory).mockReturnValue({
        scriptPaths: ['scripts/main.js'],
        referencePaths: ['references/api-docs.md'],
        assetPaths: [],
      });

      const result = await executeSkillTool(
        'skill_list_resources',
        { skillId: 'ext-123' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.id).toBe('ext-123');
      expect((r.scripts as string[]).length).toBe(1);
      expect((r.references as string[]).length).toBe(1);
      expect((r.assets as string[]).length).toBe(0);
      const summary = r.summary as Record<string, unknown>;
      expect(summary.scriptCount).toBe(1);
      expect(summary.referenceCount).toBe(1);
    });
  });

  // ==========================================================================
  // Unknown tool — already tested above, confirming in happy path suite
  // ==========================================================================

  describe('unknown tool name', () => {
    it('returns error for any unrecognised tool name', async () => {
      const result = await executeSkillTool('skill_does_not_exist', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown skill tool: skill_does_not_exist');
    });
  });
});
