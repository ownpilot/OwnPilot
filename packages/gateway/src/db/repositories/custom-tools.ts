/**
 * Custom Tools Repository
 *
 * Stores LLM-created and user-defined tools
 * Supports enable/disable, permissions, and approval workflows
 */

import { getDatabase } from '../connection.js';
import { randomUUID } from 'node:crypto';

// =============================================================================
// TYPES
// =============================================================================

export type ToolPermission =
  | 'network'      // HTTP requests
  | 'filesystem'   // File read/write
  | 'database'     // Custom data access
  | 'shell'        // Shell command execution
  | 'email'        // Send emails
  | 'scheduling';  // Create scheduled tasks

export type ToolStatus = 'active' | 'disabled' | 'pending_approval' | 'rejected';

export interface CustomToolRecord {
  id: string;
  userId: string;
  name: string;
  description: string;
  /** JSON Schema for parameters */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** JavaScript code to execute */
  code: string;
  /** Tool category for UI grouping */
  category?: string;
  /** Current status */
  status: ToolStatus;
  /** Required permissions */
  permissions: ToolPermission[];
  /** Whether execution requires user approval */
  requiresApproval: boolean;
  /** Who created this tool */
  createdBy: 'user' | 'llm';
  /** Version number (incremented on updates) */
  version: number;
  /** Usage statistics */
  usageCount: number;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  /** Optional metadata (tags, notes, etc.) */
  metadata?: Record<string, unknown>;
}

interface CustomToolRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  parameters: string;
  code: string;
  category: string | null;
  status: string;
  permissions: string;
  requires_approval: number;
  created_by: string;
  version: number;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: string | null;
}

// =============================================================================
// HELPERS
// =============================================================================

