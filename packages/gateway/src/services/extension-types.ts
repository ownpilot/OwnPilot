/**
 * Extension Manifest Types
 *
 * Defines the JSON manifest format for user extensions --
 * shareable bundles of tools, system prompts, triggers, and config requirements.
 */

// =============================================================================
// Manifest Types (parsed from extension.json)
// =============================================================================

export interface ExtensionManifest {
  /** Unique extension ID (lowercase + hyphens, e.g. "github-assistant") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semver version */
  version: string;
  /** Description */
  description: string;
  /** Package format: 'ownpilot' (native) or 'agentskills' (open standard) */
  format?: ExtensionFormat;
  /** Author info */
  author?: { name: string; email?: string; url?: string };
  /** Category for UI grouping */
  category?: ExtensionCategory;
  /** Tags for search/discovery */
  tags?: string[];
  /** Icon (emoji or URL) */
  icon?: string;
  /** Documentation URL */
  docs?: string;

  /** Tool definitions with inline JavaScript executors */
  tools: ExtensionToolDefinition[];
  /** Additional system prompt text injected when this extension is active */
  system_prompt?: string;
  /** Triggers to auto-create when extension is installed */
  triggers?: ExtensionTriggerDefinition[];
  /** External services this extension needs (registered in Config Center) */
  required_services?: ExtensionRequiredService[];
  /** Keywords that hint this extension's tools should be prioritized */
  keywords?: string[];

  // -- AgentSkills.io format fields (populated when format === 'agentskills') --

  /** Full markdown body from SKILL.md (loaded as system prompt on activation) */
  instructions?: string;
  /** License identifier or reference */
  license?: string;
  /** Environment requirements / compatibility notes */
  compatibility?: string;
  /** Pre-approved tools the extension may use (space-delimited in SKILL.md) */
  allowed_tools?: string[];
  /** Paths to bundled scripts (relative to extension directory) */
  script_paths?: string[];
  /** Paths to bundled references (relative to extension directory) */
  reference_paths?: string[];
}

/** Manifest format: 'ownpilot' = native tool bundles, 'agentskills' = open standard (SKILL.md) */
export type ExtensionFormat = 'ownpilot' | 'agentskills';

export type ExtensionCategory =
  | 'developer'
  | 'productivity'
  | 'communication'
  | 'data'
  | 'utilities'
  | 'integrations'
  | 'media'
  | 'lifestyle'
  | 'other';

export interface ExtensionToolDefinition {
  /** Tool name (must be unique across all extensions, recommended: prefix with extension id) */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema parameters */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** JavaScript code to execute (runs in sandbox, same as custom tools) */
  code: string;
  /** Required permissions */
  permissions?: string[];
  /** Whether execution requires user approval */
  requires_approval?: boolean;
}

export interface ExtensionTriggerDefinition {
  /** Trigger name */
  name: string;
  /** Trigger description */
  description?: string;
  /** Trigger type */
  type: 'schedule' | 'event';
  /** Trigger config (e.g. { cron: '0 9 * * 1-5' } for schedule) */
  config: Record<string, unknown>;
  /** Action to execute when trigger fires */
  action: {
    type: 'chat' | 'tool' | 'notification';
    payload: Record<string, unknown>;
  };
  /** Whether trigger is enabled by default (default: true) */
  enabled?: boolean;
}

export interface ExtensionRequiredService {
  /** Config Center service name */
  name: string;
  /** Display name */
  display_name: string;
  /** Description */
  description?: string;
  /** Category */
  category?: string;
  /** Docs URL */
  docs_url?: string;
  /** Config schema fields */
  config_schema?: ExtensionConfigField[];
}

export interface ExtensionConfigField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  description?: string;
}

// =============================================================================
// Validation
// =============================================================================

