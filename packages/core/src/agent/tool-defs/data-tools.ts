/**
 * Data Tool Definitions
 *
 * Tool schemas for list operations, data extraction, and validation.
 */

import type { ToolDefinition } from '../types.js';

export const DATA_TOOL_DEFS: readonly ToolDefinition[] = [
  // ===== DATA EXTRACTION TOOLS =====
  {
    name: 'extract_urls',
    description: 'Extract all URLs from text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to extract URLs from',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'extract_emails',
    description: 'Extract all email addresses from text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to extract emails from',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'extract_numbers',
    description: 'Extract all numbers from text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to extract numbers from',
        },
        include_decimals: {
          type: 'boolean',
          description: 'Include decimal numbers (default: true)',
        },
      },
      required: ['text'],
    },
  },
  // ===== LIST & DATA TOOLS =====
  {
    name: 'sort_list',
    description: 'Sort a list of items',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of items to sort',
        },
        order: {
          type: 'string',
          description: 'Sort order: asc, desc (default: asc)',
        },
        numeric: {
          type: 'boolean',
          description: 'Sort numerically if items are numbers (default: false)',
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'deduplicate',
    description: 'Remove duplicate items from a list',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of items to deduplicate',
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Case sensitive comparison (default: true)',
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'create_table',
    description: 'Create a formatted table from data',
    parameters: {
      type: 'object',
      properties: {
        headers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Column headers',
        },
        rows: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'string' },
          },
          description: 'Table rows (array of arrays)',
        },
        format: {
          type: 'string',
          description: 'Output format: markdown, csv, json (default: markdown)',
        },
      },
      required: ['headers', 'rows'],
    },
  },
  // ===== VALIDATION TOOLS =====
  {
    name: 'validate_email',
    description: 'Validate if a string is a valid email address',
    parameters: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address to validate',
        },
      },
      required: ['email'],
    },
  },
  {
    name: 'validate_url',
    description: 'Validate if a string is a valid URL',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to validate',
        },
      },
      required: ['url'],
    },
  },
];
