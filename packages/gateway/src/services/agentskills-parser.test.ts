/**
 * AgentSkills.io SKILL.md Parser Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock fs — intercept existsSync and readdirSync for scanSkillDirectory tests
// ---------------------------------------------------------------------------

const mockExistsSync = vi.fn().mockReturnValue(false);
const mockReaddirSync = vi.fn().mockReturnValue([]);

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

import {
  parseSkillMdFrontmatter,
  parseAgentSkillsMd,
  scanSkillDirectory,
  isAgentSkillsDir,
} from './agentskills-parser.js';

// =============================================================================
// parseSkillMdFrontmatter
// =============================================================================

describe('parseSkillMdFrontmatter', () => {
  it('parses basic frontmatter and body', () => {
    const content = `---
name: pdf-processing
description: Extract text from PDFs.
---

# PDF Processing

Use this skill when working with PDF files.`;

    const result = parseSkillMdFrontmatter(content);
    expect(result.frontmatter.name).toBe('pdf-processing');
    expect(result.frontmatter.description).toBe('Extract text from PDFs.');
    expect(result.body).toContain('# PDF Processing');
    expect(result.body).toContain('Use this skill when working with PDF files.');
  });

  it('parses optional fields', () => {
    const content = `---
name: code-review
description: Reviews code for quality.
license: Apache-2.0
compatibility: Requires git
---

Instructions here.`;

    const result = parseSkillMdFrontmatter(content);
    expect(result.frontmatter.name).toBe('code-review');
    expect(result.frontmatter.license).toBe('Apache-2.0');
    expect(result.frontmatter.compatibility).toBe('Requires git');
  });

  it('parses metadata nested map', () => {
    const content = `---
name: test-skill
description: A test skill.
metadata:
  author: example-org
  version: "2.0"
---

Body.`;

    const result = parseSkillMdFrontmatter(content);
    const meta = result.frontmatter.metadata as Record<string, string>;
    expect(meta.author).toBe('example-org');
    expect(meta.version).toBe('2.0');
  });

  it('parses flow-style array tags', () => {
    const content = `---
name: my-skill
description: Test.
tags: [code, review, quality]
---

Body.`;

    const result = parseSkillMdFrontmatter(content);
    expect(result.frontmatter.tags).toEqual(['code', 'review', 'quality']);
  });

  it('parses allowed-tools field', () => {
    const content = `---
name: git-skill
description: Git operations.
allowed-tools: Bash(git:*) Read Write
---

Body.`;

    const result = parseSkillMdFrontmatter(content);
    expect(result.frontmatter['allowed-tools']).toBe('Bash(git:*) Read Write');
  });

  it('handles quoted values', () => {
    const content = `---
name: "my-skill"
description: 'A skill with "quotes" inside.'
---

Body.`;

    const result = parseSkillMdFrontmatter(content);
    expect(result.frontmatter.name).toBe('my-skill');
    expect(result.frontmatter.description).toBe('A skill with "quotes" inside.');
  });

  it('throws when frontmatter is missing', () => {
    expect(() => parseSkillMdFrontmatter('# No frontmatter')).toThrow(
      'must start with YAML frontmatter'
    );
  });

  it('throws when frontmatter is not closed', () => {
    expect(() => parseSkillMdFrontmatter('---\nname: test\nno closing')).toThrow('not closed');
  });

  it('handles empty body', () => {
    const content = `---
name: empty
description: No body.
---`;

    const result = parseSkillMdFrontmatter(content);
    expect(result.frontmatter.name).toBe('empty');
    expect(result.body).toBe('');
  });

  it('parses block-style list', () => {
    const content = `---
name: list-skill
description: Has block list.
allowed-tools:
  - search_web
  - read_file
  - write_file
---

Body.`;

    const result = parseSkillMdFrontmatter(content);
    expect(result.frontmatter['allowed-tools']).toEqual(['search_web', 'read_file', 'write_file']);
  });

  it('parses metadata as string without failing', () => {
    const content = `---
name: string-meta
description: Metadata is a string.
metadata: v1.0.0
---

Body.`;

    const result = parseSkillMdFrontmatter(content);
    // String metadata is stored as-is by the parser
    expect(result.frontmatter.metadata).toBe('v1.0.0');
  });

  it('skips comments in YAML', () => {
    const content = `---
# This is a comment
name: commented
description: Has comments.
# Another comment
---

Body.`;

    const result = parseSkillMdFrontmatter(content);
    expect(result.frontmatter.name).toBe('commented');
    expect(result.frontmatter.description).toBe('Has comments.');
  });
});

// =============================================================================
// parseAgentSkillsMd
// =============================================================================

describe('parseAgentSkillsMd', () => {
  it('converts SKILL.md to ExtensionManifest', () => {
    const content = `---
name: data-analysis
description: Analyzes datasets and generates reports.
---

# Data Analysis

## When to use
Use when the user has data to analyze.

## Steps
1. Load the dataset
2. Run analysis
3. Generate report`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.id).toBe('data-analysis');
    expect(manifest.name).toBe('data-analysis');
    expect(manifest.format).toBe('agentskills');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.description).toBe('Analyzes datasets and generates reports.');
    expect(manifest.tools).toEqual([]);
    expect(manifest.instructions).toContain('# Data Analysis');
    expect(manifest.instructions).toContain('Use when the user has data to analyze.');
    expect(manifest.system_prompt).toBe(manifest.instructions);
  });

  it('extracts metadata version and author', () => {
    const content = `---
name: versioned
description: A versioned skill.
metadata:
  author: john-doe
  version: "3.0.0"
---

Body.`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.version).toBe('3.0.0');
    expect(manifest.author?.name).toBe('john-doe');
  });

  it('parses allowed-tools into array', () => {
    const content = `---
name: git-ops
description: Git operations.
allowed-tools: Bash(git:*) Read Write
---

Instructions.`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.allowed_tools).toEqual(['Bash(git:*)', 'Read', 'Write']);
  });

  it('stores license and compatibility', () => {
    const content = `---
name: licensed
description: Has license.
license: MIT
compatibility: Requires Node.js 18+
---

Body.`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.license).toBe('MIT');
    expect(manifest.compatibility).toBe('Requires Node.js 18+');
  });

  it('infers category from content', () => {
    const devContent = `---
name: code-helper
description: Helps with code review and debugging.
---

Debug code issues.`;

    const manifest = parseAgentSkillsMd(devContent);
    expect(manifest.category).toBe('developer');
  });

  it('infers tags from name and description', () => {
    const content = `---
name: email-helper
description: Helps draft and send professional emails.
---

Body.`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.tags).toBeDefined();
    expect(manifest.tags!.length).toBeGreaterThan(0);
    expect(manifest.tags!.length).toBeLessThanOrEqual(5);
  });

  it('throws on invalid frontmatter', () => {
    const content = `---
description: Missing name field.
---

Body.`;

    expect(() => parseAgentSkillsMd(content)).toThrow('Invalid SKILL.md frontmatter');
  });

  it('sets default icon for agentskills format', () => {
    const content = `---
name: test
description: Test skill.
---

Body.`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.icon).toBe('\uD83D\uDCD8');
  });

  it('accepts string metadata (coerced by validator)', () => {
    const content = `---
name: openclaw-skill
description: A skill from OpenClaw.
metadata: v1.0.0
---

Instructions.`;

    // Should not throw — validator coerces string metadata
    const manifest = parseAgentSkillsMd(content);
    expect(manifest.name).toBe('openclaw-skill');
    expect(manifest.version).toBe('1.0.0'); // Falls back to default since metadata is coerced
  });

  it('parses block-style allowed-tools list', () => {
    const content = `---
name: block-tools
description: Uses block-style list.
allowed-tools:
  - search_web
  - read_file
  - write_file
---

Instructions.`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.allowed_tools).toEqual(['search_web', 'read_file', 'write_file']);
  });

  it('handles skill with no body gracefully', () => {
    const content = `---
name: minimal
description: Minimal skill with no instructions.
---`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.instructions).toBe('');
    expect(manifest.system_prompt).toBeUndefined();
  });

  // category inference tests (cover lines 331, 333, 340 in inferCategory)

  it('infers category "media" from description containing "image" (line 331)', () => {
    const content = `---
name: image-processor
description: Process and analyze images.
---

Image processing instructions.`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.category).toBe('media');
  });

  it('infers category "integrations" from description containing "api" (line 333)', () => {
    const content = `---
name: api-connector
description: Connect to external api endpoints.
---

API connector instructions.`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.category).toBe('integrations');
  });

  it('infers category "communication" from description containing "email"', () => {
    const content = `---
name: email-helper
description: Send and manage email messages.
---

Email helper instructions.`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.category).toBe('communication');
  });

  it('infers category "data" from description containing "database"', () => {
    const content = `---
name: db-query
description: Query databases and handle sql operations.
---

Database skill instructions.`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.category).toBe('data');
  });

  it('infers category "productivity" from description containing "calendar"', () => {
    const content = `---
name: calendar-sync
description: Sync and manage calendar events.
---

Calendar skill instructions.`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.category).toBe('productivity');
  });

  it('uses skillDir to scan for scripts and references', () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('scripts'));
    mockReaddirSync.mockReturnValue([
      { name: 'main.js', isFile: () => true, isDirectory: () => false },
      { name: 'helper.js', isFile: () => true, isDirectory: () => false },
    ]);

    const content = `---
name: scripted-skill
description: Skill with scripts.
---

Instructions.`;

    const manifest = parseAgentSkillsMd(content, '/some/skill/dir');
    expect(manifest.script_paths).toHaveLength(2);
    expect(manifest.script_paths).toContain('scripts/main.js');
    expect(manifest.script_paths).toContain('scripts/helper.js');
  });
});

// =============================================================================
// parseSkillMdFrontmatter — edge cases
// =============================================================================

describe('parseSkillMdFrontmatter — edge cases', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('skips lines that do not match key:value pattern (line 116)', () => {
    const content = `---
name: test-skill
description: Test.
# This comment line is ignored
=== not a valid key ===
valid-key: valid value
---

Body.`;

    // Should not throw and should still parse valid keys
    const result = parseSkillMdFrontmatter(content);
    expect(result.frontmatter.name).toBe('test-skill');
    expect(result.frontmatter['valid-key']).toBe('valid value');
  });
});

// =============================================================================
// scanSkillDirectory
// =============================================================================

describe('scanSkillDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
  });

  it('returns empty arrays when no subdirectories exist', () => {
    mockExistsSync.mockReturnValue(false);
    const result = scanSkillDirectory('/some/skill');
    expect(result.scriptPaths).toEqual([]);
    expect(result.referencePaths).toEqual([]);
    expect(result.assetPaths).toEqual([]);
  });

  it('collects files from scripts/ subdirectory', () => {
    mockExistsSync.mockImplementation((p: string) => String(p).endsWith('scripts'));
    mockReaddirSync.mockReturnValue([
      { name: 'run.js', isFile: () => true },
      { name: 'helper.ts', isFile: () => true },
    ]);

    const result = scanSkillDirectory('/skill');
    expect(result.scriptPaths).toEqual(['scripts/run.js', 'scripts/helper.ts']);
  });

  it('collects files from references/ subdirectory', () => {
    mockExistsSync.mockImplementation((p: string) => String(p).endsWith('references'));
    mockReaddirSync.mockReturnValue([{ name: 'api-docs.md', isFile: () => true }]);

    const result = scanSkillDirectory('/skill');
    expect(result.referencePaths).toEqual(['references/api-docs.md']);
  });

  it('collects files from assets/ subdirectory', () => {
    mockExistsSync.mockImplementation((p: string) => String(p).endsWith('assets'));
    mockReaddirSync.mockReturnValue([{ name: 'template.json', isFile: () => true }]);

    const result = scanSkillDirectory('/skill');
    expect(result.assetPaths).toEqual(['assets/template.json']);
  });

  it('skips directories within subdirectories (only files)', () => {
    mockExistsSync.mockImplementation((p: string) => String(p).endsWith('scripts'));
    mockReaddirSync.mockReturnValue([
      { name: 'lib', isFile: () => false }, // directory — should be skipped
      { name: 'main.js', isFile: () => true },
    ]);

    const result = scanSkillDirectory('/skill');
    expect(result.scriptPaths).toEqual(['scripts/main.js']);
  });

  it('handles readdirSync throwing (returns empty for that subdir)', () => {
    mockExistsSync.mockImplementation((p: string) => String(p).endsWith('scripts'));
    mockReaddirSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = scanSkillDirectory('/skill');
    expect(result.scriptPaths).toEqual([]);
  });
});

// =============================================================================
// isAgentSkillsDir
// =============================================================================

describe('isAgentSkillsDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('returns true when SKILL.md exists in the directory', () => {
    mockExistsSync.mockReturnValue(true);
    expect(isAgentSkillsDir('/some/skill/dir')).toBe(true);
  });

  it('returns false when SKILL.md does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(isAgentSkillsDir('/some/other/dir')).toBe(false);
  });
});
