/**
 * Data Extraction Tools
 * Extract structured data from unstructured content
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';

// ============================================================================
// EXTRACT ENTITIES TOOL
// ============================================================================

export const extractEntitiesTool: ToolDefinition = {
  name: 'extract_entities',
  brief: 'Extract people, orgs, locations, dates from text',
  description: 'Extract named entities from text (people, organizations, locations, dates, etc.)',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to extract entities from',
      },
      entityTypes: {
        type: 'array',
        description: 'Types of entities to extract',
        items: {
          type: 'string',
          enum: [
            'person',
            'organization',
            'location',
            'date',
            'time',
            'money',
            'percentage',
            'email',
            'phone',
            'url',
            'product',
            'event',
          ],
        },
      },
      includeConfidence: {
        type: 'boolean',
        description: 'Include confidence scores for each entity',
      },
    },
    required: ['text'],
  },
};

export const extractEntitiesExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
  const text = params.text as string;
  const entityTypes = params.entityTypes as string[] | undefined;
  const includeConfidence = params.includeConfidence === true;

  if (!text || text.trim().length === 0) {
    return {
      content: { error: 'Text is required for entity extraction' },
      isError: true,
    };
  }

  // Basic regex-based extraction for common patterns
  const basicEntities: Record<string, string[]> = {};

  // Email extraction
  const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (emails) basicEntities.email = [...new Set(emails)];

  // URL extraction
  const urls = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g);
  if (urls) basicEntities.url = [...new Set(urls)];

  // Phone extraction (various formats)
  const phones = text.match(/(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
  if (phones) basicEntities.phone = [...new Set(phones)];

  // Money extraction
  const money = text.match(
    /[$€£¥]\s?\d+(?:[.,]\d{2})?(?:\s?(?:million|billion|k|M|B))?|\d+(?:[.,]\d{2})?\s?(?:USD|EUR|GBP|TRY)/gi
  );
  if (money) basicEntities.money = [...new Set(money)];

  // Percentage extraction
  const percentages = text.match(/\d+(?:\.\d+)?%/g);
  if (percentages) basicEntities.percentage = [...new Set(percentages)];

  // Date extraction (basic patterns)
  const dates = text.match(
    /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}/gi
  );
  if (dates) basicEntities.date = [...new Set(dates)];

  return {
    content: {
      text: text.length > 200 ? text.substring(0, 200) + '...' : text,
      basicEntities,
      entityTypesRequested: entityTypes || 'all',
      includeConfidence,
      requiresNLPForAdvanced: true,
      note: 'Basic patterns extracted. Advanced entity extraction (person, organization, location) requires NLP/AI integration.',
    },
    isError: false,
  };
};

// ============================================================================
// EXTRACT TABLE DATA TOOL
// ============================================================================

export const extractTableDataTool: ToolDefinition = {
  name: 'extract_table_data',
  brief: 'Extract tabular data from text or HTML',
  description: 'Extract tabular data from text or HTML',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Text or HTML containing table data',
      },
      format: {
        type: 'string',
        description: 'Input format',
        enum: ['text', 'html', 'markdown', 'csv'],
      },
      hasHeader: {
        type: 'boolean',
        description: 'Whether first row is header (default: true)',
      },
      delimiter: {
        type: 'string',
        description: 'Column delimiter for text format (default: auto-detect)',
      },
    },
    required: ['content'],
  },
};

export const extractTableDataExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
  const content = params.content as string;
  const format = (params.format as string) || 'auto';
  const hasHeader = params.hasHeader !== false;
  const delimiter = params.delimiter as string | undefined;

  if (!content || content.trim().length === 0) {
    return {
      content: { error: 'Content is required for table extraction' },
      isError: true,
    };
  }

  // Detect format
  let detectedFormat = format;
  if (format === 'auto') {
    if (content.includes('<table') || content.includes('<tr')) {
      detectedFormat = 'html';
    } else if (content.includes('|') && content.includes('---')) {
      detectedFormat = 'markdown';
    } else if (content.includes(',') && content.includes('\n')) {
      detectedFormat = 'csv';
    } else {
      detectedFormat = 'text';
    }
  }

  let tables: Array<{ headers?: string[]; rows: string[][] }> = [];

  switch (detectedFormat) {
    case 'csv':
      tables = parseCSV(content, delimiter || ',', hasHeader);
      break;
    case 'markdown':
      tables = parseMarkdownTable(content);
      break;
    case 'html':
      tables = parseHTMLTable(content);
      break;
    case 'text':
      tables = parseTextTable(content, delimiter, hasHeader);
      break;
  }

  return {
    content: {
      format: detectedFormat,
      tableCount: tables.length,
      tables,
    },
    isError: false,
  };
};

/**
 * Parse CSV content
 */
