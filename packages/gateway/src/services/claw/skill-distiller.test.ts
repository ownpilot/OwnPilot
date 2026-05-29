/**
 * Skill distiller tests — the closed learning loop.
 *
 * Covers: gating (tool-call threshold, learnSkills opt-out, empty distillation),
 * manifest shape, mission slugging, and keyword-based learned-skill retrieval.
 * `distillSkillFromRun` takes an injected `complete` fn and ExtensionService so
 * no live provider or DB is required.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ClawConfig } from '@ownpilot/core';
import {
  distillSkillFromRun,
  buildLearnedManifest,
  slugifyMission,
  findLearnedSkills,
  buildDistillMessages,
  LEARNED_SKILL_TAG,
  MIN_TOOL_CALLS_FOR_SKILL,
  type CompleteFn,
} from './skill-distiller.js';

function makeConfig(overrides: Partial<ClawConfig> = {}): ClawConfig {
  return {
    id: 'claw-7',
    userId: 'user-1',
    name: 'Research Bot',
    mission: 'Research competitor pricing and summarize',
    mode: 'continuous',
    allowedTools: [],
    limits: {
      maxTurnsPerCycle: 20,
      maxToolCallsPerCycle: 100,
      maxCyclesPerHour: 30,
      cycleTimeoutMs: 300000,
    },
    autoStart: false,
    depth: 0,
    sandbox: 'auto',
    createdBy: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const fiveTools = ['search_web', 'browse_web', 'write_file', 'read_file', 'claw_publish_artifact'];

function fakeService(installSpy = vi.fn().mockResolvedValue({ id: 'x' })) {
  return { installFromManifest: installSpy } as never;
}

describe('slugifyMission', () => {
  it('produces a claw-learned-prefixed lowercase hyphenated slug', () => {
    expect(slugifyMission('Research Competitor Pricing!')).toBe(
      'claw-learned-research-competitor-pricing'
    );
  });

  it('caps at 64 chars and never ends with a hyphen', () => {
    const slug = slugifyMission('a'.repeat(200));
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('falls back to "task" for empty/symbol-only missions', () => {
    expect(slugifyMission('!!!')).toBe('claw-learned-task');
  });
});

describe('buildLearnedManifest', () => {
  it('builds a valid agentskills manifest tagged claw-learned', () => {
    const m = buildLearnedManifest(makeConfig(), 'Do the thing', 'body');
    expect(m.format).toBe('agentskills');
    expect(m.tools).toEqual([]);
    expect(m.instructions).toBe('body');
    expect(m.tags).toContain(LEARNED_SKILL_TAG);
    expect(m.tags).toContain('claw-7');
    expect(m.id).toBe(m.name);
    expect(m.name).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('buildDistillMessages', () => {
  it('includes the mission and the tool sequence', () => {
    const { system, user } = buildDistillMessages({
      mission: 'My mission',
      toolSequence: ['a', 'b'],
      report: 'done',
    });
    expect(system).toContain('## Procedure');
    expect(user).toContain('My mission');
    expect(user).toContain('a -> b');
  });
});

describe('distillSkillFromRun', () => {
  const complete: CompleteFn = vi
    .fn()
    .mockResolvedValue('## When to use\nalways\n## Procedure\n1. go');

  it('distills and installs a skill when the run is substantial', async () => {
    const install = vi.fn().mockResolvedValue({ id: 'claw-learned-research-competitor-pricing' });
    const result = await distillSkillFromRun({
      config: makeConfig(),
      mission: 'Research competitor pricing',
      toolSequence: fiveTools,
      report: 'Found 3 competitors',
      complete,
      extensionService: fakeService(install),
    });

    expect(result).not.toBeNull();
    expect(install).toHaveBeenCalledTimes(1);
    const [manifest, userId] = install.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(manifest.format).toBe('agentskills');
    expect(manifest.tags).toContain(LEARNED_SKILL_TAG);
    expect(manifest.instructions).toContain('Procedure');
  });

  it('does NOT distill when below the tool-call threshold', async () => {
    const install = vi.fn();
    const result = await distillSkillFromRun({
      config: makeConfig(),
      mission: 'tiny',
      toolSequence: fiveTools.slice(0, MIN_TOOL_CALLS_FOR_SKILL - 1),
      report: 'x',
      complete,
      extensionService: fakeService(install),
    });
    expect(result).toBeNull();
    expect(install).not.toHaveBeenCalled();
  });

  it('does NOT distill when learnSkills is false', async () => {
    const install = vi.fn();
    const result = await distillSkillFromRun({
      config: makeConfig({ learnSkills: false }),
      mission: 'm',
      toolSequence: fiveTools,
      report: 'x',
      complete,
      extensionService: fakeService(install),
    });
    expect(result).toBeNull();
    expect(install).not.toHaveBeenCalled();
  });

  it('returns null (no throw) when the LLM returns empty', async () => {
    const install = vi.fn();
    const result = await distillSkillFromRun({
      config: makeConfig(),
      mission: 'm',
      toolSequence: fiveTools,
      report: 'x',
      complete: vi.fn().mockResolvedValue('   '),
      extensionService: fakeService(install),
    });
    expect(result).toBeNull();
    expect(install).not.toHaveBeenCalled();
  });

  it('never throws when persistence fails', async () => {
    const install = vi.fn().mockRejectedValue(new Error('db down'));
    const result = await distillSkillFromRun({
      config: makeConfig(),
      mission: 'm',
      toolSequence: fiveTools,
      report: 'x',
      complete,
      extensionService: fakeService(install),
    });
    expect(result).toBeNull();
  });
});

describe('findLearnedSkills', () => {
  function svcWith(
    skills: Array<{
      id: string;
      name: string;
      description: string;
      tags: string[];
      instructions: string;
    }>
  ) {
    return {
      getEnabledMetadata: () =>
        skills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          format: 'agentskills',
          toolNames: [],
          keywords: s.tags,
        })),
      getById: (id: string) => {
        const s = skills.find((x) => x.id === id);
        return s ? ({ manifest: { instructions: s.instructions } } as never) : null;
      },
    } as never;
  }

  it('returns only claw-learned skills ranked by query overlap', () => {
    const svc = svcWith([
      {
        id: 'claw-learned-pricing',
        name: 'claw-learned-pricing',
        description: 'research competitor pricing tables',
        tags: [LEARNED_SKILL_TAG, 'claw-1'],
        instructions: 'do pricing',
      },
      {
        id: 'claw-learned-weather',
        name: 'claw-learned-weather',
        description: 'fetch weather forecast data',
        tags: [LEARNED_SKILL_TAG, 'claw-2'],
        instructions: 'do weather',
      },
      {
        id: 'regular-skill',
        name: 'regular-skill',
        description: 'pricing helper not learned',
        tags: ['utility'],
        instructions: 'nope',
      },
    ]);

    const matches = findLearnedSkills(svc, 'competitor pricing research', 3);
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe('claw-learned-pricing');
    expect(matches[0].instructions).toBe('do pricing');
  });

  it('returns empty when there are no learned skills', () => {
    const svc = svcWith([]);
    expect(findLearnedSkills(svc, 'anything')).toEqual([]);
  });
});
