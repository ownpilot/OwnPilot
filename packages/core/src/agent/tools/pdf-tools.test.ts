import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockTryImport = vi.hoisted(() => vi.fn());
const mockAccess = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockDirname = vi.hoisted(
  () => vi.fn((p: string) => p.substring(0, p.lastIndexOf('/')) || '.'),
);

vi.mock('./module-resolver.js', () => ({
  tryImport: (...args: unknown[]) => mockTryImport(...args),
}));

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

vi.mock('node:path', () => ({
  dirname: (...args: unknown[]) => mockDirname(...args),
}));

// ---------------------------------------------------------------------------
// Import module under test (after mocks are wired)
// ---------------------------------------------------------------------------

const {
  readPdfTool,
  readPdfExecutor,
  createPdfTool,
  createPdfExecutor,
  pdfInfoTool,
  pdfInfoExecutor,
  PDF_TOOLS,
  PDF_TOOL_NAMES,
} = await import('./pdf-tools.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyContext = {} as Parameters<typeof readPdfExecutor>[1];

function makePdfParseResult(overrides: Record<string, unknown> = {}) {
  return {
    text: 'Hello World',
    numpages: 3,
    info: { Title: 'Test PDF' },
    metadata: { Producer: 'Test' },
    ...overrides,
  };
}

function makeStat(overrides: Record<string, unknown> = {}) {
  return {
    size: 4096,
    mtime: new Date('2025-06-15T12:00:00Z'),
    ...overrides,
  };
}

interface MockDoc {
  fontSize: ReturnType<typeof vi.fn>;
  text: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

/**
 * Creates a mock PDFDocument constructor whose instances behave like an
 * EventEmitter: listeners for 'data' and 'end' are stored, and calling
 * `doc.end()` flushes a single chunk then fires 'end'.
 *
 * The 'end' event is emitted asynchronously (via queueMicrotask) to match
 * real PDFDocument behavior where `doc.on('end', resolve)` is registered
 * AFTER `doc.end()` is called.
 *
 * Returns both the constructor mock and a reference to the last created
 * document instance for assertions.
 */
function makePdfKitMock(chunkContent = 'pdf-bytes') {
  const docRef: { current: MockDoc | null } = { current: null };

  // Using a function expression (not arrow) so it works with `new`.
  const MockPDFDocument = vi.fn().mockImplementation(function () {
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    const doc: MockDoc = {
      fontSize: vi.fn().mockReturnThis(),
      text: vi.fn().mockReturnThis(),
      end: vi.fn(() => {
        // Emit 'data' synchronously (chunks must be collected before 'end')
        const chunk = Buffer.from(chunkContent);
        for (const cb of listeners['data'] ?? []) cb(chunk);
        // Emit 'end' asynchronously so that the caller can register the
        // `doc.on('end', resolve)` listener before it fires.
        queueMicrotask(() => {
          for (const cb of listeners['end'] ?? []) cb();
        });
      }),
      on: vi.fn((event: string, cb: (...a: unknown[]) => void) => {
        (listeners[event] ??= []).push(cb);
        return doc;
      }),
    };
    docRef.current = doc;
    return doc;
  });

  return { MockPDFDocument, docRef };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  mockDirname.mockImplementation(
    (p: string) => p.substring(0, p.lastIndexOf('/')) || '.',
  );
});

// =====================================================================
// Tool definition structures
// =====================================================================

describe('Tool definitions', () => {
  it('readPdfTool has correct name', () => {
    expect(readPdfTool.name).toBe('read_pdf');
  });

  it('readPdfTool requires path', () => {
    expect(readPdfTool.parameters.required).toContain('path');
  });

  it('readPdfTool exposes pages, extractImages, extractTables params', () => {
    const props = readPdfTool.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty('pages');
    expect(props).toHaveProperty('extractImages');
    expect(props).toHaveProperty('extractTables');
  });

  it('readPdfTool has brief and description strings', () => {
    expect(typeof readPdfTool.brief).toBe('string');
    expect(typeof readPdfTool.description).toBe('string');
    expect(readPdfTool.brief.length).toBeGreaterThan(0);
    expect(readPdfTool.description.length).toBeGreaterThan(0);
  });

  it('createPdfTool has correct name', () => {
    expect(createPdfTool.name).toBe('create_pdf');
  });

  it('createPdfTool requires path and content', () => {
    expect(createPdfTool.parameters.required).toEqual(
      expect.arrayContaining(['path', 'content']),
    );
  });

  it('createPdfTool exposes format, title, author, pageSize, margins params', () => {
    const props = createPdfTool.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty('format');
    expect(props).toHaveProperty('title');
    expect(props).toHaveProperty('author');
    expect(props).toHaveProperty('pageSize');
    expect(props).toHaveProperty('margins');
  });

  it('pdfInfoTool has correct name', () => {
    expect(pdfInfoTool.name).toBe('get_pdf_info');
  });

  it('pdfInfoTool requires path', () => {
    expect(pdfInfoTool.parameters.required).toContain('path');
  });

  it('pdfInfoTool has brief and description strings', () => {
    expect(typeof pdfInfoTool.brief).toBe('string');
    expect(typeof pdfInfoTool.description).toBe('string');
  });
});

// =====================================================================
// PDF_TOOLS and PDF_TOOL_NAMES arrays
// =====================================================================

describe('PDF_TOOLS / PDF_TOOL_NAMES', () => {
  it('PDF_TOOLS contains exactly 3 entries', () => {
    expect(PDF_TOOLS).toHaveLength(3);
  });

  it('PDF_TOOLS pairs definitions with executors', () => {
    expect(PDF_TOOLS[0].definition).toBe(readPdfTool);
    expect(PDF_TOOLS[0].executor).toBe(readPdfExecutor);
    expect(PDF_TOOLS[1].definition).toBe(createPdfTool);
    expect(PDF_TOOLS[1].executor).toBe(createPdfExecutor);
    expect(PDF_TOOLS[2].definition).toBe(pdfInfoTool);
    expect(PDF_TOOLS[2].executor).toBe(pdfInfoExecutor);
  });

  it('PDF_TOOL_NAMES matches definition names', () => {
    expect(PDF_TOOL_NAMES).toEqual(['read_pdf', 'create_pdf', 'get_pdf_info']);
  });

  it('PDF_TOOL_NAMES length matches PDF_TOOLS length', () => {
    expect(PDF_TOOL_NAMES).toHaveLength(PDF_TOOLS.length);
  });

  it('each PDF_TOOLS entry has definition and executor properties', () => {
    for (const entry of PDF_TOOLS) {
      expect(entry).toHaveProperty('definition');
      expect(entry).toHaveProperty('executor');
      expect(typeof entry.executor).toBe('function');
      expect(typeof entry.definition.name).toBe('string');
    }
  });
});

// =====================================================================
// readPdfExecutor
// =====================================================================

describe('readPdfExecutor', () => {
  it('returns error when file is not found', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
    const result = await readPdfExecutor({ path: '/missing.pdf' }, emptyContext);
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toContain(
      'PDF file not found: /missing.pdf',
    );
  });

  it('reads file and returns parsed data when pdf-parse is available', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    const buf = Buffer.from('fake-pdf');
    mockReadFile.mockResolvedValueOnce(buf);
    const parseData = makePdfParseResult();
    const mockParse = vi.fn().mockResolvedValueOnce(parseData);
    mockTryImport.mockResolvedValueOnce({ default: mockParse });

    const result = await readPdfExecutor({ path: '/test.pdf' }, emptyContext);
    expect(result.isError).toBe(false);
    const content = result.content as Record<string, unknown>;
    expect(content.text).toBe('Hello World');
    expect(content.pageCount).toBe(3);
    expect(content.info).toEqual({ Title: 'Test PDF' });
    expect(content.metadata).toEqual({ Producer: 'Test' });
    expect(mockParse).toHaveBeenCalledWith(buf);
  });

  it('does not add page-filter note when pages is "all"', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi.fn().mockResolvedValueOnce(makePdfParseResult()),
    });

    const result = await readPdfExecutor(
      { path: '/test.pdf', pages: 'all' },
      emptyContext,
    );
    expect((result.content as Record<string, unknown>).note).toBeUndefined();
  });

  it('adds page-filter note when pages is not "all"', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi.fn().mockResolvedValueOnce(makePdfParseResult()),
    });

    const result = await readPdfExecutor(
      { path: '/test.pdf', pages: '1-3' },
      emptyContext,
    );
    expect((result.content as Record<string, unknown>).note).toBe(
      'Page filtering applied at text level',
    );
  });

  it('defaults pages to "all" when not provided', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi.fn().mockResolvedValueOnce(makePdfParseResult()),
    });

    const result = await readPdfExecutor({ path: '/test.pdf' }, emptyContext);
    expect((result.content as Record<string, unknown>).note).toBeUndefined();
  });

  it('does not add note when pages is non-all but text is empty', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi
        .fn()
        .mockResolvedValueOnce(makePdfParseResult({ text: '' })),
    });

    const result = await readPdfExecutor(
      { path: '/test.pdf', pages: '2' },
      emptyContext,
    );
    // data.text is '', which is falsy, so pages-filter branch not entered
    expect((result.content as Record<string, unknown>).note).toBeUndefined();
  });

  it('does not include tables when extractTables is false', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi.fn().mockResolvedValueOnce(makePdfParseResult()),
    });

    const result = await readPdfExecutor(
      { path: '/test.pdf', extractTables: false },
      emptyContext,
    );
    expect((result.content as Record<string, unknown>).tables).toBeUndefined();
  });

  it('does not include tables when extractTables is not provided', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi.fn().mockResolvedValueOnce(makePdfParseResult()),
    });

    const result = await readPdfExecutor({ path: '/test.pdf' }, emptyContext);
    expect((result.content as Record<string, unknown>).tables).toBeUndefined();
  });

  it('extracts tables when extractTables is true', async () => {
    const textWithTable = [
      'Name  Age  City',
      'Alice  30  NYC',
      'Bob  25  LA',
    ].join('\n');

    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi
        .fn()
        .mockResolvedValueOnce(makePdfParseResult({ text: textWithTable })),
    });

    const result = await readPdfExecutor(
      { path: '/test.pdf', extractTables: true },
      emptyContext,
    );
    const content = result.content as Record<string, unknown>;
    expect(content.tables).toBeDefined();
    const tables = content.tables as Array<{ rows: string[][] }>;
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(3);
  });

  it('falls back to file info when pdf-parse is unavailable', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockRejectedValueOnce(new Error('not found'));
    mockStat.mockResolvedValueOnce(makeStat());

    const result = await readPdfExecutor({ path: '/test.pdf' }, emptyContext);
    expect(result.isError).toBe(false);
    const content = result.content as Record<string, unknown>;
    expect(content.warning).toContain('pdf-parse library not installed');
    expect(content.path).toBe('/test.pdf');
    expect(content.size).toBe(4096);
    expect(content.modified).toBe('2025-06-15T12:00:00.000Z');
  });

  it('returns error on general exception', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockRejectedValueOnce(new Error('read failed'));

    const result = await readPdfExecutor({ path: '/test.pdf' }, emptyContext);
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toContain(
      'Failed to read PDF: read failed',
    );
  });
});