function parseCSV(
  content: string,
  delimiter: string,
  hasHeader: boolean
): Array<{ headers?: string[]; rows: string[][] }> {
  const lines = content
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l);
  if (lines.length === 0) return [];

  const rows = lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  });

  if (hasHeader && rows.length > 0) {
    return [{ headers: rows[0], rows: rows.slice(1) }];
  }

  return [{ rows }];
}

/**
 * Parse markdown table
 */
function parseMarkdownTable(content: string): Array<{ headers?: string[]; rows: string[][] }> {
  const lines = content.trim().split('\n');
  const tables: Array<{ headers?: string[]; rows: string[][] }> = [];

  let currentTable: { headers?: string[]; rows: string[][] } | null = null;
  let headerParsed = false;

  for (const line of lines) {
    if (line.includes('|')) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c);

      // Skip separator line
      if (cells.every((c) => /^[-:]+$/.test(c))) {
        headerParsed = true;
        continue;
      }

      if (!currentTable) {
        currentTable = { rows: [] };
        tables.push(currentTable);
      }

      if (!headerParsed) {
        currentTable.headers = cells;
      } else {
        currentTable.rows.push(cells);
      }
    } else if (currentTable) {
      currentTable = null;
      headerParsed = false;
    }
  }

  return tables;
}

/**
 * Parse HTML table
 */
function parseHTMLTable(content: string): Array<{ headers?: string[]; rows: string[][] }> {
  const tables: Array<{ headers?: string[]; rows: string[][] }> = [];

  // Find all tables
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(content)) !== null) {
    const tableContent = tableMatch[1] || '';
    const table: { headers?: string[]; rows: string[][] } = { rows: [] };

    // Extract headers
    const headerMatch = tableContent.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
    if (headerMatch) {
      const headerCells = headerMatch[1]?.match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];
      table.headers = headerCells.map((cell) => cell.replace(/<[^>]+>/g, '').trim());
    }

    // Extract rows
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const rowContent = rowMatch[1] || '';
      const cells = rowContent.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
      const rowData = cells.map((cell) => cell.replace(/<[^>]+>/g, '').trim());

      if (rowData.length > 0) {
        // If no headers and this is first row with th tags, use as headers
        if (!table.headers && rowContent.includes('<th')) {
          table.headers = rowData;
        } else {
          table.rows.push(rowData);
        }
      }
    }

    if (table.rows.length > 0 || table.headers) {
      tables.push(table);
    }
  }

  return tables;
}

/**
 * Parse text table using whitespace or delimiter
 */
function parseTextTable(
  content: string,
  delimiter: string | undefined,
  hasHeader: boolean
): Array<{ headers?: string[]; rows: string[][] }> {
  const lines = content
    .trim()
    .split('\n')
    .filter((l) => l.trim());
  if (lines.length === 0) return [];

  // Auto-detect delimiter
  let effectiveDelimiter: string | RegExp;
  if (delimiter) {
    effectiveDelimiter = delimiter;
  } else if (lines[0]!.includes('\t')) {
    effectiveDelimiter = '\t';
  } else if (lines[0]!.includes('|')) {
    effectiveDelimiter = '|';
  } else {
    effectiveDelimiter = /\s{2,}/; // Multiple spaces
  }

  const rows = lines.map((line) => {
    return line
      .split(effectiveDelimiter)
      .map((c) => c.trim())
      .filter((c) => c);
  });

  if (hasHeader && rows.length > 0) {
    return [{ headers: rows[0], rows: rows.slice(1) }];
  }

  return [{ rows }];
}

// ============================================================================
// EXPORT ALL DATA EXTRACTION TOOLS
// ============================================================================

export const DATA_EXTRACTION_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> =
  [
    { definition: extractEntitiesTool, executor: extractEntitiesExecutor },
    { definition: extractTableDataTool, executor: extractTableDataExecutor },
  ];

export const DATA_EXTRACTION_TOOL_NAMES = DATA_EXTRACTION_TOOLS.map((t) => t.definition.name);
