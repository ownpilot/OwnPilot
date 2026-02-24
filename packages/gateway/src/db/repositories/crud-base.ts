/**
 * CrudRepository Base Class
 *
 * Generic base class that eliminates duplicated CRUD methods across
 * simple repositories. Provides standard create, getById, update,
 * delete, list, and count operations with multi-tenant user_id scoping.
 *
 * Concrete repositories extend this and provide:
 * - tableName: the database table
 * - mapRow(): converts a DB row to a domain entity
 * - buildCreateFields(): builds the column->value map for INSERT
 * - buildUpdateFields(): builds the UpdateField[] for UPDATE
 * - generateId(): (optional) customize ID generation (default: crypto.randomUUID)
 * - defaultOrderBy: (optional) customize ORDER BY (default: 'created_at DESC')
 *
 * All queries are scoped to the user_id set in the constructor.
 */

import { BaseRepository } from './base.js';
import { buildUpdateStatement, type UpdateField } from './query-helpers.js';

/**
 * Configuration for INSERT: maps column names to their values.
 * The 'id' and 'user_id' columns are handled automatically.
 */
export type CreateFields = Record<string, unknown>;

export abstract class CrudRepository<
  TRow extends Record<string, unknown>,
  TEntity,
  TCreateInput,
  TUpdateInput,
> extends BaseRepository {
  /** Database table name */
  abstract readonly tableName: string;

  /** User ID for multi-tenant scoping */
  protected readonly userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  // ---------------------------------------------------------------------------
  // Abstract methods — must be implemented by concrete repositories
  // ---------------------------------------------------------------------------

  /** Convert a database row to a domain entity */
  abstract mapRow(row: TRow): TEntity;

  /**
   * Build column-value pairs for INSERT.
   * Do NOT include 'id' or 'user_id' — these are added automatically.
   * Return a plain object where keys are column names and values are
   * the corresponding parameter values (already serialized, e.g. JSON.stringify for arrays).
   */
  abstract buildCreateFields(input: TCreateInput): CreateFields;

  /**
   * Build UpdateField[] for the SET clause.
   * Fields with `value: undefined` are automatically skipped.
   */
  abstract buildUpdateFields(input: TUpdateInput): UpdateField[];

  // ---------------------------------------------------------------------------
  // Optional overrides
  // ---------------------------------------------------------------------------

  /** Generate a new ID for create(). Default: crypto.randomUUID() */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  /** Default ORDER BY clause for list(). Override to customize. */
  protected get defaultOrderBy(): string {
    return 'created_at DESC';
  }

  /**
   * Entity name used in error messages (e.g. "bookmark", "note").
   * Default: tableName with trailing 's' removed.
   */
  protected get entityName(): string {
    const name = this.tableName;
    return name.endsWith('s') ? name.slice(0, -1) : name;
  }

  /**
   * Override to true in subclasses that want RESOURCE_CREATED / UPDATED / DELETED
   * events emitted automatically on create(), update(), and delete().
   * Default: false (no events emitted — preserves existing behavior).
   */
  protected get emitEvents(): boolean {
    return false;
  }

  /**
   * Resource type string included in emitted event payloads.
   * Default: entityName (tableName without trailing 's').
   * Override to customize the resource type label.
   */
  protected get resourceType(): string {
    return this.entityName;
  }

  // ---------------------------------------------------------------------------
  // Standard CRUD operations
  // ---------------------------------------------------------------------------

  /**
   * Insert a new record and return the created entity.
   */
  async create(input: TCreateInput): Promise<TEntity> {
    const id = this.generateId();
    const fields = this.buildCreateFields(input);

    // Prepend id + user_id
    const allFields: Record<string, unknown> = { id, user_id: this.userId, ...fields };

    const columns = Object.keys(allFields);
    const values = Object.values(allFields);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

    await this.execute(
      `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );

    const result = await this.getById(id);
    if (!result) throw new Error(`Failed to create ${this.entityName}`);

    if (this.emitEvents) {
      const { getEventBus, createEvent, EventTypes } = await import('@ownpilot/core');
      getEventBus().emit(
        createEvent(EventTypes.RESOURCE_CREATED, 'resource', `${this.tableName}-repository`, {
          resourceType: this.resourceType,
          id,
        }),
      );
    }

    return result;
  }

  /**
   * Get a single record by ID, scoped to user_id.
   */
  async getById(id: string): Promise<TEntity | null> {
    const row = await this.queryOne<TRow>(
      `SELECT * FROM ${this.tableName} WHERE id = $1 AND user_id = $2`,
      [id, this.userId],
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * Update a record by ID with partial input.
   * Returns the updated entity, or null if not found.
   * Returns the existing entity unchanged if no fields to update.
   */
  async update(id: string, input: TUpdateInput): Promise<TEntity | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const fields = this.buildUpdateFields(input);
    const hasChanges = fields.some((f) => f.value !== undefined);
    if (!hasChanges) return existing;

    const stmt = buildUpdateStatement(
      this.tableName,
      fields,
      [
        { column: 'id', value: id },
        { column: 'user_id', value: this.userId },
      ],
      1,
      [{ sql: 'updated_at = NOW()' }],
    );

    if (!stmt) return existing;

    await this.execute(stmt.sql, stmt.params);

    const updated = await this.getById(id);

    if (updated && this.emitEvents) {
      const { getEventBus, createEvent, EventTypes } = await import('@ownpilot/core');
      getEventBus().emit(
        createEvent(EventTypes.RESOURCE_UPDATED, 'resource', `${this.tableName}-repository`, {
          resourceType: this.resourceType,
          id,
          changes: input,
        }),
      );
    }

    return updated;
  }

  /**
   * Delete a record by ID, scoped to user_id.
   * Returns true if deleted, false if not found.
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute(
      `DELETE FROM ${this.tableName} WHERE id = $1 AND user_id = $2`,
      [id, this.userId],
    );
    const deleted = result.changes > 0;

    if (deleted && this.emitEvents) {
      const { getEventBus, createEvent, EventTypes } = await import('@ownpilot/core');
      getEventBus().emit(
        createEvent(EventTypes.RESOURCE_DELETED, 'resource', `${this.tableName}-repository`, {
          resourceType: this.resourceType,
          id,
        }),
      );
    }

    return deleted;
  }

  /**
   * List all records for the current user with optional pagination.
   * Uses the defaultOrderBy property for ordering.
   *
   * Concrete repositories typically override or shadow this with a
   * domain-specific `list(query)` method that accepts filter parameters.
   */
  async listAll(limit?: number, offset?: number): Promise<TEntity[]> {
    let sql = `SELECT * FROM ${this.tableName} WHERE user_id = $1`;
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    sql += ` ORDER BY ${this.defaultOrderBy}`;

    if (limit !== undefined && limit > 0) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(limit);
    }
    if (offset !== undefined && offset > 0) {
      sql += ` OFFSET $${paramIndex++}`;
      params.push(offset);
    }

    const rows = await this.query<TRow>(sql, params);
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * Count records for the current user.
   */
  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE user_id = $1`,
      [this.userId],
    );
    return parseInt(row?.count ?? '0', 10);
  }
}