// =====================================================================
// extractTablesFromText (tested through readPdfExecutor)
// =====================================================================

describe('extractTablesFromText (via readPdfExecutor)', () => {
  async function extractTables(text: string) {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi
        .fn()
        .mockResolvedValueOnce(makePdfParseResult({ text })),
    });
    const result = await readPdfExecutor(
      { path: '/t.pdf', extractTables: true },
      emptyContext,
    );
    return (result.content as Record<string, unknown>).tables as Array<{
      rows: string[][];
    }>;
  }

  it('returns empty array when text has no table-like lines', async () => {
    const tables = await extractTables('Just a normal sentence.\nAnother line.');
    expect(tables).toEqual([]);
  });

  it('returns empty array when table has only 1 row (minimum is 2)', async () => {
    const tables = await extractTables(
      'single line\nName  Age  City\nnot a table',
    );
    // Only one table-like line between non-table lines
    expect(tables).toEqual([]);
  });

  it('detects a single table with exactly 2 rows', async () => {
    const text = 'Header  Col2\nRow1  Val1';
    const tables = await extractTables(text);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(2);
  });

  it('detects a single table with multiple rows', async () => {
    const text = [
      'Name  Age  City',
      'Alice  30  NYC',
      'Bob  25  LA',
      'Carol  35  SF',
    ].join('\n');
    const tables = await extractTables(text);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(4);
  });

  it('splits columns by 2+ whitespace characters', async () => {
    const text = 'First Name  Last Name\nJohn  Doe';
    const tables = await extractTables(text);
    expect(tables[0].rows[0]).toEqual(['First Name', 'Last Name']);
    expect(tables[0].rows[1]).toEqual(['John', 'Doe']);
  });

  it('detects multiple separate tables', async () => {
    const text = [
      'A  B',
      'C  D',
      'not a table line',
      'X  Y  Z',
      'P  Q  R',
    ].join('\n');
    const tables = await extractTables(text);
    expect(tables).toHaveLength(2);
    expect(tables[0].rows).toHaveLength(2);
    expect(tables[1].rows).toHaveLength(2);
  });

  it('handles trailing table at end of text (no closing non-table line)', async () => {
    const text = [
      'some preamble',
      'Col1  Col2',
      'Val1  Val2',
      'Val3  Val4',
    ].join('\n');
    const tables = await extractTables(text);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(3);
  });

  it('skips single-column lines (not table-like)', async () => {
    const text = [
      'SingleWord',
      'Another single column line',
      'Col1  Col2',
      'Val1  Val2',
    ].join('\n');
    const tables = await extractTables(text);
    expect(tables).toHaveLength(1);
  });

  it('ignores short table (1 row) followed by a valid table', async () => {
    const text = [
      'Short  Table',
      'break',
      'Long  Table  Here',
      'Row2  Data  More',
      'Row3  Data  More',
    ].join('\n');
    const tables = await extractTables(text);
    // First "table" has only 1 row -> skipped. Second has 3 rows.
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(3);
  });

  it('returns empty array for empty text', async () => {
    const tables = await extractTables('');
    expect(tables).toEqual([]);
  });

  it('handles text with only whitespace lines', async () => {
    const tables = await extractTables('  \n   \n  ');
    expect(tables).toEqual([]);
  });

  it('handles lines with exactly 2 columns', async () => {
    const text = 'Key  Value\nFoo  Bar';
    const tables = await extractTables(text);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows[0]).toHaveLength(2);
  });

  it('handles lines with many columns', async () => {
    const text = 'A  B  C  D  E\n1  2  3  4  5';
    const tables = await extractTables(text);
    expect(tables[0].rows[0]).toHaveLength(5);
  });

  it('trims whitespace from column values via filter', async () => {
    const text = '  Name  Age  \n  Alice  30  ';
    const tables = await extractTables(text);
    expect(tables).toHaveLength(1);
    // The filter(c => c.trim()) removes empty strings from split
    expect(tables[0].rows[0].every((c) => c.trim().length > 0)).toBe(true);
  });

  it('treats three consecutive table-like lines as one table', async () => {
    const text = 'X  Y\nA  B\nC  D';
    const tables = await extractTables(text);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(3);
  });
});