function rowToRecord(row: CustomToolRow): CustomToolRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    parameters: JSON.parse(row.parameters),
    code: row.code,
    category: row.category ?? undefined,
    status: row.status as ToolStatus,
    permissions: JSON.parse(row.permissions),
    requiresApproval: row.requires_approval === 1,
    createdBy: row.created_by as 'user' | 'llm',
    version: row.version,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class CustomToolsRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId: string = 'default') {
    this.userId = userId;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS custom_tools (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        parameters TEXT NOT NULL,
        code TEXT NOT NULL,
        category TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        permissions TEXT NOT NULL DEFAULT '[]',
        requires_approval INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT 'user',
        version INTEGER NOT NULL DEFAULT 1,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT,
        UNIQUE(user_id, name)
      );

      CREATE INDEX IF NOT EXISTS idx_custom_tools_user ON custom_tools(user_id);
      CREATE INDEX IF NOT EXISTS idx_custom_tools_status ON custom_tools(status);
      CREATE INDEX IF NOT EXISTS idx_custom_tools_category ON custom_tools(category);
    `);
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Create a new custom tool
   */
  create(input: {
    name: string;
    description: string;
    parameters: CustomToolRecord['parameters'];
    code: string;
    category?: string;
    permissions?: ToolPermission[];
    requiresApproval?: boolean;
    createdBy?: 'user' | 'llm';
    metadata?: Record<string, unknown>;
  }): CustomToolRecord {
    const id = `tool_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    // Tools created by LLM start as pending_approval if they need dangerous permissions
    const dangerousPermissions: ToolPermission[] = ['shell', 'filesystem', 'email'];
    const hasDangerous = input.permissions?.some((p) => dangerousPermissions.includes(p));
    const status: ToolStatus =
      input.createdBy === 'llm' && hasDangerous ? 'pending_approval' : 'active';

    const stmt = this.db.prepare(`
      INSERT INTO custom_tools (
        id, user_id, name, description, parameters, code, category,
        status, permissions, requires_approval, created_by, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.userId,
      input.name,
      input.description,
      JSON.stringify(input.parameters),
      input.code,
      input.category ?? null,
      status,
      JSON.stringify(input.permissions ?? []),
      input.requiresApproval ? 1 : 0,
      input.createdBy ?? 'user',
      input.metadata ? JSON.stringify(input.metadata) : null
    );

    return this.get(id)!;
  }

  /**
   * Get a tool by ID
   */
  get(id: string): CustomToolRecord | null {
    const stmt = this.db.prepare<[string, string], CustomToolRow>(`
      SELECT * FROM custom_tools WHERE id = ? AND user_id = ?
    `);
    const row = stmt.get(id, this.userId);
    return row ? rowToRecord(row) : null;
  }

  /**
   * Get a tool by name
   */
  getByName(name: string): CustomToolRecord | null {
    const stmt = this.db.prepare<[string, string], CustomToolRow>(`
      SELECT * FROM custom_tools WHERE name = ? AND user_id = ?
    `);
    const row = stmt.get(name, this.userId);
    return row ? rowToRecord(row) : null;
  }

  /**
   * List all tools with optional filters
   */
  list(options?: {
    status?: ToolStatus;
    category?: string;
    createdBy?: 'user' | 'llm';
    limit?: number;
    offset?: number;
  }): CustomToolRecord[] {
    let sql = 'SELECT * FROM custom_tools WHERE user_id = ?';
    const params: unknown[] = [this.userId];

    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    if (options?.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }
    if (options?.createdBy) {
      sql += ' AND created_by = ?';
      params.push(options.createdBy);
    }

    sql += ' ORDER BY updated_at DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options?.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as CustomToolRow[];
    return rows.map(rowToRecord);
  }

  /**
   * Get all active tools (for use in LLM context)
   */
  getActiveTools(): CustomToolRecord[] {
    return this.list({ status: 'active' });
  }

  /**
   * Update a tool
   */
  update(
    id: string,
    input: Partial<{
      name: string;
      description: string;
      parameters: CustomToolRecord['parameters'];
      code: string;
      category: string;
      permissions: ToolPermission[];
      requiresApproval: boolean;
      metadata: Record<string, unknown>;
    }>
  ): CustomToolRecord | null {
    const existing = this.get(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description);
    }
    if (input.parameters !== undefined) {
      updates.push('parameters = ?');
      values.push(JSON.stringify(input.parameters));
    }
    if (input.code !== undefined) {
      updates.push('code = ?');
      values.push(input.code);
    }
    if (input.category !== undefined) {
      updates.push('category = ?');
      values.push(input.category);
    }
    if (input.permissions !== undefined) {
      updates.push('permissions = ?');
      values.push(JSON.stringify(input.permissions));
    }
    if (input.requiresApproval !== undefined) {
      updates.push('requires_approval = ?');
      values.push(input.requiresApproval ? 1 : 0);
    }
    if (input.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(input.metadata));
    }

    if (updates.length === 0) return existing;

    // Increment version on code changes
    if (input.code !== undefined || input.parameters !== undefined) {
      updates.push('version = version + 1');
    }

    updates.push("updated_at = datetime('now')");
    values.push(id, this.userId);

    const stmt = this.db.prepare(`
      UPDATE custom_tools SET ${updates.join(', ')} WHERE id = ? AND user_id = ?
    `);
    stmt.run(...values);

    return this.get(id);
  }

  /**
   * Delete a tool
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM custom_tools WHERE id = ? AND user_id = ?
    `);
    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  // ===========================================================================
  // Status Management
  // ===========================================================================

  /**
   * Enable a tool
   */
  enable(id: string): CustomToolRecord | null {
    const stmt = this.db.prepare(`
      UPDATE custom_tools
      SET status = 'active', updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `);
    stmt.run(id, this.userId);
    return this.get(id);
  }

  /**
   * Disable a tool
   */
  disable(id: string): CustomToolRecord | null {
    const stmt = this.db.prepare(`
      UPDATE custom_tools
      SET status = 'disabled', updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `);
    stmt.run(id, this.userId);
    return this.get(id);
  }

  /**
   * Approve a pending tool (for LLM-created tools)
   */
  approve(id: string): CustomToolRecord | null {
    const stmt = this.db.prepare(`
      UPDATE custom_tools
      SET status = 'active', updated_at = datetime('now')
      WHERE id = ? AND user_id = ? AND status = 'pending_approval'
    `);
    stmt.run(id, this.userId);
    return this.get(id);
  }

  /**
   * Reject a pending tool
   */
  reject(id: string): CustomToolRecord | null {
    const stmt = this.db.prepare(`
      UPDATE custom_tools
      SET status = 'rejected', updated_at = datetime('now')
      WHERE id = ? AND user_id = ? AND status = 'pending_approval'
    `);
    stmt.run(id, this.userId);
    return this.get(id);
  }

  // ===========================================================================
  // Usage Tracking
  // ===========================================================================

  /**
   * Record tool usage
   */
  recordUsage(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE custom_tools
      SET usage_count = usage_count + 1, last_used_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `);
    stmt.run(id, this.userId);
  }

  /**
   * Get tools pending approval
   */
  getPendingApproval(): CustomToolRecord[] {
    return this.list({ status: 'pending_approval' });
  }

  /**
   * Get usage statistics
   */
  getStats(): {
    total: number;
    active: number;
    disabled: number;
    pendingApproval: number;
    createdByLLM: number;
    createdByUser: number;
    totalUsage: number;
  } {
    const stmt = this.db.prepare<[string], {
      total: number;
      active: number;
      disabled: number;
      pending: number;
      by_llm: number;
      by_user: number;
      total_usage: number;
    }>(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) as disabled,
        SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN created_by = 'llm' THEN 1 ELSE 0 END) as by_llm,
        SUM(CASE WHEN created_by = 'user' THEN 1 ELSE 0 END) as by_user,
        SUM(usage_count) as total_usage
      FROM custom_tools WHERE user_id = ?
    `);

    const row = stmt.get(this.userId);
    return {
      total: row?.total ?? 0,
      active: row?.active ?? 0,
      disabled: row?.disabled ?? 0,
      pendingApproval: row?.pending ?? 0,
      createdByLLM: row?.by_llm ?? 0,
      createdByUser: row?.by_user ?? 0,
      totalUsage: row?.total_usage ?? 0,
    };
  }
}

/**
 * Create repository instance
 */
export function createCustomToolsRepo(userId?: string): CustomToolsRepository {
  return new CustomToolsRepository(userId);
}
