import { describe, it, expect } from 'vitest';
import { getStarterPlan, STARTER_PLANS } from './starter-plans';

describe('starter-plans', () => {
  it('returns null for null/undefined/unknown preset', () => {
    expect(getStarterPlan(null)).toBeNull();
    expect(getStarterPlan(undefined)).toBeNull();
    expect(getStarterPlan('definitely-not-a-preset')).toBeNull();
  });

  it.each(Object.keys(STARTER_PLANS))(
    'returns a non-empty starter plan for known preset %s',
    (preset) => {
      const plan = getStarterPlan(preset);
      expect(plan).not.toBeNull();
      expect(plan!.length).toBeGreaterThan(0);
    }
  );

  it('every starter task has a unique id within its plan', () => {
    for (const [preset, tasks] of Object.entries(STARTER_PLANS)) {
      const ids = tasks.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      // Sanity-check the id format matches what the backend regex accepts.
      for (const id of ids) {
        expect(id).toMatch(/^[a-zA-Z0-9_.\-]{1,64}$/);
      }
      expect(tasks.length, `preset ${preset}`).toBeLessThanOrEqual(50); // CLAW_MAX_TASKS
    }
  });

  it('every starter task has a non-empty title', () => {
    for (const tasks of Object.values(STARTER_PLANS)) {
      for (const t of tasks) {
        expect(t.title.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('all preset keys match the templates in CreateClawModal (six built-ins)', () => {
    const expectedPresets = [
      'research',
      'code-review',
      'data-analysis',
      'monitor',
      'content',
      'event-reactor',
    ];
    for (const preset of expectedPresets) {
      expect(STARTER_PLANS[preset]).toBeDefined();
    }
  });
});