// =====================================================================
// createPdfExecutor
// =====================================================================

describe('createPdfExecutor', () => {
  it('creates output directory recursively', async () => {
    const { MockPDFDocument } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    await createPdfExecutor(
      { path: '/out/dir/test.pdf', content: 'hello' },
      emptyContext,
    );
    expect(mockMkdir).toHaveBeenCalledWith('/out/dir', { recursive: true });
  });

  it('returns success with file metadata on pdfkit success', async () => {
    const { MockPDFDocument } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    const result = await createPdfExecutor(
      {
        path: '/out/test.pdf',
        content: 'hello',
        title: 'My Doc',
        author: 'Tester',
        pageSize: 'Letter',
      },
      emptyContext,
    );
    expect(result.isError).toBe(false);
    const content = result.content as Record<string, unknown>;
    expect(content.success).toBe(true);
    expect(content.path).toBe('/out/test.pdf');
    expect(content.size).toBeGreaterThan(0);
    expect(content.pageSize).toBe('Letter');
    expect(content.title).toBe('My Doc');
    expect(content.author).toBe('Tester');
  });

  it('defaults format to text, pageSize to A4', async () => {
    const { MockPDFDocument, docRef } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    const result = await createPdfExecutor(
      { path: '/out/test.pdf', content: 'plain text' },
      emptyContext,
    );
    const content = result.content as Record<string, unknown>;
    expect(content.pageSize).toBe('A4');

    // text format: content passed directly to doc.text
    expect(docRef.current!.text).toHaveBeenCalledWith('plain text', {
      align: 'left',
    });
  });

  it('passes title, author, and Creator to PDFDocument info', async () => {
    const { MockPDFDocument } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    await createPdfExecutor(
      {
        path: '/out/test.pdf',
        content: 'x',
        title: 'T',
        author: 'A',
      },
      emptyContext,
    );
    expect(MockPDFDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        info: expect.objectContaining({
          Title: 'T',
          Author: 'A',
          Creator: 'OwnPilot',
        }),
      }),
    );
  });

  it('writes the concatenated PDF buffer to the output path', async () => {
    const { MockPDFDocument } = makePdfKitMock('chunk-data');
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    await createPdfExecutor(
      { path: '/out/test.pdf', content: 'x' },
      emptyContext,
    );
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [writePath, writeBuf] = mockWriteFile.mock.calls[0] as [
      string,
      Buffer,
    ];
    expect(writePath).toBe('/out/test.pdf');
    expect(writeBuf.toString()).toBe('chunk-data');
  });

  it('handles html format by stripping tags', async () => {
    const { MockPDFDocument, docRef } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    await createPdfExecutor(
      {
        path: '/out/test.pdf',
        content: '<h1>Title</h1><p>Body</p>',
        format: 'html',
      },
      emptyContext,
    );
    expect(docRef.current!.text).toHaveBeenCalledWith('TitleBody', {
      align: 'left',
    });
  });

  it('handles markdown format by converting to plain text', async () => {
    const { MockPDFDocument, docRef } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    await createPdfExecutor(
      {
        path: '/out/test.pdf',
        content: '# Hello\n**bold**',
        format: 'markdown',
      },
      emptyContext,
    );
    const textArg = docRef.current!.text.mock.calls[0][0] as string;
    // Header converted: "# Hello" -> "\nHello\n"
    expect(textArg).toContain('Hello');
    // Bold stripped
    expect(textArg).not.toContain('**');
    expect(textArg).toContain('bold');
  });

  it('calls doc.fontSize(12) regardless of format', async () => {
    for (const format of ['text', 'html', 'markdown']) {
      vi.resetAllMocks();
      mockDirname.mockReturnValue('.');
      const { MockPDFDocument, docRef } = makePdfKitMock();
      mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
      mockMkdir.mockResolvedValueOnce(undefined);
      mockWriteFile.mockResolvedValueOnce(undefined);

      await createPdfExecutor(
        { path: '/test.pdf', content: 'x', format },
        emptyContext,
      );
      expect(docRef.current!.fontSize).toHaveBeenCalledWith(12);
    }
  });

  it('returns error when pdfkit is unavailable', async () => {
    mockTryImport.mockRejectedValueOnce(new Error('not found'));
    mockMkdir.mockResolvedValueOnce(undefined);

    const result = await createPdfExecutor(
      { path: '/out/test.pdf', content: 'x' },
      emptyContext,
    );
    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(content.error).toContain('pdfkit library not installed');
    expect(content.suggestion).toContain('pnpm add pdfkit');
  });

  it('returns error on general exception', async () => {
    mockMkdir.mockRejectedValueOnce(new Error('EACCES'));

    const result = await createPdfExecutor(
      { path: '/no-perms/test.pdf', content: 'x' },
      emptyContext,
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toContain(
      'Failed to create PDF: EACCES',
    );
  });

  it('title and author are undefined when not provided', async () => {
    const { MockPDFDocument } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    const result = await createPdfExecutor(
      { path: '/out/test.pdf', content: 'x' },
      emptyContext,
    );
    const content = result.content as Record<string, unknown>;
    expect(content.title).toBeUndefined();
    expect(content.author).toBeUndefined();
  });

  it('calls doc.end() to finalize the PDF', async () => {
    const { MockPDFDocument, docRef } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    await createPdfExecutor(
      { path: '/out/test.pdf', content: 'test' },
      emptyContext,
    );
    expect(docRef.current!.end).toHaveBeenCalledTimes(1);
  });

  it('passes pageSize to PDFDocument constructor', async () => {
    const { MockPDFDocument } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    await createPdfExecutor(
      { path: '/out/test.pdf', content: 'x', pageSize: 'Legal' },
      emptyContext,
    );
    expect(MockPDFDocument).toHaveBeenCalledWith(
      expect.objectContaining({ size: 'Legal' }),
    );
  });
});

