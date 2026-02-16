/**
 * SkillPackageService Tests
 *
 * Tests for install, uninstall, enable/disable, validation, trigger sync, and scan.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillPackageService, SkillPackageError } from './skill-package-service.js';
import type { SkillPackageManifest } from './skill-package-types.js';

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted so they're available in vi.mock factories)
// ---------------------------------------------------------------------------

const { mockEmit, mockTriggerService, mockRepo } = vi.hoisted(() => ({
  mockEmit: vi.fn(),
  mockTriggerService: {
    createTrigger: vi.fn(async (_userId: string, input: Record<string, unknown>) => ({
      id: `trigger-${Date.now()}`,
      name: input.name,
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
}));

vi.mock('@ownpilot/core', () => ({
  getEventBus: () => ({ emit: mockEmit }),
  createEvent: vi.fn(
    (type: string, category: string, source: string, data: unknown) => ({
      type, category, source, data,
      timestamp: new Date().toISOString(),
    }),
  ),
  EventTypes: {
    RESOURCE_CREATED: 'resource.created',
    RESOURCE_UPDATED: 'resource.updated',
    RESOURCE_DELETED: 'resource.deleted',
  },
  getServiceRegistry: () => ({
    get: () => mockTriggerService,
  }),
  Services: { Trigger: 'trigger' },
}));

vi.mock('../db/repositories/skill-packages.js', () => ({
  skillPackagesRepo: mockRepo,
  SkillPackagesRepository: vi.fn(),
}));

vi.mock('./api-service-registrar.js', () => ({
  registerToolConfigRequirements: vi.fn(),
  unregisterDependencies: vi.fn(),
}));

vi.mock('../paths/index.js', () => ({
  getDataDirectoryInfo: () => ({ root: '/tmp/test-data' }),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock fs for install/scan tests
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  existsSync: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validManifest(overrides: Partial<SkillPackageManifest> = {}): SkillPackageManifest {
  return {
    id: 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    description: 'A test skill package',
    tools: [
      {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {}, required: [] },
        code: 'return { content: "ok" }',
      },
    ],
    ...overrides,
  };
}

function fakeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-skill',
    userId: 'default',
    name: 'Test Skill',
    version: '1.0.0',
    description: 'A test skill package',
    category: 'other',
    status: 'enabled',
    manifest: validManifest(),
    settings: {},
    toolCount: 1,
    triggerCount: 0,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillPackageService', () => {
  let service: SkillPackageService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.getById.mockReset();
    mockRepo.getAll.mockReturnValue([]);
    mockRepo.getEnabled.mockReturnValue([]);
    service = new SkillPackageService();
  });

  // ========================================================================
  // installFromManifest
  // ========================================================================

  describe('installFromManifest', () => {
    it('installs a valid manifest', async () => {
      const record = fakeRecord();
      mockRepo.upsert.mockResolvedValue(record);

      const result = await service.installFromManifest(validManifest());

      expect(result).toBe(record);
      expect(mockRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
        id: 'test-skill',
        name: 'Test Skill',
        toolCount: 1,
      }));
      expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'resource.created',
      }));
    });

    it('throws VALIDATION_ERROR for invalid manifest', async () => {
      await expect(
        service.installFromManifest({ id: '', name: '', version: '', description: '', tools: [] } as unknown as SkillPackageManifest),
      ).rejects.toThrow(SkillPackageError);
    });

    it('activates triggers when package is enabled', async () => {
      const manifest = validManifest({
        triggers: [
          { name: 'Daily check', type: 'schedule', config: { cron: '0 9 * * *' }, action: { type: 'chat', payload: { prompt: 'Check status' } } },
        ],
      });
      const record = fakeRecord({ status: 'enabled' });
      mockRepo.upsert.mockResolvedValue(record);

      await service.installFromManifest(manifest);

      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith('default', expect.objectContaining({
        name: expect.stringContaining('[Skill:test-skill]'),
        type: 'schedule',
        config: { cron: '0 9 * * *' },
      }));
    });

    it('does not activate triggers when package is disabled', async () => {
      const manifest = validManifest({
        triggers: [
          { name: 'Daily check', type: 'schedule', config: { cron: '0 9 * * *' }, action: { type: 'chat', payload: { prompt: 'Check' } } },
        ],
      });
      const record = fakeRecord({ status: 'disabled' });
      mockRepo.upsert.mockResolvedValue(record);

      await service.installFromManifest(manifest);

      expect(mockTriggerService.createTrigger).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // uninstall
  // ========================================================================

  describe('uninstall', () => {
    it('uninstalls an existing package', async () => {
      mockRepo.getById.mockReturnValue(fakeRecord());
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockRepo.delete.mockResolvedValue(true);

      const result = await service.uninstall('test-skill');

      expect(result).toBe(true);
      expect(mockRepo.delete).toHaveBeenCalledWith('test-skill');
      expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'resource.deleted',
      }));
    });

    it('returns false when package not found', async () => {
      mockRepo.getById.mockReturnValue(null);
      const result = await service.uninstall('missing');
      expect(result).toBe(false);
    });

    it('deactivates triggers before deleting', async () => {
      mockRepo.getById.mockReturnValue(fakeRecord());
      mockTriggerService.listTriggers.mockResolvedValue([
        { id: 't1', name: '[Skill:test-skill] Daily check' },
        { id: 't2', name: '[Skill:test-skill] Weekly report' },
        { id: 't3', name: 'Other trigger' },
      ]);
      mockRepo.delete.mockResolvedValue(true);

      await service.uninstall('test-skill');

      expect(mockTriggerService.deleteTrigger).toHaveBeenCalledTimes(2);
      expect(mockTriggerService.deleteTrigger).toHaveBeenCalledWith('default', 't1');
      expect(mockTriggerService.deleteTrigger).toHaveBeenCalledWith('default', 't2');
    });
  });

  // ========================================================================
  // enable / disable
  // ========================================================================

  describe('enable', () => {
    it('enables a disabled package and activates triggers', async () => {
      const manifest = validManifest({
        triggers: [
          { name: 'Check', type: 'schedule', config: { cron: '0 9 * * *' }, action: { type: 'chat', payload: { prompt: 'Check' } } },
        ],
      });
      const record = fakeRecord({ status: 'disabled', manifest });
      const updatedRecord = fakeRecord({ status: 'enabled', manifest });

      mockRepo.getById.mockReturnValue(record);
      mockRepo.updateStatus.mockResolvedValue(updatedRecord);

      const result = await service.enable('test-skill');

      expect(result?.status).toBe('enabled');
      expect(mockTriggerService.createTrigger).toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'resource.updated',
      }));
    });

    it('returns null when package not found', async () => {
      mockRepo.getById.mockReturnValue(null);
      const result = await service.enable('missing');
      expect(result).toBeNull();
    });

    it('returns existing record if already enabled', async () => {
      const record = fakeRecord({ status: 'enabled' });
      mockRepo.getById.mockReturnValue(record);

      const result = await service.enable('test-skill');
      expect(result).toBe(record);
      expect(mockRepo.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('disable', () => {
    it('disables an enabled package and deactivates triggers', async () => {
      const record = fakeRecord({ status: 'enabled' });
      const updatedRecord = fakeRecord({ status: 'disabled' });

      mockRepo.getById.mockReturnValue(record);
      mockTriggerService.listTriggers.mockResolvedValue([]);
      mockRepo.updateStatus.mockResolvedValue(updatedRecord);

      const result = await service.disable('test-skill');

      expect(result?.status).toBe('disabled');
    });

    it('returns existing record if already disabled', async () => {
      const record = fakeRecord({ status: 'disabled' });
      mockRepo.getById.mockReturnValue(record);

      const result = await service.disable('test-skill');
      expect(result).toBe(record);
      expect(mockRepo.updateStatus).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // getToolDefinitions
  // ========================================================================

  describe('getToolDefinitions', () => {
    it('returns tool defs from all enabled packages', () => {
      mockRepo.getEnabled.mockReturnValue([
        fakeRecord({ manifest: validManifest() }),
        fakeRecord({
          id: 'pkg-2',
          manifest: validManifest({
            id: 'pkg-2',
            tools: [
              { name: 'tool_a', description: 'Tool A', parameters: { type: 'object', properties: {} }, code: 'return {}' },
              { name: 'tool_b', description: 'Tool B', parameters: { type: 'object', properties: {} }, code: 'return {}' },
            ],
          }),
        }),
      ]);

      const defs = service.getToolDefinitions();
      expect(defs).toHaveLength(3); // 1 from first + 2 from second
      expect(defs.map(d => d.name)).toEqual(['test_tool', 'tool_a', 'tool_b']);
    });

    it('returns empty when no enabled packages', () => {
      mockRepo.getEnabled.mockReturnValue([]);
      const defs = service.getToolDefinitions();
      expect(defs).toHaveLength(0);
    });
  });

  // ========================================================================
  // getSystemPromptSections
  // ========================================================================

  describe('getSystemPromptSections', () => {
    it('returns sections from enabled packages with system prompts', () => {
      mockRepo.getEnabled.mockReturnValue([
        fakeRecord({ manifest: validManifest({ system_prompt: 'Use GitHub tools for repos.' }) }),
        fakeRecord({ manifest: validManifest({ system_prompt: '' }) }), // empty → skipped
        fakeRecord({ manifest: validManifest({ system_prompt: undefined }) }), // undefined → skipped
      ]);

      const sections = service.getSystemPromptSections();
      expect(sections).toHaveLength(1);
      expect(sections[0]).toContain('## Skill: Test Skill');
      expect(sections[0]).toContain('Use GitHub tools for repos.');
    });
  });

  // ========================================================================
  // Read
  // ========================================================================

  describe('getById / getAll / getEnabled', () => {
    it('delegates to repo', () => {
      const record = fakeRecord();
      mockRepo.getById.mockReturnValue(record);
      expect(service.getById('test-skill')).toBe(record);

      mockRepo.getAll.mockReturnValue([record]);
      expect(service.getAll()).toEqual([record]);

      mockRepo.getEnabled.mockReturnValue([record]);
      expect(service.getEnabled()).toEqual([record]);
    });
  });

  // ========================================================================
  // install (file-based) — JSON vs Markdown
  // ========================================================================

  describe('install (file-based)', () => {
    // fs is mocked at module level — get reference to mocked functions
    let mockReadFileSync: ReturnType<typeof vi.fn>;
    let mockExistsSync: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const fs = await import('fs');
      mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>;
      mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
    });

    it('installs from .json file', async () => {
      const manifest = validManifest();
      mockReadFileSync.mockReturnValue(JSON.stringify(manifest));
      mockRepo.upsert.mockResolvedValue(fakeRecord());

      const result = await service.install('/path/to/skill.json');

      expect(result.id).toBe('test-skill');
      expect(mockReadFileSync).toHaveBeenCalledWith('/path/to/skill.json', 'utf-8');
    });

    it('installs from .md file', async () => {
      const mdContent = `---
id: md-skill
name: MD Skill
version: 1.0.0
description: A markdown skill
---

## Tools

### md_tool

Does markdown things.

\`\`\`javascript
return { content: { ok: true } };
\`\`\`
`;
      mockReadFileSync.mockReturnValue(mdContent);
      mockRepo.upsert.mockResolvedValue(fakeRecord({ id: 'md-skill', name: 'MD Skill' }));

      const result = await service.install('/path/to/skill.md');

      expect(result.id).toBe('md-skill');
      expect(mockRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
        id: 'md-skill',
        name: 'MD Skill',
      }));
    });

    it('throws VALIDATION_ERROR for invalid .md file', async () => {
      mockReadFileSync.mockReturnValue('# Not a valid skill markdown');

      await expect(service.install('/path/to/bad.md')).rejects.toThrow(SkillPackageError);
      await expect(service.install('/path/to/bad.md')).rejects.toThrow('Invalid markdown manifest');
    });

    it('throws IO_ERROR when file cannot be read', async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

      await expect(service.install('/missing/skill.json')).rejects.toThrow('Cannot read manifest');
    });
  });

  // ========================================================================
  // scanDirectory — .md support
  // ========================================================================

  describe('scanDirectory (.md support)', () => {
    let mockReadFileSync: ReturnType<typeof vi.fn>;
    let mockExistsSync: ReturnType<typeof vi.fn>;
    let mockReaddirSync: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const fs = await import('fs');
      mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>;
      mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
      mockReaddirSync = fs.readdirSync as ReturnType<typeof vi.fn>;
    });

    it('discovers skill.md files', async () => {
      const mdContent = `---
id: md-pkg
name: MD Pkg
version: 1.0.0
description: Test
---

## Tools

### t

Test.

\`\`\`javascript
return { content: {} };
\`\`\`
`;
      // Use includes to handle both forward and backslash path separators
      mockExistsSync.mockImplementation((p: string) => {
        const n = p.replace(/\\/g, '/');
        if (n.endsWith('skill-packages')) return true;
        if (n.endsWith('my-pkg/skill.md')) return true;
        return false;
      });
      mockReaddirSync.mockReturnValue([
        { name: 'my-pkg', isDirectory: () => true },
      ]);
      mockReadFileSync.mockReturnValue(mdContent);
      mockRepo.upsert.mockResolvedValue(fakeRecord({ id: 'md-pkg' }));

      const result = await service.scanDirectory(undefined, 'default');

      expect(result.installed).toBe(1);
    });

    it('prefers skill.json over skill.md when both exist', async () => {
      const manifest = validManifest({ id: 'dual-pkg' });

      mockExistsSync.mockImplementation((p: string) => {
        const n = p.replace(/\\/g, '/');
        if (n.endsWith('skill-packages')) return true;
        if (n.endsWith('dual-pkg/skill.json')) return true;
        if (n.endsWith('dual-pkg/skill.md')) return true;
        return false;
      });
      mockReaddirSync.mockReturnValue([
        { name: 'dual-pkg', isDirectory: () => true },
      ]);
      mockReadFileSync.mockReturnValue(JSON.stringify(manifest));
      mockRepo.upsert.mockResolvedValue(fakeRecord({ id: 'dual-pkg' }));

      const result = await service.scanDirectory(undefined, 'default');

      expect(result.installed).toBe(1);
      // readFileSync should have been called with .json path, not .md
      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('skill.json'),
        'utf-8',
      );
    });
  });
});
