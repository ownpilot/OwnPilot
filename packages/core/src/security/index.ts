/**
 * Security Module
 *
 * Provides security validation and configuration for code execution.
 * CRITICAL: This module ensures code execution only happens in sandboxed environments.
 */

import { isDockerAvailable, checkSandboxHealth, type SandboxHealthStatus } from '../sandbox/docker.js';
import { getExecutionMode, type ExecutionMode } from '../sandbox/execution-mode.js';
import { getLog } from '../services/get-log.js';

const log = getLog('Security');

/**
 * Security configuration
 */
export interface SecurityConfig {
  /** Require Docker for code execution (default: true in production) */
  requireDocker: boolean;
  /** Allow file access to home directory (default: false) */
  allowHomeAccess: boolean;
  /** Workspace directory for file operations */
  workspaceDir: string;
  /** Allowed temp directories */
  tempDirs: string[];
  /** Block dangerous shell commands */
  blockDangerousCommands: boolean;
  /** Execution mode for code tools */
  executionMode: ExecutionMode;
  /** Require approval for local execution (default: true) */
  requireLocalApproval: boolean;
}

/**
 * Security status report
 */
export interface SecurityStatus {
  isSecure: boolean;
  dockerAvailable: boolean;
  dockerRequired: boolean;
  unsafeExecutionEnabled: boolean;
  homeAccessEnabled: boolean;
  warnings: string[];
  errors: string[];
  sandboxHealth?: SandboxHealthStatus;
}

/**
 * Dangerous environment variables that should NEVER be set in production
 * NOTE: ALLOW_UNSAFE_CODE_EXECUTION has been completely removed from the codebase.
 * Code execution now REQUIRES Docker - no bypass is possible.
 */
const DANGEROUS_ENV_VARS = [
  'ALLOW_HOME_DIR_ACCESS',
  'DOCKER_SANDBOX_RELAXED_SECURITY',
];

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Validate security configuration at startup
 * Returns warnings/errors for insecure configurations
 */
export async function validateSecurityConfig(): Promise<SecurityStatus> {
  const executionMode = getExecutionMode();

  const status: SecurityStatus = {
    isSecure: true,
    dockerAvailable: false,
    dockerRequired: executionMode === 'docker', // Only strictly required in docker mode
    unsafeExecutionEnabled: false, // This option has been removed - always false
    homeAccessEnabled: process.env.ALLOW_HOME_DIR_ACCESS === 'true',
    warnings: [],
    errors: [],
  };

  // Check Docker availability
  status.dockerAvailable = await isDockerAvailable();

  // CRITICAL: Check for dangerous environment variables in production
  if (isProduction()) {
    for (const envVar of DANGEROUS_ENV_VARS) {
      if (process.env[envVar] === 'true') {
        status.errors.push(
          `SECURITY ERROR: ${envVar}=true is NOT ALLOWED in production! ` +
          `This would allow code execution on the host system.`
        );
        status.isSecure = false;
      }
    }

    // Require Docker in production
    if (!status.dockerAvailable) {
      status.errors.push(
        'SECURITY ERROR: Docker is required for production but not available. ' +
        'Code execution tools will be disabled.'
      );
      status.isSecure = false;
    }
  }

  // Warnings for development
  if (!isProduction()) {
    if (status.homeAccessEnabled) {
      status.warnings.push(
        'WARNING: ALLOW_HOME_DIR_ACCESS=true - File tools can access home directory.'
      );
    }

    if (!status.dockerAvailable && executionMode === 'docker') {
      status.warnings.push(
        'WARNING: Docker not available. Code execution tools will be DISABLED.'
      );
    }

    if (!status.dockerAvailable && executionMode === 'auto') {
      status.warnings.push(
        'WARNING: Docker not available. Code execution will use LOCAL mode with user approval.'
      );
    }

    if (executionMode === 'local') {
      status.warnings.push(
        'WARNING: EXECUTION_MODE=local — Code execution runs directly on host (with approval).'
      );
    }
  }

  // Docker availability info (severity depends on mode)
  if (!status.dockerAvailable) {
    if (executionMode === 'docker') {
      status.errors.push(
        'Docker is not available. Code execution (execute_javascript, execute_python, execute_shell) will be disabled.'
      );
    } else {
      // auto or local — Docker absence is info, not error
      status.warnings.push(
        `Docker not available. Execution mode: ${executionMode} — local execution with approval is available.`
      );
    }
  }

  // Get detailed sandbox health if Docker is available
  if (status.dockerAvailable) {
    try {
      status.sandboxHealth = await checkSandboxHealth();
    } catch {
      // Ignore health check errors
    }
  }

  return status;
}

/**
 * Enforce security configuration
 * Call this at application startup to prevent insecure configurations
 */
