/**
 * Tool Permission System
 *
 * Provides fine-grained access control for tool execution:
 * - Permission levels (read, write, execute, admin)
 * - Tool category mappings
 * - User/context-based permission checks
 * - Configurable permission policies
 */

import type { ToolContext } from './types.js';
import { getLog } from '../services/get-log.js';

const log = getLog('Permission');

// =============================================================================
// Permission Types
// =============================================================================

/**
 * Permission levels in ascending order of privilege
 */
export type PermissionLevel = 'none' | 'read' | 'write' | 'execute' | 'admin';

/**
 * Tool category for permission grouping
 */
export type ToolCategory =
  | 'file_read' // Read files
  | 'file_write' // Write/create files
  | 'file_delete' // Delete files/directories
  | 'code_execute' // Execute code (JS, Python, Shell)
  | 'network_read' // HTTP GET, fetch pages
  | 'network_write' // HTTP POST/PUT/DELETE
  | 'system' // System commands, package managers
  | 'memory' // Memory/conversation management
  | 'custom'; // Custom/plugin tools

/**
 * Permission configuration for a tool
 */
export interface ToolPermissionConfig {
  /** Required permission level */
  readonly level: PermissionLevel;
  /** Tool category */
  readonly category: ToolCategory;
  /** Requires explicit user confirmation */
  readonly requiresConfirmation?: boolean;
  /** List of allowed paths (for file tools) */
  readonly allowedPaths?: readonly string[];
  /** List of allowed hosts (for network tools) */
  readonly allowedHosts?: readonly string[];
  /** Rate limit (calls per minute) */
  readonly rateLimit?: number;
  /** Description of what this permission allows */
  readonly description?: string;
}

/**
 * User permission configuration
 */
export interface UserPermissions {
  /** User ID */
  readonly userId: string;
  /** Maximum permission level */
  readonly maxLevel: PermissionLevel;
  /** Allowed tool categories */
  readonly allowedCategories: readonly ToolCategory[];
  /** Explicitly allowed tools (overrides category restrictions) */
  readonly allowedTools?: readonly string[];
  /** Explicitly denied tools (overrides everything) */
  readonly deniedTools?: readonly string[];
  /** Allowed file paths */
  readonly allowedPaths?: readonly string[];
  /** Allowed network hosts */
  readonly allowedHosts?: readonly string[];
  /** Whether user requires confirmation for destructive actions */
  readonly requireConfirmation?: boolean;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  /** Whether access is allowed */
  readonly allowed: boolean;
  /** Reason for denial (if denied) */
  readonly reason?: string;
  /** Whether confirmation is required */
  readonly requiresConfirmation?: boolean;
  /** Additional context */
  readonly context?: Record<string, unknown>;
}

/**
 * Permission policy configuration
 */
export interface PermissionPolicy {
  /** Default permission level for unauthenticated users */
  readonly defaultLevel: PermissionLevel;
  /** Default allowed categories */
  readonly defaultCategories: readonly ToolCategory[];
  /** Global rate limit (calls per minute) */
  readonly globalRateLimit?: number;
  /** Whether to log all permission checks */
  readonly auditLog?: boolean;
  /** Tool-specific configurations */
  readonly tools: Record<string, ToolPermissionConfig>;
  /** User-specific overrides */
  readonly users?: Record<string, UserPermissions>;
}

// =============================================================================
// Default Configurations
// =============================================================================

/**
 * Default tool permission mappings
 */
