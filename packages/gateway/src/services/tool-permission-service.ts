/**
 * Tool Permission Service
 *
 * Centralized permission enforcement for ALL tool execution paths.
 * Every tool execution — whether from chat, triggers, plans, workflows,
 * or skills — passes through this service before proceeding.
 *
 * Check order (first rejection wins):
 * 1. Tool group check (is the tool's group enabled for this user?)
 * 2. Execution permissions (code execution categories: JS, Python, Shell, etc.)
 * 3. CLI tool policy (per-tool allowed/prompt/blocked)
 * 4. Skill allowed-tools (if called from skill context)
 * 5. Custom tool requiresApproval (blocks in non-interactive contexts)
 */

import type { ExecutionPermissions } from '@ownpilot/core';
import { getGroupForTool, getBaseName as coreGetBaseName } from '@ownpilot/core';
import { getLog } from './log.js';
import type { ToolExecContext } from './permission-utils.js';
import { isNonInteractiveContext, downgradePromptToBlocked } from './permission-utils.js';

const log = getLog('ToolPermissionService');

// =============================================================================
// Types
// =============================================================================

export type PermissionDenialCode =
  | 'TOOL_GROUP_DISABLED'
  | 'EXECUTION_BLOCKED'
  | 'CLI_POLICY_BLOCKED'
  | 'SKILL_NOT_ALLOWED'
  | 'REQUIRES_APPROVAL';

export type PermissionResult =
  | { allowed: true }
  | { allowed: false; reason: string; code: PermissionDenialCode };

// =============================================================================
// CODE EXECUTION TOOLS — tools that require ExecutionPermissions
// =============================================================================

const CODE_EXECUTION_TOOLS: Record<string, keyof Omit<ExecutionPermissions, 'enabled' | 'mode'>> = {
  execute_javascript: 'execute_javascript',
  execute_python: 'execute_python',
  execute_shell: 'execute_shell',
  compile_code: 'compile_code',
  package_manager: 'package_manager',
};

// =============================================================================
// Lazy imports to avoid circular dependencies
// =============================================================================

let _getEnabledToolGroupIds: (() => string[]) | null = null;
let _cliToolPoliciesRepo: {
  getPolicy(toolName: string, userId?: string): Promise<string | null>;
} | null = null;
let _dynamicRegistryGetter: (() => { tools: Map<string, { requiresApproval?: boolean }> }) | null =
  null;

async function loadEnabledToolGroupIds(): Promise<string[]> {
  if (!_getEnabledToolGroupIds) {
    const mod = await import('../routes/settings.js');
    _getEnabledToolGroupIds = mod.getEnabledToolGroupIds;
  }
  return _getEnabledToolGroupIds();
}

async function loadCliToolPolicy(toolName: string, userId: string): Promise<string | null> {
  if (!_cliToolPoliciesRepo) {
    try {
      const mod = await import('../db/repositories/cli-tool-policies.js');
      _cliToolPoliciesRepo = mod.cliToolPoliciesRepo;
    } catch {
      return null;
    }
  }
  return _cliToolPoliciesRepo!.getPolicy(toolName, userId);
}

async function loadCustomToolRequiresApproval(toolName: string): Promise<boolean> {
  if (!_dynamicRegistryGetter) {
    try {
      const mod = await import('./custom-tool-registry.js');
      _dynamicRegistryGetter = mod.getCustomToolDynamicRegistry as NonNullable<
        typeof _dynamicRegistryGetter
      >;
    } catch {
      return false;
    }
  }
  if (!_dynamicRegistryGetter) return false;
  const registry = _dynamicRegistryGetter();
  const tool = registry.tools.get(toolName);
  return tool?.requiresApproval === true;
}

// =============================================================================
// Tool Permission Service
// =============================================================================

/**
 * Check if a tool is allowed to execute given the user, tool name, and context.
 *
 * This is the SINGLE authority for tool permission decisions across the entire system.
 */
