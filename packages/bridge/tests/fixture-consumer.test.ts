import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Fixture Consumer Test (dep-beta)
 * Phase 10 INTEG-02: Dependency chain test — consumer side.
 * This test reads fixture-output.json written by dep-alpha.
 * If dep-alpha did NOT run first, this file won't exist and the test fails.
 */
describe('fixture-consumer', () => {
  it('dep-beta: reads fixture produced by dep-alpha', () => {
    const fixturePath = join(
      '.planning/phases/10-integration-smoke-test/orchestration-inputs/dependency-chain-plans',
      'fixture-output.json'
    );

    // File must exist (dep-alpha ran first)
    expect(existsSync(fixturePath)).toBe(true);

    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    // Assert dep-alpha produced it
    expect(fixture.producedBy).toBe('dep-alpha');
    expect(fixture.orchestrationPhase).toBe(10);
    expect(fixture.value).toBe(42);
  });
});