export async function enforceSecurityConfig(): Promise<void> {
  const status = await validateSecurityConfig();

  // Log security status
  const execMode = getExecutionMode();
  const modeDesc = execMode === 'auto' ? 'auto (Docker preferred, local fallback with approval)'
    : execMode === 'local' ? 'local (direct execution with approval)'
    : 'docker (sandbox only)';

  const dockerInfo = `${status.dockerAvailable ? 'Yes' : 'No'}${execMode === 'docker' && !status.dockerAvailable ? ' (code execution DISABLED)' : ''}`;

  log.info(`Status: ${status.isSecure ? 'SECURE' : 'INSECURE'} | Env: ${isProduction() ? 'PRODUCTION' : 'DEVELOPMENT'} | Mode: ${modeDesc} | Docker: ${dockerInfo} | Home Access: ${status.homeAccessEnabled ? 'ENABLED' : 'Disabled'}`);

  for (const warning of status.warnings) {
    log.warn(warning);
  }

  for (const error of status.errors) {
    log.error(error);
  }

  // In production, throw error for critical security issues
  if (isProduction() && status.errors.length > 0) {
    throw new Error(
      'SECURITY: Application cannot start due to insecure configuration. ' +
      'Please fix the errors above.'
    );
  }
}

/**
 * Check if code execution is allowed.
 * With execution mode support:
 * - 'docker': only if Docker available
 * - 'local'/'auto': always allowed (local fallback with approval)
 */
export async function isCodeExecutionAllowed(): Promise<{
  allowed: boolean;
  sandboxed: boolean;
  reason: string;
}> {
  const dockerAvailable = await isDockerAvailable();
  const executionMode = getExecutionMode();

  if (dockerAvailable) {
    return {
      allowed: true,
      sandboxed: true,
      reason: 'Docker sandbox available',
    };
  }

  // Docker not available — check execution mode
  if (executionMode === 'local' || executionMode === 'auto') {
    return {
      allowed: true,
      sandboxed: false,
      reason: `Local execution available (mode: ${executionMode}, requires user approval)`,
    };
  }

  // Docker-only mode, Docker not available
  return {
    allowed: false,
    sandboxed: false,
    reason: 'Docker is required for code execution in docker mode. Install Docker or set EXECUTION_MODE=auto.',
  };
}

/**
 * Get the default security configuration
 */
export function getDefaultSecurityConfig(): SecurityConfig {
  return {
    requireDocker: isProduction(),
    allowHomeAccess: process.env.ALLOW_HOME_DIR_ACCESS === 'true',
    workspaceDir: process.env.WORKSPACE_DIR ?? process.cwd(),
    tempDirs: ['/tmp', 'C:\\Temp', process.env.TEMP ?? ''].filter(Boolean),
    blockDangerousCommands: true,
    executionMode: getExecutionMode(),
    requireLocalApproval: true,
  };
}

/**
 * Critical pattern for regex-based security blocking
 */
export interface CriticalPattern {
  readonly pattern: RegExp;
  readonly description: string;
}

/**
 * Critical patterns that are ALWAYS blocked regardless of permission settings.
 * Regex-based for robust matching (no simple substring bypass).
 */
export const CRITICAL_PATTERNS: readonly CriticalPattern[] = [
  // Filesystem destruction
  { pattern: /\brm\s+(-\w*r\w*\s+)?(-\w*f\w*\s+)?\/(\s|$|\*)/i, description: 'Recursive delete from root' },
  { pattern: /\brm\s+-\w*rf\w*\s+\//i, description: 'Force recursive delete' },
  { pattern: /\bmkfs\b/i, description: 'Filesystem format' },
  { pattern: /\bdd\s+if=\/dev\/(zero|random|urandom)/i, description: 'Raw disk overwrite' },
  // Fork bombs
  { pattern: /:\(\)\s*\{.*:\|:.*\}/s, description: 'Fork bomb (bash)' },
  // System control
  { pattern: /\b(shutdown|reboot|halt|poweroff)\s/i, description: 'System shutdown/reboot' },
  { pattern: /\binit\s+[06]\b/i, description: 'Init level change' },
  { pattern: /\bchmod\s+(-\w+\s+)?777\s+\//i, description: 'Recursive chmod 777 on root' },
  // Credential/sensitive access
  { pattern: />\s*\/etc\/(passwd|shadow)/i, description: 'System file overwrite' },
  // Windows destructive
  { pattern: /\bformat\s+[a-z]:/i, description: 'Drive format (Windows)' },
  { pattern: /\bdel\s+\/[fsq]+.*[a-z]:\\/i, description: 'Recursive force delete (Windows)' },
  { pattern: /\brd\s+\/s\s+\/q\s+[a-z]:\\/i, description: 'Directory tree delete (Windows)' },
  { pattern: /\breg\s+delete\s+HK(LM|CR)/i, description: 'Registry deletion' },
  // Remote code execution
  { pattern: /\b(curl|wget)\s+[^|]*\|\s*(ba)?sh\b/i, description: 'Remote code pipe to shell' },
  { pattern: /\/dev\/tcp\//i, description: 'Bash reverse shell' },
  { pattern: /\bnc\s+-\w*e\b/i, description: 'Netcat shell' },
];

/**
 * Check code against critical patterns (Layer 1 security).
 * These are ALWAYS blocked regardless of user permission settings.
 */
export function checkCriticalPatterns(code: string): { blocked: boolean; reason?: string } {
  for (const { pattern, description } of CRITICAL_PATTERNS) {
    if (pattern.test(code)) {
      return { blocked: true, reason: description };
    }
  }
  return { blocked: false };
}

/**
 * Check if a command is blocked for security.
 * Backward-compatible wrapper around checkCriticalPatterns().
 */
export function isCommandBlocked(command: string): boolean {
  return checkCriticalPatterns(command).blocked;
}

// Safe math expression evaluator (replaces new Function() usage)
export { evaluateMathExpression } from './safe-math.js';
