/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SkillManager,
  createSkillManager,
  getSkillManager,
  BUILTIN_SKILLS,
  BUILTIN_ROLES,
  type Skill,
  type Role,
  type CustomInstruction,
  type SkillFeedback,
} from './skills.js';

// =============================================================================
// Mocks
// =============================================================================

const { readFileMock, writeFileMock, mkdirMock } = vi.hoisted(() => ({
  readFileMock: vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFileMock: vi.fn().mockResolvedValue(undefined),
  mkdirMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
}));

vi.mock('node:crypto', () => {
  let counter = 0;
  return {
    randomUUID: () => `test-uuid-${++counter}`,
  };
});

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return {
    ...actual,
    join: (...args: string[]) => args.join('/'),
  };
});

// =============================================================================
// Helpers
// =============================================================================

function makeSkillInput(
  overrides: Partial<Skill> = {}
): Omit<Skill, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'successRate'> {
  return {
    name: 'Test Skill',
    description: 'A test skill',
    category: 'custom',
    instructions: 'Do testing things',
    exampleTriggers: ['test this'],
    keywords: ['test', 'spec'],
    proficiency: 'intermediate',
    createdBy: 'user-1',
    isSystem: false,
    enabled: true,
    tags: ['test'],
    ...overrides,
  };
}

function makeRoleInput(
  overrides: Partial<Role> = {}
): Omit<Role, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'> {
  return {
    name: 'Test Role',
    description: 'A test role',
    systemPrompt: 'You are a test role',
    personality: {
      tone: 'casual',
      verbosity: 'concise',
      style: ['direct'],
    },
    skills: [],
    domains: ['testing'],
    triggers: ['test this for me'],
    createdBy: 'user-1',
    isSystem: false,
    enabled: true,
    ...overrides,
  };
}

function makeInstructionInput(
  overrides: Partial<CustomInstruction> = {}
): Omit<CustomInstruction, 'id' | 'userId' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Test Instruction',
    content: 'Always be explicit',
    applyWhen: 'always',
    priority: 10,
    enabled: true,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('BUILTIN_SKILLS', () => {
  it('contains 10 built-in skills', () => {
    expect(BUILTIN_SKILLS).toHaveLength(10);
  });

  it('all have required fields', () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.category).toBeTruthy();
      expect(skill.instructions).toBeTruthy();
      expect(skill.exampleTriggers.length).toBeGreaterThan(0);
      expect(skill.keywords.length).toBeGreaterThan(0);
      expect(skill.proficiency).toBe('expert');
      expect(skill.successRate).toBe(1.0);
      expect(skill.usageCount).toBe(0);
      expect(skill.createdBy).toBe('system');
      expect(skill.isSystem).toBe(true);
      expect(skill.enabled).toBe(true);
      expect(skill.tags.length).toBeGreaterThan(0);
    }
  });

  it('includes expected skill names', () => {
    const names = BUILTIN_SKILLS.map((s) => s.name);
    expect(names).toContain('Python Developer');
    expect(names).toContain('TypeScript Developer');
    expect(names).toContain('Technical Writer');
    expect(names).toContain('Data Analyst');
    expect(names).toContain('Email Composer');
    expect(names).toContain('Research Assistant');
    expect(names).toContain('Task Planner');
    expect(names).toContain('Creative Writer');
    expect(names).toContain('Code Reviewer');
    expect(names).toContain('Translator');
  });

  it('covers all expected categories', () => {
    const categories = new Set(BUILTIN_SKILLS.map((s) => s.category));
    expect(categories).toContain('coding');
    expect(categories).toContain('writing');
    expect(categories).toContain('analysis');
    expect(categories).toContain('communication');
    expect(categories).toContain('research');
    expect(categories).toContain('creativity');
    expect(categories).toContain('organization');
    expect(categories).toContain('translation');
  });

  it('has requiredTools on skills that need them', () => {
    const python = BUILTIN_SKILLS.find((s) => s.name === 'Python Developer');
    expect(python?.requiredTools).toContain('code_execute');

    const research = BUILTIN_SKILLS.find((s) => s.name === 'Research Assistant');
    expect(research?.requiredTools).toContain('web_search');
    expect(research?.requiredTools).toContain('web_fetch');

    const writer = BUILTIN_SKILLS.find((s) => s.name === 'Technical Writer');
    expect(writer?.requiredTools).toBeUndefined();
  });
});

describe('BUILTIN_ROLES', () => {
  it('contains 4 built-in roles', () => {
    expect(BUILTIN_ROLES).toHaveLength(4);
  });

  it('all have required fields', () => {
    for (const role of BUILTIN_ROLES) {
      expect(role.name).toBeTruthy();
      expect(role.description).toBeTruthy();
      expect(role.systemPrompt).toBeTruthy();
      expect(role.personality).toBeDefined();
      expect(role.personality.tone).toBeTruthy();
      expect(role.personality.verbosity).toBeTruthy();
      expect(role.personality.style.length).toBeGreaterThan(0);
      expect(role.domains.length).toBeGreaterThan(0);
      expect(role.triggers.length).toBeGreaterThan(0);
      expect(role.createdBy).toBe('system');
      expect(role.isSystem).toBe(true);
      expect(role.enabled).toBe(true);
      expect(role.usageCount).toBe(0);
    }
  });

  it('includes expected role names', () => {
    const names = BUILTIN_ROLES.map((r) => r.name);
    expect(names).toContain('Personal Assistant');
    expect(names).toContain('Senior Developer');
    expect(names).toContain('Writing Coach');
    expect(names).toContain('Business Analyst');
  });
});