// =====================================================================
// convertMarkdownToText (tested through createPdfExecutor)
// =====================================================================

describe('convertMarkdownToText (via createPdfExecutor)', () => {
  async function convertMd(markdown: string): Promise<string> {
    const { MockPDFDocument, docRef } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);
    mockDirname.mockReturnValue('.');

    await createPdfExecutor(
      { path: '/t.pdf', content: markdown, format: 'markdown' },
      emptyContext,
    );
    return docRef.current!.text.mock.calls[0][0] as string;
  }

  // --- Headers ---

  it('converts # heading', async () => {
    const result = await convertMd('# Title');
    expect(result).toContain('\nTitle\n');
  });

  it('converts ## heading', async () => {
    const result = await convertMd('## Subtitle');
    expect(result).toContain('\nSubtitle\n');
  });

  it('converts ### heading', async () => {
    const result = await convertMd('### H3');
    expect(result).toContain('\nH3\n');
  });

  it('converts #### heading', async () => {
    const result = await convertMd('#### H4');
    expect(result).toContain('\nH4\n');
  });

  it('converts ##### heading', async () => {
    const result = await convertMd('##### H5');
    expect(result).toContain('\nH5\n');
  });

  it('converts ###### heading', async () => {
    const result = await convertMd('###### H6');
    expect(result).toContain('\nH6\n');
  });

  // --- Bold ---

  it('strips **bold** markers', async () => {
    const result = await convertMd('This is **bold** text');
    expect(result).toContain('This is bold text');
    expect(result).not.toContain('**');
  });

  it('strips __bold__ markers', async () => {
    const result = await convertMd('This is __bold__ text');
    expect(result).toContain('This is bold text');
    expect(result).not.toContain('__');
  });

  // --- Italic ---

  it('strips *italic* markers', async () => {
    const result = await convertMd('This is *italic* text');
    expect(result).toContain('This is italic text');
    expect(result).not.toContain('*');
  });

  it('strips _italic_ markers', async () => {
    const result = await convertMd('This is _italic_ text');
    expect(result).toContain('This is italic text');
  });

  // --- Links ---

  it('converts [text](url) to text (url)', async () => {
    const result = await convertMd('Visit [Example](https://example.com) now');
    expect(result).toContain('Example (https://example.com)');
    expect(result).not.toContain('[');
    expect(result).not.toContain(']');
  });

  // --- Unordered lists ---

  it('converts - list items to bullet character', async () => {
    const result = await convertMd('- Item one\n- Item two');
    expect(result).toContain('\u2022 Item one');
    expect(result).toContain('\u2022 Item two');
  });

  it('converts * list items to bullet character', async () => {
    const result = await convertMd('* Apple\n* Banana');
    // The list regex runs after bold/italic. "* Apple" as italic:
    // *(.+?)* requires matching closing *, but "* Apple\n* Banana"
    // would match *(.+?)* across "Apple\n" only if `.` matched newlines (it doesn't).
    // So italic won't match, and the list regex will convert "* " -> bullet.
    expect(result).toContain('Apple');
    expect(result).toContain('Banana');
  });

  it('converts + list items to bullet character', async () => {
    const result = await convertMd('+ Item one');
    expect(result).toContain('\u2022 Item one');
  });

  // --- Ordered lists ---

  it('converts numbered lists to indented text', async () => {
    const result = await convertMd('1. First\n2. Second');
    expect(result).toContain('  First');
    expect(result).toContain('  Second');
    expect(result).not.toContain('1.');
    expect(result).not.toContain('2.');
  });

  // --- Code blocks ---

  it('strips code block fences and keeps content', async () => {
    const result = await convertMd('```js\nconsole.log("hi");\n```');
    expect(result).toContain('console.log("hi");');
    expect(result).not.toContain('```');
  });

  it('strips code block fences without language specifier', async () => {
    const result = await convertMd('```\nplain code\n```');
    expect(result).toContain('plain code');
    expect(result).not.toContain('```');
  });

  // --- Inline code ---

  it('strips backticks from inline code', async () => {
    const result = await convertMd('Use `console.log` to debug');
    expect(result).toContain('Use console.log to debug');
    expect(result).not.toContain('`');
  });

  // --- Blockquotes ---

  it('converts blockquotes to indented text', async () => {
    const result = await convertMd('> This is a quote');
    expect(result).toContain('  This is a quote');
    expect(result).not.toContain('>');
  });

  // --- Horizontal rules ---

  it('converts --- to \\n---\\n', async () => {
    const result = await convertMd('above\n---\nbelow');
    expect(result).toContain('\n---\n');
  });

  it('*** is consumed by italic regex before horizontal rule', async () => {
    // Bold/italic regexes run before horizontal rule: *(.+?)* matches *** -> *
    const result = await convertMd('above\n***\nbelow');
    // The horizontal rule regex never sees ***, so no \n---\n
    expect(result).not.toContain('***');
  });

  it('___ is consumed by italic regex before horizontal rule', async () => {
    // Italic regex _(.+?)_ matches ___ -> _ (single underscore remains)
    const result = await convertMd('above\n___\nbelow');
    expect(result).not.toContain('___');
  });

  it('converts ---- (4 dashes) to \\n---\\n', async () => {
    const result = await convertMd('above\n----\nbelow');
    expect(result).toContain('\n---\n');
  });

  // --- Combined ---

  it('handles combined markdown elements', async () => {
    const md = [
      '# Report',
      '',
      'This is **important** and *urgent*.',
      '',
      '- Item A',
      '- Item B',
      '',
      '> Note: check this',
      '',
      '`code here`',
    ].join('\n');

    const result = await convertMd(md);
    expect(result).toContain('\nReport\n');
    expect(result).toContain('important');
    expect(result).toContain('urgent');
    expect(result).toContain('\u2022 Item A');
    expect(result).toContain('  Note: check this');
    expect(result).toContain('code here');
    expect(result).not.toContain('**');
    expect(result).not.toContain('`');
  });

  it('preserves plain text unchanged', async () => {
    const result = await convertMd('Just plain text with no formatting.');
    expect(result).toBe('Just plain text with no formatting.');
  });

  it('handles multiple bold segments in one line', async () => {
    const result = await convertMd('**first** and **second**');
    expect(result).toBe('first and second');
  });

  it('handles nested bold within italic-like context gracefully', async () => {
    // Bold is processed before italic
    const result = await convertMd('**bold text** then *italic text*');
    expect(result).toContain('bold text');
    expect(result).toContain('italic text');
    expect(result).not.toContain('**');
    expect(result).not.toContain('*');
  });
});

