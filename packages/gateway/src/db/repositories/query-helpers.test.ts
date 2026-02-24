/**
 * Query Helpers Tests
 *
 * Unit tests for buildUpdateStatement helper that generates parameterized
 * UPDATE SQL from dynamic field lists.
 */

import { describe, it, expect } from 'vitest';
import { buildUpdateStatement } from './query-helpers.js';

describe('buildUpdateStatement', () => {
  // ===========================================================================
  // Core functionality
  // ===========================================================================

  describe('basic SET clause generation', () => {
    it('should generate UPDATE with a single field', () => {
      const result = buildUpdateStatement(
        'goals',
        [{ column: 'title', value: 'New Title' }],
        [{ column: 'id', value: 'goal_1' }]
      );

      expect(result).not.toBeNull();
      expect(result!.sql).toBe('UPDATE goals SET title = $1 WHERE id = $2');
      expect(result!.params).toEqual(['New Title', 'goal_1']);
    });

    it('should generate UPDATE with multiple fields', () => {
      const result = buildUpdateStatement(
        'notes',
        [
          { column: 'title', value: 'Updated' },
          { column: 'content', value: 'New content' },
          { column: 'updated_at', value: '2026-01-01' },
        ],
        [{ column: 'id', value: 'note-1' }]
      );

      expect(result).not.toBeNull();
      expect(result!.sql).toBe(
        'UPDATE notes SET title = $1, content = $2, updated_at = $3 WHERE id = $4'
      );
      expect(result!.params).toEqual(['Updated', 'New content', '2026-01-01', 'note-1']);
    });

    it('should generate UPDATE with multiple WHERE conditions', () => {
      const result = buildUpdateStatement(
        'tasks',
        [{ column: 'status', value: 'completed' }],
        [
          { column: 'id', value: 'task-1' },
          { column: 'user_id', value: 'user-1' },
        ]
      );

      expect(result).not.toBeNull();
      expect(result!.sql).toBe('UPDATE tasks SET status = $1 WHERE id = $2 AND user_id = $3');
      expect(result!.params).toEqual(['completed', 'task-1', 'user-1']);
    });
  });

  // ===========================================================================
  // Undefined field skipping
  // ===========================================================================

  describe('undefined field handling', () => {
    it('should skip fields with undefined values', () => {
      const result = buildUpdateStatement(
        'goals',
        [
          { column: 'title', value: 'Updated' },
          { column: 'description', value: undefined },
          { column: 'priority', value: 8 },
        ],
        [{ column: 'id', value: 'goal_1' }]
      );

      expect(result).not.toBeNull();
      expect(result!.sql).toBe('UPDATE goals SET title = $1, priority = $2 WHERE id = $3');
      expect(result!.params).toEqual(['Updated', 8, 'goal_1']);
    });

    it('should return null when all fields are undefined', () => {
      const result = buildUpdateStatement(
        'goals',
        [
          { column: 'title', value: undefined },
          { column: 'description', value: undefined },
        ],
        [{ column: 'id', value: 'goal_1' }]
      );

      expect(result).toBeNull();
    });

    it('should return null for an empty fields array', () => {
      const result = buildUpdateStatement('goals', [], [{ column: 'id', value: 'goal_1' }]);

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Null and falsy values (not undefined)
  // ===========================================================================

  describe('null and falsy value handling', () => {
    it('should include fields with null values', () => {
      const result = buildUpdateStatement(
        'notes',
        [{ column: 'category', value: null }],
        [{ column: 'id', value: 'note-1' }]
      );

      expect(result).not.toBeNull();
      expect(result!.sql).toBe('UPDATE notes SET category = $1 WHERE id = $2');
      expect(result!.params).toEqual([null, 'note-1']);
    });

    it('should include fields with empty string values', () => {
      const result = buildUpdateStatement(
        'notes',
        [{ column: 'title', value: '' }],
        [{ column: 'id', value: 'note-1' }]
      );

      expect(result).not.toBeNull();
      expect(result!.params[0]).toBe('');
    });

    it('should include fields with zero values', () => {
      const result = buildUpdateStatement(
        'goals',
        [{ column: 'progress', value: 0 }],
        [{ column: 'id', value: 'goal_1' }]
      );

      expect(result).not.toBeNull();
      expect(result!.params[0]).toBe(0);
    });

    it('should include fields with false values', () => {
      const result = buildUpdateStatement(
        'notes',
        [{ column: 'is_pinned', value: false }],
        [{ column: 'id', value: 'note-1' }]
      );

      expect(result).not.toBeNull();
      expect(result!.params[0]).toBe(false);
    });
  });

  // ===========================================================================
  // Parameter indexing
  // ===========================================================================

  describe('parameter indexing', () => {
    it('should start at $1 by default', () => {
      const result = buildUpdateStatement(
        'goals',
        [{ column: 'title', value: 'x' }],
        [{ column: 'id', value: '1' }]
      );

      expect(result!.sql).toContain('$1');
      expect(result!.sql).toContain('$2');
    });

    it('should support custom startIndex', () => {
      const result = buildUpdateStatement(
        'goals',
        [
          { column: 'title', value: 'x' },
          { column: 'status', value: 'active' },
        ],
        [{ column: 'id', value: '1' }],
        3
      );

      expect(result!.sql).toBe('UPDATE goals SET title = $3, status = $4 WHERE id = $5');
      expect(result!.params).toEqual(['x', 'active', '1']);
    });

    it('should produce sequential indices with mixed defined/undefined fields', () => {
      const result = buildUpdateStatement(
        'tasks',
        [
          { column: 'title', value: 'A' },
          { column: 'description', value: undefined },
          { column: 'status', value: 'done' },
          { column: 'priority', value: undefined },
          { column: 'category', value: 'work' },
        ],
        [
          { column: 'id', value: 't1' },
          { column: 'user_id', value: 'u1' },
        ]
      );

      expect(result).not.toBeNull();
      // title=$1, status=$2, category=$3, id=$4, user_id=$5
      expect(result!.sql).toBe(
        'UPDATE tasks SET title = $1, status = $2, category = $3 WHERE id = $4 AND user_id = $5'
      );
      expect(result!.params).toEqual(['A', 'done', 'work', 't1', 'u1']);
    });
  });

  // ===========================================================================
  // WHERE clause
  // ===========================================================================

  describe('WHERE clause', () => {
    it('should omit WHERE when where array is empty', () => {
      const result = buildUpdateStatement('settings', [{ column: 'value', value: 'new' }], []);

      expect(result).not.toBeNull();
      expect(result!.sql).toBe('UPDATE settings SET value = $1');
      expect(result!.params).toEqual(['new']);
    });

    it('should support three or more WHERE conditions', () => {
      const result = buildUpdateStatement(
        'items',
        [{ column: 'name', value: 'x' }],
        [
          { column: 'id', value: '1' },
          { column: 'user_id', value: 'u1' },
          { column: 'workspace_id', value: 'w1' },
        ]
      );

      expect(result!.sql).toBe(
        'UPDATE items SET name = $1 WHERE id = $2 AND user_id = $3 AND workspace_id = $4'
      );
      expect(result!.params).toEqual(['x', '1', 'u1', 'w1']);
    });
  });

  // ===========================================================================
  // Complex value types
  // ===========================================================================

  describe('complex value types', () => {
    it('should handle JSON stringified values', () => {
      const metadata = JSON.stringify({ key: 'value' });
      const result = buildUpdateStatement(
        'goals',
        [{ column: 'metadata', value: metadata }],
        [{ column: 'id', value: 'g1' }]
      );

      expect(result!.params[0]).toBe('{"key":"value"}');
    });

    it('should handle boolean values', () => {
      const result = buildUpdateStatement(
        'notes',
        [
          { column: 'is_pinned', value: true },
          { column: 'is_archived', value: false },
        ],
        [{ column: 'id', value: 'n1' }]
      );

      expect(result!.params).toEqual([true, false, 'n1']);
    });

    it('should handle numeric values', () => {
      const result = buildUpdateStatement(
        'goals',
        [
          { column: 'priority', value: 10 },
          { column: 'progress', value: 75.5 },
        ],
        [{ column: 'id', value: 'g1' }]
      );

      expect(result!.params).toEqual([10, 75.5, 'g1']);
    });

    it('should handle Date objects', () => {
      const now = new Date('2026-01-15T12:00:00Z');
      const result = buildUpdateStatement(
        'tasks',
        [{ column: 'completed_at', value: now.toISOString() }],
        [{ column: 'id', value: 't1' }]
      );

      expect(result!.params[0]).toBe('2026-01-15T12:00:00.000Z');
    });
  });

  // ===========================================================================
  // Raw SQL clauses
  // ===========================================================================

  describe('raw SQL clauses', () => {
    it('should append raw SET clauses after parameterized fields', () => {
      const result = buildUpdateStatement(
        'tasks',
        [{ column: 'title', value: 'New Title' }],
        [
          { column: 'id', value: 'task-1' },
          { column: 'user_id', value: 'user-1' },
        ],
        1,
        [{ sql: 'updated_at = NOW()' }]
      );

      expect(result).not.toBeNull();
      expect(result!.sql).toBe(
        'UPDATE tasks SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3'
      );
      expect(result!.params).toEqual(['New Title', 'task-1', 'user-1']);
    });

    it('should append multiple raw clauses', () => {
      const result = buildUpdateStatement(
        'tasks',
        [{ column: 'status', value: 'completed' }],
        [{ column: 'id', value: 'task-1' }],
        1,
        [{ sql: 'completed_at = NOW()' }, { sql: 'updated_at = NOW()' }]
      );

      expect(result).not.toBeNull();
      expect(result!.sql).toBe(
        'UPDATE tasks SET status = $1, completed_at = NOW(), updated_at = NOW() WHERE id = $2'
      );
      expect(result!.params).toEqual(['completed', 'task-1']);
    });

    it('should work with only raw clauses (no parameterized fields)', () => {
      const result = buildUpdateStatement(
        'tasks',
        [
          { column: 'title', value: undefined },
          { column: 'description', value: undefined },
        ],
        [{ column: 'id', value: 'task-1' }],
        1,
        [{ sql: 'updated_at = NOW()' }]
      );

      expect(result).not.toBeNull();
      expect(result!.sql).toBe('UPDATE tasks SET updated_at = NOW() WHERE id = $1');
      expect(result!.params).toEqual(['task-1']);
    });

    it('should return null when no parameterized fields and no raw clauses', () => {
      const result = buildUpdateStatement(
        'tasks',
        [{ column: 'title', value: undefined }],
        [{ column: 'id', value: 'task-1' }],
        1,
        []
      );

      expect(result).toBeNull();
    });

    it('should handle raw clauses with NULL', () => {
      const result = buildUpdateStatement(
        'tasks',
        [{ column: 'status', value: 'pending' }],
        [{ column: 'id', value: 'task-1' }],
        1,
        [{ sql: 'completed_at = NULL' }]
      );

      expect(result!.sql).toBe('UPDATE tasks SET status = $1, completed_at = NULL WHERE id = $2');
    });
  });

  // ===========================================================================
  // Realistic repository scenarios
  // ===========================================================================

  describe('realistic repository scenarios', () => {
    it('should handle a typical goal update', () => {
      const input = {
        title: 'Learn Rust',
        description: undefined,
        status: 'active' as const,
        priority: 8,
        dueDate: undefined,
        progress: undefined,
        metadata: undefined,
      };

      const result = buildUpdateStatement(
        'goals',
        [
          { column: 'updated_at', value: '2026-01-15T12:00:00Z' },
          { column: 'title', value: input.title },
          { column: 'description', value: input.description },
          { column: 'status', value: input.status },
          { column: 'priority', value: input.priority },
          { column: 'due_date', value: input.dueDate },
          { column: 'progress', value: input.progress },
          { column: 'metadata', value: input.metadata },
        ],
        [
          { column: 'id', value: 'goal_1' },
          { column: 'user_id', value: 'user-1' },
        ]
      );

      expect(result).not.toBeNull();
      expect(result!.sql).toBe(
        'UPDATE goals SET updated_at = $1, title = $2, status = $3, priority = $4 WHERE id = $5 AND user_id = $6'
      );
      expect(result!.params).toEqual([
        '2026-01-15T12:00:00Z',
        'Learn Rust',
        'active',
        8,
        'goal_1',
        'user-1',
      ]);
    });

    it('should handle a typical note update with all fields', () => {
      const result = buildUpdateStatement(
        'notes',
        [
          { column: 'title', value: 'Updated Title' },
          { column: 'content', value: 'New content here' },
          { column: 'content_type', value: 'html' },
          { column: 'category', value: 'work' },
          { column: 'tags', value: '["tag1","tag2"]' },
          { column: 'is_pinned', value: true },
          { column: 'is_archived', value: false },
          { column: 'color', value: '#ff0000' },
          { column: 'updated_at', value: 'NOW()' },
        ],
        [
          { column: 'id', value: 'note-1' },
          { column: 'user_id', value: 'user-1' },
        ]
      );

      expect(result).not.toBeNull();
      expect(result!.params).toHaveLength(11); // 9 SET + 2 WHERE
    });
  });
});
