import { describe, expect, it, vi } from 'vitest';
import { INDEXES_SQL, MIGRATIONS_SQL, SCHEMA_SQL, initializeSchema } from './index.js';

const CRITICAL_TABLES = [
  'settings',
  'conversations',
  'messages',
  'user_extensions',
  'user_workspaces',
  'custom_tools',
  'cli_providers',
  'ui_sessions',
];

describe('PostgreSQL schema bundle', () => {
  it('includes tables needed by startup and core request flows', () => {
    const ddlBundle = `${SCHEMA_SQL}\n${MIGRATIONS_SQL}`;

    for (const table of CRITICAL_TABLES) {
      expect(ddlBundle).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('includes ui_sessions indexes in the bundled index SQL', () => {
    expect(INDEXES_SQL).toContain('idx_ui_sessions_expires_at');
    expect(INDEXES_SQL).toContain('idx_ui_sessions_kind');
  });

  it('runs tables, migrations, then indexes in order', async () => {
    const runSql = vi.fn(async () => undefined);

    await initializeSchema(runSql);

    expect(runSql).toHaveBeenCalledTimes(3);
    expect(runSql.mock.calls[0][0]).toBe(SCHEMA_SQL);
    expect(runSql.mock.calls[1][0]).toBe(MIGRATIONS_SQL);
    expect(runSql.mock.calls[2][0]).toBe(INDEXES_SQL);
  });
});
