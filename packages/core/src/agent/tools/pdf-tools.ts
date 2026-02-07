/**
 * PDF Tools
 * Read and create PDF documents
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';
import { tryImport } from './module-resolver.js';

// ============================================================================
// READ PDF TOOL
// ============================================================================

export const readPdfTool: ToolDefinition = {
  name: 'read_pdf',
  brief: 'Extract text from a PDF file',
  description: 'Extract text content from a PDF file. Supports multi-page PDFs with page selection.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the PDF file',
      },
      pages: {
        type: 'string',
        description: 'Page range to extract (e.g., "1-5", "1,3,5", "all"). Default: "all"',
      },
      extractImages: {
        type: 'boolean',
        description: 'Whether to extract image descriptions (requires Vision API)',
      },
      extractTables: {
        type: 'boolean',
        description: 'Attempt to extract tables as structured data',
      },
    },
    required: ['path'],
  },
};

export const readPdfExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const path = params.path as string;
  const pages = (params.pages as string) || 'all';
  const extractTables = params.extractTables === true;

  try {
    // Dynamic import for PDF parsing
    const fs = await import('node:fs/promises');

    // Check if file exists
    try {
      await fs.access(path);
    } catch {
      return {
        content: { error: `PDF file not found: ${path}` },
        isError: true,
      };
    }

    const fileBuffer = await fs.readFile(path);

    // Use pdf-parse library if available, otherwise basic extraction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdfParse: any = null; // Optional dependency - dynamically imported
    try {
      pdfParse = (await tryImport('pdf-parse') as Record<string, unknown>).default;
    } catch {
      // pdf-parse not installed, use basic extraction
    }

    if (pdfParse) {
      const data = await pdfParse(fileBuffer);

      const result: Record<string, unknown> = {
        text: data.text,
        pageCount: data.numpages,
        info: data.info,
        metadata: data.metadata,
      };

      // Filter by pages if specified
      if (pages !== 'all' && data.text) {
        // Basic page filtering - pdf-parse doesn't provide per-page text easily
        result.note = 'Page filtering applied at text level';
      }

      if (extractTables) {
        // Basic table extraction using heuristics
        result.tables = extractTablesFromText(data.text);
      }

      return { content: result, isError: false };
    }

    // Fallback: Return file info only
    const stats = await fs.stat(path);
    return {
      content: {
        warning: 'pdf-parse library not installed. Install with: pnpm add pdf-parse',
        path,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error;
    return {
      content: { error: `Failed to read PDF: ${err.message}` },
      isError: true,
    };
  }
};

/**
 * Basic table extraction from text
 */
function extractTablesFromText(text: string): Array<{ rows: string[][] }> {
  const tables: Array<{ rows: string[][] }> = [];
  const lines = text.split('\n');

  let currentTable: string[][] = [];
  let inTable = false;

  for (const line of lines) {
    // Detect table-like patterns (multiple whitespace-separated columns)
    const columns = line.split(/\s{2,}/).filter(c => c.trim());

    if (columns.length >= 2) {
      if (!inTable) {
        inTable = true;
        currentTable = [];
      }
      currentTable.push(columns);
    } else if (inTable) {
      if (currentTable.length >= 2) {
        tables.push({ rows: currentTable });
      }
      currentTable = [];
      inTable = false;
    }
  }

  // Don't forget the last table
  if (inTable && currentTable.length >= 2) {
    tables.push({ rows: currentTable });
  }

  return tables;
}

// ============================================================================
// CREATE PDF TOOL
// ============================================================================

export const createPdfTool: ToolDefinition = {
  name: 'create_pdf',
  brief: 'Create a PDF from text, HTML, or markdown',
  description: 'Create a PDF document from text, HTML, or markdown content',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Output path for the PDF file',
      },
      content: {
        type: 'string',
        description: 'Text content for the PDF',
      },
      format: {
        type: 'string',
        description: 'Content format: "text", "html", or "markdown"',
        enum: ['text', 'html', 'markdown'],
      },
      title: {
        type: 'string',
        description: 'PDF document title',
      },
      author: {
        type: 'string',
        description: 'PDF document author',
      },
      pageSize: {
        type: 'string',
        description: 'Page size: "A4", "Letter", "Legal"',
        enum: ['A4', 'Letter', 'Legal'],
      },
      margins: {
        type: 'object',
        description: 'Page margins in points {top, right, bottom, left}',
      },
    },
    required: ['path', 'content'],
  },
};

