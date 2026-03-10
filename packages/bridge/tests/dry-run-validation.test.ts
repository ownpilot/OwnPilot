import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Dry-Run Validation Test (INTEG-05)
 * Validates that /orchestrate --dry-run mode is properly specified.
 * Does NOT invoke orchestration — reads the skill definition statically.
 */
describe('dry-run-validation', () => {
  const skillPath = join(homedir(), '.claude/skills/orchestrate/SKILL.md');

  it('INTEG-05: /orchestrate SKILL.md exists', () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it('INTEG-05: SKILL.md documents --dry-run flag', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('--dry-run');
  });

  it('INTEG-05: --dry-run shows execution plan without executing', () => {
    const content = readFileSync(skillPath, 'utf-8');
    // Dry-run must show plan but NOT execute
    expect(content).toContain('--dry-run');
    // Must document that it shows the plan
    expect(content.toLowerCase()).toMatch(/dry.run.*plan|plan.*dry.run|show.*plan|execution plan/);
  });

  it('INTEG-05: /orchestrate usage documents phase and plan parameters', () => {
    const content = readFileSync(skillPath, 'utf-8');
    // Usage section must show invocation patterns
    expect(content).toContain('/orchestrate');
    // Must show phase parameter
    expect(content).toMatch(/phase \d+/);
  });

  it('INTEG-05: /orchestrate responsibility matrix documented (AUTON-08)', () => {
    const content = readFileSync(skillPath, 'utf-8');
    // Must document the distinction from /gsd:execute-phase
    expect(content).toContain('gsd:execute-phase');
    // Must state it handles parallel execution
    expect(content.toLowerCase()).toContain('parallel');
  });
});
