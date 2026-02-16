/**
 * Skill Package Manifest Types
 *
 * Defines the JSON manifest format for skill packages —
 * shareable bundles of tools, system prompts, triggers, and config requirements.
 */

// =============================================================================
// Manifest Types (parsed from skill.json)
// =============================================================================

export interface SkillPackageManifest {
  /** Unique skill package ID (lowercase + hyphens, e.g. "github-assistant") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semver version */
  version: string;
  /** Description */
  description: string;
  /** Author info */
  author?: { name: string; email?: string; url?: string };
  /** Category for UI grouping */
  category?: SkillPackageCategory;
  /** Tags for search/discovery */
  tags?: string[];
  /** Icon (emoji or URL) */
  icon?: string;
  /** Documentation URL */
  docs?: string;

  /** Tool definitions with inline JavaScript executors */
  tools: SkillToolDefinition[];
  /** Additional system prompt text injected when this skill is active */
  system_prompt?: string;
  /** Triggers to auto-create when skill is installed */
  triggers?: SkillTriggerDefinition[];
  /** External services this skill needs (registered in Config Center) */
  required_services?: SkillRequiredService[];
  /** Keywords that hint this skill's tools should be prioritized */
  keywords?: string[];
}

export type SkillPackageCategory =
  | 'developer'
  | 'productivity'
  | 'communication'
  | 'data'
  | 'utilities'
  | 'integrations'
  | 'media'
  | 'lifestyle'
  | 'other';

export interface SkillToolDefinition {
  /** Tool name (must be unique across all skills, recommended: prefix with skill id) */
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

export interface SkillTriggerDefinition {
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

export interface SkillRequiredService {
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
  config_schema?: SkillConfigField[];
}

export interface SkillConfigField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  description?: string;
}

// =============================================================================
// Validation
// =============================================================================

const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const TOOL_NAME_PATTERN = /^[a-z0-9_]+$/;

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
  } else if (!SKILL_ID_PATTERN.test(m.id)) {
    errors.push(`Invalid "id" format: "${m.id}" (must be lowercase alphanumeric + hyphens, start with letter/digit)`);
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
        errors.push(`${prefix}: invalid tool name "${tool.name}" (must be lowercase alphanumeric + underscores)`);
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
