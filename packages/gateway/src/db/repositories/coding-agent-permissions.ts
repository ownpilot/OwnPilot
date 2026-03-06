/**
 * Coding Agent Permissions Repository
 *
 * Per-provider permission profiles for coding agent sessions.
 */

import { BaseRepository, parseJsonField, parseBool } from './base.js';

// =============================================================================
// ROW TYPE
// =============================================================================

interface PermissionRow {
  id: string;
  user_id: string;
  provider_ref: string;
  io_format: string;
  fs_access: string;
  allowed_dirs: string | null; // JSONB
  network_access: boolean | number;
  shell_access: boolean | number;
  git_access: boolean | number;
  autonomy: string;
  max_file_changes: number;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export type IoFormat = 'text' | 'json' | 'stream-json';
export type FsAccess = 'none' | 'read-only' | 'read-write' | 'full';
export type Autonomy = 'supervised' | 'semi-auto' | 'full-auto';

export interface CodingAgentPermissionRecord {
  id: string;
  userId: string;
  providerRef: string;
  ioFormat: IoFormat;
  fsAccess: FsAccess;
  allowedDirs: string[];
  networkAccess: boolean;
  shellAccess: boolean;
  gitAccess: boolean;
  autonomy: Autonomy;
  maxFileChanges: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertPermissionInput {
  providerRef: string;
  ioFormat?: IoFormat;
  fsAccess?: FsAccess;
  allowedDirs?: string[];
  networkAccess?: boolean;
  shellAccess?: boolean;
  gitAccess?: boolean;
  autonomy?: Autonomy;
  maxFileChanges?: number;
}

// =============================================================================
// HELPERS
// =============================================================================

function rowToRecord(row: PermissionRow): CodingAgentPermissionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    providerRef: row.provider_ref,
    ioFormat: row.io_format as IoFormat,
    fsAccess: row.fs_access as FsAccess,
    allowedDirs: parseJsonField<string[]>(row.allowed_dirs, []),
    networkAccess: parseBool(row.network_access),
    shellAccess: parseBool(row.shell_access),
    gitAccess: parseBool(row.git_access),
    autonomy: row.autonomy as Autonomy,
    maxFileChanges: Number(row.max_file_changes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class CodingAgentPermissionsRepository extends BaseRepository {
  async getByProvider(
    providerRef: string,
    userId = 'default'
  ): Promise<CodingAgentPermissionRecord | null> {
    const row = await this.queryOne<PermissionRow>(
      'SELECT * FROM coding_agent_permissions WHERE provider_ref = $1 AND user_id = $2',
      [providerRef, userId]
    );
    return row ? rowToRecord(row) : null;
  }

  async list(userId = 'default'): Promise<CodingAgentPermissionRecord[]> {
    const rows = await this.query<PermissionRow>(
      'SELECT * FROM coding_agent_permissions WHERE user_id = $1 ORDER BY provider_ref',
      [userId]
    );
    return rows.map(rowToRecord);
  }

  async upsert(
    input: UpsertPermissionInput,
    userId = 'default'
  ): Promise<CodingAgentPermissionRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO coding_agent_permissions (
        id, user_id, provider_ref, io_format, fs_access, allowed_dirs,
        network_access, shell_access, git_access, autonomy, max_file_changes,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (user_id, provider_ref) DO UPDATE SET
        io_format = EXCLUDED.io_format,
        fs_access = EXCLUDED.fs_access,
        allowed_dirs = EXCLUDED.allowed_dirs,
        network_access = EXCLUDED.network_access,
        shell_access = EXCLUDED.shell_access,
        git_access = EXCLUDED.git_access,
        autonomy = EXCLUDED.autonomy,
        max_file_changes = EXCLUDED.max_file_changes,
        updated_at = EXCLUDED.updated_at`,
      [
        id,
        userId,
        input.providerRef,
        input.ioFormat ?? 'text',
        input.fsAccess ?? 'read-write',
        JSON.stringify(input.allowedDirs ?? []),
        input.networkAccess ?? true,
        input.shellAccess ?? true,
        input.gitAccess ?? true,
        input.autonomy ?? 'semi-auto',
        input.maxFileChanges ?? 50,
        now,
        now,
      ]
    );

    const record = await this.getByProvider(input.providerRef, userId);
    if (!record) throw new Error('Failed to upsert permission profile');
    return record;
  }

  async delete(providerRef: string, userId = 'default'): Promise<boolean> {
    const result = await this.execute(
      'DELETE FROM coding_agent_permissions WHERE provider_ref = $1 AND user_id = $2',
      [providerRef, userId]
    );
    return (result?.changes ?? 0) > 0;
  }
}

// =============================================================================
// SINGLETON & FACTORY
// =============================================================================

export const codingAgentPermissionsRepo = new CodingAgentPermissionsRepository();

export function createCodingAgentPermissionsRepository(): CodingAgentPermissionsRepository {
  return new CodingAgentPermissionsRepository();
}