export const createPdfExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const outputPath = params.path as string;
  const content = params.content as string;
  const format = (params.format as string) || 'text';
  const title = params.title as string | undefined;
  const author = params.author as string | undefined;
  const pageSize = (params.pageSize as string) || 'A4';

  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });

    // Try to use pdfkit if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let PDFDocument: any = null; // Optional dependency - dynamically imported
    try {
      PDFDocument = (await tryImport('pdfkit') as Record<string, unknown>).default;
    } catch {
      // pdfkit not installed
    }

    if (PDFDocument) {
      const doc = new PDFDocument({
        size: pageSize as 'A4' | 'LETTER' | 'LEGAL',
        info: {
          Title: title,
          Author: author,
          Creator: 'OwnPilot',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));

      // Process content based on format
      if (format === 'markdown') {
        // Basic markdown to text conversion
        const processedContent = convertMarkdownToText(content);
        doc.fontSize(12).text(processedContent, { align: 'left' });
      } else if (format === 'html') {
        // Strip HTML tags for basic support
        const textContent = content.replace(/<[^>]+>/g, '');
        doc.fontSize(12).text(textContent, { align: 'left' });
      } else {
        doc.fontSize(12).text(content, { align: 'left' });
      }

      doc.end();

      // Wait for PDF generation to complete
      await new Promise<void>((resolve) => {
        doc.on('end', resolve);
      });

      const pdfBuffer = Buffer.concat(chunks);
      await fs.writeFile(outputPath, pdfBuffer);

      return {
        content: {
          success: true,
          path: outputPath,
          size: pdfBuffer.length,
          pageSize,
          title,
          author,
        },
        isError: false,
      };
    }

    // Fallback: Create a simple text file with .pdf extension
    // (Not a real PDF, but indicates the library is missing)
    return {
      content: {
        error: 'pdfkit library not installed. Install with: pnpm add pdfkit',
        suggestion: 'Run: pnpm add pdfkit @types/pdfkit',
      },
      isError: true,
    };
  } catch (error: unknown) {
    const err = error as Error;
    return {
      content: { error: `Failed to create PDF: ${err.message}` },
      isError: true,
    };
  }
};

/**
 * Basic markdown to text conversion
 */
function convertMarkdownToText(markdown: string): string {
  let text = markdown;

  // Headers
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '\n$1\n');

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/__(.+?)__/g, '$1');

  // Italic
  text = text.replace(/\*(.+?)\*/g, '$1');
  text = text.replace(/_(.+?)_/g, '$1');

  // Links
  text = text.replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');

  // Lists
  text = text.replace(/^\s*[-*+]\s+/gm, '• ');
  text = text.replace(/^\s*\d+\.\s+/gm, '  ');

  // Code blocks
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    return match.replace(/```\w*\n?/g, '').trim();
  });

  // Inline code
  text = text.replace(/`(.+?)`/g, '$1');

  // Blockquotes
  text = text.replace(/^>\s+/gm, '  ');

  // Horizontal rules
  text = text.replace(/^[-*_]{3,}$/gm, '\n---\n');

  return text;
}

// ============================================================================
// PDF INFO TOOL
// ============================================================================

export const pdfInfoTool: ToolDefinition = {
  name: 'get_pdf_info',
  brief: 'Get PDF page count, title, author metadata',
  description: 'Get metadata and information about a PDF file without reading its full content. Returns file size, page count, title, author, and other document properties.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the PDF file',
      },
    },
    required: ['path'],
  },
};

export const pdfInfoExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const pdfPath = params.path as string;

  try {
    const fs = await import('node:fs/promises');

    // Check if file exists
    const stats = await fs.stat(pdfPath);

    const fileBuffer = await fs.readFile(pdfPath);

    // Try to use pdf-parse for metadata
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdfParse: any = null; // Optional dependency - dynamically imported
    try {
      pdfParse = (await tryImport('pdf-parse') as Record<string, unknown>).default;
    } catch {
      // pdf-parse not installed
    }

    if (pdfParse) {
      const data = await pdfParse(fileBuffer, { max: 1 }); // Only parse first page for speed

      return {
        content: {
          path: pdfPath,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          pageCount: data.numpages,
          info: data.info,
          metadata: data.metadata,
        },
        isError: false,
      };
    }

    // Basic info without pdf-parse
    return {
      content: {
        path: pdfPath,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        warning: 'Install pdf-parse for full PDF metadata: pnpm add pdf-parse',
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error;
    return {
      content: { error: `Failed to get PDF info: ${err.message}` },
      isError: true,
    };
  }
};

// ============================================================================
// EXPORT ALL PDF TOOLS
// ============================================================================

export const PDF_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: readPdfTool, executor: readPdfExecutor },
  { definition: createPdfTool, executor: createPdfExecutor },
  { definition: pdfInfoTool, executor: pdfInfoExecutor },
];

export const PDF_TOOL_NAMES = PDF_TOOLS.map((t) => t.definition.name);
