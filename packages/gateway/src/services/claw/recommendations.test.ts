import { describe, expect, it } from 'vitest';
import type { ClawConfig } from '@ownpilot/core/services/claw';
import { buildSafeFixPatch } from './recommendations.js';

function config(overrides: Partial<ClawConfig> = {}): ClawConfig {
  return {
    id: 'claw-1',
    userId: 'default',
    name: 'Test Claw',
    mission: 'Do useful work',
    mode: 'single-shot',
    allowedTools: [],
    limits: {},
    autoStart: false,
    depth: 0,
    sandbox: 'auto',
    createdBy: 'user',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('claw recommendation helpers', () => {
  it('builds conservative fixes for weak single-shot claws', () => {
    const result = buildSafeFixPatch(config());

    expect(result.applied).toEqual(['mission_contract', 'stop_condition', 'autonomy_policy']);
    expect(result.patch.stopCondition).toBe('on_report');
    expect(result.patch.missionContract).toEqual(
      expect.objectContaining({
        evidenceRequired: true,
        minConfidence: 0.8,
      })
    );
    expect(result.patch.autonomyPolicy).toEqual(
      expect.objectContaining({
        allowSelfModify: false,
        requireEvidence: true,
        destructiveActionPolicy: 'ask',
      })
    );
  });

  it('uses idle stop condition for non-single-shot claws and skips event filters', () => {
    const result = buildSafeFixPatch(config({ mode: 'event', eventFilters: [] }));

    expect(result.patch.stopCondition).toBe('idle:3');
    expect(result.skipped).toContain('event_filters requires a project-specific event source');
  });

  it('uses preset defaults for missing contract fields', () => {
    const result = buildSafeFixPatch(config({ preset: 'research' }), [
      {
        id: 'research',
        successCriteria: ['Sources reviewed'],
        deliverables: ['Report with sources'],
        constraints: ['No invented citations'],
      },
    ]);

    expect(result.patch.missionContract).toEqual(
      expect.objectContaining({
        successCriteria: ['Sources reviewed'],
        deliverables: ['Report with sources'],
        constraints: ['No invented citations'],
      })
    );
  });

  it('does not patch an already conservative config', () => {
    const result = buildSafeFixPatch(
      config({
        stopCondition: 'on_report',
        missionContract: {
          successCriteria: ['Done'],
          deliverables: ['Report'],
          constraints: ['No risky actions'],
          escalationRules: ['Ask on blockers'],
          evidenceRequired: true,
          minConfidence: 0.8,
        },
        autonomyPolicy: {
          allowSelfModify: false,
          allowSubclaws: true,
          requireEvidence: true,
          destructiveActionPolicy: 'ask',
          filesystemScopes: [],
        },
      })
    );

    expect(result.applied).toEqual([]);
    expect(result.patch).toEqual({});
  });

  it('hardens unsafe autonomy policy without discarding safe fields', () => {
    const result = buildSafeFixPatch(
      config({
        autonomyPolicy: {
          allowSelfModify: true,
          allowSubclaws: false,
          requireEvidence: false,
          destructiveActionPolicy: 'allow',
          filesystemScopes: ['workspace'],
          maxCostUsdBeforePause: 1.5,
        },
      })
    );

    expect(result.patch.autonomyPolicy).toEqual(
      expect.objectContaining({
        allowSelfModify: false,
        allowSubclaws: false,
        requireEvidence: true,
        destructiveActionPolicy: 'ask',
        filesystemScopes: ['workspace'],
        maxCostUsdBeforePause: 1.5,
      })
    );
  });
});
