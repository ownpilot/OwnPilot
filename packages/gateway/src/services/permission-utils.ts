/**
 * Permission Utilities
 *
 * Shared helpers for tool permission enforcement across execution contexts.
 */

import type { ExecutionPermissions } from '@ownpilot/core';

/**
 * Downgrade 'prompt' permissions to 'blocked' for non-interactive contexts.
 * Used by triggers, plans, and workflows where there is no UI to prompt the user.
 */
export function downgradePromptToBlocked(perms: ExecutionPermissions): ExecutionPermissions {
  return {
    ...perms,
    execute_javascript:
      perms.execute_javascript === 'prompt' ? 'blocked' : perms.execute_javascript,
    execute_python: perms.execute_python === 'prompt' ? 'blocked' : perms.execute_python,
    execute_shell: perms.execute_shell === 'prompt' ? 'blocked' : perms.execute_shell,
    compile_code: perms.compile_code === 'prompt' ? 'blocked' : perms.compile_code,
    package_manager: perms.package_manager === 'prompt' ? 'blocked' : perms.package_manager,
  };
}

/**
 * Execution context for tool permission checks.
 * Identifies WHERE a tool is being called from, enabling
 * context-appropriate permission enforcement.
 */
export interface ToolExecContext {
  /** The execution source requesting the tool */
  source: 'chat' | 'trigger' | 'plan' | 'workflow' | 'skill' | 'coding-agent' | 'system';
  /** Code-execution category permissions (from user settings) */
  executionPermissions?: ExecutionPermissions;
  /** Agent ID if called from an agent */
  agentId?: string;
  /** Skill/extension ID if called from a skill context */
  skillId?: string;
  /** Allowed tools declared by the active skill (undefined = no restriction) */
  skillAllowedTools?: string[];
  /** Specific CLI tool name (for run_cli_tool policy check) */
  cliToolName?: string;
}

/** Whether the context is non-interactive (no UI to prompt the user) */
export function isNonInteractiveContext(source: ToolExecContext['source']): boolean {
  return source === 'trigger' || source === 'plan' || source === 'workflow' || source === 'system';
}
