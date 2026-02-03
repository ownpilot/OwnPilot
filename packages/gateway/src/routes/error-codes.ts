/**
 * Standardized Error Codes
 *
 * Centralized error code constants for consistent error handling across all routes.
 * Organized by category for better maintainability.
 */

// ============================================================================
// Generic Errors
// ============================================================================

export const ERROR_CODES = {
  // Not Found Errors (404)
  NOT_FOUND: 'NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  BACKUP_NOT_FOUND: 'BACKUP_NOT_FOUND',
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  UNKNOWN_PROVIDER: 'UNKNOWN_PROVIDER',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  NO_CHECKPOINT: 'NO_CHECKPOINT',
  NO_LEGACY_DATA: 'NO_LEGACY_DATA',

  // Validation Errors (400)
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_VALUE: 'INVALID_VALUE',
  INVALID_CRON: 'INVALID_CRON',
  INVALID_TABLES: 'INVALID_TABLES',
  INVALID_LEVEL: 'INVALID_LEVEL',
  INVALID_LANGUAGE: 'INVALID_LANGUAGE',
  INVALID_DECISION: 'INVALID_DECISION',
  INVALID_IMPORT_DATA: 'INVALID_IMPORT_DATA',
  MISSING_FILENAME: 'MISSING_FILENAME',

  // Access & Permission Errors (403)
  ACCESS_DENIED: 'ACCESS_DENIED',
  PROTECTED: 'PROTECTED',

  // Conflict Errors (409)
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  ALREADY_RUNNING: 'ALREADY_RUNNING',
  SESSION_ACTIVE: 'SESSION_ACTIVE',
  OPERATION_IN_PROGRESS: 'OPERATION_IN_PROGRESS',
  NOT_PAUSED: 'NOT_PAUSED',

  // Service Unavailable (503)
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Generic Operation Failures (500)
  ERROR: 'ERROR',
  EXECUTION_ERROR: 'EXECUTION_ERROR',

  // ============================================================================
  // Database & Connection Errors
  // ============================================================================

  POSTGRES_NOT_CONNECTED: 'POSTGRES_NOT_CONNECTED',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  DISCONNECT_FAILED: 'DISCONNECT_FAILED',

  // ============================================================================
  // Workspace Errors
  // ============================================================================

  WORKSPACE_ERROR: 'WORKSPACE_ERROR',
  WORKSPACE_CREATE_ERROR: 'WORKSPACE_CREATE_ERROR',
  WORKSPACE_UPDATE_ERROR: 'WORKSPACE_UPDATE_ERROR',
  WORKSPACE_DELETE_ERROR: 'WORKSPACE_DELETE_ERROR',
  WORKSPACE_FETCH_ERROR: 'WORKSPACE_FETCH_ERROR',
  WORKSPACE_LIST_ERROR: 'WORKSPACE_LIST_ERROR',
  WORKSPACE_LIMIT_EXCEEDED: 'WORKSPACE_LIMIT_EXCEEDED',
  WORKSPACE_EMPTY: 'WORKSPACE_EMPTY',

  // ============================================================================
  // Container & Sandbox Errors
  // ============================================================================

  CONTAINER_START_ERROR: 'CONTAINER_START_ERROR',
  CONTAINER_STOP_ERROR: 'CONTAINER_STOP_ERROR',
  CONTAINER_STATUS_ERROR: 'CONTAINER_STATUS_ERROR',
  CONTAINER_LOGS_ERROR: 'CONTAINER_LOGS_ERROR',
  SANDBOX_SETTINGS_ERROR: 'SANDBOX_SETTINGS_ERROR',
  SANDBOX_ENABLE_ERROR: 'SANDBOX_ENABLE_ERROR',
  SANDBOX_DISABLE_ERROR: 'SANDBOX_DISABLE_ERROR',
  SANDBOX_CHECK_FAILED: 'SANDBOX_CHECK_FAILED',
  DOCKER_UNAVAILABLE: 'DOCKER_UNAVAILABLE',

  // ============================================================================
  // File Operations
  // ============================================================================

  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',
  FILE_DELETE_ERROR: 'FILE_DELETE_ERROR',
  FILE_LIST_ERROR: 'FILE_LIST_ERROR',
  DOWNLOAD_ERROR: 'DOWNLOAD_ERROR',

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  CREATE_FAILED: 'CREATE_FAILED',
  UPDATE_FAILED: 'UPDATE_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  FETCH_FAILED: 'FETCH_FAILED',
  FETCH_ERROR: 'FETCH_ERROR',
  LIST_FAILED: 'LIST_FAILED',
  ADD_FAILED: 'ADD_FAILED',
  ADD_STEP_ERROR: 'ADD_STEP_ERROR',
  SEND_FAILED: 'SEND_FAILED',
  TOGGLE_FAILED: 'TOGGLE_FAILED',

  // ============================================================================
  // Search & Query Errors
  // ============================================================================

  SEARCH_ERROR: 'SEARCH_ERROR',
  SEARCH_FAILED: 'SEARCH_FAILED',
  AUDIT_QUERY_ERROR: 'AUDIT_QUERY_ERROR',

  // ============================================================================
  // Import/Export Errors
  // ============================================================================

  IMPORT_ERROR: 'IMPORT_ERROR',
  IMPORT_FAILED: 'IMPORT_FAILED',
  EXPORT_ERROR: 'EXPORT_ERROR',
  EXPORT_FAILED: 'EXPORT_FAILED',
  EXPORT_SAVE_FAILED: 'EXPORT_SAVE_FAILED',

  // ============================================================================
  // Profile & User Data
  // ============================================================================

  PROFILE_FETCH_ERROR: 'PROFILE_FETCH_ERROR',
  SUMMARY_FETCH_ERROR: 'SUMMARY_FETCH_ERROR',
  CATEGORY_FETCH_ERROR: 'CATEGORY_FETCH_ERROR',
  DATA_SET_ERROR: 'DATA_SET_ERROR',
  DATA_DELETE_ERROR: 'DATA_DELETE_ERROR',
  QUICK_SETUP_ERROR: 'QUICK_SETUP_ERROR',

  // ============================================================================
  // Stats & Analytics
  // ============================================================================

  STATS_ERROR: 'STATS_ERROR',
  STATS_FAILED: 'STATS_FAILED',
  DATA_AGGREGATION_FAILED: 'DATA_AGGREGATION_FAILED',
  ESTIMATION_FAILED: 'ESTIMATION_FAILED',

  // ============================================================================
  // Sync & Migration
  // ============================================================================

  SYNC_ERROR: 'SYNC_ERROR',
  MIGRATION_FAILED: 'MIGRATION_FAILED',
  REFRESH_FAILED: 'REFRESH_FAILED',

  // ============================================================================
  // Execution & Recording
  // ============================================================================

  EXECUTIONS_LIST_ERROR: 'EXECUTIONS_LIST_ERROR',
  RECORD_FAILED: 'RECORD_FAILED',
  RESUME_ERROR: 'RESUME_ERROR',
  ROLLBACK_ERROR: 'ROLLBACK_ERROR',
  CLEANUP_ERROR: 'CLEANUP_ERROR',

  // ============================================================================
  // Workflow & Automation
  // ============================================================================

  APPROVAL_ERROR: 'APPROVAL_ERROR',
  TIMELINE_FAILED: 'TIMELINE_FAILED',
  BRIEFING_FAILED: 'BRIEFING_FAILED',
  BUDGET_FAILED: 'BUDGET_FAILED',

  // ============================================================================
  // System & Status
  // ============================================================================

  SYSTEM_STATUS_ERROR: 'SYSTEM_STATUS_ERROR',
} as const;

// Type for error codes
export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

// Helper function to check if a string is a valid error code
export function isValidErrorCode(code: string): code is ErrorCode {
  return Object.values(ERROR_CODES).includes(code as ErrorCode);
}