// =====================================================================
// pdfInfoExecutor
// =====================================================================

describe('pdfInfoExecutor', () => {
  it('returns full info when pdf-parse is available', async () => {
    const stats = makeStat();
    mockStat.mockResolvedValueOnce(stats);
    mockReadFile.mockResolvedValueOnce(Buffer.from('pdf-data'));

    const parseData = makePdfParseResult({ numpages: 10 });
    const mockParse = vi.fn().mockResolvedValueOnce(parseData);
    mockTryImport.mockResolvedValueOnce({ default: mockParse });

    const result = await pdfInfoExecutor(
      { path: '/info.pdf' },
      emptyContext,
    );
    expect(result.isError).toBe(false);
    const content = result.content as Record<string, unknown>;
    expect(content.path).toBe('/info.pdf');
    expect(content.size).toBe(4096);
    expect(content.modified).toBe('2025-06-15T12:00:00.000Z');
    expect(content.pageCount).toBe(10);
    expect(content.info).toEqual({ Title: 'Test PDF' });
    expect(content.metadata).toEqual({ Producer: 'Test' });
  });

  it('passes { max: 1 } to pdf-parse for speed', async () => {
    mockStat.mockResolvedValueOnce(makeStat());
    const buf = Buffer.from('x');
    mockReadFile.mockResolvedValueOnce(buf);

    const mockParse = vi.fn().mockResolvedValueOnce(makePdfParseResult());
    mockTryImport.mockResolvedValueOnce({ default: mockParse });

    await pdfInfoExecutor({ path: '/info.pdf' }, emptyContext);
    expect(mockParse).toHaveBeenCalledWith(buf, { max: 1 });
  });

  it('returns basic info with warning when pdf-parse is unavailable', async () => {
    const stats = makeStat();
    mockStat.mockResolvedValueOnce(stats);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockRejectedValueOnce(new Error('not found'));

    const result = await pdfInfoExecutor(
      { path: '/info.pdf' },
      emptyContext,
    );
    expect(result.isError).toBe(false);
    const content = result.content as Record<string, unknown>;
    expect(content.path).toBe('/info.pdf');
    expect(content.size).toBe(4096);
    expect(content.modified).toBe('2025-06-15T12:00:00.000Z');
    expect(content.warning).toContain('Install pdf-parse');
    expect(content.pageCount).toBeUndefined();
  });

  it('returns error when file does not exist (stat fails)', async () => {
    mockStat.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await pdfInfoExecutor(
      { path: '/missing.pdf' },
      emptyContext,
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toContain(
      'Failed to get PDF info: ENOENT',
    );
  });

  it('returns error when readFile fails', async () => {
    mockStat.mockResolvedValueOnce(makeStat());
    mockReadFile.mockRejectedValueOnce(new Error('read error'));

    const result = await pdfInfoExecutor(
      { path: '/bad.pdf' },
      emptyContext,
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toContain(
      'Failed to get PDF info: read error',
    );
  });

  it('returns error when pdf-parse throws during parsing', async () => {
    mockStat.mockResolvedValueOnce(makeStat());
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi.fn().mockRejectedValueOnce(new Error('corrupt PDF')),
    });

    const result = await pdfInfoExecutor(
      { path: '/corrupt.pdf' },
      emptyContext,
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toContain(
      'corrupt PDF',
    );
  });

  it('does not include warning field when pdf-parse succeeds', async () => {
    mockStat.mockResolvedValueOnce(makeStat());
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi.fn().mockResolvedValueOnce(makePdfParseResult()),
    });

    const result = await pdfInfoExecutor(
      { path: '/info.pdf' },
      emptyContext,
    );
    expect(
      (result.content as Record<string, unknown>).warning,
    ).toBeUndefined();
  });
});

