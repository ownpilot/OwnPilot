/**
 * Migration smoke test
 *
 * Runs the full schema init + migration set against a real PostgreSQL
 * instance and verifies that critical tables exist. Used by CI to catch
 * migration ordering or idempotency regressions.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm tsx scripts/migration-smoke-test.ts
 *
 * Exit codes:
 *   0 — all migrations applied, critical tables present
 *   1 — migration failed OR a critical table is missing
 */

import { initializeAdapter, closeAdapter } from '../src/db/adapters/index.js';

/**
 * Tables that *must* exist after a clean run of every migration. Failure to
 * find any of these indicates a regression in the migration set.
 */
const CRITICAL_TABLES = [
  'agents',
  'conversations',
  'messages',
  'memories',
  'plans',
  'goals',
  'workflows',
  'claws',
  'fleets',
  'agent_souls',
  'channel_messages',
  'triggers',
  'custom_table_schemas',
  'user_extensions',
];

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_HOST) {
    console.error('[smoke] DATABASE_URL or POSTGRES_HOST must be set');
    process.exit(1);
  }

  console.log('[smoke] Initialising adapter (runs schema + migrations)…');
  const adapter = await initializeAdapter();

  if (!adapter.isConnected()) {
    console.error('[smoke] Adapter reports not connected after initialize');
    process.exit(1);
  }

  console.log('[smoke] Verifying critical tables…');
  const missing: string[] = [];
  for (const table of CRITICAL_TABLES) {
    const row = await adapter.queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [table]
    );
    if (!row?.exists) missing.push(table);
  }

  if (missing.length > 0) {
    console.error(`[smoke] Missing critical tables: ${missing.join(', ')}`);
    await closeAdapter();
    process.exit(1);
  }

  console.log(`[smoke] OK — all ${CRITICAL_TABLES.length} critical tables present`);

  // Re-run init to confirm idempotency.
  console.log('[smoke] Re-running initializeAdapter to confirm idempotency…');
  await closeAdapter();
  await initializeAdapter();
  console.log('[smoke] Idempotency check passed');

  await closeAdapter();
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] Failed:', err);
  process.exit(1);
});
