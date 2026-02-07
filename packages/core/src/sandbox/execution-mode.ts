/**
 * Execution Mode Configuration
 *
 * Controls how code execution tools run:
 * - 'docker': Docker sandbox only (most secure)
 * - 'local': Direct local execution (requires approval)
 * - 'auto': Try Docker first, fall back to local with approval
 */

// =============================================================================
// Types
// =============================================================================

export type ExecutionMode = 'docker' | 'local' | 'auto';

export interface ExecutionModeConfig {
  /** Execution mode (default: 'auto') */
  mode: ExecutionMode;
  /** Require user approval for local execution (default: true) */
  requireApproval: boolean;
  /** Languages allowed for local execution */
  allowedLanguages: string[];
  /** Timeout for local execution in ms (default: 30000) */
  localTimeout: number;
  /** Max output size for local execution in bytes (default: 1MB) */
  localMaxOutputSize: number;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Get the execution mode from environment or default.
 */
export function getExecutionMode(): ExecutionMode {
  const envMode = process.env.EXECUTION_MODE?.toLowerCase();
  if (envMode === 'docker' || envMode === 'local' || envMode === 'auto') {
    return envMode;
  }
  return 'auto';
}

/**
 * Get the full execution mode configuration.
 *
 * requireApproval defaults to false because the autonomy system already
 * provides tool-level approval. Adding a second gate for "local vs docker"
 * is redundant. If users want to prevent local execution entirely, they
 * should set EXECUTION_MODE=docker.
 * To force an extra approval step, set LOCAL_EXEC_REQUIRE_APPROVAL=true.
 */
export function getExecutionModeConfig(): ExecutionModeConfig {
  return {
    mode: getExecutionMode(),
    requireApproval: process.env.LOCAL_EXEC_REQUIRE_APPROVAL === 'true',
    allowedLanguages: (process.env.LOCAL_EXEC_LANGUAGES || 'javascript,python,shell').split(',').map(s => s.trim()),
    localTimeout: parseInt(process.env.LOCAL_EXEC_TIMEOUT || '30000', 10),
    localMaxOutputSize: parseInt(process.env.LOCAL_EXEC_MAX_OUTPUT || String(1024 * 1024), 10),
  };
}

/**
 * Check if a language is allowed for local execution.
 */
export function isLanguageAllowed(language: string): boolean {
  const config = getExecutionModeConfig();
  return config.allowedLanguages.includes(language.toLowerCase());
}
