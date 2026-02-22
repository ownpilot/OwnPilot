/**
 * AgentSkills.io SKILL.md Parser
 *
 * Parses the open-standard AgentSkills.io format (SKILL.md) into OwnPilot's
 * ExtensionManifest. The format uses YAML frontmatter for metadata and
 * Markdown body for agent instructions.
 *
 * Spec: https://agentskills.io/specification
 *
 * Directory structure:
 *   skill-name/
 *   ├── SKILL.md          # Required: YAML frontmatter + instructions
 *   ├── scripts/           # Optional: executable code
 *   ├── references/        # Optional: documentation
 *   └── assets/            # Optional: templates, resources
 */

import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { ExtensionManifest } from './extension-types.js';
import { validateAgentSkillsFrontmatter, type AgentSkillsFrontmatter } from './extension-types.js';
import { getLog } from './log.js';

const log = getLog('AgentSkillsParser');

// =============================================================================
// YAML frontmatter parser (lightweight, no dependency)
// =============================================================================

/**
 * Extract YAML frontmatter and markdown body from a SKILL.md file.
 * Expects `---\n...\n---\n` at the start of the file.
 */
export function parseSkillMdFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    throw new Error('SKILL.md must start with YAML frontmatter (---)');
  }

  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    throw new Error('SKILL.md frontmatter not closed (missing second ---)');
  }

  const yamlBlock = trimmed.substring(3, endIndex).trim();
  const body = trimmed.substring(endIndex + 4).trim();

  // Lightweight YAML parser for flat key-value + simple nested objects
  const frontmatter = parseSimpleYaml(yamlBlock);

  return { frontmatter, body };
}

/**
 * Parse simple YAML (flat key-value pairs, one level of nesting).
 * Supports: strings, quoted strings, arrays (flow/block), nested maps (one level).
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentKey: string | null = null;
  let currentMap: Record<string, string> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Check if this is a nested key (indented, part of a map)
    if (currentKey && currentMap && /^\s{2,}/.test(line)) {
      const match = line.trim().match(/^([^:]+):\s*(.*)$/);
      if (match) {
        const val = unquote(match[2]!.trim());
        currentMap[match[1]!.trim()] = val;
      }
      continue;
    }

    // Flush current map if we're back at top level
    if (currentKey && currentMap) {
      result[currentKey] = currentMap;
      currentKey = null;
      currentMap = null;
    }

    // Top-level key: value
    const kvMatch = line.match(/^([a-z_-]+):\s*(.*)$/i);
    if (!kvMatch) continue;

    const key = kvMatch[1]!.trim();
    const rawValue = kvMatch[2]!.trim();

    if (!rawValue) {
      // Start of a nested map or block sequence
      currentKey = key;
      currentMap = {};
      continue;
    }

    // Flow-style array: [item1, item2]
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const items = rawValue
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      result[key] = items;
      continue;
    }

    // Simple value
    result[key] = unquote(rawValue);
  }

  // Flush last map
  if (currentKey && currentMap) {
    result[currentKey] = currentMap;
  }

  return result;
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// =============================================================================
// Directory scanner
// =============================================================================

/**
 * Scan a skill directory for optional scripts/, references/, and assets/ subdirs.
 * Returns relative paths to discovered files.
 */
export function scanSkillDirectory(skillDir: string): {
  scriptPaths: string[];
  referencePaths: string[];
  assetPaths: string[];
} {
  const scriptPaths: string[] = [];
  const referencePaths: string[] = [];
  const assetPaths: string[] = [];

  const scriptsDir = join(skillDir, 'scripts');
  if (existsSync(scriptsDir)) {
    try {
      for (const entry of readdirSync(scriptsDir, { withFileTypes: true })) {
        if (entry.isFile()) {
          scriptPaths.push(`scripts/${entry.name}`);
        }
      }
    } catch {
      /* skip unreadable */
    }
  }

  const refsDir = join(skillDir, 'references');
  if (existsSync(refsDir)) {
    try {
      for (const entry of readdirSync(refsDir, { withFileTypes: true })) {
        if (entry.isFile()) {
          referencePaths.push(`references/${entry.name}`);
        }
      }
    } catch {
      /* skip unreadable */
    }
  }

  const assetsDir = join(skillDir, 'assets');
  if (existsSync(assetsDir)) {
    try {
      for (const entry of readdirSync(assetsDir, { withFileTypes: true })) {
        if (entry.isFile()) {
          assetPaths.push(`assets/${entry.name}`);
        }
      }
    } catch {
      /* skip unreadable */
    }
  }

  return { scriptPaths, referencePaths, assetPaths };
}

