/**
 * Skill Package Markdown Parser & Serializer
 *
 * Parses `.md` skill package files into SkillPackageManifest objects,
 * and serializes manifests back to readable markdown.
 *
 * Format: YAML frontmatter + ## sections for System Prompt, Tools,
 * Required Services, Triggers.  See skill-development-guide.md for the full spec.
 */

import type {
  SkillPackageManifest,
  SkillPackageCategory,
  SkillToolDefinition,
  SkillTriggerDefinition,
  SkillRequiredService,
  SkillConfigField,
} from './skill-package-types.js';

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a skill markdown file into a SkillPackageManifest.
 * Throws on structural errors (missing frontmatter, etc.).
 */
export function parseSkillMarkdown(content: string): SkillPackageManifest {
  const { metadata, body } = parseFrontmatter(content);
  const sections = splitSections(body);

  const manifest: SkillPackageManifest = {
    id: String(metadata.id ?? ''),
    name: String(metadata.name ?? ''),
    version: String(metadata.version ?? ''),
    description: String(metadata.description ?? ''),
    tools: [],
  };

  // Optional frontmatter fields
  if (metadata.category) manifest.category = String(metadata.category) as SkillPackageCategory;
  if (metadata.icon) manifest.icon = String(metadata.icon);
  if (metadata.author) manifest.author = { name: String(metadata.author) };
  if (metadata.docs) manifest.docs = String(metadata.docs);
  if (Array.isArray(metadata.tags)) manifest.tags = metadata.tags.map(String);
  if (Array.isArray(metadata.keywords)) manifest.keywords = metadata.keywords.map(String);

  // System prompt
  const systemPromptContent = sections.get('system prompt');
  if (systemPromptContent?.trim()) {
    manifest.system_prompt = systemPromptContent.trim();
  }

  // Tools
  const toolsContent = sections.get('tools');
  if (toolsContent) {
    manifest.tools = parseToolsSection(toolsContent);
  }

  // Required services
  const servicesContent = sections.get('required services');
  if (servicesContent) {
    manifest.required_services = parseRequiredServicesSection(servicesContent);
  }

  // Triggers
  const triggersContent = sections.get('triggers');
  if (triggersContent) {
    manifest.triggers = parseTriggersSection(triggersContent);
  }

  return manifest;
}

/**
 * Serialize a SkillPackageManifest to readable markdown.
 */
