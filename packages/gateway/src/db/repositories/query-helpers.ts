/**
 * Query Helpers for Repository UPDATE operations
 *
 * Provides a reusable builder for parameterized UPDATE statements,
 * eliminating duplicated dynamic SET-clause construction across repositories.
 */

export interface UpdateField {
  /** Database column name */
  column: string;
  /** Value to set. When undefined, the field is skipped. */
  value: unknown;
}

/**
 * A raw SQL SET clause appended verbatim (no parameterization).
 * Use for expressions like `updated_at = NOW()` or `completed_at = NULL`.
 */
export interface RawSetClause {
  /** Raw SQL fragment, e.g. "updated_at = NOW()" */
  sql: string;
}

export interface UpdateStatement {
  /** The full parameterized SQL string, e.g. UPDATE t SET col=$1 WHERE id=$2 */
  sql: string;
  /** Ordered parameter values matching the $N placeholders */
  params: unknown[];
}

/**
 * Build a parameterized UPDATE statement from a list of fields.
 * Only includes fields where `value !== undefined`.
 *
 * Returns `null` when there are no fields to update (all values are undefined
 * and no raw clauses are provided).
 *
 * @param table       - Table name (must be a safe identifier, not user input)
 * @param fields      - Columns to SET (undefined values are skipped)
 * @param where       - WHERE clause conditions joined with AND
 * @param startIndex  - First $N index (default 1). Useful when the caller
 *                      has already reserved lower indices for other purposes.
 * @param rawClauses  - Optional raw SQL SET clauses appended after parameterized fields
 *
 * @example
 * ```ts
 * const result = buildUpdateStatement(
 *   'goals',
 *   [
 *     { column: 'title', value: input.title },
 *     { column: 'description', value: input.description },
 *   ],
 *   [
 *     { column: 'id', value: id },
 *     { column: 'user_id', value: userId },
 *   ],
 *   1,
 *   [{ sql: 'updated_at = NOW()' }],
 * );
 * // result.sql   => "UPDATE goals SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3"
 * // result.params => [input.title, id, userId]
 * ```
 */
export function buildUpdateStatement(
  table: string,
  fields: UpdateField[],
  where: UpdateField[],
  startIndex = 1,
  rawClauses: RawSetClause[] = []
): UpdateStatement | null {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let idx = startIndex;

  for (const field of fields) {
    if (field.value !== undefined) {
      setClauses.push(`${field.column} = $${idx++}`);
      params.push(field.value);
    }
  }

  // Append raw SQL clauses (no parameterization)
  for (const raw of rawClauses) {
    setClauses.push(raw.sql);
  }

  if (setClauses.length === 0) {
    return null;
  }

  const whereClauses: string[] = [];
  for (const cond of where) {
    whereClauses.push(`${cond.column} = $${idx++}`);
    params.push(cond.value);
  }

  const whereStr = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';
  const sql = `UPDATE ${table} SET ${setClauses.join(', ')}${whereStr}`;

  return { sql, params };
}
