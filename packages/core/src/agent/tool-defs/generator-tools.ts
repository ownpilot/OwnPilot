/**
 * Generator Tool Definitions
 *
 * Tool schemas for UUID, random number/string/choice, password, and lorem ipsum generation.
 */

import type { ToolDefinition } from '../types.js';

export const GENERATOR_TOOL_DEFS: readonly ToolDefinition[] = [
  {
    name: 'generate_uuid',
    description: 'Generate a random UUID',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  // ===== RANDOM GENERATION TOOLS =====
  {
    name: 'random_number',
    description: 'Generate a random number within a range',
    parameters: {
      type: 'object',
      properties: {
        min: {
          type: 'number',
          description: 'Minimum value (default: 0)',
        },
        max: {
          type: 'number',
          description: 'Maximum value (default: 100)',
        },
        integer: {
          type: 'boolean',
          description: 'If true, return integer only (default: true)',
        },
      },
    },
  },
  {
    name: 'random_string',
    description: 'Generate a random string',
    parameters: {
      type: 'object',
      properties: {
        length: {
          type: 'number',
          description: 'Length of string (default: 16)',
        },
        charset: {
          type: 'string',
          description: 'Character set: alphanumeric, alpha, numeric, hex, custom',
        },
        custom: {
          type: 'string',
          description: 'Custom characters to use (when charset is "custom")',
        },
      },
    },
  },
  {
    name: 'random_choice',
    description: 'Randomly select from a list of options',
    parameters: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of options to choose from',
        },
        count: {
          type: 'number',
          description: 'Number of items to select (default: 1)',
        },
      },
      required: ['options'],
    },
  },
  // ===== GENERATOR TOOLS =====
  {
    name: 'generate_password',
    description: 'Generate a secure random password',
    parameters: {
      type: 'object',
      properties: {
        length: {
          type: 'number',
          description: 'Password length (default: 16)',
        },
        uppercase: {
          type: 'boolean',
          description: 'Include uppercase letters (default: true)',
        },
        lowercase: {
          type: 'boolean',
          description: 'Include lowercase letters (default: true)',
        },
        numbers: {
          type: 'boolean',
          description: 'Include numbers (default: true)',
        },
        symbols: {
          type: 'boolean',
          description: 'Include symbols (default: true)',
        },
      },
    },
  },
  {
    name: 'generate_lorem_ipsum',
    description: 'Generate Lorem Ipsum placeholder text',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type: words, sentences, paragraphs (default: paragraphs)',
        },
        count: {
          type: 'number',
          description: 'Number of units to generate (default: 3)',
        },
      },
    },
  },
];
