import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  distillSkillFromRun,
  findLearnedSkills,
  LEARNED_SKILL_TAG,
  MIN_TOOL_CALLS_FOR_SKILL,
} from './skill-distiller.js';
import type { ClawConfig } from '@ownpilot/core/services/claw';
import type { ExtensionService } from '../extension/service.js';

function makeConfig(over: Partial<ClawConfig> = {}): ClawConfig {
  return {
    id: 'claw-1',
    name: 'TestClaw',
    description: 'Test claw',
    enabled: true,
    trigger: { type: 'manual' },
    model: { provider: 'anthropic', model: 'claude-3-5-sonnet-latest' },
    clawType: 'dev',
    ...over,
  };
}

function makeSkillInput(over: {
  config?: Partial<ClawConfig>;
  toolSequence?: string[];
  completeResult?: string;
  report?: string;
}) {
  const completeFn = vi
    .fn<[{ system: string; user: string }], Promise<string>>()
    .mockResolvedValue(over.completeResult ?? 'A reusable skill procedure.');
  return {
    config: makeConfig(over.config ?? {}),
    mission: 'Test mission',
    toolSequence: over.toolSequence ?? ['read_file', 'read_file'],
    report: over.report ?? 'Test report',
    complete: completeFn,
  };
}

describe('distillSkillFromRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when toolSequence has fewer than MIN_TOOL_CALLS_FOR_SKILL entries', async () => {
    const input = makeSkillInput({ toolSequence: ['read_file', 'bash'] });
    const result = await distillSkillFromRun(input);
    expect(result).toBeNull();
  });

  it('returns null when learnSkills is disabled', async () => {
    const input = makeSkillInput({
      config: { learnSkills: false },
      toolSequence: ['read_file', 'bash', 'grep', 'sed', 'awk'],
    });
    const result = await distillSkillFromRun(input);
    expect(result).toBeNull();
  });

  it('returns null when LLM returns empty string', async () => {
    const input = makeSkillInput({
      completeResult: '',
      toolSequence: ['read_file', 'bash', 'grep', 'sed', 'awk'],
    });
    const result = await distillSkillFromRun(input);
    expect(result).toBeNull();
  });

  it('passes mission to LLM when threshold is met', async () => {
    const input = makeSkillInput({
      toolSequence: ['read_file', 'bash', 'grep', 'sed', 'awk'],
    });
    await distillSkillFromRun(input);
    expect(input.complete.mock.calls.length).toBeGreaterThan(0);
    const [prompt] = input.complete.mock.calls[0]!;
    expect(prompt.user).toContain('Test mission');
  });

  it('returns skill with slugified name when mission is provided', async () => {
    const mockInstall = vi.fn().mockResolvedValue(undefined);
    const input = makeSkillInput({
      mission: 'Fix login bug',
      toolSequence: ['read_file', 'bash', 'grep', 'sed', 'awk'],
      completeResult: 'A reusable skill procedure.',
    });
    input.mission = 'Fix login bug'; // override after construction
    const extSvc = {
      installFromManifest: mockInstall,
      getEnabledMetadata: vi.fn().mockReturnValue([]),
      getById: vi.fn(),
    } as unknown as ExtensionService;
    const result = await distillSkillFromRun({ ...input, extensionService: extSvc });
    expect(result).not.toBeNull();
    expect(result!.name).toMatch(/^claw-learned-fix-login-bug$/);
  });

  it('returns null on unexpected error', async () => {
    const input = makeSkillInput({
      toolSequence: ['read_file', 'bash', 'grep', 'sed', 'awk'],
      completeResult: 'A reusable skill procedure.',
    });
    // Mock complete to throw
    input.complete = vi.fn().mockRejectedValue(new Error('unexpected'));
    const result = await distillSkillFromRun(input);
    expect(result).toBeNull();
  });

  it('skips when instruction content is empty', async () => {
    const input = makeSkillInput({
      toolSequence: ['read_file', 'bash', 'grep', 'sed', 'awk'],
      completeResult: '   ',
    });
    const result = await distillSkillFromRun(input);
    expect(result).toBeNull();
  });
});

describe('findLearnedSkills', () => {
  it('returns empty array when no skills are enabled', () => {
    const svc = {
      getEnabledMetadata: vi.fn().mockReturnValue([]),
      getById: vi.fn(),
    };
    const result = findLearnedSkills(svc, 'deploy webapp');
    expect(result).toHaveLength(0);
  });

  it('filters out skills without the LEARNED_SKILL_TAG', () => {
    const svc = {
      getEnabledMetadata: vi.fn().mockReturnValue([
        {
          id: 's1',
          name: 'Deploy webapp',
          description: 'How to deploy',
          keywords: [],
          instructions: '',
        },
      ]),
      getById: vi.fn(),
    };
    const result = findLearnedSkills(svc, 'deploy webapp');
    expect(result).toHaveLength(0);
  });

  it('returns matched skills sorted by keyword overlap score', () => {
    const svc = {
      getEnabledMetadata: vi.fn().mockReturnValue([
        {
          id: 's1',
          name: 'Deploy webapp',
          description: 'Deploy to cloud',
          keywords: [LEARNED_SKILL_TAG, 'deploy'],
          instructions: 'Step 1',
        },
        {
          id: 's2',
          name: 'Fix login bug',
          description: 'Fix auth issues',
          keywords: [LEARNED_SKILL_TAG, 'login', 'auth'],
          instructions: 'Step 1',
        },
        {
          id: 's3',
          name: 'CI setup',
          description: 'CI pipeline',
          keywords: [LEARNED_SKILL_TAG, 'ci', 'pipeline'],
          instructions: 'Step 1',
        },
      ]),
      getById: vi.fn().mockImplementation((id: string) => ({
        id,
        name: '',
        description: '',
        keywords: [],
        instructions: '',
        manifest: { instructions: 'Step 1' },
      })),
    };
    const result = findLearnedSkills(svc, 'deploy to production');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.score).toBeGreaterThanOrEqual(result[result.length - 1]!.score);
  });

  it('limits results to specified limit', () => {
    const skills = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      name: `Skill ${i}`,
      description: `Description ${i}`,
      keywords: [LEARNED_SKILL_TAG],
      instructions: `Instructions ${i}`,
    }));
    const svc = {
      getEnabledMetadata: vi.fn().mockReturnValue(skills),
      getById: vi.fn(),
    };
    const result = findLearnedSkills(svc, 'skill', 3);
    expect(result).toHaveLength(3);
  });

  it('excludes short tokens and deduplicates', () => {
    // 'ab' (len=2) is filtered out, 'xyz' (len=3) remains and appears in name
    const svc = {
      getEnabledMetadata: vi.fn().mockReturnValue([
        {
          id: 's1',
          name: 'ab xyz ef',
          description: 'gh ij',
          keywords: [LEARNED_SKILL_TAG],
          instructions: 'Step 1',
        },
      ]),
      getById: vi.fn().mockReturnValue({
        id: 's1',
        name: '',
        description: '',
        keywords: [],
        instructions: '',
        manifest: { instructions: '' },
      }),
    };
    const result = findLearnedSkills(svc, 'ab ab xyz');
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBeGreaterThan(0);
  });
});

describe('exports', () => {
  it('LEARNED_SKILL_TAG is a non-empty string', () => {
    expect(typeof LEARNED_SKILL_TAG).toBe('string');
    expect(LEARNED_SKILL_TAG.length).toBeGreaterThan(0);
  });

  it('MIN_TOOL_CALLS_FOR_SKILL is 5', () => {
    expect(MIN_TOOL_CALLS_FOR_SKILL).toBe(5);
  });
});
