/**
 * Sandbox types for plugin isolation
 */

import type { PluginId } from '../types/branded.js';

/**
 * Resource limits for sandboxed execution
 */
export interface ResourceLimits {
  /** Maximum memory in bytes (default: 128MB) */
  maxMemory?: number;
  /** Maximum CPU time in milliseconds (default: 5000) */
  maxCpuTime?: number;
  /** Maximum execution time in milliseconds (default: 30000) */
  maxExecutionTime?: number;
  /** Maximum number of network requests (default: 10) */
  maxNetworkRequests?: number;
  /** Maximum file system operations (default: 100) */
  maxFsOperations?: number;
}

/**
 * Permissions for sandboxed code
 */
export interface SandboxPermissions {
  /** Allow network access */
  network?: boolean;
  /** Allowed network hosts (if network is true) */
  allowedHosts?: string[];
  /** Allow file system read */
  fsRead?: boolean;
  /** Allowed read paths (if fsRead is true) */
  allowedReadPaths?: string[];
  /** Allow file system write */
  fsWrite?: boolean;
  /** Allowed write paths (if fsWrite is true) */
  allowedWritePaths?: string[];
  /** Allow spawning child processes */
  spawn?: boolean;
  /** Allow environment variable access */
  env?: boolean;
  /** Allowed environment variables */
  allowedEnvVars?: string[];
  /** Allow timer functions (setTimeout, setInterval) */
  timers?: boolean;
  /** Allow crypto operations */
  crypto?: boolean;
}

/**
 * Default resource limits
 */
export const DEFAULT_RESOURCE_LIMITS: Required<ResourceLimits> = {
  maxMemory: 128 * 1024 * 1024, // 128MB
  maxCpuTime: 5000, // 5 seconds
  maxExecutionTime: 30000, // 30 seconds
  maxNetworkRequests: 10,
  maxFsOperations: 100,
};

/**
 * Default permissions (very restrictive)
 */
export const DEFAULT_PERMISSIONS: Required<SandboxPermissions> = {
  network: false,
  allowedHosts: [],
  fsRead: false,
  allowedReadPaths: [],
  fsWrite: false,
  allowedWritePaths: [],
  spawn: false,
  env: false,
  allowedEnvVars: [],
  timers: true,
  crypto: true,
};

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
  /** Plugin ID for logging/auditing */
  pluginId: PluginId;
  /** Resource limits */
  limits?: ResourceLimits;
  /** Permissions */
  permissions?: SandboxPermissions;
  /** Custom globals to inject */
  globals?: Record<string, unknown>;
  /** Enable debug mode (more verbose errors) */
  debug?: boolean;
}

/**
 * Execution context passed to sandboxed code
 */
export interface ExecutionContext {
  /** Plugin ID */
  pluginId: string;
  /** Current timestamp */
  timestamp: number;
  /** Execution ID */
  executionId: string;
  /** User-provided data */
  data?: unknown;
}

/**
 * Result of sandboxed execution
 */
export interface ExecutionResult<T = unknown> {
  /** Whether execution succeeded */
  success: boolean;
  /** Returned value (if success) */
  value?: T;
  /** Error message (if failed) */
  error?: string;
  /** Error stack trace (if debug mode) */
  stack?: string;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Memory used in bytes */
  memoryUsed?: number;
  /** Resource usage statistics */
  resourceUsage?: {
    networkRequests: number;
    fsOperations: number;
  };
}

/**
 * Message types for worker communication
 */
export type WorkerMessage =
  | { type: 'execute'; code: string; context: ExecutionContext }
  | { type: 'result'; result: ExecutionResult }
  | { type: 'error'; error: string; stack?: string }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string }
  | { type: 'resource'; action: string; allowed: boolean };

/**
 * Worker state
 */
export type WorkerState = 'idle' | 'running' | 'terminated' | 'error';

/**
 * Sandbox statistics
 */
export interface SandboxStats {
  /** Total executions */
  totalExecutions: number;
  /** Successful executions */
  successfulExecutions: number;
  /** Failed executions */
  failedExecutions: number;
  /** Total execution time */
  totalExecutionTime: number;
  /** Average execution time */
  averageExecutionTime: number;
  /** Terminated due to limits */
  terminatedCount: number;
}
