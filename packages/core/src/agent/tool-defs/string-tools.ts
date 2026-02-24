/**
 * String Tool Definitions
 *
 * Tool schemas for calculation, text truncation, wrapping, slug/case conversion,
 * and percentage/statistics operations.
 */

import type { ToolDefinition } from '../types.js';

export const STRING_TOOL_DEFS: readonly ToolDefinition[] = [
  {
    name: 'calculate',
    description: 'Evaluate a mathematical expression',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical expression to evaluate (e.g., "2 + 2 * 3")',
        },
      },
      required: ['expression'],
    },
  },
  // ===== STRING TOOLS =====
  {
    name: 'truncate_text',
    description: 'Truncate text to specified length with ellipsis',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to truncate',
        },
        length: {
          type: 'number',
          description: 'Maximum length (default: 100)',
        },
        suffix: {
          type: 'string',
          description: 'Suffix to add (default: "...")',
        },
        word_boundary: {
          type: 'boolean',
          description: 'Cut at word boundary (default: true)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'wrap_text',
    description: 'Wrap text to specified line width',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to wrap',
        },
        width: {
          type: 'number',
          description: 'Maximum line width (default: 80)',
        },
      },
      required: ['text'],
    },
  },
  // ===== SLUG & CASE TOOLS =====
  {
    name: 'to_slug',
    description: 'Convert text to URL-friendly slug',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to convert',
        },
        separator: {
          type: 'string',
          description: 'Word separator (default: "-")',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'change_case',
    description: 'Change text case (camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to convert',
        },
        case_type: {
          type: 'string',
          description: 'Target case: camel, pascal, snake, kebab, constant',
        },
      },
      required: ['text', 'case_type'],
    },
  },
  // ===== CALCULATION TOOLS =====
  {
    name: 'calculate_percentage',
    description: 'Calculate percentage (what % is X of Y, X% of Y, % change)',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description:
            'Operation: "of" (X% of Y), "is" (X is what % of Y), "change" (% change from X to Y)',
        },
        value1: {
          type: 'number',
          description: 'First value',
        },
        value2: {
          type: 'number',
          description: 'Second value',
        },
      },
      required: ['operation', 'value1', 'value2'],
    },
  },
  {
    name: 'calculate_statistics',
    description: 'Calculate statistics for a list of numbers',
    parameters: {
      type: 'object',
      properties: {
        numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of numbers',
        },
      },
      required: ['numbers'],
    },
  },
];