export function serializeSkillMarkdown(manifest: SkillPackageManifest): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`id: ${manifest.id}`);
  lines.push(`name: ${manifest.name}`);
  lines.push(`version: ${manifest.version}`);
  lines.push(`description: ${manifest.description}`);
  if (manifest.category) lines.push(`category: ${manifest.category}`);
  if (manifest.icon) lines.push(`icon: ${manifest.icon}`);
  if (manifest.author) lines.push(`author: ${manifest.author.name}`);
  if (manifest.tags?.length) lines.push(`tags: [${manifest.tags.join(', ')}]`);
  if (manifest.keywords?.length) lines.push(`keywords: [${manifest.keywords.join(', ')}]`);
  if (manifest.docs) lines.push(`docs: ${manifest.docs}`);
  lines.push('---');
  lines.push('');

  // Title
  lines.push(`# ${manifest.name}`);
  lines.push('');
  lines.push(manifest.description);
  lines.push('');

  // System prompt
  if (manifest.system_prompt?.trim()) {
    lines.push('## System Prompt');
    lines.push('');
    lines.push(manifest.system_prompt.trim());
    lines.push('');
  }

  // Required services
  if (manifest.required_services?.length) {
    lines.push('## Required Services');
    lines.push('');
    for (const service of manifest.required_services) {
      lines.push(`### ${service.name}`);
      lines.push(`- **Display Name**: ${service.display_name}`);
      if (service.description) lines.push(`- **Description**: ${service.description}`);
      if (service.category) lines.push(`- **Category**: ${service.category}`);
      if (service.docs_url) lines.push(`- **Docs URL**: ${service.docs_url}`);

      if (service.config_schema?.length) {
        lines.push('');
        lines.push('| Field | Label | Type | Required | Description |');
        lines.push('|-------|-------|------|----------|-------------|');
        for (const field of service.config_schema) {
          const req = field.required ? 'yes' : 'no';
          lines.push(`| ${field.name} | ${field.label} | ${field.type} | ${req} | ${field.description ?? ''} |`);
        }
      }
      lines.push('');
    }
  }

  // Tools
  if (manifest.tools.length > 0) {
    lines.push('## Tools');
    lines.push('');
    for (const tool of manifest.tools) {
      lines.push(`### ${tool.name}`);
      lines.push('');
      lines.push(tool.description);
      lines.push('');

      if (tool.permissions?.length) {
        lines.push(`**Permissions**: ${tool.permissions.join(', ')}`);
        lines.push('');
      }
      if (tool.requires_approval) {
        lines.push('**Requires Approval**: yes');
        lines.push('');
      }

      // Parameters table
      const props = tool.parameters.properties;
      const required = new Set(tool.parameters.required ?? []);
      const paramNames = Object.keys(props);
      if (paramNames.length > 0) {
        lines.push('| Parameter | Type | Required | Description |');
        lines.push('|-----------|------|----------|-------------|');
        for (const name of paramNames) {
          const prop = props[name] as Record<string, unknown>;
          const type = String(prop.type ?? 'string');
          const req = required.has(name) ? 'yes' : 'no';
          const desc = String(prop.description ?? '');
          lines.push(`| ${name} | ${type} | ${req} | ${desc} |`);
        }
        lines.push('');
      }

      // Code block
      lines.push('```javascript');
      lines.push(tool.code);
      lines.push('```');
      lines.push('');
    }
  }

  // Triggers
  if (manifest.triggers?.length) {
    lines.push('## Triggers');
    lines.push('');
    for (const trigger of manifest.triggers) {
      lines.push(`### ${trigger.name}`);
      lines.push(`- **Type**: ${trigger.type}`);
      if (trigger.description) lines.push(`- **Description**: ${trigger.description}`);
      if (trigger.enabled !== undefined) lines.push(`- **Enabled**: ${trigger.enabled}`);
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify({ config: trigger.config, action: trigger.action }, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Frontmatter Parser
// =============================================================================

interface FrontmatterResult {
  metadata: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(content: string): FrontmatterResult {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith('---')) {
    throw new Error('Missing YAML frontmatter (file must start with ---)');
  }

  // Find closing ---
  const secondDelim = trimmed.indexOf('\n---', 3);
  if (secondDelim === -1) {
    throw new Error('Missing closing frontmatter delimiter (---)');
  }

  const yamlBlock = trimmed.substring(3, secondDelim).trim();
  const body = trimmed.substring(secondDelim + 4); // skip \n---

  const metadata: Record<string, unknown> = {};

  for (const line of yamlBlock.split('\n')) {
    const trimLine = line.trim();
    if (!trimLine || trimLine.startsWith('#')) continue;

    // Split on first `: ` or `:`
    const colonIdx = trimLine.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimLine.substring(0, colonIdx).trim();
    let value = trimLine.substring(colonIdx + 1).trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Inline YAML array: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      metadata[key] = inner
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(s => {
          // Strip quotes from individual items
          if ((s.startsWith('"') && s.endsWith('"')) ||
              (s.startsWith("'") && s.endsWith("'"))) {
            return s.slice(1, -1);
          }
          return s;
        });
    } else {
      metadata[key] = value;
    }
  }

  return { metadata, body };
}

// =============================================================================
// Section Splitter
// =============================================================================

/**
 * Split markdown body into ## sections.
 * Returns Map<lowercased-section-name, content>.
 * Tracks fenced code block state to avoid splitting on headings inside code.
 */
function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  let currentSection: string | null = null;
  let currentLines: string[] = [];
  let inCodeBlock = false;

  for (const line of body.split('\n')) {
    // Track fenced code blocks
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }

    if (!inCodeBlock && /^## (.+)$/.test(line)) {
      // Save previous section
      if (currentSection !== null) {
        sections.set(currentSection, currentLines.join('\n'));
      }
      currentSection = line.replace(/^## /, '').trim().toLowerCase();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Save last section
  if (currentSection !== null) {
    sections.set(currentSection, currentLines.join('\n'));
  }

  return sections;
}

/**
 * Split a section's content into ### sub-sections.
 */
function splitSubsections(content: string): Array<{ name: string; content: string }> {
  const subs: Array<{ name: string; content: string }> = [];
  let currentName: string | null = null;
  let currentLines: string[] = [];
  let inCodeBlock = false;

  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }

    if (!inCodeBlock && /^### (.+)$/.test(line)) {
      if (currentName !== null) {
        subs.push({ name: currentName, content: currentLines.join('\n') });
      }
      currentName = line.replace(/^### /, '').trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentName !== null) {
    subs.push({ name: currentName, content: currentLines.join('\n') });
  }

  return subs;
}

// =============================================================================
// Table Parser
// =============================================================================

/**
 * Parse a markdown table from text content.
 * Returns array of row objects keyed by lowercased header names.
 */
function parseMarkdownTable(content: string): Array<Record<string, string>> {
  const tableLines = content
    .split('\n')
    .filter(l => l.trim().startsWith('|'));

  if (tableLines.length < 2) return [];

  const parseRow = (line: string): string[] =>
    line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);

  const headers = parseRow(tableLines[0]!).map(h => h.toLowerCase());
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < tableLines.length; i++) {
    const cells = parseRow(tableLines[i]!);
    // Skip separator rows (|---|---|)
    if (cells.every(c => /^[-:]+$/.test(c))) continue;

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
    rows.push(row);
  }

  return rows;
}

// =============================================================================
// Metadata Parser (bold list items)
// =============================================================================

/**
 * Parse `- **Key**: Value` or `**Key**: Value` lines into a key-value map.
 */
function parseBoldMetadata(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Match both `- **Key**: Value` and `**Key**: Value` (with or without leading dash)
  const pattern = /^(?:-\s+)?\*\*(.+?)\*\*:\s*(.+)$/;

  for (const line of content.split('\n')) {
    const match = line.trim().match(pattern);
    if (match) {
      result[match[1]!.toLowerCase()] = match[2]!.trim();
    }
  }

  return result;
}

// =============================================================================
// Code Block Extractor
// =============================================================================

/**
 * Extract the first fenced code block from content.
 * Optionally filter by language (e.g., 'javascript', 'json').
 */
function extractCodeBlock(content: string, lang?: string): string | null {
  const lines = content.split('\n');
  let capturing = false;
  let captured: string[] = [];

  for (const line of lines) {
    if (capturing) {
      if (line.trimStart().startsWith('```')) {
        return captured.join('\n');
      }
      captured.push(line);
    } else if (line.trimStart().startsWith('```')) {
      const fenceLang = line.trimStart().substring(3).trim().toLowerCase();
      if (!lang || fenceLang === lang || fenceLang === '') {
        capturing = true;
        captured = [];
      }
    }
  }

  return null;
}

// =============================================================================
// Tool Section Parser
// =============================================================================

function parseToolsSection(content: string): SkillToolDefinition[] {
  const subs = splitSubsections(content);
  return subs.map(parseOneTool);
}

function parseOneTool(sub: { name: string; content: string }): SkillToolDefinition {
  const content = sub.content;
  const lines = content.split('\n');

  // Extract description: first paragraph (lines before first **Key, |, or ```)
  const descLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (descLines.length > 0) break; // End of first paragraph
      continue; // Skip leading blank lines
    }
    if (trimmed.startsWith('**') || trimmed.startsWith('|') || trimmed.startsWith('```')) break;
    descLines.push(trimmed);
  }
  const description = descLines.join(' ');

  // Extract bold metadata
  const meta = parseBoldMetadata(content);
  const permissions = meta['permissions']
    ? meta['permissions'].split(',').map(s => s.trim()).filter(Boolean)
    : undefined;
  const requiresApproval = meta['requires approval']
    ? ['yes', 'true'].includes(meta['requires approval'].toLowerCase())
    : undefined;

  // Parse parameter table
  const tableRows = parseMarkdownTable(content);
  const parameters = buildParametersSchema(tableRows);

  // Extract code block (prefer javascript/js, fall back to any)
  const code = extractCodeBlock(content, 'javascript')
    ?? extractCodeBlock(content, 'js')
    ?? extractCodeBlock(content)
    ?? '';

  const tool: SkillToolDefinition = {
    name: sub.name,
    description,
    parameters,
    code,
  };

  if (permissions?.length) tool.permissions = permissions;
  if (requiresApproval !== undefined) tool.requires_approval = requiresApproval;

  return tool;
}