export const DEFAULT_TOOL_PERMISSIONS: Record<string, ToolPermissionConfig> = {
  // File System - Read
  read_file: {
    level: 'read',
    category: 'file_read',
    description: 'Read file contents',
  },
  list_directory: {
    level: 'read',
    category: 'file_read',
    description: 'List directory contents',
  },
  search_files: {
    level: 'read',
    category: 'file_read',
    description: 'Search for text in files',
  },
  get_file_info: {
    level: 'read',
    category: 'file_read',
    description: 'Get file metadata',
  },

  // File System - Write
  write_file: {
    level: 'write',
    category: 'file_write',
    requiresConfirmation: true,
    description: 'Create or modify files',
  },
  download_file: {
    level: 'write',
    category: 'file_write',
    description: 'Download file from URL',
  },
  copy_file: {
    level: 'write',
    category: 'file_write',
    description: 'Copy or move files',
  },

  // File System - Delete
  delete_file: {
    level: 'write',
    category: 'file_delete',
    requiresConfirmation: true,
    description: 'Delete files or directories',
  },

  // Code Execution
  execute_javascript: {
    level: 'execute',
    category: 'code_execute',
    requiresConfirmation: true,
    rateLimit: 10,
    description: 'Execute JavaScript code',
  },
  execute_python: {
    level: 'execute',
    category: 'code_execute',
    requiresConfirmation: true,
    rateLimit: 10,
    description: 'Execute Python code',
  },
  execute_shell: {
    level: 'admin',
    category: 'code_execute',
    requiresConfirmation: true,
    rateLimit: 5,
    description: 'Execute shell commands',
  },
  compile_code: {
    level: 'execute',
    category: 'code_execute',
    rateLimit: 5,
    description: 'Compile source code',
  },
  package_manager: {
    level: 'admin',
    category: 'system',
    requiresConfirmation: true,
    rateLimit: 3,
    description: 'Run package manager commands',
  },

  // Network - Read
  http_request: {
    level: 'read',
    category: 'network_read',
    description: 'Make HTTP requests',
  },
  fetch_web_page: {
    level: 'read',
    category: 'network_read',
    description: 'Fetch and parse web pages',
  },
  search_web: {
    level: 'read',
    category: 'network_read',
    rateLimit: 20,
    description: 'Search the web',
  },
  call_json_api: {
    level: 'read',
    category: 'network_read',
    description: 'Call JSON APIs',
  },

  // Memory
  memory_store: {
    level: 'write',
    category: 'memory',
    description: 'Store information in memory',
  },
  memory_recall: {
    level: 'read',
    category: 'memory',
    description: 'Recall stored information',
  },
};

/**
 * Default permission policy
 */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  defaultLevel: 'read',
  defaultCategories: ['file_read', 'network_read', 'memory'],
  globalRateLimit: 60,
  auditLog: true,
  tools: DEFAULT_TOOL_PERMISSIONS,
};

// =============================================================================
// Permission Level Utilities
// =============================================================================

/**
 * Permission level hierarchy (higher index = higher privilege)
 */
const PERMISSION_HIERARCHY: readonly PermissionLevel[] = [
  'none',
  'read',
  'write',
  'execute',
  'admin',
];

/**
 * Check if a permission level meets the required level
 */
export function hasPermissionLevel(
  userLevel: PermissionLevel,
  requiredLevel: PermissionLevel
): boolean {
  const userIndex = PERMISSION_HIERARCHY.indexOf(userLevel);
  const requiredIndex = PERMISSION_HIERARCHY.indexOf(requiredLevel);
  return userIndex >= requiredIndex;
}

/**
 * Get the highest permission level from a list
 */
export function getHighestPermissionLevel(levels: readonly PermissionLevel[]): PermissionLevel {
  let highest: PermissionLevel = 'none';
  for (const level of levels) {
    if (PERMISSION_HIERARCHY.indexOf(level) > PERMISSION_HIERARCHY.indexOf(highest)) {
      highest = level;
    }
  }
  return highest;
}

// =============================================================================
// Permission Checker
// =============================================================================

/**
 * Permission checker class
 */
export class PermissionChecker {
  private readonly policy: PermissionPolicy;
  private readonly rateLimitCounters: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(policy: PermissionPolicy = DEFAULT_PERMISSION_POLICY) {
    this.policy = policy;
  }

