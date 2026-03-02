/**
 * Artifacts Repository (PostgreSQL)
 *
 * CRUD + version history for AI-generated interactive content
 * (HTML, SVG, Markdown, charts, forms) with data bindings.
 */

import { generateId } from '@ownpilot/core';
import type {
  Artifact,
  ArtifactVersion,
  CreateArtifactInput,
  UpdateArtifactInput,
  ArtifactQuery,
  DataBinding,
  ArtifactType,
  DashboardSize,
} from '@ownpilot/core';
import { BaseRepository, parseJsonField } from './base.js';
import { buildUpdateStatement } from './query-helpers.js';

// ============================================================================
// Row Types
// ============================================================================

interface ArtifactRow {
  id: string;
  conversation_id: string | null;
  user_id: string;
  type: string;
  title: string;
  content: string;
  data_bindings: string;
  pinned: boolean;
  dashboard_position: number | null;
  dashboard_size: string;
  version: number;
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface ArtifactVersionRow {
  id: string;
  artifact_id: string;
  version: number;
  content: string;
  data_bindings: string | null;
  created_at: string;
}

// ============================================================================
// Row Mappers
// ============================================================================

function rowToArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    type: row.type as ArtifactType,
    title: row.title,
    content: row.content,
    dataBindings: parseJsonField<DataBinding[]>(row.data_bindings, []),
    pinned: row.pinned,
    dashboardPosition: row.dashboard_position,
    dashboardSize: row.dashboard_size as DashboardSize,
    version: row.version,
    tags: row.tags ?? [],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToVersion(row: ArtifactVersionRow): ArtifactVersion {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    version: row.version,
    content: row.content,
    dataBindings: row.data_bindings ? parseJsonField<DataBinding[]>(row.data_bindings, []) : null,
    createdAt: new Date(row.created_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class ArtifactsRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  /**
   * Create a new artifact
   */
  async create(input: CreateArtifactInput): Promise<Artifact> {
    const id = generateId('art');
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO artifacts (
        id, conversation_id, user_id, type, title, content,
        data_bindings, pinned, dashboard_size, tags, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;
    await this.query(sql, [
      id,
      input.conversationId ?? null,
      this.userId,
      input.type,
      input.title,
      input.content,
      JSON.stringify(input.dataBindings ?? []),
      input.pinToDashboard ?? false,
      input.dashboardSize ?? 'medium',
      input.tags ?? [],
      now,
      now,
    ]);

    return this.getById(id) as Promise<Artifact>;
  }

  /**
   * Get an artifact by ID
   */
  async getById(id: string): Promise<Artifact | null> {
    const row = await this.queryOne<ArtifactRow>(
      'SELECT * FROM artifacts WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? rowToArtifact(row) : null;
  }

  /**
   * Update an artifact (saves version snapshot before applying changes)
   */
  async update(id: string, input: UpdateArtifactInput): Promise<Artifact | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    // Save version snapshot if content is changing
    if (input.content !== undefined && input.content !== existing.content) {
      await this.saveVersion(existing);
    }

    const fields = [
      { column: 'title', value: input.title },
      { column: 'content', value: input.content },
      {
        column: 'data_bindings',
        value: input.dataBindings !== undefined ? JSON.stringify(input.dataBindings) : undefined,
      },
      { column: 'pinned', value: input.pinned },
      { column: 'dashboard_position', value: input.dashboardPosition },
      { column: 'dashboard_size', value: input.dashboardSize },
      { column: 'tags', value: input.tags },
    ];

    // Always bump version if content changed
    const rawClauses = [{ sql: 'updated_at = NOW()' }];
    if (input.content !== undefined && input.content !== existing.content) {
      rawClauses.push({ sql: 'version = version + 1' });
    }

    const stmt = buildUpdateStatement(
      'artifacts',
      fields,
      [
        { column: 'id', value: id },
        { column: 'user_id', value: this.userId },
      ],
      1,
      rawClauses
    );

    if (!stmt) return existing;
    await this.query(stmt.sql, stmt.params);

    return this.getById(id);
  }

  /**
   * Delete an artifact
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute('DELETE FROM artifacts WHERE id = $1 AND user_id = $2', [
      id,
      this.userId,
    ]);
    return result.changes > 0;
  }

  /**
   * List artifacts with filters
   */
  async list(query: ArtifactQuery = {}): Promise<{ artifacts: Artifact[]; total: number }> {
    let sql = 'SELECT * FROM artifacts WHERE user_id = $1';
    let countSql = 'SELECT COUNT(*) as count FROM artifacts WHERE user_id = $1';
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.type) {
      sql += ` AND type = $${paramIndex}`;
      countSql += ` AND type = $${paramIndex}`;
      params.push(query.type);
      paramIndex++;
    }

    if (query.pinned !== undefined) {
      sql += ` AND pinned = $${paramIndex}`;
      countSql += ` AND pinned = $${paramIndex}`;
      params.push(query.pinned);
      paramIndex++;
    }

    if (query.conversationId) {
      sql += ` AND conversation_id = $${paramIndex}`;
      countSql += ` AND conversation_id = $${paramIndex}`;
      params.push(query.conversationId);
      paramIndex++;
    }

    if (query.search) {
      sql += ` AND (title ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`;
      countSql += ` AND (title ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`;
      params.push(`%${this.escapeLike(query.search)}%`);
      paramIndex++;
    }

    // Count
    const countRows = await this.query<{ count: string }>(countSql, params);
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    // Data
    sql += ' ORDER BY created_at DESC';
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    sql += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const rows = await this.query<ArtifactRow>(sql, params);
    return { artifacts: rows.map(rowToArtifact), total };
  }

  /**
   * Get pinned artifacts for dashboard
   */
  async getPinned(): Promise<Artifact[]> {
    const rows = await this.query<ArtifactRow>(
      'SELECT * FROM artifacts WHERE user_id = $1 AND pinned = true ORDER BY dashboard_position ASC NULLS LAST, updated_at DESC',
      [this.userId]
    );
    return rows.map(rowToArtifact);
  }

  /**
   * Toggle pin status
   */
  async togglePin(id: string): Promise<Artifact | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const newPinned = !existing.pinned;
    await this.query(
      'UPDATE artifacts SET pinned = $1, dashboard_position = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4',
      [newPinned, newPinned ? null : null, id, this.userId]
    );

    return this.getById(id);
  }

  /**
   * Update data bindings (used by refresh)
   */
  async updateBindings(id: string, bindings: DataBinding[]): Promise<void> {
    await this.query(
      'UPDATE artifacts SET data_bindings = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
      [JSON.stringify(bindings), id, this.userId]
    );
  }

  /**
   * Save a version snapshot of the current artifact state
   */
  private async saveVersion(artifact: Artifact): Promise<void> {
    const versionId = generateId('artv');
    await this.query(
      `INSERT INTO artifact_versions (id, artifact_id, version, content, data_bindings, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        versionId,
        artifact.id,
        artifact.version,
        artifact.content,
        JSON.stringify(artifact.dataBindings),
      ]
    );
  }

  /**
   * Get version history for an artifact
   */
  async getVersions(artifactId: string): Promise<ArtifactVersion[]> {
    // Verify ownership
    const exists = await this.queryOne<{ id: string }>(
      'SELECT id FROM artifacts WHERE id = $1 AND user_id = $2',
      [artifactId, this.userId]
    );
    if (!exists) return [];

    const rows = await this.query<ArtifactVersionRow>(
      'SELECT * FROM artifact_versions WHERE artifact_id = $1 ORDER BY version DESC',
      [artifactId]
    );
    return rows.map(rowToVersion);
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createArtifactsRepository(userId = 'default'): ArtifactsRepository {
  return new ArtifactsRepository(userId);
}
