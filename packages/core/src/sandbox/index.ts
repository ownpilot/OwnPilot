/**
 * Sandbox module - Plugin isolation and execution
 *
 * Provides two sandbox implementations:
 * 1. SandboxExecutor - Fast, vm-based sandbox for trusted plugins
 * 2. WorkerSandbox - Worker-based sandbox for untrusted plugins with process isolation
 *
 * @module sandbox
 */

// Types
export type {
  ResourceLimits,
  SandboxPermissions,
  SandboxConfig,
  ExecutionContext,
  ExecutionResult,
  WorkerMessage,
  WorkerState,
  SandboxStats,
} from './types.js';

export {
  DEFAULT_RESOURCE_LIMITS,
  DEFAULT_PERMISSIONS,
} from './types.js';

// Context utilities
export {
  ResourceCounter,
  buildConsole,
  buildCrypto,
  buildTimers,
  buildSandboxContext,
  validateCode,
} from './context.js';

// Centralized code validation (single source of truth for dangerous patterns)
export {
  DANGEROUS_CODE_PATTERNS,
  MAX_TOOL_CODE_SIZE,
  validateToolCode,
  findFirstDangerousPattern,
  analyzeToolCode,
  calculateSecurityScore,
  type CodeValidationPattern,
  type CodeValidationResult,
  type SecurityScore,
  type SecurityScoreCategory,
} from './code-validator.js';

// VM-based sandbox (faster, less isolated)
export {
  SandboxExecutor,
  createSandbox,
  runInSandbox,
} from './executor.js';

// Worker-based sandbox (slower, more isolated)
export {
  WorkerSandbox,
  createWorkerSandbox,
} from './worker-sandbox.js';

// Docker-based sandbox (real isolation for untrusted code)
export {
  isDockerAvailable,
  ensureImage,
  executeInSandbox,
  executePythonSandbox,
  executeJavaScriptSandbox,
  executeShellSandbox,
  // Health check and diagnostics
  checkSandboxHealth,
  getSandboxStatus,
  resetSandboxCache,
  getDockerVersion,
  testSecurityFlags,
  type SandboxConfig as DockerSandboxConfig,
  type SandboxResult as DockerSandboxResult,
  type SandboxHealthStatus,
} from './docker.js';
