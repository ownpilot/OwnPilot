/**
 * Generator Tool Definitions
 *
 * Tool schemas for UUID, random number/string/choice, password, and lorem ipsum generation.
 */

import type { ToolDefinition } from '../../types.js';

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

// ===========================================================================
// Executors
// ===========================================================================

/**
 * Generator tool executors
 *
 * Executors: random_number, random_string, random_choice, generate_password,
 *            generate_lorem_ipsum, generate_uuid
 */

import { randomUUID, randomInt } from 'node:crypto';
import type { ToolExecutor } from '../../types.js';

export const GENERATOR_EXECUTORS: Record<string, ToolExecutor> = {
  generate_uuid: async () => {
    return { content: randomUUID() };
  },

  random_number: async (args) => {
    const min = (args.min as number) ?? 0;
    const max = (args.max as number) ?? 100;
    const integer = args.integer !== false;

    const random = Math.random() * (max - min) + min;
    const result = integer ? Math.floor(random) : random;

    return { content: String(result) };
  },

  random_string: async (args) => {
    const length = (args.length as number) ?? 16;
    const charset = (args.charset as string) ?? 'alphanumeric';
    const custom = args.custom as string;

    let chars: string;
    switch (charset) {
      case 'alpha':
        chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        break;
      case 'numeric':
        chars = '0123456789';
        break;
      case 'hex':
        chars = '0123456789abcdef';
        break;
      case 'custom':
        chars = custom || 'abcdefghijklmnopqrstuvwxyz';
        break;
      default:
        chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    }

    let result = '';
    for (let i = 0; i < length; i++) {
      // CSPRNG: random_string is a generator tool the LLM may use to mint
      // passwords, tokens, or any value the user later relies on for
      // security. Math.random() is a non-cryptographic PRNG; the casts
      // here keep the result unpredictable. The per-char cost (length
      // calls to randomInt) is fine for typical lengths (≤128).
      result += chars.charAt(randomInt(chars.length));
    }

    return { content: result };
  },

  random_choice: async (args) => {
    const options = args.options as string[];
    const count = Math.min((args.count as number) ?? 1, options.length);

    if (count === 1) {
      return { content: options[Math.floor(Math.random() * options.length)] };
    }

    const shuffled = [...options].sort(() => Math.random() - 0.5);
    return { content: shuffled.slice(0, count).join(', ') };
  },

  generate_password: async (args) => {
    const length = (args.length as number) ?? 16;
    const useUpper = args.uppercase !== false;
    const useLower = args.lowercase !== false;
    const useNumbers = args.numbers !== false;
    const useSymbols = args.symbols !== false;

    let charset = '';
    if (useUpper) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (useLower) charset += 'abcdefghijklmnopqrstuvwxyz';
    if (useNumbers) charset += '0123456789';
    if (useSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (!charset) {
      return { content: 'Error: At least one character type must be enabled', isError: true };
    }

    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(randomInt(charset.length));
    }

    return {
      content: `\u{1F510} Generated Password:
${password}

\u{1F4CA} Strength: ${length >= 16 ? 'Strong' : length >= 12 ? 'Medium' : 'Weak'}
\u{1F4CF} Length: ${length} characters`,
    };
  },

  generate_lorem_ipsum: async (args) => {
    const type = (args.type as string) ?? 'paragraphs';
    const count = (args.count as number) ?? 3;

    const words = [
      'lorem',
      'ipsum',
      'dolor',
      'sit',
      'amet',
      'consectetur',
      'adipiscing',
      'elit',
      'sed',
      'do',
      'eiusmod',
      'tempor',
      'incididunt',
      'ut',
      'labore',
      'et',
      'dolore',
      'magna',
      'aliqua',
      'enim',
      'ad',
      'minim',
      'veniam',
      'quis',
      'nostrud',
      'exercitation',
      'ullamco',
      'laboris',
      'nisi',
      'aliquip',
      'ex',
      'ea',
      'commodo',
      'consequat',
      'duis',
      'aute',
      'irure',
      'in',
      'reprehenderit',
      'voluptate',
      'velit',
      'esse',
      'cillum',
      'fugiat',
      'nulla',
      'pariatur',
      'excepteur',
      'sint',
      'occaecat',
      'cupidatat',
      'non',
      'proident',
      'sunt',
      'culpa',
      'qui',
      'officia',
      'deserunt',
      'mollit',
      'anim',
      'id',
      'est',
      'laborum',
    ];

    const getWord = () => words[Math.floor(Math.random() * words.length)];
    const getSentence = () => {
      const len = 8 + Math.floor(Math.random() * 10);
      const sentence = Array.from({ length: len }, getWord).join(' ');
      return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
    };
    const getParagraph = () => {
      const len = 3 + Math.floor(Math.random() * 4);
      return Array.from({ length: len }, getSentence).join(' ');
    };

    let result: string;
    switch (type) {
      case 'words':
        result = Array.from({ length: count }, getWord).join(' ');
        break;
      case 'sentences':
        result = Array.from({ length: count }, getSentence).join(' ');
        break;
      default:
        result = Array.from({ length: count }, getParagraph).join('\n\n');
    }

    return { content: result };
  },
};
