/**
 * Time Tool Definitions
 *
 * Tool schemas for time and date operations.
 */

import type { ToolDefinition } from '../types.js';

export const TIME_TOOL_DEFS: readonly ToolDefinition[] = [
  {
    name: 'get_current_time',
    description: 'Get the current date and time in ISO format',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone name (e.g., "America/New_York")',
        },
      },
    },
  },
  {
    name: 'format_date',
    description: 'Format a date in various formats',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description:
            'Date string to format (ISO format or natural language like "tomorrow", "next week")',
        },
        format: {
          type: 'string',
          description: 'Output format: iso, short, long, relative, custom (with pattern)',
        },
        timezone: {
          type: 'string',
          description: 'Target timezone (default: UTC)',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'date_diff',
    description: 'Calculate difference between two dates',
    parameters: {
      type: 'object',
      properties: {
        date1: {
          type: 'string',
          description: 'First date (ISO format)',
        },
        date2: {
          type: 'string',
          description: 'Second date (ISO format, defaults to now)',
        },
        unit: {
          type: 'string',
          description: 'Unit for result: days, hours, minutes, seconds, weeks, months, years',
        },
      },
      required: ['date1'],
    },
  },
  {
    name: 'add_to_date',
    description: 'Add or subtract time from a date',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Starting date (ISO format, defaults to now)',
        },
        amount: {
          type: 'number',
          description: 'Amount to add (negative to subtract)',
        },
        unit: {
          type: 'string',
          description: 'Unit: days, hours, minutes, seconds, weeks, months, years',
        },
      },
      required: ['amount', 'unit'],
    },
  },
];
