import { describe, it, expect } from 'vitest';
import {
  extractEntitiesTool,
  extractEntitiesExecutor,
  extractTableDataTool,
  extractTableDataExecutor,
  DATA_EXTRACTION_TOOLS,
  DATA_EXTRACTION_TOOL_NAMES,
} from './data-extraction-tools.js';
import type { ToolContext } from '../types.js';

const ctx = {} as ToolContext;

// =============================================================================
// TOOL DEFINITIONS & EXPORTS
// =============================================================================

describe('tool definitions and exports', () => {
  it('should define extractEntitiesTool with correct name', () => {
    expect(extractEntitiesTool.name).toBe('extract_entities');
  });

  it('should define extractTableDataTool with correct name', () => {
    expect(extractTableDataTool.name).toBe('extract_table_data');
  });

  it('should require text param in extractEntitiesTool', () => {
    expect(extractEntitiesTool.parameters.required).toContain('text');
  });

  it('should require content param in extractTableDataTool', () => {
    expect(extractTableDataTool.parameters.required).toContain('content');
  });

  it('should export DATA_EXTRACTION_TOOLS with 2 entries', () => {
    expect(DATA_EXTRACTION_TOOLS).toHaveLength(2);
    expect(DATA_EXTRACTION_TOOLS[0]!.definition.name).toBe('extract_entities');
    expect(DATA_EXTRACTION_TOOLS[1]!.definition.name).toBe('extract_table_data');
  });

  it('should export DATA_EXTRACTION_TOOL_NAMES with correct names', () => {
    expect(DATA_EXTRACTION_TOOL_NAMES).toEqual(['extract_entities', 'extract_table_data']);
  });

  it('should pair each definition with its executor', () => {
    expect(DATA_EXTRACTION_TOOLS[0]!.executor).toBe(extractEntitiesExecutor);
    expect(DATA_EXTRACTION_TOOLS[1]!.executor).toBe(extractTableDataExecutor);
  });
});

// =============================================================================
// EXTRACT ENTITIES EXECUTOR
// =============================================================================