const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const TOOL_NAME_PATTERN = /^[a-z0-9_.]+$/;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateManifest(manifest: unknown): ValidationResult {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be a JSON object'] };
  }

  const m = manifest as Record<string, unknown>;

  // Required top-level fields
  if (!m.id || typeof m.id !== 'string') {
    errors.push('Missing or invalid "id" (must be a string)');
  } else if (!EXTENSION_ID_PATTERN.test(m.id)) {
    errors.push(
      `Invalid "id" format: "${m.id}" (must be lowercase alphanumeric + hyphens, start with letter/digit)`
    );
  }

  if (!m.name || typeof m.name !== 'string') {
    errors.push('Missing or invalid "name" (must be a string)');
  }

  if (!m.version || typeof m.version !== 'string') {
    errors.push('Missing or invalid "version" (must be a string)');
  }

  if (!m.description || typeof m.description !== 'string') {
    errors.push('Missing or invalid "description" (must be a string)');
  }

  // Tools (required, at least 1)
  if (!Array.isArray(m.tools) || m.tools.length === 0) {
    errors.push('Missing or empty "tools" array (must have at least 1 tool)');
  } else {
    const toolNames = new Set<string>();
    for (let i = 0; i < m.tools.length; i++) {
      const tool = m.tools[i] as Record<string, unknown>;
      const prefix = `tools[${i}]`;

      if (!tool.name || typeof tool.name !== 'string') {
        errors.push(`${prefix}: missing or invalid "name"`);
      } else if (!TOOL_NAME_PATTERN.test(tool.name)) {
        errors.push(
          `${prefix}: invalid tool name "${tool.name}" (must be lowercase alphanumeric + underscores)`
        );
      } else if (toolNames.has(tool.name)) {
        errors.push(`${prefix}: duplicate tool name "${tool.name}"`);
      } else {
        toolNames.add(tool.name);
      }

      if (!tool.description || typeof tool.description !== 'string') {
        errors.push(`${prefix}: missing or invalid "description"`);
      }

      if (!tool.parameters || typeof tool.parameters !== 'object') {
        errors.push(`${prefix}: missing or invalid "parameters"`);
      }

      if (!tool.code || typeof tool.code !== 'string') {
        errors.push(`${prefix}: missing or invalid "code"`);
      }
    }
  }

  // Optional triggers validation
  if (m.triggers !== undefined) {
    if (!Array.isArray(m.triggers)) {
      errors.push('"triggers" must be an array');
    } else {
      for (let i = 0; i < m.triggers.length; i++) {
        const trigger = m.triggers[i] as Record<string, unknown>;
        const prefix = `triggers[${i}]`;

        if (!trigger.name || typeof trigger.name !== 'string') {
          errors.push(`${prefix}: missing or invalid "name"`);
        }
        if (!trigger.type || (trigger.type !== 'schedule' && trigger.type !== 'event')) {
          errors.push(`${prefix}: invalid "type" (must be 'schedule' or 'event')`);
        }
        if (!trigger.config || typeof trigger.config !== 'object') {
          errors.push(`${prefix}: missing or invalid "config"`);
        }
        if (!trigger.action || typeof trigger.action !== 'object') {
          errors.push(`${prefix}: missing or invalid "action"`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// AgentSkills.io format validation
// =============================================================================

/** AgentSkills.io SKILL.md name pattern: lowercase alphanumeric + hyphens, no consecutive hyphens */
const AGENTSKILLS_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Normalizes a skill name to meet AgentSkills.io format requirements.
 * Converts "Suno AI Music Architect" to "suno-ai-music-architect"
 */
export function normalizeSkillName(name: string): string {
  return (
    name
      // Convert to lowercase
      .toLowerCase()
      // Replace spaces and underscores with hyphens
      .replace(/[\s_]+/g, '-')
      // Remove invalid characters (keep only alphanumeric and hyphens)
      .replace(/[^a-z0-9-]/g, '')
      // Replace consecutive hyphens with single hyphen
      .replace(/-+/g, '-')
      // Trim hyphens from start and end
      .replace(/^-+|-+$/g, '')
  );
}

/** Parsed frontmatter from an AgentSkills.io SKILL.md file */
export interface AgentSkillsFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  'allowed-tools'?: string;
}

export function validateAgentSkillsFrontmatter(fm: unknown): ValidationResult {
  const errors: string[] = [];

  if (!fm || typeof fm !== 'object') {
    return { valid: false, errors: ['Frontmatter must be a YAML object'] };
  }

  const f = fm as Record<string, unknown>;

  // Normalize skill name before validation
  if (f.name && typeof f.name === 'string') {
    const normalizedName = normalizeSkillName(f.name);
    // Store normalized name back
    f.name = normalizedName;
  }

  if (!f.name || typeof f.name !== 'string') {
    errors.push('Missing or invalid "name" (required)');
  } else if (f.name.length > 64) {
    errors.push(`"name" exceeds 64 characters: ${f.name.length}`);
  } else if (!AGENTSKILLS_NAME_PATTERN.test(f.name)) {
    errors.push(
      `Invalid "name" format: "${f.name}" (lowercase alphanumeric + hyphens, no consecutive hyphens, cannot start/end with hyphen)`
    );
  }

  if (!f.description || typeof f.description !== 'string') {
    errors.push('Missing or invalid "description" (required)');
  } else if (f.description.length > 1024) {
    errors.push(`"description" exceeds 1024 characters: ${f.description.length}`);
  }

  if (f.license !== undefined && typeof f.license !== 'string') {
    errors.push('"license" must be a string');
  }

  if (f.compatibility !== undefined) {
    if (typeof f.compatibility !== 'string') {
      errors.push('"compatibility" must be a string');
    } else if (f.compatibility.length > 500) {
      errors.push(`"compatibility" exceeds 500 characters`);
    }
  }

  // Coerce non-object metadata instead of rejecting (e.g. OpenClaw skills may use string metadata)
  if (f.metadata !== undefined && f.metadata !== null) {
    if (typeof f.metadata === 'string') {
      // Treat string metadata as a single "value" entry
      f.metadata = { value: f.metadata };
    } else if (typeof f.metadata !== 'object' || Array.isArray(f.metadata)) {
      // Drop invalid types silently
      f.metadata = undefined;
    }
  } else if (f.metadata === null) {
    f.metadata = undefined;
  }

  return { valid: errors.length === 0, errors };
}