  /**
   * Check if a tool call is allowed
   */
  check(
    toolName: string,
    context: ToolContext,
    args?: Record<string, unknown>
  ): PermissionCheckResult {
    // Get tool configuration
    const toolConfig = this.policy.tools[toolName];
    if (!toolConfig) {
      // Unknown tool - use default restrictive policy
      return {
        allowed: false,
        reason: `Unknown tool: ${toolName}`,
      };
    }

    // Get user permissions
    const userPermissions = this.getUserPermissions(context.userId);

    // Check if tool is explicitly denied
    if (userPermissions.deniedTools?.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is explicitly denied for user`,
      };
    }

    // Check if tool is explicitly allowed (bypass other checks)
    const explicitlyAllowed = userPermissions.allowedTools?.includes(toolName);

    if (!explicitlyAllowed) {
      // Check permission level
      if (!hasPermissionLevel(userPermissions.maxLevel, toolConfig.level)) {
        return {
          allowed: false,
          reason: `Insufficient permission level. Required: ${toolConfig.level}, User: ${userPermissions.maxLevel}`,
        };
      }

      // Check category
      if (!userPermissions.allowedCategories.includes(toolConfig.category)) {
        return {
          allowed: false,
          reason: `Tool category "${toolConfig.category}" is not allowed for user`,
        };
      }
    }

    // Check path restrictions (for file tools)
    if (args && args.path && toolConfig.category.startsWith('file_')) {
      const pathAllowed = this.checkPathAllowed(
        args.path as string,
        userPermissions.allowedPaths ?? toolConfig.allowedPaths
      );
      if (!pathAllowed) {
        return {
          allowed: false,
          reason: `Path "${args.path}" is not allowed`,
        };
      }
    }

    // Check host restrictions (for network tools)
    if (args && (args.url || args.host) && toolConfig.category.startsWith('network_')) {
      const url = (args.url as string) ?? `https://${args.host}`;
      const hostAllowed = this.checkHostAllowed(
        url,
        userPermissions.allowedHosts ?? toolConfig.allowedHosts
      );
      if (!hostAllowed) {
        return {
          allowed: false,
          reason: `Host is not in the allowed list`,
        };
      }
    }

    // Check rate limit
    const rateLimit = toolConfig.rateLimit ?? this.policy.globalRateLimit;
    if (rateLimit) {
      const rateLimitResult = this.checkRateLimit(
        `${context.userId ?? 'anonymous'}:${toolName}`,
        rateLimit
      );
      if (!rateLimitResult.allowed) {
        return rateLimitResult;
      }
    }

    // Determine if confirmation is required
    const requiresConfirmation =
      (toolConfig.requiresConfirmation || userPermissions.requireConfirmation) &&
      !explicitlyAllowed;

    return {
      allowed: true,
      requiresConfirmation,
      context: {
        toolConfig,
        userLevel: userPermissions.maxLevel,
      },
    };
  }

  /**
   * Get permissions for a user
   */
  private getUserPermissions(userId?: string): UserPermissions {
    if (userId && this.policy.users?.[userId]) {
      return this.policy.users[userId];
    }

    // Return default permissions
    return {
      userId: userId ?? 'anonymous',
      maxLevel: this.policy.defaultLevel,
      allowedCategories: [...this.policy.defaultCategories],
    };
  }

  /**
   * Check if a path is allowed
   */
  private checkPathAllowed(filePath: string, allowedPaths?: readonly string[]): boolean {
    // If no restrictions, allow all
    if (!allowedPaths || allowedPaths.length === 0) {
      return true;
    }

    // Normalize path
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();

    return allowedPaths.some((allowed) => {
      const normalizedAllowed = allowed.replace(/\\/g, '/').toLowerCase();
      // Allow if path starts with allowed path
      return normalizedPath.startsWith(normalizedAllowed);
    });
  }