export async function checkToolPermission(
  userId: string,
  toolName: string,
  context: ToolExecContext
): Promise<PermissionResult> {
  // Normalize: strip namespace prefix for group lookup
  // e.g., "core.execute_shell" → "execute_shell"
  const baseName = coreGetBaseName(toolName);

  // =========================================================================
  // 1. Tool group check
  // =========================================================================
  const group = getGroupForTool(baseName);
  if (group) {
    const enabledGroupIds = await loadEnabledToolGroupIds();
    if (!enabledGroupIds.includes(group.id)) {
      log.info('Tool blocked by disabled group', {
        toolName,
        group: group.id,
        source: context.source,
      });
      return {
        allowed: false,
        reason: `Tool group "${group.name}" is disabled`,
        code: 'TOOL_GROUP_DISABLED',
      };
    }
  }

  // =========================================================================
  // 2. Execution permissions check (code execution categories)
  // =========================================================================
  const execCategory = CODE_EXECUTION_TOOLS[baseName];
  if (execCategory && context.executionPermissions) {
    const perms = isNonInteractiveContext(context.source)
      ? downgradePromptToBlocked(context.executionPermissions)
      : context.executionPermissions;

    if (!perms.enabled) {
      return {
        allowed: false,
        reason: 'Code execution is globally disabled',
        code: 'EXECUTION_BLOCKED',
      };
    }

    const mode = perms[execCategory];
    if (mode === 'blocked') {
      return {
        allowed: false,
        reason: `${baseName} is blocked by execution permissions`,
        code: 'EXECUTION_BLOCKED',
      };
    }

    // 'prompt' in non-interactive context was already downgraded to 'blocked' above
    // 'prompt' in chat context → pass through (approval handled downstream)
    // 'allowed' → pass through
  }

  // =========================================================================
  // 3. CLI tool policy check
  // =========================================================================
  // The run_cli_tool tool takes a tool_name argument, so we check the actual
  // CLI tool name, not "run_cli_tool" itself. This check only applies when
  // the caller provides CLI tool context.
  if (baseName === 'run_cli_tool' && context.cliToolName) {
    const policy = await loadCliToolPolicy(context.cliToolName, userId);
    if (policy === 'blocked') {
      return {
        allowed: false,
        reason: `CLI tool "${context.cliToolName}" is blocked by policy`,
        code: 'CLI_POLICY_BLOCKED',
      };
    }
    if (policy === 'prompt' && isNonInteractiveContext(context.source)) {
      return {
        allowed: false,
        reason: `CLI tool "${context.cliToolName}" requires approval (not available in ${context.source} context)`,
        code: 'CLI_POLICY_BLOCKED',
      };
    }
  }

  // =========================================================================
  // 4. Skill allowed-tools check
  // =========================================================================
  if (context.skillAllowedTools) {
    // '*' wildcard or empty list means "all tools allowed"
    if (
      context.skillAllowedTools.length > 0 &&
      !context.skillAllowedTools.includes('*') &&
      !context.skillAllowedTools.includes(baseName)
    ) {
      log.warn('Skill attempted to use undeclared tool', {
        skillId: context.skillId,
        toolName: baseName,
        allowedTools: context.skillAllowedTools,
      });
      return {
        allowed: false,
        reason: `Tool "${baseName}" is not in this skill's allowed-tools list`,
        code: 'SKILL_NOT_ALLOWED',
      };
    }
  }

  // =========================================================================
  // 5. Custom tool requiresApproval check
  // =========================================================================
  if (isNonInteractiveContext(context.source)) {
    const needsApproval = await loadCustomToolRequiresApproval(baseName);
    if (needsApproval) {
      return {
        allowed: false,
        reason: `Custom tool "${baseName}" requires approval (not available in ${context.source} context)`,
        code: 'REQUIRES_APPROVAL',
      };
    }
  }

  return { allowed: true };
}

/**
 * Filter a list of tool names to only those allowed for the given user and context.
 */
export async function filterAllowedTools(
  userId: string,
  toolNames: string[],
  context: ToolExecContext
): Promise<string[]> {
  const results = await Promise.all(
    toolNames.map(async (name) => {
      const result = await checkToolPermission(userId, name, context);
      return result.allowed ? name : null;
    })
  );
  return results.filter((name): name is string => name !== null);
}

/**
 * Reset lazy-loaded dependencies (for testing).
 */
export function resetToolPermissionService(): void {
  _getEnabledToolGroupIds = null;
  _cliToolPoliciesRepo = null;
  _dynamicRegistryGetter = null;
}
