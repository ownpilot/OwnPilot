/**
 * Workspaces Repository
 *
 * Manages user workspaces with PostgreSQL
 */

import { BaseRepository } from './base.js';
import { randomUUID, createHash } from 'node:crypto';
import type { ContainerConfig } from '@ownpilot/core';

// ============================================================================
// Types
// ============================================================================

export type WorkspaceStatus = 'active' | 'paused' | 'deleted';
export type ContainerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

export interface UserWorkspace {
  id: string;
  userId: string;
  name: string;
  description?: string;
  status: WorkspaceStatus;
  storagePath: string;
  containerConfig: ContainerConfig;
  containerId?: string;
  containerStatus: ContainerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CodeExecution {
  id: string;
  workspaceId: string;
  userId: string;
  language: string;
  codeHash: string;
  status: ExecutionStatus;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  executionTimeMs?: number;
  createdAt: Date;
}

export interface CreateWorkspaceInput {
  userId?: string;
  name: string;
  description?: string;
  storagePath: string;
  containerConfig: ContainerConfig;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  status?: WorkspaceStatus;
  containerConfig?: ContainerConfig;
}

interface WorkspaceRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: string;
  storage_path: string;
  container_config: string;
  container_id: string | null;
  container_status: string;
  created_at: string;
  updated_at: string;
}

interface ExecutionRow {
  [key: string]: unknown;
  id: string;
  workspace_id: string;
  user_id: string;
  language: string;
  code_hash: string;
  status: string;
  stdout: string | null;
  stderr: string | null;
  exit_code: number | null;
  execution_time_ms: number | null;
  created_at: string;
}

// ============================================================================
// Row Mapping
// ============================================================================

function rowToWorkspace(row: WorkspaceRow): UserWorkspace {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description || undefined,
    status: row.status as WorkspaceStatus,
    storagePath: row.storage_path,
    containerConfig: typeof row.container_config === 'string'
      ? JSON.parse(row.container_config)
      : row.container_config,
    containerId: row.container_id || undefined,
    containerStatus: row.container_status as ContainerStatus,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToExecution(row: ExecutionRow): CodeExecution {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    language: row.language,
    codeHash: row.code_hash,
    status: row.status as ExecutionStatus,
    stdout: row.stdout || undefined,
    stderr: row.stderr || undefined,
    exitCode: row.exit_code ?? undefined,
    executionTimeMs: row.execution_time_ms ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class WorkspacesRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  /**
   * List all workspaces for the user
   */
  async list(): Promise<UserWorkspace[]> {
    const rows = await this.query<WorkspaceRow>(
      `SELECT * FROM user_workspaces
       WHERE user_id = $1 AND status != 'deleted'
       ORDER BY updated_at DESC`,
      [this.userId]
    );
    return rows.map(rowToWorkspace);
  }

  /**
   * Count workspaces for the user
   */
  async count(): Promise<number> {
    const result = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM user_workspaces
       WHERE user_id = $1 AND status != 'deleted'`,
      [this.userId]
    );
    return parseInt(result?.count ?? '0', 10);
  }

  /**
   * Get workspace by ID
   */
  async get(id: string): Promise<UserWorkspace | null> {
    const row = await this.queryOne<WorkspaceRow>(
      `SELECT * FROM user_workspaces WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return row ? rowToWorkspace(row) : null;
  }

  /**
   * Create a new workspace
   */
  async create(input: CreateWorkspaceInput): Promise<UserWorkspace> {
    const id = randomUUID();
    const userId = input.userId || this.userId;
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO user_workspaces
       (id, user_id, name, description, status, storage_path, container_config, container_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, 'stopped', $7, $8)`,
      [
        id,
        userId,
        input.name,
        input.description || null,
        input.storagePath,
        JSON.stringify(input.containerConfig),
        now,
        now,
      ]
    );

    return (await this.get(id))!;
  }

  /**
   * Update a workspace
   */
  async update(id: string, input: UpdateWorkspaceInput): Promise<UserWorkspace | null> {
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
    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }
    if (input.containerConfig !== undefined) {
      updates.push(`container_config = $${paramIndex++}`);
      values.push(JSON.stringify(input.containerConfig));
    }

    if (updates.length === 0) {
      return this.get(id);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id, this.userId);

    await this.execute(
      `UPDATE user_workspaces SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
      values
    );

    return this.get(id);
  }

  /**
   * Soft delete a workspace
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `UPDATE user_workspaces SET status = 'deleted', updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );
    return result.changes > 0;
  }

  /**
   * Update container status
   */
  async updateContainerStatus(id: string, containerId: string | null, status: ContainerStatus): Promise<boolean> {
    const result = await this.execute(
      `UPDATE user_workspaces SET container_id = $1, container_status = $2, updated_at = NOW() WHERE id = $3`,
      [containerId, status, id]
    );
    return result.changes > 0;
  }

  /**
   * Count executions for a workspace
   */
  async countExecutions(workspaceId: string): Promise<number> {
    const result = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM code_executions WHERE workspace_id = $1`,
      [workspaceId]
    );
    return parseInt(result?.count ?? '0', 10);
  }

  /**
   * Create a code execution record
   */
  async createExecution(
    workspaceId: string,
    language: string,
    code: string
  ): Promise<CodeExecution> {
    const id = randomUUID();
    const codeHash = createHash('sha256').update(code).digest('hex').substring(0, 16);
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO code_executions
       (id, workspace_id, user_id, language, code_hash, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [id, workspaceId, this.userId, language, codeHash, now]
    );

    const row = await this.queryOne<ExecutionRow>(
      `SELECT * FROM code_executions WHERE id = $1`,
      [id]
    );
    return rowToExecution(row!);
  }

  /**
   * Update execution result
   */
  async updateExecution(
    executionId: string,
    status: ExecutionStatus,
    stdout?: string,
    stderr?: string,
    exitCode?: number,
    executionTimeMs?: number
  ): Promise<boolean> {
    const result = await this.execute(
      `UPDATE code_executions
       SET status = $1, stdout = $2, stderr = $3, exit_code = $4, execution_time_ms = $5
       WHERE id = $6`,
      [status, stdout || null, stderr || null, exitCode ?? null, executionTimeMs ?? null, executionId]
    );
    return result.changes > 0;
  }

  /**
   * List recent executions for a workspace
   */
  async listExecutions(workspaceId: string, limit = 10): Promise<CodeExecution[]> {
    const rows = await this.query<ExecutionRow>(
      `SELECT * FROM code_executions
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [workspaceId, limit]
    );
    return rows.map(rowToExecution);
  }

  /**
   * Log audit entry
   */
  async logAudit(
    action: string,
    resourceType: string,
    resource?: string,
    success = true,
    error?: string,
    ipAddress?: string
  ): Promise<void> {
    try {
      const id = randomUUID();
      const now = new Date().toISOString();

      await this.execute(
        `INSERT INTO workspace_audit
         (id, user_id, workspace_id, action, resource, success, error, ip_address, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          this.userId,
          null,
          action,
          resource || resourceType,
          success,
          error || null,
          ipAddress || null,
          now,
        ]
      );
    } catch {
      // Don't fail on audit logging errors
    }
  }
}

// Factory function
export function createWorkspacesRepository(userId = 'default'): WorkspacesRepository {
  return new WorkspacesRepository(userId);
}
