/**
 * CSV Import Header Validation Tests
 *
 * Focused on Plan 11 CSV-001: a malicious CSV header must be rejected
 * with 400 before reaching the database adapter. The endpoint requires
 * the shared admin key, the X-Admin-Key header, and a connected adapter;
 * we mock all three and assert the rejection path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockAdapter } = vi.hoisted(() => {
  const mockAdapter = {
    isConnected: vi.fn(() => true),
    queryOne: vi.fn(async () => ({ exists: true })),
    query: vi.fn(async () => []),
    exec: vi.fn(async () => {}),
    execute: vi.fn(async () => ({ changes: 1 })),
  };
  return { mockAdapter };
});

vi.mock('../../db/adapters/index.js', () => ({
  getAdapterSync: () => mockAdapter,
  getAdapter: () => Promise.resolve(mockAdapter),
}));

import { csvExportRoutes } from './csv-export.js';
import { ERROR_CODES } from '../helpers.js';

const ADMIN_KEY = 'test-admin-key-csv-import-1234567890';
const TABLE = 'expenses'; // in IMPORTABLE_TABLES

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function createApp() {
  const app = new Hono();
  app.route('/db', csvExportRoutes);
  return app;
}

async function postCsv(table: string, body: string) {
  const app = createApp();
  return app.request(`/db/import/csv/${table}`, {
    method: 'POST',
    headers: {
      'X-Admin-Key': ADMIN_KEY,
      'Content-Type': 'text/csv',
    },
    body,
  });
}

describe('csvExportRoutes — CSV import header validation (Plan 11 CSV-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_KEY = ADMIN_KEY;
  });

  it('rejects a header containing SQL metacharacters with 400', async () => {
    // `id; DROP TABLE users; --` is not a valid identifier — it contains
    // spaces, semicolons, and dashes. validateColumnName rejects it.
    const csv = 'id,id; DROP TABLE users; --,amount\n1,2,3\n';
    const res = await postCsv(TABLE, csv);

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ERROR_CODES.INVALID_IMPORT_DATA);
    expect(body.error.message).toMatch(/invalid csv header/i);

    // Crucially: the adapter should NOT have been asked to insert anything.
    expect(mockAdapter.execute).not.toHaveBeenCalled();
  });

  it('rejects a header that is the literal SQL injection payload', async () => {
    // The exact payload from Plan 11 CSV-001: `; DROP TABLE users; --`
    // contains a space and a semicolon, both of which fail the identifier
    // allowlist. The parser passes it through verbatim because it has no
    // special CSV meaning.
    const csv = 'id,; DROP TABLE users; --,amount\n1,2,3\n';
    const res = await postCsv(TABLE, csv);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/invalid csv header/i);
    expect(mockAdapter.execute).not.toHaveBeenCalled();
  });

  it('rejects a header with a dot (no JSONB path traversal)', async () => {
    // A header `parent.column` looks like JSONB path syntax. Even though
    // SQL injection is not possible through `data->>KEY`, allowing dots in
    // column names opens a different attack surface (path traversal in
    // future refactors). Reject.
    const csv = 'id,parent.column,amount\n1,2,3\n';
    const res = await postCsv(TABLE, csv);

    expect(res.status).toBe(400);
    expect(mockAdapter.execute).not.toHaveBeenCalled();
  });

  it('accepts a header that contains only safe characters', async () => {
    // The happy path: all-lowercase alpha + underscore. We don't care what
    // the adapter does next — we only care that validation passed (no 400
    // at the header stage). The handler may still return 400/500 later for
    // other reasons (mocked adapter is permissive), but the response we
    // assert is "not the header-validation 400".
    const csv = 'id,date,amount\n1,2024-01-01,9.99\n';
    const res = await postCsv(TABLE, csv);

    // Header validation passed → no 400 with INVALID_IMPORT_DATA about headers.
    if (res.status === 400) {
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).not.toMatch(/invalid csv header/i);
    }
  });

  it('rejects when ANY one of the headers is invalid (fail fast on first)', async () => {
    // First header is fine, second is not. The validator should bail on
    // the second and never reach the database.
    const csv = 'id,bad;header,amount\n1,2,3\n';
    const res = await postCsv(TABLE, csv);

    expect(res.status).toBe(400);
    expect(mockAdapter.execute).not.toHaveBeenCalled();
  });
});