// =====================================================================
// Edge cases and integration-style scenarios
// =====================================================================

describe('Edge cases', () => {
  it('readPdfExecutor with extractTables on text with no tables returns empty array', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi
        .fn()
        .mockResolvedValueOnce(
          makePdfParseResult({ text: 'No tables here at all.' }),
        ),
    });

    const result = await readPdfExecutor(
      { path: '/t.pdf', extractTables: true },
      emptyContext,
    );
    expect(
      (result.content as Record<string, unknown>).tables,
    ).toEqual([]);
  });

  it('createPdfExecutor with empty content succeeds', async () => {
    const { MockPDFDocument } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    const result = await createPdfExecutor(
      { path: '/out/empty.pdf', content: '' },
      emptyContext,
    );
    expect(result.isError).toBe(false);
  });

  it('readPdfExecutor passes extractTables=true only for strict boolean', async () => {
    // extractTables is checked with === true
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi.fn().mockResolvedValueOnce(
        makePdfParseResult({ text: 'A  B\nC  D' }),
      ),
    });

    const result = await readPdfExecutor(
      { path: '/t.pdf', extractTables: 'yes' },
      emptyContext,
    );
    // 'yes' !== true, so no tables extracted
    expect(
      (result.content as Record<string, unknown>).tables,
    ).toBeUndefined();
  });

  it('createPdfExecutor with multiple chunks concatenates correctly', async () => {
    // Custom mock that emits two data chunks
    const docRef: { current: MockDoc | null } = { current: null };
    const MockPDF = vi.fn().mockImplementation(function () {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const doc: MockDoc = {
        fontSize: vi.fn().mockReturnThis(),
        text: vi.fn().mockReturnThis(),
        end: vi.fn(() => {
          const c1 = Buffer.from('chunk1');
          const c2 = Buffer.from('chunk2');
          for (const cb of listeners['data'] ?? []) {
            cb(c1);
            cb(c2);
          }
          queueMicrotask(() => {
            for (const cb of listeners['end'] ?? []) cb();
          });
        }),
        on: vi.fn((event: string, cb: (...a: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return doc;
        }),
      };
      docRef.current = doc;
      return doc;
    });

    mockTryImport.mockResolvedValueOnce({ default: MockPDF });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    await createPdfExecutor(
      { path: '/out/multi.pdf', content: 'x' },
      emptyContext,
    );
    const writtenBuf = mockWriteFile.mock.calls[0]![1] as Buffer;
    expect(writtenBuf.toString()).toBe('chunk1chunk2');
  });

  it('pdfInfoExecutor uses path param correctly', async () => {
    mockStat.mockResolvedValueOnce(makeStat());
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockRejectedValueOnce(new Error('not found'));

    const result = await pdfInfoExecutor(
      { path: '/deep/nested/file.pdf' },
      emptyContext,
    );
    const content = result.content as Record<string, unknown>;
    expect(content.path).toBe('/deep/nested/file.pdf');
  });

  it('readPdfExecutor with both pages filter and extractTables', async () => {
    const text = 'Col1  Col2\nVal1  Val2';
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockResolvedValueOnce({
      default: vi.fn().mockResolvedValueOnce(makePdfParseResult({ text })),
    });

    const result = await readPdfExecutor(
      { path: '/t.pdf', pages: '1-2', extractTables: true },
      emptyContext,
    );
    const content = result.content as Record<string, unknown>;
    expect(content.note).toBe('Page filtering applied at text level');
    expect(content.tables).toBeDefined();
    expect((content.tables as unknown[]).length).toBe(1);
  });

  it('readPdfExecutor fallback includes install instructions', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockRejectedValueOnce(new Error('not found'));
    mockStat.mockResolvedValueOnce(makeStat());

    const result = await readPdfExecutor({ path: '/test.pdf' }, emptyContext);
    const content = result.content as Record<string, unknown>;
    expect(content.warning).toContain('pnpm add pdf-parse');
  });

  it('createPdfExecutor html strips nested tags', async () => {
    const { MockPDFDocument, docRef } = makePdfKitMock();
    mockTryImport.mockResolvedValueOnce({ default: MockPDFDocument });
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);

    await createPdfExecutor(
      {
        path: '/out/test.pdf',
        content: '<div><span>nested</span></div>',
        format: 'html',
      },
      emptyContext,
    );
    expect(docRef.current!.text).toHaveBeenCalledWith('nested', {
      align: 'left',
    });
  });

  it('pdfInfoExecutor includes modified date as ISO string', async () => {
    const d = new Date('2024-01-15T08:30:00Z');
    mockStat.mockResolvedValueOnce(makeStat({ mtime: d }));
    mockReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockTryImport.mockRejectedValueOnce(new Error('not found'));

    const result = await pdfInfoExecutor(
      { path: '/info.pdf' },
      emptyContext,
    );
    const content = result.content as Record<string, unknown>;
    expect(content.modified).toBe('2024-01-15T08:30:00.000Z');
  });
});