// ---------------------------------------------------------------------------
// SkillManager
// ---------------------------------------------------------------------------
describe('SkillManager', () => {
  let manager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    writeFileMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    manager = new SkillManager('user-1', '/tmp/test-skills');
  });

  // =========================================================================
  // Constructor
  // =========================================================================
  describe('constructor', () => {
    it('uses provided storageDir', () => {
      const m = new SkillManager('u1', '/custom/dir');
      // Initialize will use this directory for mkdir
      expect(m).toBeDefined();
    });

    it('falls back to HOME-based dir when no storageDir', () => {
      const orig = process.env.HOME;
      process.env.HOME = '/home/test';
      const m = new SkillManager('u1');
      expect(m).toBeDefined();
      process.env.HOME = orig;
    });

    it('falls back to USERPROFILE when HOME is undefined', () => {
      const origHome = process.env.HOME;
      const origProfile = process.env.USERPROFILE;
      delete process.env.HOME;
      process.env.USERPROFILE = 'C:\\Users\\test';
      const m = new SkillManager('u1');
      expect(m).toBeDefined();
      process.env.HOME = origHome;
      process.env.USERPROFILE = origProfile;
    });

    it('falls back to "." when neither HOME nor USERPROFILE is set', () => {
      const origHome = process.env.HOME;
      const origProfile = process.env.USERPROFILE;
      delete process.env.HOME;
      delete process.env.USERPROFILE;
      const m = new SkillManager('u1');
      expect(m).toBeDefined();
      process.env.HOME = origHome;
      process.env.USERPROFILE = origProfile;
    });
  });

  // =========================================================================
  // Initialization
  // =========================================================================
  describe('initialize', () => {
    it('creates storage directory and loads data', async () => {
      await manager.initialize();
      expect(mkdirMock).toHaveBeenCalledWith('/tmp/test-skills', { recursive: true });
    });

    it('only initializes once', async () => {
      await manager.initialize();
      await manager.initialize();
      expect(mkdirMock).toHaveBeenCalledTimes(1);
    });

    it('loads existing skills from file', async () => {
      const existingSkills: Skill[] = [
        {
          id: 'skill_existing',
          name: 'Existing Skill',
          description: 'Already stored',
          category: 'custom',
          instructions: 'Do stuff',
          exampleTriggers: ['do stuff'],
          keywords: ['stuff'],
          proficiency: 'beginner',
          successRate: 0.8,
          usageCount: 5,
          createdBy: 'user-1',
          isSystem: false,
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          tags: ['custom'],
        },
      ];
      readFileMock.mockImplementation((filePath: any) => {
        if (String(filePath).includes('skills.json'))
          return Promise.resolve(JSON.stringify(existingSkills));
        if (String(filePath).includes('roles.json')) return Promise.resolve('[]');
        if (String(filePath).includes('instructions.json')) return Promise.resolve('[]');
        return Promise.reject(new Error('ENOENT'));
      });

      await manager.initialize();
      const skill = manager.getSkill('skill_existing');
      expect(skill).toBeDefined();
      expect(skill?.name).toBe('Existing Skill');
    });

    it('loads existing roles from file', async () => {
      const existingRoles: Role[] = [
        {
          id: 'role_existing',
          name: 'Existing Role',
          description: 'Already stored',
          systemPrompt: 'You exist',
          personality: { tone: 'casual', verbosity: 'concise', style: ['direct'] },
          skills: [],
          domains: ['general'],
          triggers: ['existing'],
          createdBy: 'user-1',
          isSystem: false,
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          usageCount: 3,
        },
      ];
      readFileMock.mockImplementation((filePath: any) => {
        if (String(filePath).includes('skills.json')) return Promise.resolve('[]');
        if (String(filePath).includes('roles.json'))
          return Promise.resolve(JSON.stringify(existingRoles));
        if (String(filePath).includes('instructions.json')) return Promise.resolve('[]');
        return Promise.reject(new Error('ENOENT'));
      });

      await manager.initialize();
      const role = manager.getRole('role_existing');
      expect(role).toBeDefined();
      expect(role?.name).toBe('Existing Role');
    });

    it('loads existing instructions from file', async () => {
      const existingInstructions: CustomInstruction[] = [
        {
          id: 'instr_existing',
          userId: 'user-1',
          name: 'Existing Instruction',
          content: 'Be nice',
          applyWhen: 'always',
          priority: 5,
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ];
      readFileMock.mockImplementation((filePath: any) => {
        if (String(filePath).includes('skills.json')) return Promise.resolve('[]');
        if (String(filePath).includes('roles.json')) return Promise.resolve('[]');
        if (String(filePath).includes('instructions.json'))
          return Promise.resolve(JSON.stringify(existingInstructions));
        return Promise.reject(new Error('ENOENT'));
      });

      await manager.initialize();
      const instructions = manager.getApplicableInstructions();
      expect(instructions.some((i) => i.name === 'Existing Instruction')).toBe(true);
    });

    it('adds builtin skills if not already present', async () => {
      await manager.initialize();
      const allSkills = manager.getAllSkills();
      expect(allSkills.length).toBeGreaterThanOrEqual(BUILTIN_SKILLS.length);

      for (const builtin of BUILTIN_SKILLS) {
        const found = allSkills.find((s) => s.name === builtin.name);
        expect(found).toBeDefined();
        expect(found?.isSystem).toBe(true);
      }
    });

    it('adds builtin roles if not already present', async () => {
      await manager.initialize();
      const allRoles = manager.getAllRoles();
      expect(allRoles.length).toBeGreaterThanOrEqual(BUILTIN_ROLES.length);

      for (const builtin of BUILTIN_ROLES) {
        const found = allRoles.find((r) => r.name === builtin.name);
        expect(found).toBeDefined();
        expect(found?.isSystem).toBe(true);
      }
    });

    it('does not duplicate builtins if they already exist', async () => {
      const existingSkills: Skill[] = [
        {
          id: 'skill_builtin_python_developer',
          name: 'Python Developer',
          description: 'Custom desc',
          category: 'coding',
          instructions: 'custom',
          exampleTriggers: [],
          keywords: [],
          proficiency: 'expert',
          successRate: 0.9,
          usageCount: 10,
          createdBy: 'system',
          isSystem: true,
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          tags: [],
        },
      ];
      readFileMock.mockImplementation((filePath: any) => {
        if (String(filePath).includes('skills.json'))
          return Promise.resolve(JSON.stringify(existingSkills));
        if (String(filePath).includes('roles.json')) return Promise.resolve('[]');
        if (String(filePath).includes('instructions.json')) return Promise.resolve('[]');
        return Promise.reject(new Error('ENOENT'));
      });

      await manager.initialize();
      const pythonSkills = manager.getAllSkills().filter((s) => s.name === 'Python Developer');
      expect(pythonSkills).toHaveLength(1);
      // Should keep the existing one, not overwrite with default
      expect(pythonSkills[0].usageCount).toBe(10);
    });
  });

  // =========================================================================
  // Skill Management
  // =========================================================================
  describe('addSkill', () => {
    it('adds a new skill with generated id and timestamps', async () => {
      await manager.initialize();
      const skill = await manager.addSkill(makeSkillInput());

      expect(skill.id).toMatch(/^skill_test-uuid-/);
      expect(skill.name).toBe('Test Skill');
      expect(skill.usageCount).toBe(0);
      expect(skill.successRate).toBe(1.0);
      expect(skill.createdAt).toBeTruthy();
      expect(skill.updatedAt).toBeTruthy();
    });

    it('persists skill to storage', async () => {
      await manager.initialize();
      writeFileMock.mockClear();

      await manager.addSkill(makeSkillInput());

      const writeCalls = writeFileMock.mock.calls;
      const skillsWrite = writeCalls.find((c) => String(c[0]).includes('skills.json'));
      expect(skillsWrite).toBeDefined();
    });

    it('auto-initializes if not yet initialized', async () => {
      const freshManager = new SkillManager('user-1', '/tmp/test-skills');
      const skill = await freshManager.addSkill(makeSkillInput());
      expect(skill.id).toBeTruthy();
      expect(mkdirMock).toHaveBeenCalled();
    });

    it('can retrieve added skill by id', async () => {
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());
      const retrieved = manager.getSkill(added.id);
      expect(retrieved).toEqual(added);
    });
  });

  describe('updateSkill', () => {
    it('updates a non-system skill', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());

      vi.setSystemTime(new Date('2024-06-01T00:00:00Z'));
      const updated = await manager.updateSkill(added.id, { name: 'Updated Skill' });
      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Updated Skill');
      expect(updated?.id).toBe(added.id);
      expect(updated?.createdAt).toBe(added.createdAt);
      expect(updated?.updatedAt).toBe('2024-06-01T00:00:00.000Z');
      vi.useRealTimers();
    });

    it('returns null for non-existent skill', async () => {
      await manager.initialize();
      const result = await manager.updateSkill('non-existent', { name: 'Foo' });
      expect(result).toBeNull();
    });

    it('returns null when trying to update a system skill', async () => {
      await manager.initialize();
      const systemSkill = manager.getAllSkills().find((s) => s.isSystem);
      expect(systemSkill).toBeDefined();

      const result = await manager.updateSkill(systemSkill!.id, { name: 'Hacked' });
      expect(result).toBeNull();
    });

    it('preserves id and createdAt even if included in updates', async () => {
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());

      const updated = await manager.updateSkill(added.id, {
        id: 'hacked_id' as any,
        createdAt: '1999-01-01',
        description: 'New desc',
      });
      expect(updated?.id).toBe(added.id);
      expect(updated?.createdAt).toBe(added.createdAt);
      expect(updated?.description).toBe('New desc');
    });

    it('persists changes to storage', async () => {
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());
      writeFileMock.mockClear();

      await manager.updateSkill(added.id, { name: 'Updated' });

      const writeCalls = writeFileMock.mock.calls;
      const skillsWrite = writeCalls.find((c) => String(c[0]).includes('skills.json'));
      expect(skillsWrite).toBeDefined();
    });
  });

  describe('deleteSkill', () => {
    it('deletes a non-system skill', async () => {
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());

      const result = await manager.deleteSkill(added.id);
      expect(result).toBe(true);
      expect(manager.getSkill(added.id)).toBeUndefined();
    });

    it('returns false for non-existent skill', async () => {
      await manager.initialize();
      const result = await manager.deleteSkill('non-existent');
      expect(result).toBe(false);
    });

    it('returns false when trying to delete a system skill', async () => {
      await manager.initialize();
      const systemSkill = manager.getAllSkills().find((s) => s.isSystem);
      expect(systemSkill).toBeDefined();

      const result = await manager.deleteSkill(systemSkill!.id);
      expect(result).toBe(false);
      expect(manager.getSkill(systemSkill!.id)).toBeDefined();
    });

    it('persists deletion to storage', async () => {
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());
      writeFileMock.mockClear();

      await manager.deleteSkill(added.id);

      const writeCalls = writeFileMock.mock.calls;
      const skillsWrite = writeCalls.find((c) => String(c[0]).includes('skills.json'));
      expect(skillsWrite).toBeDefined();
    });
  });

  describe('getSkill', () => {
    it('returns skill by id', async () => {
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());
      expect(manager.getSkill(added.id)).toEqual(added);
    });

    it('returns undefined for unknown id', async () => {
      await manager.initialize();
      expect(manager.getSkill('nonexistent')).toBeUndefined();
    });
  });

  describe('getAllSkills', () => {
    it('returns all skills including builtins', async () => {
      await manager.initialize();
      const allSkills = manager.getAllSkills();
      expect(allSkills.length).toBeGreaterThanOrEqual(BUILTIN_SKILLS.length);
    });

    it('includes custom skills after adding them', async () => {
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());
      const allSkills = manager.getAllSkills();
      expect(allSkills.some((s) => s.id === added.id)).toBe(true);
    });
  });

  describe('getSkillsByCategory', () => {
    it('returns skills filtered by category', async () => {
      await manager.initialize();
      const codingSkills = manager.getSkillsByCategory('coding');
      expect(codingSkills.length).toBeGreaterThan(0);
      expect(codingSkills.every((s) => s.category === 'coding')).toBe(true);
    });

    it('only returns enabled skills', async () => {
      await manager.initialize();
      await manager.addSkill(
        makeSkillInput({ category: 'custom', enabled: false, name: 'Disabled Custom' })
      );
      const customSkills = manager.getSkillsByCategory('custom');
      expect(customSkills.every((s) => s.enabled)).toBe(true);
    });

    it('returns empty array for category with no skills', async () => {
      await manager.initialize();
      // 'teaching' category has no builtin skills
      const teachingSkills = manager.getSkillsByCategory('teaching');
      expect(teachingSkills).toEqual([]);
    });
  });

  // =========================================================================
  // findRelevantSkills
  // =========================================================================
  describe('findRelevantSkills', () => {
    it('finds skills matching keywords', async () => {
      await manager.initialize();
      const skills = manager.findRelevantSkills('I need help with python code');
      expect(skills.length).toBeGreaterThan(0);
      expect(skills.some((s) => s.name === 'Python Developer')).toBe(true);
    });

    it('finds skills matching example triggers', async () => {
      await manager.initialize();
      const skills = manager.findRelevantSkills('write python script for me');
      expect(skills.some((s) => s.name === 'Python Developer')).toBe(true);
    });

    it('finds skills matching tags', async () => {
      await manager.initialize();
      const skills = manager.findRelevantSkills('programming task');
      expect(skills.length).toBeGreaterThan(0);
    });

    it('respects maxSkills parameter', async () => {
      await manager.initialize();
      const skills = manager.findRelevantSkills('code review python typescript', 1);
      expect(skills.length).toBeLessThanOrEqual(1);
    });

    it('defaults to max 3 skills', async () => {
      await manager.initialize();
      const skills = manager.findRelevantSkills(
        'code review python typescript data analysis research translate'
      );
      expect(skills.length).toBeLessThanOrEqual(3);
    });

    it('returns empty array when no skills match', async () => {
      await manager.initialize();
      const skills = manager.findRelevantSkills('xyzzy totally unrelated gibberish');
      expect(skills).toEqual([]);
    });

    it('skips disabled skills', async () => {
      await manager.initialize();
      const added = await manager.addSkill(
        makeSkillInput({
          name: 'Disabled Skill',
          keywords: ['unicorns123'],
          exampleTriggers: ['unicorns123'],
          enabled: false,
        })
      );
      const skills = manager.findRelevantSkills('unicorns123');
      expect(skills.some((s) => s.id === added.id)).toBe(false);
    });

    it('boosts score by success rate', async () => {
      await manager.initialize();
      const highSuccess = await manager.addSkill(
        makeSkillInput({
          name: 'High Success',
          keywords: ['uniquekeyword99'],
          exampleTriggers: [],
          tags: [],
          successRate: 1.0,
        } as any)
      );
      const lowSuccess = await manager.addSkill(
        makeSkillInput({
          name: 'Low Success',
          keywords: ['uniquekeyword99'],
          exampleTriggers: [],
          tags: [],
          successRate: 0.0,
        } as any)
      );

      // Need to manually set successRate since addSkill resets it
      const highSkill = manager.getSkill(highSuccess.id)!;
      highSkill.successRate = 1.0;
      const lowSkill = manager.getSkill(lowSuccess.id)!;
      lowSkill.successRate = 0.0;

      const skills = manager.findRelevantSkills('uniquekeyword99');
      expect(skills.length).toBe(2);
      // Higher success rate should be ranked first
      expect(skills[0].name).toBe('High Success');
    });

    it('ranks trigger matches higher than keyword matches', async () => {
      await manager.initialize();
      await manager.addSkill(
        makeSkillInput({
          name: 'Trigger Match',
          keywords: [],
          exampleTriggers: ['booga wooga'],
          tags: [],
        })
      );
      await manager.addSkill(
        makeSkillInput({
          name: 'Keyword Match',
          keywords: ['booga'],
          exampleTriggers: [],
          tags: [],
        })
      );

      const skills = manager.findRelevantSkills('booga wooga');
      expect(skills.length).toBe(2);
      // Trigger match should rank higher (3 points vs 2 points for keyword)
      expect(skills[0].name).toBe('Trigger Match');
    });
  });

  // =========================================================================
  // recordSkillUsage
  // =========================================================================
  describe('recordSkillUsage', () => {
    it('increments usage count', async () => {
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());
      expect(added.usageCount).toBe(0);

      await manager.recordSkillUsage(added.id);
      const skill = manager.getSkill(added.id);
      expect(skill?.usageCount).toBe(1);
    });

    it('updates updatedAt timestamp', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());

      vi.setSystemTime(new Date('2024-06-01T00:00:00Z'));
      await manager.recordSkillUsage(added.id);

      const skill = manager.getSkill(added.id);
      expect(skill?.updatedAt).toBe('2024-06-01T00:00:00.000Z');
      vi.useRealTimers();
    });

    it('updates success rate with positive feedback', async () => {
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());
      const originalRate = added.successRate;

      const feedback: SkillFeedback = {
        skillId: added.id,
        helpful: true,
        rating: 5,
        timestamp: new Date().toISOString(),
      };
      await manager.recordSkillUsage(added.id, feedback);

      const skill = manager.getSkill(added.id);
      // EMA: 1.0 * 0.9 + 1 * 0.1 = 1.0 (stays at 1.0 with positive feedback)
      expect(skill?.successRate).toBe(originalRate * 0.9 + 1 * 0.1);
    });

    it('updates success rate with negative feedback', async () => {
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());

      const feedback: SkillFeedback = {
        skillId: added.id,
        helpful: false,
        timestamp: new Date().toISOString(),
      };
      await manager.recordSkillUsage(added.id, feedback);

      const skill = manager.getSkill(added.id);
      // EMA: 1.0 * 0.9 + 0 * 0.1 = 0.9
      expect(skill?.successRate).toBe(0.9);
    });

    it('does nothing for non-existent skill', async () => {
      await manager.initialize();
      // Should not throw
      await manager.recordSkillUsage('non-existent');
    });

    it('persists changes to storage', async () => {
      await manager.initialize();
      const added = await manager.addSkill(makeSkillInput());
      writeFileMock.mockClear();

      await manager.recordSkillUsage(added.id);

      const writeCalls = writeFileMock.mock.calls;
      const skillsWrite = writeCalls.find((c) => String(c[0]).includes('skills.json'));
      expect(skillsWrite).toBeDefined();
    });
  });

  // =========================================================================
  // Role Management
  // =========================================================================
  describe('addRole', () => {
    it('adds a new role with generated id and timestamps', async () => {
      await manager.initialize();
      const role = await manager.addRole(makeRoleInput());

      expect(role.id).toMatch(/^role_test-uuid-/);
      expect(role.name).toBe('Test Role');
      expect(role.usageCount).toBe(0);
      expect(role.createdAt).toBeTruthy();
      expect(role.updatedAt).toBeTruthy();
    });

    it('persists role to storage', async () => {
      await manager.initialize();
      writeFileMock.mockClear();

      await manager.addRole(makeRoleInput());

      const writeCalls = writeFileMock.mock.calls;
      const rolesWrite = writeCalls.find((c) => String(c[0]).includes('roles.json'));
      expect(rolesWrite).toBeDefined();
    });

    it('auto-initializes if not yet initialized', async () => {
      const freshManager = new SkillManager('user-1', '/tmp/test-skills');
      const role = await freshManager.addRole(makeRoleInput());
      expect(role.id).toBeTruthy();
    });

    it('can retrieve added role by id', async () => {
      await manager.initialize();
      const added = await manager.addRole(makeRoleInput());
      const retrieved = manager.getRole(added.id);
      expect(retrieved).toEqual(added);
    });
  });

  describe('updateRole', () => {
    it('updates a non-system role', async () => {
      await manager.initialize();
      const added = await manager.addRole(makeRoleInput());

      const updated = await manager.updateRole(added.id, { name: 'Updated Role' });
      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Updated Role');
      expect(updated?.id).toBe(added.id);
      expect(updated?.createdAt).toBe(added.createdAt);
    });

    it('returns null for non-existent role', async () => {
      await manager.initialize();
      const result = await manager.updateRole('non-existent', { name: 'Foo' });
      expect(result).toBeNull();
    });

    it('returns null when trying to update a system role', async () => {
      await manager.initialize();
      const systemRole = manager.getAllRoles().find((r) => r.isSystem);
      expect(systemRole).toBeDefined();

      const result = await manager.updateRole(systemRole!.id, { name: 'Hacked' });
      expect(result).toBeNull();
    });

    it('preserves id and createdAt even if included in updates', async () => {
      await manager.initialize();
      const added = await manager.addRole(makeRoleInput());

      const updated = await manager.updateRole(added.id, {
        id: 'hacked_id' as any,
        createdAt: '1999-01-01',
        description: 'New desc',
      });
      expect(updated?.id).toBe(added.id);
      expect(updated?.createdAt).toBe(added.createdAt);
      expect(updated?.description).toBe('New desc');
    });

    it('sets updatedAt to current time', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      await manager.initialize();
      const added = await manager.addRole(makeRoleInput());

      vi.setSystemTime(new Date('2024-06-01T00:00:00Z'));
      const updated = await manager.updateRole(added.id, { description: 'New desc' });
      expect(updated?.updatedAt).toBe('2024-06-01T00:00:00.000Z');
      vi.useRealTimers();
    });
  });

  describe('deleteRole', () => {
    it('deletes a non-system role', async () => {
      await manager.initialize();
      const added = await manager.addRole(makeRoleInput());

      const result = await manager.deleteRole(added.id);
      expect(result).toBe(true);
      expect(manager.getRole(added.id)).toBeUndefined();
    });

    it('returns false for non-existent role', async () => {
      await manager.initialize();
      const result = await manager.deleteRole('non-existent');
      expect(result).toBe(false);
    });

    it('returns false when trying to delete a system role', async () => {
      await manager.initialize();
      const systemRole = manager.getAllRoles().find((r) => r.isSystem);
      expect(systemRole).toBeDefined();

      const result = await manager.deleteRole(systemRole!.id);
      expect(result).toBe(false);
      expect(manager.getRole(systemRole!.id)).toBeDefined();
    });

    it('persists deletion to storage', async () => {
      await manager.initialize();
      const added = await manager.addRole(makeRoleInput());
      writeFileMock.mockClear();

      await manager.deleteRole(added.id);

      const writeCalls = writeFileMock.mock.calls;
      const rolesWrite = writeCalls.find((c) => String(c[0]).includes('roles.json'));
      expect(rolesWrite).toBeDefined();
    });
  });

  describe('getRole', () => {
    it('returns role by id', async () => {
      await manager.initialize();
      const added = await manager.addRole(makeRoleInput());
      expect(manager.getRole(added.id)).toEqual(added);
    });

    it('returns undefined for unknown id', async () => {
      await manager.initialize();
      expect(manager.getRole('nonexistent')).toBeUndefined();
    });
  });

  describe('getAllRoles', () => {
    it('returns all roles including builtins', async () => {
      await manager.initialize();
      const allRoles = manager.getAllRoles();
      expect(allRoles.length).toBeGreaterThanOrEqual(BUILTIN_ROLES.length);
    });

    it('includes custom roles after adding them', async () => {
      await manager.initialize();
      const added = await manager.addRole(makeRoleInput());
      const allRoles = manager.getAllRoles();
      expect(allRoles.some((r) => r.id === added.id)).toBe(true);
    });
  });

  // =========================================================================
  // findRelevantRole
  // =========================================================================
  describe('findRelevantRole', () => {
    it('finds role matching triggers', async () => {
      await manager.initialize();
      const role = manager.findRelevantRole('help me with something');
      expect(role).toBeDefined();
      expect(role?.name).toBe('Personal Assistant');
    });

    it('finds developer role for coding prompts', async () => {
      await manager.initialize();
      // Use a prompt that matches Senior Developer triggers and domains
      // without matching Personal Assistant triggers ("help me", "can you", "I need")
      const role = manager.findRelevantRole('programming and code review for debugging');
      expect(role).toBeDefined();
      expect(role?.name).toBe('Senior Developer');
    });

    it('finds role matching domains', async () => {
      await manager.initialize();
      const role = manager.findRelevantRole('I need help with business strategy');
      expect(role).toBeDefined();
      // Should match Business Analyst due to triggers and domains
    });

    it('returns undefined when no role matches', async () => {
      await manager.initialize();
      const role = manager.findRelevantRole('xyzzy totally random gibberish');
      expect(role).toBeUndefined();
    });

    it('skips disabled roles', async () => {
      await manager.initialize();
      const added = await manager.addRole(
        makeRoleInput({
          name: 'Disabled Role',
          triggers: ['uniquetrigger12345'],
          domains: [],
          enabled: false,
        })
      );
      const role = manager.findRelevantRole('uniquetrigger12345');
      expect(role?.id).not.toBe(added.id);
    });

    it('returns highest scoring role', async () => {
      await manager.initialize();
      await manager.addRole(
        makeRoleInput({
          name: 'Low Score',
          triggers: ['matchme'],
          domains: [],
        })
      );
      await manager.addRole(
        makeRoleInput({
          name: 'High Score',
          triggers: ['matchme', 'please matchme'],
          domains: ['matchme'],
        })
      );

      const role = manager.findRelevantRole('matchme please matchme');
      expect(role?.name).toBe('High Score');
    });
  });

  // =========================================================================
  // Active Role
  // =========================================================================
  describe('setActiveRole / getActiveRole', () => {
    it('sets and gets active role', async () => {
      await manager.initialize();
      const added = await manager.addRole(makeRoleInput());

      manager.setActiveRole(added.id);
      const active = manager.getActiveRole();
      expect(active).toBeDefined();
      expect(active?.id).toBe(added.id);
    });

    it('increments usage count when setting active role', async () => {
      await manager.initialize();
      const added = await manager.addRole(makeRoleInput());
      expect(added.usageCount).toBe(0);

      manager.setActiveRole(added.id);
      const active = manager.getActiveRole();
      expect(active?.usageCount).toBe(1);
    });

    it('clears active role when passed undefined', async () => {
      await manager.initialize();
      const added = await manager.addRole(makeRoleInput());

      manager.setActiveRole(added.id);
      expect(manager.getActiveRole()).toBeDefined();

      manager.setActiveRole(undefined);
      expect(manager.getActiveRole()).toBeUndefined();
    });

    it('sets activeRole to undefined if roleId does not exist', async () => {
      await manager.initialize();
      manager.setActiveRole('non-existent');
      expect(manager.getActiveRole()).toBeUndefined();
    });

    it('returns undefined when no role is active', async () => {
      await manager.initialize();
      expect(manager.getActiveRole()).toBeUndefined();
    });
  });

  // =========================================================================
  // Custom Instructions
  // =========================================================================
  describe('addInstruction', () => {
    it('adds a new instruction with generated id and timestamps', async () => {
      await manager.initialize();
      const instruction = await manager.addInstruction(makeInstructionInput());

      expect(instruction.id).toMatch(/^instr_test-uuid-/);
      expect(instruction.userId).toBe('user-1');
      expect(instruction.name).toBe('Test Instruction');
      expect(instruction.createdAt).toBeTruthy();
      expect(instruction.updatedAt).toBeTruthy();
    });

    it('persists instruction to storage', async () => {
      await manager.initialize();
      writeFileMock.mockClear();

      await manager.addInstruction(makeInstructionInput());

      const writeCalls = writeFileMock.mock.calls;
      const instructionsWrite = writeCalls.find((c) => String(c[0]).includes('instructions.json'));
      expect(instructionsWrite).toBeDefined();
    });

    it('auto-initializes if not yet initialized', async () => {
      const freshManager = new SkillManager('user-1', '/tmp/test-skills');
      const instruction = await freshManager.addInstruction(makeInstructionInput());
      expect(instruction.id).toBeTruthy();
    });
  });

  describe('updateInstruction', () => {
    it('updates an existing instruction', async () => {
      await manager.initialize();
      const added = await manager.addInstruction(makeInstructionInput());

      const updated = await manager.updateInstruction(added.id, { name: 'Updated Instruction' });
      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Updated Instruction');
      expect(updated?.id).toBe(added.id);
      expect(updated?.userId).toBe(added.userId);
      expect(updated?.createdAt).toBe(added.createdAt);
    });

    it('returns null for non-existent instruction', async () => {
      await manager.initialize();
      const result = await manager.updateInstruction('non-existent', { name: 'Foo' });
      expect(result).toBeNull();
    });

    it('preserves id, userId, and createdAt even if included in updates', async () => {
      await manager.initialize();
      const added = await manager.addInstruction(makeInstructionInput());

      const updated = await manager.updateInstruction(added.id, {
        id: 'hacked_id' as any,
        userId: 'hacked_user' as any,
        createdAt: '1999-01-01',
        content: 'New content',
      });
      expect(updated?.id).toBe(added.id);
      expect(updated?.userId).toBe('user-1');
      expect(updated?.createdAt).toBe(added.createdAt);
      expect(updated?.content).toBe('New content');
    });

    it('sets updatedAt to current time', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      await manager.initialize();
      const added = await manager.addInstruction(makeInstructionInput());

      vi.setSystemTime(new Date('2024-06-01T00:00:00Z'));
      const updated = await manager.updateInstruction(added.id, { content: 'New content' });
      expect(updated?.updatedAt).toBe('2024-06-01T00:00:00.000Z');
      vi.useRealTimers();
    });
  });

  describe('deleteInstruction', () => {
    it('deletes an existing instruction', async () => {
      await manager.initialize();
      const added = await manager.addInstruction(makeInstructionInput());

      const result = await manager.deleteInstruction(added.id);
      expect(result).toBe(true);
    });

    it('returns false for non-existent instruction', async () => {
      await manager.initialize();
      const result = await manager.deleteInstruction('non-existent');
      expect(result).toBe(false);
    });

    it('persists deletion to storage', async () => {
      await manager.initialize();
      const added = await manager.addInstruction(makeInstructionInput());
      writeFileMock.mockClear();

      await manager.deleteInstruction(added.id);

      const writeCalls = writeFileMock.mock.calls;
      const instructionsWrite = writeCalls.find((c) => String(c[0]).includes('instructions.json'));
      expect(instructionsWrite).toBeDefined();
    });

    it('does not persist if instruction does not exist', async () => {
      await manager.initialize();
      writeFileMock.mockClear();

      await manager.deleteInstruction('non-existent');

      const writeCalls = writeFileMock.mock.calls;
      const instructionsWrite = writeCalls.find((c) => String(c[0]).includes('instructions.json'));
      expect(instructionsWrite).toBeUndefined();
    });
  });

  // =========================================================================
  // getApplicableInstructions
  // =========================================================================
  describe('getApplicableInstructions', () => {
    it('returns instructions with applyWhen=always', async () => {
      await manager.initialize();
      await manager.addInstruction(makeInstructionInput({ applyWhen: 'always' }));

      const results = manager.getApplicableInstructions();
      expect(results.length).toBe(1);
      expect(results[0].applyWhen).toBe('always');
    });

    it('returns instructions for matching topics', async () => {
      await manager.initialize();
      await manager.addInstruction(
        makeInstructionInput({
          name: 'Topic Instruction',
          applyWhen: 'specific_topics',
          topics: ['cooking', 'recipes'],
        })
      );

      const results = manager.getApplicableInstructions(['cooking']);
      expect(results.some((i) => i.name === 'Topic Instruction')).toBe(true);
    });

    it('does not return topic instruction when topics do not match', async () => {
      await manager.initialize();
      await manager.addInstruction(
        makeInstructionInput({
          name: 'Topic Instruction',
          applyWhen: 'specific_topics',
          topics: ['cooking'],
        })
      );

      const results = manager.getApplicableInstructions(['programming']);
      expect(results.some((i) => i.name === 'Topic Instruction')).toBe(false);
    });

    it('does not return topic instruction when no topics provided', async () => {
      await manager.initialize();
      await manager.addInstruction(
        makeInstructionInput({
          name: 'Topic Instruction',
          applyWhen: 'specific_topics',
          topics: ['cooking'],
        })
      );

      const results = manager.getApplicableInstructions();
      expect(results.some((i) => i.name === 'Topic Instruction')).toBe(false);
    });

    it('returns instructions for matching roles', async () => {
      await manager.initialize();
      await manager.addInstruction(
        makeInstructionInput({
          name: 'Role Instruction',
          applyWhen: 'specific_roles',
          roles: ['role_dev'],
        })
      );

      const results = manager.getApplicableInstructions(undefined, 'role_dev');
      expect(results.some((i) => i.name === 'Role Instruction')).toBe(true);
    });

    it('does not return role instruction when roleId does not match', async () => {
      await manager.initialize();
      await manager.addInstruction(
        makeInstructionInput({
          name: 'Role Instruction',
          applyWhen: 'specific_roles',
          roles: ['role_dev'],
        })
      );

      const results = manager.getApplicableInstructions(undefined, 'role_other');
      expect(results.some((i) => i.name === 'Role Instruction')).toBe(false);
    });

    it('does not return role instruction when no roleId provided', async () => {
      await manager.initialize();
      await manager.addInstruction(
        makeInstructionInput({
          name: 'Role Instruction',
          applyWhen: 'specific_roles',
          roles: ['role_dev'],
        })
      );

      const results = manager.getApplicableInstructions();
      expect(results.some((i) => i.name === 'Role Instruction')).toBe(false);
    });

    it('does not include manual instructions', async () => {
      await manager.initialize();
      await manager.addInstruction(
        makeInstructionInput({
          name: 'Manual Instruction',
          applyWhen: 'manual',
        })
      );

      const results = manager.getApplicableInstructions();
      expect(results.some((i) => i.name === 'Manual Instruction')).toBe(false);
    });

    it('skips disabled instructions', async () => {
      await manager.initialize();
      await manager.addInstruction(
        makeInstructionInput({
          name: 'Disabled Instruction',
          applyWhen: 'always',
          enabled: false,
        })
      );

      const results = manager.getApplicableInstructions();
      expect(results.some((i) => i.name === 'Disabled Instruction')).toBe(false);
    });

    it('sorts by priority descending', async () => {
      await manager.initialize();
      await manager.addInstruction(
        makeInstructionInput({
          name: 'Low Priority',
          applyWhen: 'always',
          priority: 1,
        })
      );
      await manager.addInstruction(
        makeInstructionInput({
          name: 'High Priority',
          applyWhen: 'always',
          priority: 100,
        })
      );

      const results = manager.getApplicableInstructions();
      expect(results[0].name).toBe('High Priority');
      expect(results[1].name).toBe('Low Priority');
    });
  });

  // =========================================================================
  // buildContext
  // =========================================================================
  describe('buildContext', () => {
    it('builds context with relevant skills', async () => {
      await manager.initialize();
      const ctx = manager.buildContext('write python code');

      expect(ctx.activeSkills.length).toBeGreaterThan(0);
      expect(ctx.systemPrompt).toBeTruthy();
      expect(ctx.metadata.userId).toBe('user-1');
      expect(ctx.metadata.timestamp).toBeTruthy();
    });

    it('includes active role in context', async () => {
      await manager.initialize();
      const role = await manager.addRole(makeRoleInput());
      manager.setActiveRole(role.id);

      const ctx = manager.buildContext('anything');
      expect(ctx.activeRole).toBeDefined();
      expect(ctx.activeRole?.id).toBe(role.id);
    });

    it('falls back to relevant role when no active role', async () => {
      await manager.initialize();

      const ctx = manager.buildContext('help me with code programming');
      // Should find a relevant role based on prompt
      expect(ctx.activeRole).toBeDefined();
    });

    it('includes role prompt in system prompt', async () => {
      await manager.initialize();
      const role = await manager.addRole(makeRoleInput({ systemPrompt: 'ROLE PROMPT HERE' }));
      manager.setActiveRole(role.id);

      const ctx = manager.buildContext('anything');
      expect(ctx.systemPrompt).toContain('ROLE PROMPT HERE');
      expect(ctx.systemPrompt).toContain('## Role: Test Role');
    });

    it('includes skill instructions in system prompt', async () => {
      await manager.initialize();
      const ctx = manager.buildContext('write python code');

      expect(ctx.systemPrompt).toContain('## Active Skills');
    });

    it('includes custom instructions in system prompt', async () => {
      await manager.initialize();
      await manager.addInstruction(
        makeInstructionInput({
          name: 'Always Be Kind',
          content: 'ALWAYS BE KIND',
          applyWhen: 'always',
        })
      );

      const ctx = manager.buildContext('write python code');
      expect(ctx.systemPrompt).toContain('## Custom Instructions');
      expect(ctx.systemPrompt).toContain('ALWAYS BE KIND');
    });

    it('passes topics to getApplicableInstructions', async () => {
      await manager.initialize();
      await manager.addInstruction(
        makeInstructionInput({
          name: 'Cooking Instruction',
          content: 'Use metric measurements',
          applyWhen: 'specific_topics',
          topics: ['cooking'],
        })
      );

      const ctx = manager.buildContext('write a recipe', ['cooking']);
      expect(ctx.instructions.some((i) => i.name === 'Cooking Instruction')).toBe(true);
      expect(ctx.systemPrompt).toContain('Use metric measurements');
    });

    it('returns empty system prompt when nothing matches', async () => {
      await manager.initialize();
      const ctx = manager.buildContext('xyzzy totally random gibberish');
      // No skills, no role, no instructions
      expect(ctx.activeSkills).toEqual([]);
      expect(ctx.systemPrompt).toBe('');
    });

    it('builds context with all three components', async () => {
      await manager.initialize();
      const role = await manager.addRole(makeRoleInput({ name: 'Full Context Role' }));
      manager.setActiveRole(role.id);

      await manager.addInstruction(
        makeInstructionInput({
          name: 'Custom Rule',
          content: 'CUSTOM RULE CONTENT',
          applyWhen: 'always',
        })
      );

      const ctx = manager.buildContext('write python code');
      expect(ctx.activeRole).toBeDefined();
      expect(ctx.activeSkills.length).toBeGreaterThan(0);
      expect(ctx.instructions.length).toBeGreaterThan(0);
      expect(ctx.systemPrompt).toContain('## Role:');
      expect(ctx.systemPrompt).toContain('## Active Skills');
      expect(ctx.systemPrompt).toContain('## Custom Instructions');
    });
  });
});

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------
describe('createSkillManager', () => {
  it('creates a SkillManager instance', () => {
    const manager = createSkillManager('user-1');
    expect(manager).toBeInstanceOf(SkillManager);
  });

  it('passes storageDir to SkillManager', () => {
    const manager = createSkillManager('user-1', '/custom/path');
    expect(manager).toBeInstanceOf(SkillManager);
  });
});

describe('getSkillManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    writeFileMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
  });

  it('creates and initializes a new manager for unknown userId', async () => {
    const uniqueId = `user-get-${Date.now()}`;
    const result = await getSkillManager(uniqueId);
    expect(result).toBeInstanceOf(SkillManager);
    expect(mkdirMock).toHaveBeenCalled();
  });

  it('returns cached manager on subsequent calls', async () => {
    const uniqueId = `user-cached-${Date.now()}`;
    const first = await getSkillManager(uniqueId);
    const second = await getSkillManager(uniqueId);
    expect(first).toBe(second);
  });
});
