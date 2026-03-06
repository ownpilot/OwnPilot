/**
 * ExtensionTypes Tests
 *
 * Tests for manifest validation logic.
 */

import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  normalizeSkillName,
  validateAgentSkillsFrontmatter,
} from './extension-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-ext',
    name: 'Test Extension',
    version: '1.0.0',
    description: 'A test extension',
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
    expect(result.errors.some((e) => e.includes('id'))).toBe(true);
  });

  it('validates id format (lowercase + hyphens)', () => {
    expect(validateManifest(validManifest({ id: 'my-ext' })).valid).toBe(true);
    expect(validateManifest(validManifest({ id: 'ext123' })).valid).toBe(true);
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
    expect(result.errors.some((e) => e.includes('tools'))).toBe(true);
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
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
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
      triggers: [{ name: 'Bad', type: 'invalid', config: {}, action: {} }],
    });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('type'))).toBe(true);
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

// ---------------------------------------------------------------------------
// normalizeSkillName
// ---------------------------------------------------------------------------

describe('normalizeSkillName', () => {
  it('converts spaces to hyphens', () => {
    expect(normalizeSkillName('Suno AI Music Architect')).toBe('suno-ai-music-architect');
  });

  it('converts to lowercase', () => {
    expect(normalizeSkillName('My Skill Name')).toBe('my-skill-name');
  });

  it('removes special characters', () => {
    expect(normalizeSkillName('Skill@Name#123!')).toBe('skillname123');
  });

  it('handles underscores like spaces', () => {
    expect(normalizeSkillName('my_skill_name')).toBe('my-skill-name');
  });

  it('removes consecutive hyphens', () => {
    expect(normalizeSkillName('my--skill---name')).toBe('my-skill-name');
  });

  it('trims hyphens from start and end', () => {
    expect(normalizeSkillName('-my-skill-name-')).toBe('my-skill-name');
  });

  it('handles mixed case with spaces and special chars', () => {
    expect(normalizeSkillName('  My Awesome SKILL!!!  ')).toBe('my-awesome-skill');
  });

  it('handles empty string', () => {
    expect(normalizeSkillName('')).toBe('');
  });

  it('handles string with only special chars', () => {
    expect(normalizeSkillName('!@#$%')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// validateAgentSkillsFrontmatter
// ---------------------------------------------------------------------------

describe('validateAgentSkillsFrontmatter', () => {
  it('accepts valid frontmatter', () => {
    const result = validateAgentSkillsFrontmatter({
      name: 'test-skill',
      description: 'A test skill description',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('normalizes invalid name before validation', () => {
    const fm = {
      name: 'Suno AI Music Architect',
      description: 'Creates AI music using Suno',
    };
    const result = validateAgentSkillsFrontmatter(fm);
    expect(result.valid).toBe(true);
    expect(fm.name).toBe('suno-ai-music-architect');
  });

  it('rejects missing name', () => {
    const result = validateAgentSkillsFrontmatter({
      description: 'A test skill',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid "name" (required)');
  });

  it('rejects missing description', () => {
    const result = validateAgentSkillsFrontmatter({
      name: 'test-skill',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid "description" (required)');
  });

  it('returns error when frontmatter is not an object', () => {
    const result = validateAgentSkillsFrontmatter('not-an-object');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Frontmatter must be a YAML object');
  });

  it('rejects name longer than 64 characters', () => {
    const result = validateAgentSkillsFrontmatter({
      name: 'a'.repeat(65),
      description: 'Valid description.',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds 64 characters'))).toBe(true);
  });

  it('accepts name with consecutive hyphens (normalizes them away)', () => {
    // normalizeSkillName converts "bad--name" -> "bad-name" (valid)
    const fm: Record<string, unknown> = { name: 'bad--name', description: 'Valid description.' };
    const result = validateAgentSkillsFrontmatter(fm);
    expect(result.valid).toBe(true);
    expect(fm.name).toBe('bad-name');
  });

  it('rejects description longer than 1024 characters', () => {
    const result = validateAgentSkillsFrontmatter({
      name: 'valid-skill',
      description: 'x'.repeat(1025),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds 1024 characters'))).toBe(true);
  });

  it('rejects non-string license', () => {
    const result = validateAgentSkillsFrontmatter({
      name: 'valid-skill',
      description: 'Valid description.',
      license: 42,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('"license" must be a string');
  });

  it('rejects non-string compatibility', () => {
    const result = validateAgentSkillsFrontmatter({
      name: 'valid-skill',
      description: 'Valid description.',
      compatibility: { foo: 'bar' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('"compatibility" must be a string');
  });

  it('rejects compatibility longer than 500 characters', () => {
    const result = validateAgentSkillsFrontmatter({
      name: 'valid-skill',
      description: 'Valid description.',
      compatibility: 'x'.repeat(501),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds 500 characters'))).toBe(true);
  });

  it('coerces null metadata to undefined (no error)', () => {
    const fm: Record<string, unknown> = {
      name: 'valid-skill',
      description: 'Valid description.',
      metadata: null,
    };
    const result = validateAgentSkillsFrontmatter(fm);
    expect(result.valid).toBe(true);
    expect(fm.metadata).toBeUndefined();
  });

  it('drops invalid non-string non-object metadata silently', () => {
    const fm: Record<string, unknown> = {
      name: 'valid-skill',
      description: 'Valid description.',
      metadata: [1, 2, 3], // array — invalid
    };
    const result = validateAgentSkillsFrontmatter(fm);
    expect(result.valid).toBe(true);
    expect(fm.metadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateManifest — trigger name/config/action validation
// ---------------------------------------------------------------------------

describe('validateManifest — triggers edge cases', () => {
  it('rejects trigger with missing name', () => {
    const manifest = {
      name: 'test-ext',
      description: 'Test',
      version: '1.0.0',
      tools: [],
      triggers: [{ type: 'schedule', config: {}, action: {} }],
    };
    const result = validateManifest(manifest as never);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('triggers[0]: missing or invalid "name"'))).toBe(
      true
    );
  });

  it('rejects trigger with missing config', () => {
    const manifest = {
      name: 'test-ext',
      description: 'Test',
      version: '1.0.0',
      tools: [],
      triggers: [{ name: 'my-trigger', type: 'schedule', action: {} }],
    };
    const result = validateManifest(manifest as never);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('missing or invalid "config"'))).toBe(true);
  });

  it('rejects trigger with missing action', () => {
    const manifest = {
      name: 'test-ext',
      description: 'Test',
      version: '1.0.0',
      tools: [],
      triggers: [{ name: 'my-trigger', type: 'schedule', config: {} }],
    };
    const result = validateManifest(manifest as never);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('missing or invalid "action"'))).toBe(true);
  });
});

describe('validateManifest — tool name validation', () => {
  it('rejects tool with missing name', () => {
    const manifest = {
      name: 'test-ext',
      description: 'Test',
      version: '1.0.0',
      tools: [{ description: 'no name', parameters: {}, code: 'fn()' }],
    };
    const result = validateManifest(manifest as never);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('missing or invalid "name"'))).toBe(true);
  });
});
