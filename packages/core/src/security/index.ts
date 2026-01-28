/**
 * Security Module
 *
 * Provides security validation and configuration for code execution.
 * CRITICAL: This module ensures code execution only happens in sandboxed environments.
 */

import { isDockerAvailable, checkSandboxHealth, type SandboxHealthStatus } from '../sandbox/docker.js';

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
  const status: SecurityStatus = {
    isSecure: true,
    dockerAvailable: false,
    dockerRequired: true, // Docker is ALWAYS required - no bypass possible
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

    if (!status.dockerAvailable) {
      status.warnings.push(
        'WARNING: Docker not available. Code execution tools will be DISABLED.'
      );
    }
  }

  // Docker is required in ALL environments for code execution
  if (!status.dockerAvailable) {
    status.errors.push(
      'Docker is not available. Code execution (execute_javascript, execute_python, execute_shell) will be disabled.'
    );
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
  console.log('\n' + '═'.repeat(60));
  console.log('🔒 SECURITY STATUS');
  console.log('═'.repeat(60));
  console.log(`Environment: ${isProduction() ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`Docker Available: ${status.dockerAvailable ? '✅ Yes (code execution enabled)' : '❌ No (code execution DISABLED)'}`);
  console.log(`Docker Required: ✅ Always (no bypass possible)`);
  console.log(`Home Access: ${status.homeAccessEnabled ? '⚠️ ENABLED' : '✅ Disabled'}`);
  console.log(`Overall Status: ${status.isSecure ? '✅ SECURE' : '❌ INSECURE'}`);

  // Print warnings
  for (const warning of status.warnings) {
    console.log(`\n⚠️  ${warning}`);
  }

  // Print errors and potentially exit in production
  for (const error of status.errors) {
    console.error(`\n❌ ${error}`);
  }

  console.log('═'.repeat(60) + '\n');

  // In production, throw error for critical security issues
  if (isProduction() && status.errors.length > 0) {
    throw new Error(
      'SECURITY: Application cannot start due to insecure configuration. ' +
      'Please fix the errors above.'
    );
  }
}

/**
 * Check if code execution is allowed
 * Returns true ONLY if Docker is available - no bypass is possible
 */
export async function isCodeExecutionAllowed(): Promise<{
  allowed: boolean;
  sandboxed: boolean;
  reason: string;
}> {
  const dockerAvailable = await isDockerAvailable();

  if (dockerAvailable) {
    return {
      allowed: true,
      sandboxed: true,
      reason: 'Docker sandbox available',
    };
  }

  // Docker is REQUIRED - no exceptions, no bypass
  return {
    allowed: false,
    sandboxed: false,
    reason: 'Docker is REQUIRED for code execution. Please install and start Docker.',
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
  };
}

/**
 * Blocked shell commands for security
 */
export const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=/dev',
  ':(){:|:&};:',
  'chmod -R 777 /',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init 0',
  'init 6',
  // Windows dangerous commands
  'format c:',
  'del /f /s /q c:\\',
  'rd /s /q c:\\',
];

/**
 * Check if a command is blocked for security
 */
export function isCommandBlocked(command: string): boolean {
  const lowerCommand = command.toLowerCase().trim();
  return BLOCKED_COMMANDS.some((blocked) =>
    lowerCommand.includes(blocked.toLowerCase())
  );
}
