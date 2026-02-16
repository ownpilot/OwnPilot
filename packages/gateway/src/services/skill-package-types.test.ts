/**
 * SkillPackageTypes Tests
 *
 * Tests for manifest validation logic.
 */

import { describe, it, expect } from 'vitest';
import { validateManifest } from './skill-package-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    description: 'A test skill',
    tools: [
      {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        code: 'return {}',
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const result = validateManifest(validManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null/undefined input', () => {
    expect(validateManifest(null).valid).toBe(false);
    expect(validateManifest(undefined).valid).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(validateManifest('string').valid).toBe(false);
    expect(validateManifest(42).valid).toBe(false);
  });

  // ------ ID validation ------

  it('requires id field', () => {
    const result = validateManifest(validManifest({ id: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('id'))).toBe(true);
  });

  it('validates id format (lowercase + hyphens)', () => {
    expect(validateManifest(validManifest({ id: 'my-skill' })).valid).toBe(true);
    expect(validateManifest(validManifest({ id: 'skill123' })).valid).toBe(true);
    expect(validateManifest(validManifest({ id: 'Invalid_ID' })).valid).toBe(false);
    expect(validateManifest(validManifest({ id: '-starts-with-hyphen' })).valid).toBe(false);
  });

  // ------ Required fields ------

  it('requires name', () => {
    const result = validateManifest(validManifest({ name: '' }));
    expect(result.valid).toBe(false);
  });

  it('requires version', () => {
    const result = validateManifest(validManifest({ version: '' }));
    expect(result.valid).toBe(false);
  });

  it('requires description', () => {
    const result = validateManifest(validManifest({ description: '' }));
    expect(result.valid).toBe(false);
  });

  // ------ Tools validation ------

  it('requires at least one tool', () => {
    const result = validateManifest(validManifest({ tools: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('tools'))).toBe(true);
  });

  it('validates tool name format (lowercase + underscores)', () => {
    const good = validManifest({
      tools: [{ name: 'my_tool_123', description: 'ok', parameters: {}, code: 'x' }],
    });
    expect(validateManifest(good).valid).toBe(true);

    const bad = validManifest({
      tools: [{ name: 'MyTool', description: 'ok', parameters: {}, code: 'x' }],
    });
    expect(validateManifest(bad).valid).toBe(false);
  });

  it('rejects duplicate tool names', () => {
    const manifest = validManifest({
      tools: [
        { name: 'tool_a', description: 'ok', parameters: {}, code: 'x' },
        { name: 'tool_a', description: 'duplicate', parameters: {}, code: 'y' },
      ],
    });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('duplicate'))).toBe(true);
  });

  it('requires tool description, parameters, and code', () => {
    const manifest = validManifest({
      tools: [{ name: 'test_tool' }],
    });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  // ------ Triggers validation ------

  it('accepts valid triggers', () => {
    const manifest = validManifest({
      triggers: [
        {
          name: 'Daily check',
          type: 'schedule',
          config: { cron: '0 9 * * *' },
          action: { type: 'chat', payload: { prompt: 'Check status' } },
        },
      ],
    });
    expect(validateManifest(manifest).valid).toBe(true);
  });

  it('validates trigger type', () => {
    const manifest = validManifest({
      triggers: [
        { name: 'Bad', type: 'invalid', config: {}, action: {} },
      ],
    });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('type'))).toBe(true);
  });

  it('rejects triggers that are not arrays', () => {
    const manifest = validManifest({ triggers: 'not-array' });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
  });

  // ------ Multiple errors ------

  it('collects multiple errors at once', () => {
    const result = validateManifest({
      id: 123,
      name: null,
      version: undefined,
      tools: 'not-array',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
