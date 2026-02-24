/**
 * Text Tool Definitions
 *
 * Tool schemas for text processing, comparison, regex, markdown, JSON/CSV conversion.
 */

import type { ToolDefinition } from '../types.js';

export const TEXT_TOOL_DEFS: readonly ToolDefinition[] = [
  // ===== DATA & TEXT TOOLS =====
  {
    name: 'parse_json',
    description: 'Parse and validate JSON string, optionally extract specific fields',
    parameters: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON string to parse',
        },
        path: {
          type: 'string',
          description: 'Optional dot notation path to extract (e.g., "user.name" or "items[0].id")',
        },
      },
      required: ['json'],
    },
  },
  {
    name: 'format_json',
    description: 'Format/prettify JSON with indentation',
    parameters: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON string to format',
        },
        indent: {
          type: 'number',
          description: 'Number of spaces for indentation (default: 2)',
        },
      },
      required: ['json'],
    },
  },
  {
    name: 'text_stats',
    description: 'Get statistics about text (word count, character count, line count, etc.)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to analyze',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'text_transform',
    description: 'Transform text (uppercase, lowercase, title case, reverse, etc.)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to transform',
        },
        operation: {
          type: 'string',
          description: 'Operation: uppercase, lowercase, titlecase, reverse, trim, slug',
        },
      },
      required: ['text', 'operation'],
    },
  },
  {
    name: 'search_replace',
    description: 'Search and replace text with support for regex',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to search in',
        },
        search: {
          type: 'string',
          description: 'Text or regex pattern to search for',
        },
        replace: {
          type: 'string',
          description: 'Replacement text',
        },
        regex: {
          type: 'boolean',
          description: 'If true, treat search as regex pattern (default: false)',
        },
        global: {
          type: 'boolean',
          description: 'If true, replace all occurrences (default: true)',
        },
      },
      required: ['text', 'search', 'replace'],
    },
  },
  // ===== TEXT COMPARISON =====
  {
    name: 'compare_texts',
    description: 'Compare two texts and show differences',
    parameters: {
      type: 'object',
      properties: {
        text1: {
          type: 'string',
          description: 'First text',
        },
        text2: {
          type: 'string',
          description: 'Second text',
        },
        mode: {
          type: 'string',
          description: 'Comparison mode: lines, words, chars (default: lines)',
        },
      },
      required: ['text1', 'text2'],
    },
  },
  // ===== REGEX TOOLS =====
  {
    name: 'test_regex',
    description: 'Test a regular expression against text',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression pattern',
        },
        text: {
          type: 'string',
          description: 'Text to test against',
        },
        flags: {
          type: 'string',
          description: 'Regex flags (g, i, m, etc.)',
        },
      },
      required: ['pattern', 'text'],
    },
  },
  // ===== WORD TOOLS =====
  {
    name: 'count_words',
    description: 'Count word frequency in text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to analyze',
        },
        top: {
          type: 'number',
          description: 'Show top N most frequent words (default: 10)',
        },
        min_length: {
          type: 'number',
          description: 'Minimum word length to count (default: 1)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'find_and_replace_bulk',
    description: 'Find and replace multiple patterns at once',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to process',
        },
        replacements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
            },
          },
          description: 'Array of {find, replace} pairs',
        },
      },
      required: ['text', 'replacements'],
    },
  },
  // ===== MARKDOWN TOOLS =====
  {
    name: 'markdown_to_html',
    description: 'Convert Markdown to HTML',
    parameters: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description: 'Markdown text to convert',
        },
      },
      required: ['markdown'],
    },
  },
  {
    name: 'strip_markdown',
    description: 'Remove Markdown formatting and return plain text',
    parameters: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description: 'Markdown text to strip',
        },
      },
      required: ['markdown'],
    },
  },
  // ===== JSON/CSV TOOLS =====
  {
    name: 'json_to_csv',
    description: 'Convert JSON array to CSV format',
    parameters: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON array string to convert',
        },
        delimiter: {
          type: 'string',
          description: 'CSV delimiter (default: ,)',
        },
      },
      required: ['json'],
    },
  },
  {
    name: 'csv_to_json',
    description: 'Convert CSV to JSON array',
    parameters: {
      type: 'object',
      properties: {
        csv: {
          type: 'string',
          description: 'CSV string to convert',
        },
        delimiter: {
          type: 'string',
          description: 'CSV delimiter (default: ,)',
        },
        headers: {
          type: 'boolean',
          description: 'First row contains headers (default: true)',
        },
      },
      required: ['csv'],
    },
  },
];
