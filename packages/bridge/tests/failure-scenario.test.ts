import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Failure Scenario Static Test (INTEG-04)
 * Validates that the failure scenario is correctly constructed.
 * Does NOT run orchestration — reads and inspects the PLAN.md file.
 */
describe('failure-scenario', () => {
  const planPath = join(
    '.planning/phases/10-integration-smoke-test/orchestration-inputs/failure-scenario',
    '10-fail-worker-PLAN.md'
  );

  it('INTEG-04: failure plan file exists', () => {
    expect(existsSync(planPath)).toBe(true);
  });

  it('INTEG-04: failure plan contains exit 1 in verify step', () => {
    const content = readFileSync(planPath, 'utf-8');
    // The plan must have a verify command that always fails
    expect(content).toContain('exit 1');
  });

  it('INTEG-04: failure plan has valid frontmatter fields', () => {
    const content = readFileSync(planPath, 'utf-8');
    expect(content).toContain('phase: 10-integration-smoke-test');
    expect(content).toContain('plan: fail-worker');
    expect(content).toContain('wave: 1');
    expect(content).toContain('depends_on: []');
  });

  it('INTEG-04: README documents expected failure behavior', () => {
    const readmePath = join(
      '.planning/phases/10-integration-smoke-test/orchestration-inputs/failure-scenario',
      'README.md'
    );
    expect(existsSync(readmePath)).toBe(true);
    const readme = readFileSync(readmePath, 'utf-8');
    expect(readme).toContain('orchestration-log.md');
    expect(readme).toContain('status: "failed"');
  });
});