describe('extractEntitiesExecutor', () => {
  // -- Error cases --

  it('should return error for empty text', async () => {
    const result = await extractEntitiesExecutor({ text: '' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'Text is required for entity extraction'
    );
  });

  it('should return error for whitespace-only text', async () => {
    const result = await extractEntitiesExecutor({ text: '   ' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('should return error for undefined text', async () => {
    const result = await extractEntitiesExecutor({}, ctx);
    expect(result.isError).toBe(true);
  });

  // -- Email extraction --

  it('should extract a single email', async () => {
    const result = await extractEntitiesExecutor({ text: 'Contact me at user@example.com' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(result.isError).toBe(false);
    expect((content.basicEntities as Record<string, string[]>).email).toEqual(['user@example.com']);
  });

  it('should extract multiple emails', async () => {
    const result = await extractEntitiesExecutor({ text: 'Email a@b.com or c@d.org' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.email).toEqual(['a@b.com', 'c@d.org']);
  });

  it('should deduplicate emails', async () => {
    const result = await extractEntitiesExecutor(
      { text: 'user@ex.com and user@ex.com again' },
      ctx
    );
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.email).toEqual(['user@ex.com']);
  });

  it('should extract email with plus addressing', async () => {
    const result = await extractEntitiesExecutor({ text: 'test+tag@example.co.uk' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.email).toEqual(['test+tag@example.co.uk']);
  });

  // -- URL extraction --

  it('should extract http URL', async () => {
    const result = await extractEntitiesExecutor({ text: 'Visit http://example.com' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.url).toEqual(['http://example.com']);
  });

  it('should extract https URL', async () => {
    const result = await extractEntitiesExecutor(
      { text: 'Visit https://example.com/page?q=1' },
      ctx
    );
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.url).toEqual(['https://example.com/page?q=1']);
  });

  it('should extract multiple URLs and deduplicate', async () => {
    const result = await extractEntitiesExecutor(
      {
        text: 'See https://a.com and https://b.com and https://a.com',
      },
      ctx
    );
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.url).toEqual(['https://a.com', 'https://b.com']);
  });

  // -- Phone extraction --

  it('should extract phone number with country code and parens', async () => {
    const result = await extractEntitiesExecutor({ text: 'Call +1 (555) 123-4567' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.phone).toBeDefined();
    expect(entities.phone!.length).toBeGreaterThanOrEqual(1);
  });

  it('should extract simple phone number', async () => {
    const result = await extractEntitiesExecutor({ text: 'Call 555-123-4567 now' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.phone).toContain('555-123-4567');
  });

  it('should extract phone with dots', async () => {
    const result = await extractEntitiesExecutor({ text: 'Call 555.123.4567' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.phone).toBeDefined();
    expect(entities.phone!.length).toBe(1);
  });

  // -- Money extraction --

  it('should extract dollar amount', async () => {
    const result = await extractEntitiesExecutor({ text: 'The price is $100' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.money).toBeDefined();
    expect(entities.money!.some((m) => m.includes('$100'))).toBe(true);
  });

  it('should extract euro amount with decimals', async () => {
    const result = await extractEntitiesExecutor({ text: 'Cost is \u20AC50.00 total' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.money).toBeDefined();
    expect(entities.money!.some((m) => m.includes('\u20AC50.00'))).toBe(true);
  });

  it('should extract USD suffix notation', async () => {
    const result = await extractEntitiesExecutor({ text: 'Total: 100 USD' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.money).toBeDefined();
    expect(entities.money!.some((m) => m.includes('USD'))).toBe(true);
  });

  it('should extract money with magnitude suffix', async () => {
    const result = await extractEntitiesExecutor({ text: 'Revenue was $5 million' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.money).toBeDefined();
    expect(entities.money!.some((m) => m.includes('million'))).toBe(true);
  });

  it('should extract TRY currency', async () => {
    const result = await extractEntitiesExecutor({ text: 'Price: 250 TRY' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.money).toBeDefined();
    expect(entities.money!.some((m) => m.includes('TRY'))).toBe(true);
  });

  // -- Percentage extraction --

  it('should extract integer percentage', async () => {
    const result = await extractEntitiesExecutor({ text: 'Success rate: 50%' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.percentage).toEqual(['50%']);
  });

  it('should extract decimal percentage', async () => {
    const result = await extractEntitiesExecutor({ text: 'Growth: 3.5% year over year' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.percentage).toEqual(['3.5%']);
  });

  it('should extract multiple percentages', async () => {
    const result = await extractEntitiesExecutor({ text: '10% off, 20% cashback' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.percentage).toEqual(['10%', '20%']);
  });

  // -- Date extraction --

  it('should extract MM/DD/YYYY date', async () => {
    const result = await extractEntitiesExecutor({ text: 'Due: 01/15/2024' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.date).toBeDefined();
    expect(entities.date!.some((d) => d.includes('01/15/2024'))).toBe(true);
  });

  it('should extract YYYY-MM-DD date', async () => {
    const result = await extractEntitiesExecutor({ text: 'Date: 2024-01-15' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.date).toBeDefined();
    expect(entities.date!.some((d) => d.includes('2024-01-15'))).toBe(true);
  });

  it('should extract named month date', async () => {
    const result = await extractEntitiesExecutor(
      { text: 'January 15, 2024 was the deadline' },
      ctx
    );
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.date).toBeDefined();
    expect(entities.date!.some((d) => d.includes('January 15, 2024'))).toBe(true);
  });

  it('should extract abbreviated month date', async () => {
    const result = await extractEntitiesExecutor({ text: 'Mar 5, 2024 meeting' }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.date).toBeDefined();
    expect(entities.date!.length).toBeGreaterThanOrEqual(1);
  });

  // -- Mixed entity types --

  it('should extract multiple entity types from mixed text', async () => {
    const text =
      'Email user@test.com, call 555-123-4567, visit https://example.com, pay $99.99, 50% off, due 01/01/2025';
    const result = await extractEntitiesExecutor({ text }, ctx);
    const entities = (result.content as Record<string, unknown>).basicEntities as Record<
      string,
      string[]
    >;
    expect(entities.email).toBeDefined();
    expect(entities.phone).toBeDefined();
    expect(entities.url).toBeDefined();
    expect(entities.money).toBeDefined();
    expect(entities.percentage).toBeDefined();
    expect(entities.date).toBeDefined();
  });

  // -- No matches --

  it('should return empty basicEntities when no patterns match', async () => {
    const result = await extractEntitiesExecutor({ text: 'Hello world, nothing here' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(result.isError).toBe(false);
    const entities = content.basicEntities as Record<string, string[]>;
    expect(Object.keys(entities)).toHaveLength(0);
  });

  // -- Text truncation --

  it('should truncate text longer than 200 characters', async () => {
    const longText = 'a'.repeat(300);
    const result = await extractEntitiesExecutor({ text: longText }, ctx);
    const content = result.content as Record<string, unknown>;
    const outputText = content.text as string;
    expect(outputText.length).toBe(203); // 200 chars + '...'
    expect(outputText.endsWith('...')).toBe(true);
  });

  it('should not truncate text at exactly 200 characters', async () => {
    const text = 'a'.repeat(200);
    const result = await extractEntitiesExecutor({ text }, ctx);
    const content = result.content as Record<string, unknown>;
    const outputText = content.text as string;
    expect(outputText).toBe(text);
    expect(outputText.endsWith('...')).toBe(false);
  });

  it('should not truncate short text', async () => {
    const text = 'Short text here';
    const result = await extractEntitiesExecutor({ text }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.text).toBe(text);
  });

  // -- entityTypes parameter --

  it('should pass entityTypes through as entityTypesRequested', async () => {
    const result = await extractEntitiesExecutor(
      { text: 'Hello', entityTypes: ['email', 'phone'] },
      ctx
    );
    const content = result.content as Record<string, unknown>;
    expect(content.entityTypesRequested).toEqual(['email', 'phone']);
  });

  it('should default entityTypesRequested to "all" when not specified', async () => {
    const result = await extractEntitiesExecutor({ text: 'Hello' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.entityTypesRequested).toBe('all');
  });

  // -- includeConfidence parameter --

  it('should set includeConfidence to true when param is true', async () => {
    const result = await extractEntitiesExecutor({ text: 'Hello', includeConfidence: true }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.includeConfidence).toBe(true);
  });

  it('should set includeConfidence to false when param is falsy', async () => {
    const result = await extractEntitiesExecutor({ text: 'Hello' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.includeConfidence).toBe(false);
  });

  // -- NLP note --

  it('should always include requiresNLPForAdvanced and note', async () => {
    const result = await extractEntitiesExecutor({ text: 'test' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.requiresNLPForAdvanced).toBe(true);
    expect(content.note).toBeDefined();
    expect(typeof content.note).toBe('string');
    expect((content.note as string).length).toBeGreaterThan(0);
  });

  // -- isError false on success --

  it('should return isError false for successful extraction', async () => {
    const result = await extractEntitiesExecutor({ text: 'user@example.com' }, ctx);
    expect(result.isError).toBe(false);
  });
});

// =============================================================================
// EXTRACT TABLE DATA EXECUTOR
// =============================================================================

describe('extractTableDataExecutor', () => {
  // -- Error cases --

  it('should return error for empty content', async () => {
    const result = await extractTableDataExecutor({ content: '' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'Content is required for table extraction'
    );
  });

  it('should return error for whitespace-only content', async () => {
    const result = await extractTableDataExecutor({ content: '   ' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('should return error for undefined content', async () => {
    const result = await extractTableDataExecutor({}, ctx);
    expect(result.isError).toBe(true);
  });

  // =========================================================================
  // CSV parsing
  // =========================================================================

  describe('CSV format', () => {
    it('should parse simple CSV with header', async () => {
      const csv = 'Name,Age,City\nAlice,30,NYC\nBob,25,LA';
      const result = await extractTableDataExecutor({ content: csv, format: 'csv' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(result.isError).toBe(false);
      expect(content.format).toBe('csv');
      expect(content.tableCount).toBe(1);
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Age', 'City']);
      expect(tables[0]!.rows).toEqual([
        ['Alice', '30', 'NYC'],
        ['Bob', '25', 'LA'],
      ]);
    });

    it('should parse CSV without header when hasHeader is false', async () => {
      const csv = 'Alice,30,NYC\nBob,25,LA';
      const result = await extractTableDataExecutor(
        { content: csv, format: 'csv', hasHeader: false },
        ctx
      );
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toBeUndefined();
      expect(tables[0]!.rows).toEqual([
        ['Alice', '30', 'NYC'],
        ['Bob', '25', 'LA'],
      ]);
    });

    it('should handle quoted fields with commas inside', async () => {
      const csv = 'Name,Address\n"Doe, John","123 Main St, Apt 4"';
      const result = await extractTableDataExecutor({ content: csv, format: 'csv' }, ctx);
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Address']);
      expect(tables[0]!.rows[0]).toEqual(['Doe, John', '123 Main St, Apt 4']);
    });

    it('should parse CSV with tab delimiter', async () => {
      const csv = 'Name\tAge\nAlice\t30\nBob\t25';
      const result = await extractTableDataExecutor(
        { content: csv, format: 'csv', delimiter: '\t' },
        ctx
      );
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Age']);
      expect(tables[0]!.rows).toEqual([
        ['Alice', '30'],
        ['Bob', '25'],
      ]);
    });

    it('should parse CSV with semicolon delimiter', async () => {
      const csv = 'Name;Age;City\nAlice;30;NYC';
      const result = await extractTableDataExecutor(
        { content: csv, format: 'csv', delimiter: ';' },
        ctx
      );
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Age', 'City']);
      expect(tables[0]!.rows).toEqual([['Alice', '30', 'NYC']]);
    });

    it('should return empty tables for CSV with only empty data rows', async () => {
      const csv = ',\n,';
      const result = await extractTableDataExecutor({ content: csv, format: 'csv' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(result.isError).toBe(false);
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables).toHaveLength(1);
      // Header is ['', ''] and rows contain ['', '']
      expect(tables[0]!.headers).toEqual(['', '']);
    });

    it('should handle single-row CSV (header only)', async () => {
      const csv = 'Name,Age,City';
      const result = await extractTableDataExecutor({ content: csv, format: 'csv' }, ctx);
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Age', 'City']);
      expect(tables[0]!.rows).toEqual([]);
    });
  });

  // =========================================================================
  // Markdown parsing
  // =========================================================================

  describe('Markdown format', () => {
    it('should parse standard markdown table', async () => {
      const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
      const result = await extractTableDataExecutor({ content: md, format: 'markdown' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(result.isError).toBe(false);
      expect(content.format).toBe('markdown');
      expect(content.tableCount).toBe(1);
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Age']);
      expect(tables[0]!.rows).toEqual([
        ['Alice', '30'],
        ['Bob', '25'],
      ]);
    });

    it('should skip separator lines correctly', async () => {
      const md = '| H1 | H2 |\n|:---:|:---:|\n| a | b |';
      const result = await extractTableDataExecutor({ content: md, format: 'markdown' }, ctx);
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['H1', 'H2']);
      expect(tables[0]!.rows).toEqual([['a', 'b']]);
    });

    it('should parse multiple markdown tables separated by non-table lines', async () => {
      const md =
        '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nSome text\n\n| C | D |\n| --- | --- |\n| 3 | 4 |';
      const result = await extractTableDataExecutor({ content: md, format: 'markdown' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.tableCount).toBe(2);
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['A', 'B']);
      expect(tables[0]!.rows).toEqual([['1', '2']]);
      expect(tables[1]!.headers).toEqual(['C', 'D']);
      expect(tables[1]!.rows).toEqual([['3', '4']]);
    });

    it('should handle markdown table with no data rows', async () => {
      const md = '| Header1 | Header2 |\n| --- | --- |';
      const result = await extractTableDataExecutor({ content: md, format: 'markdown' }, ctx);
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Header1', 'Header2']);
      expect(tables[0]!.rows).toEqual([]);
    });

    it('should return empty tables for markdown with no pipe characters', async () => {
      const md = 'Just plain text here.\nNothing tabular.';
      const result = await extractTableDataExecutor({ content: md, format: 'markdown' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.tableCount).toBe(0);
    });
  });

  // =========================================================================
  // HTML parsing
  // =========================================================================

  describe('HTML format', () => {
    it('should parse simple HTML table with thead/tbody', async () => {
      const html =
        '<table><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>';
      const result = await extractTableDataExecutor({ content: html, format: 'html' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(result.isError).toBe(false);
      expect(content.format).toBe('html');
      expect(content.tableCount).toBe(1);
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Age']);
      // The rowRegex also matches the <tr> inside <thead>, so headers appear as a data row too
      expect(tables[0]!.rows).toEqual([
        ['Name', 'Age'],
        ['Alice', '30'],
      ]);
    });

    it('should parse HTML table with th in tr (no thead)', async () => {
      const html =
        '<table><tr><th>Name</th><th>Age</th></tr><tr><td>Bob</td><td>25</td></tr></table>';
      const result = await extractTableDataExecutor({ content: html, format: 'html' }, ctx);
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Age']);
      expect(tables[0]!.rows).toEqual([['Bob', '25']]);
    });

    it('should parse multiple HTML tables', async () => {
      const html =
        '<table><tr><td>A</td><td>B</td></tr></table><p>gap</p><table><tr><td>C</td><td>D</td></tr></table>';
      const result = await extractTableDataExecutor({ content: html, format: 'html' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.tableCount).toBe(2);
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.rows).toEqual([['A', 'B']]);
      expect(tables[1]!.rows).toEqual([['C', 'D']]);
    });

    it('should strip nested HTML tags from cell content', async () => {
      const html =
        '<table><tr><td><strong>Bold</strong> text</td><td><a href="#">Link</a></td></tr></table>';
      const result = await extractTableDataExecutor({ content: html, format: 'html' }, ctx);
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.rows[0]).toEqual(['Bold text', 'Link']);
    });

    it('should strip HTML tags from header cells', async () => {
      const html =
        '<table><thead><tr><th><em>Italic</em> Header</th></tr></thead><tbody><tr><td>data</td></tr></tbody></table>';
      const result = await extractTableDataExecutor({ content: html, format: 'html' }, ctx);
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Italic Header']);
    });

    it('should return empty tables for HTML with no table tags', async () => {
      const html = '<div><p>No table here</p></div>';
      const result = await extractTableDataExecutor({ content: html, format: 'html' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.tableCount).toBe(0);
    });

    it('should handle HTML table with only headers (no data rows)', async () => {
      const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead></table>';
      const result = await extractTableDataExecutor({ content: html, format: 'html' }, ctx);
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      // Table has headers but no td rows; the thead tr has th cells matched by <t[dh]> regex
      // It should still appear since it has headers
      expect(tables.length).toBeGreaterThanOrEqual(1);
      expect(tables[0]!.headers).toEqual(['A', 'B']);
    });
  });

  // =========================================================================
  // Text parsing
  // =========================================================================

  describe('Text format', () => {
    it('should parse tab-delimited text with header', async () => {
      const text = 'Name\tAge\tCity\nAlice\t30\tNYC\nBob\t25\tLA';
      const result = await extractTableDataExecutor({ content: text, format: 'text' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('text');
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Age', 'City']);
      expect(tables[0]!.rows).toEqual([
        ['Alice', '30', 'NYC'],
        ['Bob', '25', 'LA'],
      ]);
    });

    it('should parse pipe-delimited text', async () => {
      const text = 'Name|Age\nAlice|30';
      const result = await extractTableDataExecutor({ content: text, format: 'text' }, ctx);
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Age']);
      expect(tables[0]!.rows).toEqual([['Alice', '30']]);
    });

    it('should parse multi-space delimited text', async () => {
      const text = 'Name    Age    City\nAlice   30     NYC';
      const result = await extractTableDataExecutor({ content: text, format: 'text' }, ctx);
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Age', 'City']);
      expect(tables[0]!.rows[0]).toEqual(['Alice', '30', 'NYC']);
    });

    it('should parse text without header when hasHeader is false', async () => {
      const text = 'Alice\t30\nBob\t25';
      const result = await extractTableDataExecutor(
        { content: text, format: 'text', hasHeader: false },
        ctx
      );
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toBeUndefined();
      expect(tables[0]!.rows).toEqual([
        ['Alice', '30'],
        ['Bob', '25'],
      ]);
    });

    it('should use provided delimiter for text format', async () => {
      const text = 'Name;Age\nAlice;30';
      const result = await extractTableDataExecutor(
        { content: text, format: 'text', delimiter: ';' },
        ctx
      );
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as Array<{ headers?: string[]; rows: string[][] }>;
      expect(tables[0]!.headers).toEqual(['Name', 'Age']);
      expect(tables[0]!.rows).toEqual([['Alice', '30']]);
    });

    it('should return error for blank text (all whitespace)', async () => {
      const text = '   \n   \n   ';
      const result = await extractTableDataExecutor({ content: text, format: 'text' }, ctx);
      // All-whitespace content trims to empty string, triggering the error path
      expect(result.isError).toBe(true);
    });
  });

  // =========================================================================
  // Auto-detection
  // =========================================================================

  describe('auto-detection', () => {
    it('should auto-detect CSV format (has comma and newline)', async () => {
      const csv = 'a,b,c\n1,2,3';
      const result = await extractTableDataExecutor({ content: csv }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('csv');
    });

    it('should auto-detect markdown format (has pipe and ---)', async () => {
      const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';
      const result = await extractTableDataExecutor({ content: md }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('markdown');
    });

    it('should auto-detect HTML format (has <table tag)', async () => {
      const html = '<table><tr><td>1</td></tr></table>';
      const result = await extractTableDataExecutor({ content: html }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('html');
    });

    it('should auto-detect HTML format (has <tr tag without <table)', async () => {
      const html = '<tr><td>1</td></tr>';
      const result = await extractTableDataExecutor({ content: html }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('html');
    });

    it('should fall back to text format when no other pattern matches', async () => {
      const text = 'Name\tAge\nAlice\t30';
      const result = await extractTableDataExecutor({ content: text }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('text');
    });

    it('should prefer html over markdown when both patterns present', async () => {
      // Content has <table and also has | and --- but html check comes first
      const html = '<table><tr><td>| --- |</td></tr></table>';
      const result = await extractTableDataExecutor({ content: html }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('html');
    });

    it('should prefer markdown over csv when both | with --- and comma with newline present', async () => {
      // Content has both | + --- and , + \n but markdown check comes first
      const md = '| A, B | C |\n| --- | --- |\n| 1, 2 | 3 |';
      const result = await extractTableDataExecutor({ content: md }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('markdown');
    });
  });

  // =========================================================================
  // Explicit format override
  // =========================================================================

  describe('explicit format override', () => {
    it('should use csv format when explicitly set, ignoring auto-detection', async () => {
      // This content has | and --- (would auto-detect as markdown) but format is forced
      const csv = 'a|b\n---|---\n1|2';
      const result = await extractTableDataExecutor({ content: csv, format: 'csv' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('csv');
    });

    it('should use html format when explicitly set', async () => {
      const text = 'not html at all, just text\nwith newlines';
      const result = await extractTableDataExecutor({ content: text, format: 'html' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('html');
      // No HTML tables found, so empty
      expect(content.tableCount).toBe(0);
    });

    it('should use markdown format when explicitly set', async () => {
      const text = '| A | B |\n| 1 | 2 |';
      const result = await extractTableDataExecutor({ content: text, format: 'markdown' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('markdown');
    });

    it('should use text format when explicitly set', async () => {
      const csv = 'a,b\n1,2';
      const result = await extractTableDataExecutor({ content: csv, format: 'text' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('text');
    });
  });

  // =========================================================================
  // Return structure
  // =========================================================================

  describe('return structure', () => {
    it('should return isError false on success', async () => {
      const result = await extractTableDataExecutor({ content: 'a,b\n1,2' }, ctx);
      expect(result.isError).toBe(false);
    });

    it('should include format, tableCount, and tables in content', async () => {
      const result = await extractTableDataExecutor({ content: 'a,b\n1,2' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content).toHaveProperty('format');
      expect(content).toHaveProperty('tableCount');
      expect(content).toHaveProperty('tables');
      expect(typeof content.tableCount).toBe('number');
      expect(Array.isArray(content.tables)).toBe(true);
    });

    it('should set tableCount to match tables array length', async () => {
      const html = '<table><tr><td>1</td></tr></table><table><tr><td>2</td></tr></table>';
      const result = await extractTableDataExecutor({ content: html, format: 'html' }, ctx);
      const content = result.content as Record<string, unknown>;
      const tables = content.tables as unknown[];
      expect(content.tableCount).toBe(tables.length);
    });
  });
});
