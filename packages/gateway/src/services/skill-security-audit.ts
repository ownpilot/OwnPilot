/**
 * Skill Security Audit
 *
 * Static analysis for AgentSkills.io SKILL.md format.
 * Checks skill instructions and metadata for security risks
 * before installation.
 *
 * Phase 1: Pattern-based static analysis (no LLM required).
 * Future: LLM-assisted semantic analysis.
 */

import type { ExtensionManifest } from './extension-types.js';
import { getLog } from './log.js';

const log = getLog('SkillSecurityAudit');

// =============================================================================
// Types
// =============================================================================

export type SkillRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SkillSecurityResult {
  /** Whether the skill should be blocked from installation */
  blocked: boolean;
  /** Reasons for blocking (empty if not blocked) */
  reasons: string[];
  /** Non-blocking security warnings */
  warnings: string[];
  /** Assessed risk level */
  riskLevel: SkillRiskLevel;
  /** Tools referenced in instructions but not in allowed-tools */
  undeclaredTools: string[];
}

// =============================================================================
// Dangerous Tool Patterns
// =============================================================================

/** Tools that execute arbitrary code — high-risk if undeclared */
const DANGEROUS_TOOLS = new Set([
  'execute_shell',
  'execute_python',
  'execute_javascript',
  'compile_code',
  'package_manager',
]);

/** Tools that modify filesystem — medium risk if undeclared */
const FILESYSTEM_WRITE_TOOLS = new Set([
  'write_file',
  'delete_file',
  'move_file',
  'create_folder',
]);

/** Tools that communicate externally — medium risk if undeclared */
const EXTERNAL_TOOLS = new Set([
  'send_email',
  'http_request',
  'fetch_web_page',
  'call_json_api',
]);

/** All known tool names for reference-detection in instructions */
const ALL_KNOWN_TOOLS = new Set([
  ...DANGEROUS_TOOLS,
  ...FILESYSTEM_WRITE_TOOLS,
  ...EXTERNAL_TOOLS,
  'search_web',
  'read_file',
  'list_files',
  'git_commit',
  'git_add',
  'git_checkout',
  'git_branch',
  'add_task',
  'add_note',
  'create_memory',
  'search_memories',
  'create_goal',
  'run_cli_tool',
  'run_coding_task',
]);

// =============================================================================
// Prompt Injection Patterns
// =============================================================================

/** Patterns that may indicate prompt injection attempts */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?prior\s+(instructions|rules|guidelines)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*:\s*you\s+are/i,
  /\boverride\s+(all\s+)?(safety|security|rules|permissions)\b/i,
  /\bbypass\s+(all\s+)?(restrictions|filters|safety|security)\b/i,
  /\b(disable|turn\s+off)\s+(safety|security|protection|filtering)\b/i,
  /\bact\s+as\s+if\s+(you\s+have\s+)?no\s+(restrictions|rules)\b/i,
  /\bdo\s+not\s+(follow|obey)\s+(any\s+)?(rules|guidelines|instructions)\b/i,
];

// =============================================================================
// Dangerous Script Patterns
// =============================================================================

/** Patterns in script code that are concerning */
const DANGEROUS_SCRIPT_PATTERNS = [
  /\bprocess\.env\b/,
  /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
  /\bexec\s*\(/,
  /\bexecSync\s*\(/,
  /\bspawn\s*\(/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bfs\.(write|unlink|rm|rmdir|mkdir)/,
  /\b__dirname\b/,
  /\b__filename\b/,
];

// =============================================================================
// Audit Function
// =============================================================================

/**
 * Audit a skill manifest for security risks.
 *
 * Returns warnings for medium-risk issues and blocks for critical issues.
 * This is a static analysis — no LLM calls are made.
 */
export function auditSkillSecurity(manifest: ExtensionManifest): SkillSecurityResult {
  const warnings: string[] = [];
  const reasons: string[] = [];
  const undeclaredTools: string[] = [];
  let riskLevel: SkillRiskLevel = 'low';

  const instructions = manifest.instructions ?? '';
  const allowedTools = new Set(manifest.allowed_tools ?? []);
  const hasWildcard = allowedTools.has('*');
  // Empty or undefined allowed_tools = unrestricted (backward compat)
  const hasExplicitAllowedTools =
    Array.isArray(manifest.allowed_tools) && manifest.allowed_tools.length > 0;

  // =========================================================================
  // 1. Check for tool references in instructions that aren't in allowed-tools
  // =========================================================================
  if (!hasWildcard && hasExplicitAllowedTools && instructions.length > 0) {
    for (const toolName of ALL_KNOWN_TOOLS) {
      // Check if the tool name appears in instructions (as a word boundary match)
      const regex = new RegExp(`\\b${toolName}\\b`, 'g');
      if (regex.test(instructions) && !allowedTools.has(toolName)) {
        undeclaredTools.push(toolName);

        if (DANGEROUS_TOOLS.has(toolName)) {
          warnings.push(
            `Skill instructions reference "${toolName}" (code execution) but it is not in allowed-tools`
          );
          riskLevel = elevateRisk(riskLevel, 'high');
        } else if (FILESYSTEM_WRITE_TOOLS.has(toolName) || EXTERNAL_TOOLS.has(toolName)) {
          warnings.push(
            `Skill instructions reference "${toolName}" but it is not in allowed-tools`
          );
          riskLevel = elevateRisk(riskLevel, 'medium');
        }
      }
    }
  }

  // =========================================================================
  // 2. Check if skill requests dangerous tools in allowed-tools
  // =========================================================================
  if (hasWildcard) {
    warnings.push('Skill requests wildcard (*) access to ALL tools');
    riskLevel = elevateRisk(riskLevel, 'high');
  } else if (hasExplicitAllowedTools) {
    for (const tool of allowedTools) {
      if (DANGEROUS_TOOLS.has(tool)) {
        warnings.push(`Skill requests dangerous tool "${tool}" in allowed-tools`);
        riskLevel = elevateRisk(riskLevel, 'high');
      }
    }
  }

  // =========================================================================
  // 3. Check for prompt injection patterns
  // =========================================================================
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(instructions)) {
      reasons.push(`Skill instructions contain suspicious pattern: ${pattern.source}`);
      riskLevel = elevateRisk(riskLevel, 'critical');
    }
  }

  // =========================================================================
  // 4. Check scripts for dangerous patterns
  // =========================================================================
  if (manifest.tools && manifest.tools.length > 0) {
    for (const tool of manifest.tools) {
      if (!tool.code) continue;
      for (const pattern of DANGEROUS_SCRIPT_PATTERNS) {
        if (pattern.test(tool.code)) {
          warnings.push(
            `Tool "${tool.name}" code contains suspicious pattern: ${pattern.source}`
          );
          riskLevel = elevateRisk(riskLevel, 'high');
        }
      }
    }
  }

  // =========================================================================
  // 5. Determine if skill should be blocked
  // =========================================================================
  const blocked = reasons.length > 0;

  if (warnings.length > 0 || blocked) {
    log.info('Skill security audit result', {
      skillId: manifest.id,
      riskLevel,
      blocked,
      warningCount: warnings.length,
      reasonCount: reasons.length,
    });
  }

  return { blocked, reasons, warnings, riskLevel, undeclaredTools };
}

// =============================================================================
// Helpers
// =============================================================================

function elevateRisk(current: SkillRiskLevel, proposed: SkillRiskLevel): SkillRiskLevel {
  const levels: Record<SkillRiskLevel, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  };
  return levels[proposed] > levels[current] ? proposed : current;
}