// =============================================================================
// Main converter
// =============================================================================

/**
 * Parse a SKILL.md file and its parent directory into an ExtensionManifest.
 *
 * The resulting manifest has `format: 'agentskills'` and stores the full
 * markdown body in `instructions`. Tools array is empty (agentskills format
 * is instruction-based, not tool-based). Scripts from scripts/ are listed
 * in `script_paths` for optional bridge-to-tools.
 */
export function parseAgentSkillsMd(content: string, skillDir?: string): ExtensionManifest {
  const { frontmatter, body } = parseSkillMdFrontmatter(content);

  // Validate frontmatter
  const validation = validateAgentSkillsFrontmatter(frontmatter);
  if (!validation.valid) {
    throw new Error(`Invalid SKILL.md frontmatter: ${validation.errors.join('; ')}`);
  }

  const fm = frontmatter as unknown as AgentSkillsFrontmatter;
  const metadata = fm.metadata ?? {};

  // Scan directory for scripts/references/assets
  let scriptPaths: string[] = [];
  let referencePaths: string[] = [];
  if (skillDir) {
    const scanned = scanSkillDirectory(skillDir);
    scriptPaths = scanned.scriptPaths;
    referencePaths = [...scanned.referencePaths, ...scanned.assetPaths];
  }

  // Parse allowed-tools (space-delimited string → array)
  const allowedToolsRaw =
    fm['allowed-tools'] ?? (frontmatter['allowed-tools'] as string | undefined);
  const allowedTools = allowedToolsRaw ? allowedToolsRaw.split(/\s+/).filter(Boolean) : undefined;

  const manifest: ExtensionManifest = {
    id: fm.name, // agentskills uses name as ID (must match directory name)
    name: fm.name,
    version: (metadata.version as string) ?? '1.0.0',
    description: fm.description,
    format: 'agentskills',

    // Map agentskills metadata to extension fields
    author: metadata.author ? { name: metadata.author } : undefined,
    category: inferCategory(fm.description, body),
    tags: inferTags(fm.name, fm.description),
    icon: '📘', // Default icon for agentskills format

    // AgentSkills.io doesn't define tools — it's instruction-based
    tools: [],

    // The full markdown body becomes the system prompt
    system_prompt: body || undefined,

    // AgentSkills.io specific fields
    instructions: body,
    license: fm.license,
    compatibility: fm.compatibility,
    allowed_tools: allowedTools,
    script_paths: scriptPaths.length > 0 ? scriptPaths : undefined,
    reference_paths: referencePaths.length > 0 ? referencePaths : undefined,
  };

  log.info(`Parsed AgentSkills.io skill: ${fm.name}`, {
    bodyLength: body.length,
    scripts: scriptPaths.length,
    references: referencePaths.length,
  });

  return manifest;
}

/**
 * Check if a directory contains an AgentSkills.io skill (has SKILL.md).
 */
export function isAgentSkillsDir(dir: string): boolean {
  return existsSync(join(dir, 'SKILL.md'));
}

// =============================================================================
// Helpers
// =============================================================================

/** Infer category from description/body keywords */
function inferCategory(description: string, body: string): ExtensionManifest['category'] {
  const text = `${description} ${body}`.toLowerCase();
  if (
    text.includes('code') ||
    text.includes('developer') ||
    text.includes('git') ||
    text.includes('debug')
  )
    return 'developer';
  if (text.includes('email') || text.includes('slack') || text.includes('message'))
    return 'communication';
  if (
    text.includes('data') ||
    text.includes('csv') ||
    text.includes('database') ||
    text.includes('sql')
  )
    return 'data';
  if (
    text.includes('image') ||
    text.includes('video') ||
    text.includes('audio') ||
    text.includes('pdf')
  )
    return 'media';
  if (text.includes('api') || text.includes('integration') || text.includes('webhook'))
    return 'integrations';
  if (
    text.includes('task') ||
    text.includes('calendar') ||
    text.includes('note') ||
    text.includes('plan')
  )
    return 'productivity';
  return 'other';
}

/** Extract tags from name and description */
function inferTags(name: string, description: string): string[] {
  const words = `${name} ${description}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && w.length < 20);
  // Deduplicate and take top 5
  return [...new Set(words)].slice(0, 5);
}