  /**
   * Check if a host is allowed
   */
  private checkHostAllowed(urlString: string, allowedHosts?: readonly string[]): boolean {
    // If no restrictions, allow all
    if (!allowedHosts || allowedHosts.length === 0) {
      return true;
    }

    try {
      const url = new URL(urlString);
      const host = url.hostname.toLowerCase();

      return allowedHosts.some((allowed) => {
        const normalizedAllowed = allowed.toLowerCase();
        // Allow exact match or subdomain match
        return host === normalizedAllowed || host.endsWith(`.${normalizedAllowed}`);
      });
    } catch {
      // Invalid URL
      return false;
    }
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(key: string, limit: number): PermissionCheckResult {
    const now = Date.now();
    const counter = this.rateLimitCounters.get(key);

    if (!counter || counter.resetAt < now) {
      // Reset counter
      this.rateLimitCounters.set(key, {
        count: 1,
        resetAt: now + 60000, // 1 minute window
      });
      return { allowed: true };
    }

    if (counter.count >= limit) {
      return {
        allowed: false,
        reason: `Rate limit exceeded. Max ${limit} calls per minute`,
        context: {
          limit,
          current: counter.count,
          resetsIn: Math.ceil((counter.resetAt - now) / 1000),
        },
      };
    }

    counter.count++;
    return { allowed: true };
  }

  /**
   * Record a tool usage for audit
   */
  recordUsage(
    toolName: string,
    context: ToolContext,
    result: PermissionCheckResult,
    args?: Record<string, unknown>
  ): void {
    if (!this.policy.auditLog) {
      return;
    }

    // In production, this would write to a log file or database
    const logEntry = {
      timestamp: new Date().toISOString(),
      toolName,
      userId: context.userId ?? 'anonymous',
      conversationId: context.conversationId,
      allowed: result.allowed,
      reason: result.reason,
      args: this.sanitizeArgs(args),
    };

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      log.debug('Audit:', logEntry);
    }
  }

  /**
   * Sanitize arguments for logging (remove sensitive data)
   */
  private sanitizeArgs(args?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!args) return undefined;

    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'apiKey', 'credentials'];

    for (const [key, value] of Object.entries(args)) {
      if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 100) {
        sanitized[key] = `${value.slice(0, 100)}... (truncated)`;
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Get tool permission configuration
   */
  getToolConfig(toolName: string): ToolPermissionConfig | undefined {
    return this.policy.tools[toolName];
  }

  /**
   * Update policy (for runtime configuration changes)
   */
  updatePolicy(updates: Partial<PermissionPolicy>): PermissionPolicy {
    Object.assign(this.policy, updates);
    return this.policy;
  }

  /**
   * Add user permissions
   */
  addUserPermissions(userId: string, permissions: Omit<UserPermissions, 'userId'>): void {
    if (!this.policy.users) {
      (this.policy as { users: Record<string, UserPermissions> }).users = {};
    }
    (this.policy.users as Record<string, UserPermissions>)[userId] = {
      ...permissions,
      userId,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new permission checker with default policy
 */
export function createPermissionChecker(policy: Partial<PermissionPolicy> = {}): PermissionChecker {
  const mergedPolicy: PermissionPolicy = {
    ...DEFAULT_PERMISSION_POLICY,
    ...policy,
    tools: {
      ...DEFAULT_TOOL_PERMISSIONS,
      ...policy.tools,
    },
  };

  return new PermissionChecker(mergedPolicy);
}

/**
 * Create a restrictive permission checker (read-only by default)
 */
export function createRestrictiveChecker(): PermissionChecker {
  return new PermissionChecker({
    ...DEFAULT_PERMISSION_POLICY,
    defaultLevel: 'read',
    defaultCategories: ['file_read', 'memory'],
  });
}

/**
 * Create a permissive permission checker (for trusted users)
 */
export function createPermissiveChecker(): PermissionChecker {
  return new PermissionChecker({
    ...DEFAULT_PERMISSION_POLICY,
    defaultLevel: 'admin',
    defaultCategories: [
      'file_read',
      'file_write',
      'file_delete',
      'code_execute',
      'network_read',
      'network_write',
      'system',
      'memory',
      'custom',
    ],
  });
}

// =============================================================================
// Middleware Helper
// =============================================================================

/**
 * Create a permission-checking wrapper for tool executors
 */
export function withPermissionCheck<T extends (...args: unknown[]) => Promise<unknown>>(
  toolName: string,
  executor: T,
  checker: PermissionChecker
): T {
  return (async (args: Record<string, unknown>, context: ToolContext) => {
    const result = checker.check(toolName, context, args);
    checker.recordUsage(toolName, context, result, args);

    if (!result.allowed) {
      return {
        content: `Permission denied: ${result.reason}`,
        isError: true,
        metadata: { permissionDenied: true },
      };
    }

    if (result.requiresConfirmation) {
      // In a real implementation, this would trigger a confirmation flow
      // For now, we'll log and proceed
      log.info(`Tool "${toolName}" requires confirmation`);
    }

    return executor(args, context);
  }) as T;
}
