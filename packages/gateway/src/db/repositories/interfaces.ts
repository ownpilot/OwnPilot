/**
 * Repository Interfaces
 *
 * Standard interfaces for all repositories. Provides a consistent
 * contract for CRUD operations, pagination, and querying.
 *
 * Repositories can implement IRepository<T> while keeping their
 * specialized domain methods (search, decay, getBySource, etc.).
 */

// ============================================================================
// Standard Query
// ============================================================================

/**
 * Standard query parameters shared across all repositories.
 * Domain-specific query types should extend this.
 */
export interface StandardQuery {
  /** Max records to return (default: 50) */
  limit?: number;
  /** Offset for pagination (default: 0) */
  offset?: number;
  /** Column name to order by */
  orderBy?: string;
  /** Sort direction */
  orderDir?: 'asc' | 'desc';
  /** Free-text search across relevant fields */
  search?: string;
  /** Field-value filters for exact matching */
  filter?: Record<string, unknown>;
}

// ============================================================================
// Paginated Result
// ============================================================================

/**
 * Standard paginated result returned by list operations.
 */
export interface PaginatedResult<T> {
  /** The result items for this page */
  items: T[];
  /** Total number of records matching the query (before pagination) */
  total: number;
  /** The limit that was applied */
  limit: number;
  /** The offset that was applied */
  offset: number;
  /** Whether more records exist beyond this page */
  hasMore: boolean;
}

// ============================================================================
// IRepository Interface
// ============================================================================

/**
 * Standard repository interface for consistent CRUD operations.
 *
 * Type parameters:
 * - TEntity: The domain entity type (e.g. Memory, Goal, Task)
 * - TCreateInput: Input type for creation (defaults to Partial<TEntity>)
 * - TUpdateInput: Input type for updates (defaults to Partial<TEntity>)
 *
 * Repositories that implement this interface can still define additional
 * domain-specific methods (search, getActive, decay, etc.).
 */
export interface IRepository<
  TEntity,
  TCreateInput = Partial<TEntity>,
  TUpdateInput = Partial<TEntity>,
> {
  /** Get a single entity by ID. Returns null if not found. */
  getById(id: string): Promise<TEntity | null>;

  /** List entities with standard pagination and filtering. */
  list(query?: StandardQuery): Promise<PaginatedResult<TEntity>>;

  /** Create a new entity. Returns the created entity. */
  create(input: TCreateInput): Promise<TEntity>;

  /** Update an entity by ID. Returns the updated entity or null if not found. */
  update(id: string, input: TUpdateInput): Promise<TEntity | null>;

  /** Delete an entity by ID. Returns true if deleted, false if not found. */
  delete(id: string): Promise<boolean>;

  /** Count entities matching an optional filter. */
  count(filter?: Record<string, unknown>): Promise<number>;
}

// ============================================================================
// Helper: Build paginated result from items + total
// ============================================================================

/**
 * Build a PaginatedResult from a raw items array and total count.
 */
export function buildPaginatedResult<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number,
): PaginatedResult<T> {
  return {
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
  };
}