function buildParametersSchema(
  tableRows: Array<Record<string, string>>,
): SkillToolDefinition['parameters'] {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const row of tableRows) {
    const name = row['parameter'] || row['name'];
    if (!name) continue;

    const prop: Record<string, unknown> = {};
    const rawType = (row['type'] ?? 'string').trim();
    prop.type = rawType;
    if (row['description']) prop.description = row['description'];

    properties[name] = prop;

    const isRequired = (row['required'] ?? '').toLowerCase();
    if (isRequired === 'yes' || isRequired === 'true') {
      required.push(name);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

// =============================================================================
// Required Services Section Parser
// =============================================================================

function parseRequiredServicesSection(content: string): SkillRequiredService[] {
  const subs = splitSubsections(content);
  return subs.map(parseOneService);
}

function parseOneService(sub: { name: string; content: string }): SkillRequiredService {
  const meta = parseBoldMetadata(sub.content);

  const service: SkillRequiredService = {
    name: sub.name,
    display_name: meta['display name'] ?? sub.name,
  };

  if (meta['description']) service.description = meta['description'];
  if (meta['category']) service.category = meta['category'];
  if (meta['docs url']) service.docs_url = meta['docs url'];

  // Config schema table
  const tableRows = parseMarkdownTable(sub.content);
  if (tableRows.length > 0) {
    service.config_schema = tableRows.map((row): SkillConfigField => ({
      name: row['field'] || row['name'] || '',
      label: row['label'] || '',
      type: row['type'] || 'string',
      required: ['yes', 'true'].includes((row['required'] ?? '').toLowerCase()),
      description: row['description'],
    }));
  }

  return service;
}

// =============================================================================
// Triggers Section Parser
// =============================================================================

function parseTriggersSection(content: string): SkillTriggerDefinition[] {
  const subs = splitSubsections(content);
  return subs.map(parseOneTrigger);
}

function parseOneTrigger(sub: { name: string; content: string }): SkillTriggerDefinition {
  const meta = parseBoldMetadata(sub.content);

  // Extract JSON code block for config/action
  const jsonStr = extractCodeBlock(sub.content, 'json');
  let config: Record<string, unknown> = {};
  let action: { type: 'chat' | 'tool' | 'notification'; payload: Record<string, unknown> } = {
    type: 'chat',
    payload: {},
  };

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      if (parsed.config) config = parsed.config as Record<string, unknown>;
      if (parsed.action) action = parsed.action as typeof action;
    } catch {
      // Invalid JSON — leave defaults
    }
  }

  const trigger: SkillTriggerDefinition = {
    name: sub.name,
    type: (meta['type'] as 'schedule' | 'event') ?? 'schedule',
    config,
    action,
  };

  if (meta['description']) trigger.description = meta['description'];
  if (meta['enabled'] !== undefined) {
    trigger.enabled = !['false', 'no'].includes(meta['enabled'].toLowerCase());
  }

  return trigger;
}
