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

// ---------------------------------------------------------------------------
// CSV export formula-injection sanitization (round 56, CWE-1236)
//
// escapeCsvValue writes user-controlled columns (note content, bookmark
// titles, descriptions, ...) into spreadsheet-interpreted cells. A cell
// beginning with = + - @ TAB or CR is evaluated as a formula/DDE when the
// export is opened in Excel/LibreOffice/Sheets (OWASP CSV Injection), so the
// exporter must prefix it with a single apostrophe — Excel's own guard. The
// prefix is export-side and idempotent; the import parser does not strip it
// (accepted OWASP trade-off, disclosed on round 56).
// ---------------------------------------------------------------------------

describe('csvExportRoutes — CSV export formula-injection sanitization (round 56)', () => {
  const EVIL = '=HYPERLINK("https://evil.example","Click me")';

  async function exportNotesWithContent(content: string): Promise<string> {
    mockAdapter.query.mockImplementation(async (sql: string) =>
      sql.includes('FROM "notes"')
        ? [
            {
              id: 'n1',
              title: 'Meeting notes',
              content,
              tags: ['work'],
              created_at: '2026-09-07T10:00:00.000Z',
            },
          ]
        : []
    );
    const res = await createApp().request('/db/export/csv/notes', {
      headers: { 'X-Admin-Key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    return res.text();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_KEY = ADMIN_KEY;
  });

  it('exports an = formula cell with a leading apostrophe, not raw', async () => {
    const csv = await exportNotesWithContent(EVIL);
    // The apostrophe makes the cell inert as a formula; quote-doubling and
    // comma-quoting must still apply so the field parses back as one cell.
    expect(csv).toContain(`'${EVIL.replace(/"/g, '""')}`);
  });

  it('exports + cells with a leading apostrophe', async () => {
    const csv = await exportNotesWithContent('+SUM(A1:A9)');
    expect(csv).toContain("'+SUM(A1:A9)");
  });

  it('exports - cells with a leading apostrophe', async () => {
    const csv = await exportNotesWithContent('-1+1|cmd');
    expect(csv).toContain("'-1+1|cmd");
  });

  it('exports @ cells with a leading apostrophe', async () => {
    const csv = await exportNotesWithContent('@cmd /c calc');
    expect(csv).toContain("'@cmd /c calc");
  });

  it('exports tab-leading cells with a leading apostrophe', async () => {
    const csv = await exportNotesWithContent('\tcmd');
    expect(csv).toContain("'\tcmd");
  });

  it('CONTROL: an already-prefixed cell is not double-prefixed (idempotent)', async () => {
    const csv = await exportNotesWithContent("'=already safe");
    expect(csv).toContain("'=already safe");
  });

  it('CONTROL: plain text cells are exported unchanged', async () => {
    const csv = await exportNotesWithContent('Coffee at cafe');
    expect(csv).toContain('Coffee at cafe');
  });

  it('sanitizes the all-tables export too', async () => {
    mockAdapter.query.mockImplementation(async (sql: string) =>
      sql.includes('FROM "notes"')
        ? [
            {
              id: 'n1',
              title: 'Meeting notes',
              content: EVIL,
              tags: ['work'],
              created_at: '2026-09-07T10:00:00.000Z',
            },
          ]
        : []
    );
    const res = await createApp().request('/db/export/csv', {
      headers: { 'X-Admin-Key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { tables?: Record<string, { rows?: string[] }> } };
    const row0 = body.data?.tables?.notes?.rows?.[0];
    expect(row0, 'notes table missing from the all-tables export').toBeTruthy();
    expect(row0).toContain(`'${EVIL.replace(/"/g, '""')}`);
  });
});

// ---------------------------------------------------------------------------
// CSV import quoted-multiline support (round 57)
//
// The importer used to split the raw body on '\n' BEFORE quote-aware
// parsing, tearing every quoted multiline cell — which the exporter
// legitimately emits (escapeCsvValue wraps values containing newlines) —
// into bogus rows and losing the embedded newline (silent data corruption
// on each export → import round trip; the continuation line was even
// inserted as a garbage row with a corrupted id). The importer now parses
// the whole content with a quote-aware parser (parseCsvRows): row/cell
// boundaries are only recognized outside quotes, CRLF terminators keep
// working, blank rows are dropped, and characters inside quotes (including
// newlines) are preserved verbatim.
// ---------------------------------------------------------------------------

describe('csvExportRoutes — CSV import quoted-multiline (round 57)', () => {
  // Exactly what an export → import round trip produces for a note with a
  // two-line body: 3 logical rows, one quoted cell holding an embedded LF.
  const ROUND_TRIP_CSV = [
    'id,title,content,tags',
    '"n1","Note","line one\nline two","work"',
    '"n2","Other","plain","misc"',
  ].join('\n');

  async function importCsv(body: string): Promise<{ imported?: number }> {
    const res = await createApp().request('/db/import/csv/notes', {
      method: 'POST',
      headers: { 'X-Admin-Key': ADMIN_KEY, 'Content-Type': 'text/csv' },
      body,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: { imported?: number } };
    return json.data ?? {};
  }

  function insertedRows(): Array<{ sql: string; values: unknown[] }> {
    return mockAdapter.execute.mock.calls.map((call) => ({
      sql: call[0] as string,
      values: call[1] as unknown[],
    }));
  }

  beforeEach(() => {
    // Without this, execute.mock.calls accumulate across the three tests
    // (2 → 4 → 6) and every length assertion breaks for harness reasons.
    vi.clearAllMocks();
    process.env.ADMIN_KEY = ADMIN_KEY;
  });

  it('imports a quoted multiline field as ONE row with the newline preserved', async () => {
    const body = await importCsv(ROUND_TRIP_CSV);
    expect(body.imported).toBe(2);
    const rows = insertedRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.values[2]).toBe('line one\nline two');
    expect(rows[0]!.values[0]).toBe('n1');
    expect(rows[1]!.values[2]).toBe('plain');
    expect(rows[1]!.values[0]).toBe('n2');
  });

  it('handles CRLF row terminators while preserving the embedded LF inside quotes', async () => {
    const crlf = [
      'id,title,content,tags',
      '"n1","Note","line one\nline two","work"',
      '"n2","Other","plain","misc"',
    ].join('\r\n');
    const body = await importCsv(crlf);
    expect(body.imported).toBe(2);
    const rows = insertedRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.values[2]).toBe('line one\nline two');
    expect(rows[1]!.values[0]).toBe('n2');
  });

  it('CONTROL: plain single-line rows still import unchanged', async () => {
    const body = await importCsv('id,title,content,tags\n"n1","A","x","t"\n"n2","B","y","u"');
    expect(body.imported).toBe(2);
    const rows = insertedRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.values[0]).toBe('n1');
    expect(rows[1]!.values[0]).toBe('n2');
  });
});

// ---------------------------------------------------------------------------
// CSV import id-only rows (round 58, silent invalid-SQL defect)
//
// The per-row guard used to skip only rows whose cells were ALL empty. A row
// whose sole non-empty column is the upsert key 'id' passed that guard, and
// the SQL builder filtered 'id' out of the DO UPDATE SET assignments,
// emitting `ON CONFLICT ("id") DO UPDATE SET ` with a dangling empty SET
// clause — invalid SQL that the per-row catch silently swallowed as
// errors++ with no diagnostic (observed verbatim in the round-57 proof
// output). Id-only rows are now skipped as dataless, like fully empty rows.
// ---------------------------------------------------------------------------

describe('csvExportRoutes — CSV import id-only rows (round 58)', () => {
  async function importCsv(body: string): Promise<{ imported?: number; errors?: number }> {
    const res = await createApp().request('/db/import/csv/notes', {
      method: 'POST',
      headers: { 'X-Admin-Key': ADMIN_KEY, 'Content-Type': 'text/csv' },
      body,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: { imported?: number; errors?: number } };
    return json.data ?? {};
  }

  function insertedRows(): Array<{ sql: string; values: unknown[] }> {
    return mockAdapter.execute.mock.calls.map((call) => ({
      sql: call[0] as string,
      values: call[1] as unknown[],
    }));
  }

  beforeEach(() => {
    // Isolation: count only this test's inserts (round-57 trap: without
    // clearAllMocks the execute.mock.calls accumulate across tests).
    vi.clearAllMocks();
    process.env.ADMIN_KEY = ADMIN_KEY;
  });

  it('skips an id-only data row as dataless — no invalid dangling-SET SQL, no silent error', async () => {
    const body = await importCsv('id,title,content,tags\n"n1",,,\n"n2","Other","body","misc"');
    const bad = insertedRows().filter((r) => /DO UPDATE SET\s*$/.test(r.sql));
    expect(
      bad,
      `id-only row built invalid SQL: ${JSON.stringify(bad.map((r) => r.sql))}`
    ).toHaveLength(0);
    expect(body.imported).toBe(1); // only n2 remains
    expect(body.errors).toBe(0);
    expect(insertedRows()).toHaveLength(1);
    expect(insertedRows()[0]!.values[0]).toBe('n2');
  });

  it('CONTROL: a mixed row still builds a valid upsert', async () => {
    const body = await importCsv('id,title,content,tags\n"n1","Note","body","work"');
    expect(body.imported).toBe(1);
    const rows = insertedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sql).toContain('DO UPDATE SET "title" = EXCLUDED."title"');
  });

  it('CONTROL: a fully empty data row is skipped too (true before and after the fix)', async () => {
    const body = await importCsv('id,title,content,tags\n"n1","Note","body","work"\n,,,');
    expect(body.imported).toBe(1);
    expect(body.errors).toBe(0);
    expect(insertedRows()).toHaveLength(1);
    expect(insertedRows()[0]!.values[0]).toBe('n1');
  });
});

// ---------------------------------------------------------------------------
// CSV import header-order mapping (round 59)
//
// The importer paired canonical-order columns[j] (tableColumns filtered to
// the headers present) with file-order values[j]. The file's header order is
// arbitrary (spreadsheet edits reorder columns), so any import whose columns
// were not in the canonical CSV_TABLES order had its values silently
// assigned to the WRONG columns — id received the content value, etc. The
// importer now maps each table column to its position in the FILE's header
// row (headerIndex) and reads cells by that index; the header is the
// contract, not the position.
// ---------------------------------------------------------------------------

describe('csvExportRoutes — CSV import header-order mapping (round 59)', () => {
  async function importCsv(body: string): Promise<{ imported?: number }> {
    const res = await createApp().request('/db/import/csv/notes', {
      method: 'POST',
      headers: { 'X-Admin-Key': ADMIN_KEY, 'Content-Type': 'text/csv' },
      body,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: { imported?: number } };
    return json.data ?? {};
  }

  function insertedValues(): unknown[] {
    expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
    return mockAdapter.execute.mock.calls[0]![1] as unknown[];
  }

  beforeEach(() => {
    // Isolation: count only this test's inserts (round-57 trap).
    vi.clearAllMocks();
    process.env.ADMIN_KEY = ADMIN_KEY;
  });

  it('CONTROL: canonical column order still imports correctly', async () => {
    const body = await importCsv('id,title,content,tags\n"n1","My note","my body","work"');
    expect(body.imported).toBe(1);
    expect(insertedValues()).toEqual(['n1', 'My note', 'my body', 'work']);
  });

  it('imports a REORDERED header by name: content,tags,id,title', async () => {
    // Pre-fix this stored id='my body', title='work', content='n1',
    // tags='My note' — the content value became the primary key.
    const body = await importCsv('content,tags,id,title\n"my body","work","n1","My note"');
    expect(body.imported).toBe(1);
    expect(insertedValues()).toEqual(['n1', 'My note', 'my body', 'work']);
  });

  it('imports a reordered SUBSET header by name: title,id', async () => {
    // Pre-fix this stored id='My note', title='n1'.
    const body = await importCsv('title,id\n"My note","n1"');
    expect(body.imported).toBe(1);
    expect(insertedValues()).toEqual(['n1', 'My note']);
  });
});
