import { describe, expect, it, vi } from 'vitest';
import { INDEXES_SQL, MIGRATIONS_SQL, SCHEMA_SQL, initializeSchema } from './index.js';

const CRITICAL_TABLES = [
  'settings',
  'conversations',
  'messages',
  'user_extensions',
  'dm_pairing_requests',
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

  it('includes indexes used by DM pairing approval and pending-sender lookups', () => {
    expect(INDEXES_SQL).toContain('idx_dm_pairing_code');
    expect(INDEXES_SQL).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_pairing_active_code');
    expect(INDEXES_SQL).toContain('idx_dm_pairing_pending');
  });

  it('invalidates historical DM pairing code collisions before adding indexes', () => {
    expect(MIGRATIONS_SQL).toContain('WITH duplicate_pairing_codes AS');
    expect(MIGRATIONS_SQL).toContain('PARTITION BY platform, code');
    expect(MIGRATIONS_SQL).toContain('duplicate.duplicate_rank > 1');
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
