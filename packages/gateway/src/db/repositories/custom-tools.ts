/**
 * Custom Tools Repository
 *
 * Stores LLM-created and user-defined tools
 * Supports enable/disable, permissions, and approval workflows
 */

import { BaseRepository, parseJsonField, parseJsonFieldNullable } from './base.js';
import { randomUUID } from 'node:crypto';

// =============================================================================
// TYPES
// =============================================================================

export type ToolPermission =
  | 'network' // HTTP requests
  | 'filesystem' // File read/write
  | 'database' // Custom data access
  | 'shell' // Shell command execution
  | 'email' // Send emails
  | 'scheduling'; // Create scheduled tasks

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
  /**
   * API keys / config services this tool requires (auto-registered in Config Center).
   * Shape is compatible with ToolConfigRequirement from @ownpilot/core.
   * New tools should use configRequirements on ToolDefinition instead.
   */
  requiredApiKeys?: Array<{
    name: string;
    displayName?: string;
    description?: string;
    category?: string;
    docsUrl?: string;
  }>;
}

interface CustomToolRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  name: string;
  description: string;
  parameters: string;
  code: string;
  category: string | null;
  status: string;
  permissions: string;
  requires_approval: boolean;
  created_by: string;
  version: number;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: string | null;
  required_api_keys: string | null;
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
    parameters: parseJsonField<CustomToolRecord['parameters']>(row.parameters, {
      type: 'object',
      properties: {},
    }),
    code: row.code,
    category: row.category ?? undefined,
    status: row.status as ToolStatus,
    permissions: parseJsonField(row.permissions, []),
    requiresApproval: row.requires_approval,
    createdBy: row.created_by as 'user' | 'llm',
    version: row.version,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: parseJsonFieldNullable(row.metadata) ?? undefined,
    requiredApiKeys: parseJsonFieldNullable(row.required_api_keys) ?? undefined,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class CustomToolsRepository extends BaseRepository {
  private userId: string;

  constructor(userId: string = 'default') {
    super();
    this.userId = userId;
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Create a new custom tool
   */
  async create(input: {
    name: string;
    description: string;
    parameters: CustomToolRecord['parameters'];
    code: string;
    category?: string;
    permissions?: ToolPermission[];
    requiresApproval?: boolean;
    createdBy?: 'user' | 'llm';
    metadata?: Record<string, unknown>;
    requiredApiKeys?: CustomToolRecord['requiredApiKeys'];
  }): Promise<CustomToolRecord> {
    const id = `tool_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    // Tools created by LLM start as pending_approval if they need dangerous permissions
    const dangerousPermissions: ToolPermission[] = ['shell', 'filesystem', 'email'];
    const hasDangerous = input.permissions?.some((p) => dangerousPermissions.includes(p));
    const status: ToolStatus =
      input.createdBy === 'llm' && hasDangerous ? 'pending_approval' : 'active';

    await this.execute(
      `INSERT INTO custom_tools (
        id, user_id, name, description, parameters, code, category,
        status, permissions, requires_approval, created_by, metadata, required_api_keys, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id,
        this.userId,
        input.name,
        input.description,
        JSON.stringify(input.parameters),
        input.code,
        input.category ?? null,
        status,
        JSON.stringify(input.permissions ?? []),
        input.requiresApproval || false,
        input.createdBy ?? 'user',
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.requiredApiKeys ? JSON.stringify(input.requiredApiKeys) : null,
        now,
        now,
      ]
    );

    const tool = await this.get(id);
    if (!tool) throw new Error('Failed to create custom tool');
    return tool;
  }

  /**
   * Get a tool by ID
   */
  async get(id: string): Promise<CustomToolRecord | null> {
    const row = await this.queryOne<CustomToolRow>(
      'SELECT * FROM custom_tools WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? rowToRecord(row) : null;
  }

  /**
   * Get a tool by name
   */
  async getByName(name: string): Promise<CustomToolRecord | null> {
    const row = await this.queryOne<CustomToolRow>(
      'SELECT * FROM custom_tools WHERE name = $1 AND user_id = $2',
      [name, this.userId]
    );
    return row ? rowToRecord(row) : null;
  }

  /**
   * List all tools with optional filters
   */
  async list(options?: {
    status?: ToolStatus;
    category?: string;
    createdBy?: 'user' | 'llm';
    limit?: number;
    offset?: number;
  }): Promise<CustomToolRecord[]> {
    let sql = 'SELECT * FROM custom_tools WHERE user_id = $1';
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (options?.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(options.status);
    }
    if (options?.category) {
      sql += ` AND category = $${paramIndex++}`;
      params.push(options.category);
    }
    if (options?.createdBy) {
      sql += ` AND created_by = $${paramIndex++}`;
      params.push(options.createdBy);
    }

    sql += ' ORDER BY updated_at DESC';

    if (options?.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(options.limit);
    }
    if (options?.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(options.offset);
    }

    const rows = await this.query<CustomToolRow>(sql, params);
    return rows.map(rowToRecord);
  }

  /**
   * Get all active tools (for use in LLM context)
   */
  async getActiveTools(): Promise<CustomToolRecord[]> {
    return this.list({ status: 'active' });
  }

  /**
   * Update a tool
   */
  async update(
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
      requiredApiKeys: CustomToolRecord['requiredApiKeys'];
    }>
  ): Promise<CustomToolRecord | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }
    if (input.parameters !== undefined) {
      updates.push(`parameters = $${paramIndex++}`);
      values.push(JSON.stringify(input.parameters));
    }
    if (input.code !== undefined) {
      updates.push(`code = $${paramIndex++}`);
      values.push(input.code);
    }
    if (input.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      values.push(input.category);
    }
    if (input.permissions !== undefined) {
      updates.push(`permissions = $${paramIndex++}`);
      values.push(JSON.stringify(input.permissions));
    }
    if (input.requiresApproval !== undefined) {
      updates.push(`requires_approval = $${paramIndex++}`);
      values.push(input.requiresApproval);
    }
    if (input.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(input.metadata));
    }
    if (input.requiredApiKeys !== undefined) {
      updates.push(`required_api_keys = $${paramIndex++}`);
      values.push(input.requiredApiKeys ? JSON.stringify(input.requiredApiKeys) : null);
    }

    if (updates.length === 0) return existing;

    // Increment version on code changes
    if (input.code !== undefined || input.parameters !== undefined) {
      updates.push('version = version + 1');
    }

    updates.push('updated_at = NOW()');
    values.push(id, this.userId);

    await this.execute(
      `UPDATE custom_tools SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      values
    );

    return this.get(id);
  }

  /**
   * Delete a tool
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute('DELETE FROM custom_tools WHERE id = $1 AND user_id = $2', [
      id,
      this.userId,
    ]);
    return result.changes > 0;
  }

  // ===========================================================================
  // Status Management
  // ===========================================================================

  /**
   * Enable a tool
   */
  async enable(id: string): Promise<CustomToolRecord | null> {
    await this.execute(
      `UPDATE custom_tools SET status = 'active', updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return this.get(id);
  }

  /**
   * Disable a tool
   */
  async disable(id: string): Promise<CustomToolRecord | null> {
    await this.execute(
      `UPDATE custom_tools SET status = 'disabled', updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return this.get(id);
  }

  /**
   * Approve a pending tool (for LLM-created tools)
   */
  async approve(id: string): Promise<CustomToolRecord | null> {
    await this.execute(
      `UPDATE custom_tools SET status = 'active', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending_approval'`,
      [id, this.userId]
    );
    return this.get(id);
  }

  /**
   * Reject a pending tool
   */
  async reject(id: string): Promise<CustomToolRecord | null> {
    await this.execute(
      `UPDATE custom_tools SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending_approval'`,
      [id, this.userId]
    );
    return this.get(id);
  }

  // ===========================================================================
  // Usage Tracking
  // ===========================================================================

  /**
   * Record tool usage
   */
  async recordUsage(id: string): Promise<void> {
    await this.execute(
      `UPDATE custom_tools SET usage_count = usage_count + 1, last_used_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
  }

  /**
   * Get tools pending approval
   */
  async getPendingApproval(): Promise<CustomToolRecord[]> {
    return this.list({ status: 'pending_approval' });
  }

  /**
   * Get usage statistics
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    disabled: number;
    pendingApproval: number;
    createdByLLM: number;
    createdByUser: number;
    totalUsage: number;
  }> {
    const row = await this.queryOne<{
      total: string;
      active: string;
      disabled: string;
      pending: string;
      by_llm: string;
      by_user: string;
      total_usage: string;
    }>(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) as disabled,
        SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN created_by = 'llm' THEN 1 ELSE 0 END) as by_llm,
        SUM(CASE WHEN created_by = 'user' THEN 1 ELSE 0 END) as by_user,
        SUM(usage_count) as total_usage
      FROM custom_tools WHERE user_id = $1`,
      [this.userId]
    );

    return {
      total: parseInt(row?.total ?? '0', 10),
      active: parseInt(row?.active ?? '0', 10),
      disabled: parseInt(row?.disabled ?? '0', 10),
      pendingApproval: parseInt(row?.pending ?? '0', 10),
      createdByLLM: parseInt(row?.by_llm ?? '0', 10),
      createdByUser: parseInt(row?.by_user ?? '0', 10),
      totalUsage: parseInt(row?.total_usage ?? '0', 10),
    };
  }
}

/**
 * Create repository instance
 */
export function createCustomToolsRepo(userId?: string): CustomToolsRepository {
  return new CustomToolsRepository(userId);
}
