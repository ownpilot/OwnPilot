/**
 * Artifact Data Binding Resolver
 *
 * Resolves data bindings to live values from existing personal data:
 * tasks, goals, memories, custom data tables.
 *
 * Imports repositories directly (no circular deps through service layer).
 * The `custom` binding source type is deferred to v2.
 */

import { getLog } from '@ownpilot/core';
import type { DataBinding, DataBindingSource } from '@ownpilot/core';
import {
  TasksRepository,
  GoalsRepository,
  MemoriesRepository,
  CustomDataRepository,
} from '../db/repositories/index.js';

const log = getLog('ArtifactDataResolver');

/**
 * Resolve a single data binding to its current value.
 * Returns null on any error (never throws).
 */
export async function resolveBinding(userId: string, binding: DataBinding): Promise<unknown> {
  try {
    return await resolveSource(userId, binding.source);
  } catch (err) {
    log.debug(`Failed to resolve binding "${binding.variableName}":`, err);
    return null;
  }
}

/**
 * Resolve all bindings for an artifact, returning updated bindings
 * with lastValue and lastRefreshed populated.
 */
export async function resolveAllBindings(
  userId: string,
  bindings: DataBinding[]
): Promise<DataBinding[]> {
  const now = new Date();
  return Promise.all(
    bindings.map(async (b) => {
      const value = await resolveBinding(userId, b);
      return { ...b, lastValue: value, lastRefreshed: now };
    })
  );
}

// ============================================================================
// Internal resolvers
// ============================================================================

async function resolveSource(userId: string, source: DataBindingSource): Promise<unknown> {
  switch (source.type) {
    case 'query':
      return resolveQuery(userId, source);
    case 'aggregate':
      return resolveAggregate(userId, source);
    case 'goal':
      return resolveGoal(userId, source);
    case 'memory':
      return resolveMemory(userId, source);
    case 'custom':
      // Deferred to v2
      return null;
    default:
      return null;
  }
}

async function resolveQuery(
  userId: string,
  source: Extract<DataBindingSource, { type: 'query' }>
): Promise<unknown> {
  const { entity, filter } = source;

  switch (entity) {
    case 'tasks': {
      const repo = new TasksRepository(userId);
      return repo.list({ ...filter, limit: (filter.limit as number) ?? 100 });
    }
    case 'goals': {
      const repo = new GoalsRepository(userId);
      return repo.list({ ...filter, limit: (filter.limit as number) ?? 100 });
    }
    case 'memories': {
      const repo = new MemoriesRepository(userId);
      return repo.list({ ...filter, limit: (filter.limit as number) ?? 100 });
    }
    default: {
      // Try custom data table
      const repo = new CustomDataRepository();
      const records = await repo.listRecords(entity, {
        limit: (filter.limit as number) ?? 100,
      });
      return records;
    }
  }
}

async function resolveAggregate(
  userId: string,
  source: Extract<DataBindingSource, { type: 'aggregate' }>
): Promise<unknown> {
  const { entity, operation, field, filter } = source;

  // Map entity to table name
  const tableMap: Record<string, string> = {
    tasks: 'tasks',
    goals: 'goals',
    memories: 'memories',
    bookmarks: 'bookmarks',
    notes: 'notes',
    contacts: 'contacts',
  };

  const tableName = tableMap[entity];
  if (!tableName) return null;

  let sql: string;
  const params: unknown[] = [userId];
  let paramIndex = 2;

  switch (operation) {
    case 'count':
      sql = `SELECT COUNT(*) as result FROM ${tableName} WHERE user_id = $1`;
      break;
    case 'sum':
      if (!field) return null;
      sql = `SELECT COALESCE(SUM(CAST(${field} AS NUMERIC)), 0) as result FROM ${tableName} WHERE user_id = $1`;
      break;
    case 'avg':
      if (!field) return null;
      sql = `SELECT COALESCE(AVG(CAST(${field} AS NUMERIC)), 0) as result FROM ${tableName} WHERE user_id = $1`;
      break;
    default:
      return null;
  }

  // Apply simple filters
  if (filter) {
    for (const [key, value] of Object.entries(filter)) {
      // Only allow safe column names
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        sql += ` AND ${key} = $${paramIndex++}`;
        params.push(value);
      }
    }
  }

  // Use a repository instance just for the query method
  const repo = new TasksRepository(userId);
  const rows = await (
    repo as unknown as { query: <T extends object>(sql: string, params: unknown[]) => Promise<T[]> }
  ).query<{ result: string }>(sql, params);
  const val = rows[0]?.result;
  return val !== undefined ? parseFloat(val) : null;
}

async function resolveGoal(
  userId: string,
  source: Extract<DataBindingSource, { type: 'goal' }>
): Promise<unknown> {
  const repo = new GoalsRepository(userId);
  return repo.list({ limit: 1 }).then((goals) => {
    const goal = goals.find((g) => g.id === source.goalId);
    if (goal) return goal;
    // If not found in first page, try direct get
    return repo.getById(source.goalId);
  });
}

async function resolveMemory(
  userId: string,
  source: Extract<DataBindingSource, { type: 'memory' }>
): Promise<unknown> {
  const repo = new MemoriesRepository(userId);
  return repo.search(source.query, { limit: source.limit ?? 10 });
}
