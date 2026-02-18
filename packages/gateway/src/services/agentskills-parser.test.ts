/**
 * AgentSkills.io SKILL.md Parser Tests
 */

import { describe, it, expect } from 'vitest';
import { parseSkillMdFrontmatter, parseAgentSkillsMd } from './agentskills-parser.js';

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
    expect(() => parseSkillMdFrontmatter('# No frontmatter')).toThrow('must start with YAML frontmatter');
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

  it('handles skill with no body gracefully', () => {
    const content = `---
name: minimal
description: Minimal skill with no instructions.
---`;

    const manifest = parseAgentSkillsMd(content);
    expect(manifest.instructions).toBe('');
    expect(manifest.system_prompt).toBeUndefined();
  });
});
