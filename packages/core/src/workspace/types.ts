/**
 * User Workspace Isolation Types
 *
 * Types for per-user isolated workspaces with Docker container execution.
 */

/**
 * Network policy for user containers
 */
export type NetworkPolicy = 'none' | 'restricted' | 'egress' | 'full';

/**
 * Container status
 */
export type ContainerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/**
 * Workspace status
 */
export type WorkspaceStatus = 'active' | 'suspended' | 'deleted';

/**
 * Execution status
 */
export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled';

/**
 * Supported execution languages
 */
export type ExecutionLanguage = 'python' | 'javascript' | 'shell';

/**
 * Container configuration
 */
export interface ContainerConfig {
  /** Memory limit in MB (default: 512) */
  memoryMB: number;
  /** CPU cores limit (default: 0.5) */
  cpuCores: number;
  /** Storage limit in GB (default: 2) */
  storageGB: number;
  /** Execution timeout in ms (default: 30000) */
  timeoutMs: number;
  /** Network policy (default: 'none') */
  networkPolicy: NetworkPolicy;
  /** Allowed hosts for 'restricted' network policy */
  allowedHosts?: string[];
  /** Custom Docker image (optional) */
  image?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Default container configuration
 */
export const DEFAULT_CONTAINER_CONFIG: ContainerConfig = {
  memoryMB: 512,
  cpuCores: 0.5,
  storageGB: 2,
  timeoutMs: 30000,
  networkPolicy: 'none',
};

/**
 * User workspace
 */
export interface UserWorkspace {
  /** Unique workspace ID */
  id: string;
  /** Owner user ID */
  userId: string;
  /** Workspace name */
  name: string;
  /** Optional description */
  description?: string;
  /** Workspace status */
  status: WorkspaceStatus;
  /** Path to workspace storage */
  storagePath: string;
  /** Container configuration */
  containerConfig: ContainerConfig;
  /** Current container ID (if running) */
  containerId?: string;
  /** Current container status */
  containerStatus: ContainerStatus;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Last activity timestamp */
  lastActivityAt?: Date;
}

/**
 * Create workspace request
 */
export interface CreateWorkspaceRequest {
  /** Workspace name */
  name: string;
  /** Optional description */
  description?: string;
  /** Template to use (optional) */
  template?: 'blank' | 'python' | 'node' | 'web';
  /** Custom container config (optional) */
  containerConfig?: Partial<ContainerConfig>;
}

/**
 * Update workspace request
 */
export interface UpdateWorkspaceRequest {
  /** New name (optional) */
  name?: string;
  /** New description (optional) */
  description?: string;
  /** Updated container config (optional) */
  containerConfig?: Partial<ContainerConfig>;
}

/**
 * User container info
 */
export interface UserContainer {
  /** Internal ID */
  id: string;
  /** Associated workspace ID */
  workspaceId: string;
  /** Owner user ID */
  userId: string;
  /** Docker container ID */
  containerId: string;
  /** Docker image used */
  image: string;
  /** Container status */
  status: ContainerStatus;
  /** Resource allocation */
  memoryMB: number;
  cpuCores: number;
  networkPolicy: NetworkPolicy;
  /** Started timestamp */
  startedAt: Date;
  /** Last activity timestamp */
  lastActivityAt?: Date;
  /** Stopped timestamp (if stopped) */
  stoppedAt?: Date;
}

/**
 * Code execution request
 */
export interface ExecuteCodeRequest {
  /** Programming language */
  language: ExecutionLanguage;
  /** Code to execute */
  code: string;
  /** Execution timeout in ms (optional, uses container default) */
  timeout?: number;
  /** Environment variables (optional) */
  env?: Record<string, string>;
  /** Working directory (optional, defaults to /workspace) */
  workingDir?: string;
  /** Files to create before execution (optional) */
  files?: Array<{ path: string; content: string }>;
}

/**
 * Code execution record
 */
export interface CodeExecution {
  /** Execution ID */
  id: string;
  /** Workspace ID */
  workspaceId: string;
  /** User ID */
  userId: string;
  /** Container ID used (if any) */
  containerId?: string;
  /** Programming language */
  language: ExecutionLanguage;
  /** Code hash (SHA256) */
  codeHash: string;
  /** Execution status */
  status: ExecutionStatus;
  /** Standard output */
  stdout?: string;
  /** Standard error */
  stderr?: string;
  /** Exit code */
  exitCode?: number;
  /** Error message (if failed) */
  error?: string;
  /** Execution time in ms */
  executionTimeMs?: number;
  /** Memory used in MB */
  memoryUsedMB?: number;
  /** Created timestamp */
  createdAt: Date;
  /** Started timestamp */
  startedAt?: Date;
  /** Completed timestamp */
  completedAt?: Date;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  /** Execution ID */
  executionId: string;
  /** Status */
  status: ExecutionStatus;
  /** Standard output */
  stdout?: string;
  /** Standard error */
  stderr?: string;
  /** Exit code */
  exitCode?: number;
  /** Error message */
  error?: string;
  /** Execution time in ms */
  executionTimeMs?: number;
}

/**
 * Resource usage stats
 */
export interface ResourceUsage {
  /** Memory used in MB */
  memoryMB: number;
  /** Memory limit in MB */
  memoryLimitMB: number;
  /** CPU usage percentage */
  cpuPercent: number;
  /** Storage used in MB */
  storageMB: number;
  /** Storage limit in MB */
  storageLimitMB: number;
  /** Network bytes received */
  networkBytesIn: number;
  /** Network bytes sent */
  networkBytesOut: number;
}

/**
 * Storage usage
 */
export interface StorageUsage {
  /** Used storage in bytes */
  usedBytes: number;
  /** Storage quota in bytes */
  quotaBytes: number;
  /** Number of files */
  fileCount: number;
}

/**
 * File info
 */
export interface FileInfo {
  /** File name */
  name: string;
  /** Relative path */
  path: string;
  /** File size in bytes */
  size: number;
  /** Is directory */
  isDirectory: boolean;
  /** Last modified timestamp */
  modifiedAt: Date;
  /** Created timestamp */
  createdAt: Date;
}

/**
 * Workspace audit log entry
 */
export interface WorkspaceAuditEntry {
  /** Entry ID */
  id: string;
  /** User ID */
  userId: string;
  /** Workspace ID (optional) */
  workspaceId?: string;
  /** Action performed */
  action: 'create' | 'read' | 'write' | 'delete' | 'execute' | 'start' | 'stop';
  /** Resource type */
  resourceType: 'workspace' | 'file' | 'container' | 'execution';
  /** Resource path or ID */
  resource?: string;
  /** Was successful */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
  /** Client IP address */
  ipAddress?: string;
  /** User agent */
  userAgent?: string;
  /** Timestamp */
  createdAt: Date;
}

/**
 * Sandbox settings (stored in settings table)
 */
export interface SandboxSettings {
  /** Enable sandbox system */
  enabled: boolean;
  /** Base path for workspaces */
  basePath: string;
  /** Default container memory in MB */
  defaultMemoryMB: number;
  /** Default CPU cores */
  defaultCpuCores: number;
  /** Default execution timeout in ms */
  defaultTimeoutMs: number;
  /** Default network policy */
  defaultNetwork: NetworkPolicy;
  /** Max workspaces per user */
  maxWorkspacesPerUser: number;
  /** Max storage per user in GB */
  maxStoragePerUserGB: number;
  /** Allowed Docker images */
  allowedImages: string[];
  /** Default Python image */
  pythonImage: string;
  /** Default Node.js image */
  nodeImage: string;
  /** Default shell image */
  shellImage: string;
}

/**
 * Default sandbox settings
 */
export const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = {
  enabled: false,
  basePath: '/data/workspaces',
  defaultMemoryMB: 512,
  defaultCpuCores: 0.5,
  defaultTimeoutMs: 30000,
  defaultNetwork: 'none',
  maxWorkspacesPerUser: 5,
  maxStoragePerUserGB: 2,
  allowedImages: ['python:3.11-slim', 'node:20-slim', 'alpine:latest'],
  pythonImage: 'python:3.11-slim',
  nodeImage: 'node:20-slim',
  shellImage: 'alpine:latest',
};
