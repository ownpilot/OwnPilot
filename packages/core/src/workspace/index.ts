/**
 * User Workspace Isolation Module
 *
 * Provides isolated execution environments for users with:
 * - Per-user Docker containers
 * - Isolated file storage
 * - Security controls and resource limits
 */

// Types - export with explicit names to avoid conflicts
export type {
  NetworkPolicy,
  ContainerStatus,
  WorkspaceStatus,
  ExecutionStatus,
  ExecutionLanguage,
  ContainerConfig,
  UserWorkspace,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  UserContainer,
  ExecuteCodeRequest,
  CodeExecution,
  ResourceUsage,
  StorageUsage,
  FileInfo,
  WorkspaceAuditEntry,
  SandboxSettings,
} from './types.js';

export {
  DEFAULT_CONTAINER_CONFIG,
  DEFAULT_SANDBOX_SETTINGS,
} from './types.js';

// Rename ExecutionResult to avoid conflict with sandbox module
export type { ExecutionResult as WorkspaceExecutionResult } from './types.js';

// Container orchestration
export {
  UserContainerOrchestrator,
  getOrchestrator,
  getImageForLanguage,
} from './orchestrator.js';

// Re-export Docker availability check from orchestrator with different name
export {
  isDockerAvailable as isWorkspaceDockerAvailable,
  ensureImage as ensureWorkspaceImage,
} from './orchestrator.js';

// Isolated storage - renamed to avoid conflict with plugins module
export {
  IsolatedStorage as WorkspaceStorage,
  StorageSecurityError,
  getStorage as getWorkspaceStorage,
  initializeStorage as initializeWorkspaceStorage,
} from './storage.js';
