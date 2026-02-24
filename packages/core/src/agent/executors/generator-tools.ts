/**
 * Generator tool executors
 *
 * Executors: random_number, random_string, random_choice, generate_password,
 *            generate_lorem_ipsum, generate_uuid
 */

import { randomUUID, randomInt } from 'node:crypto';
import type { ToolExecutor } from '../types.js';

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
      result += chars.charAt(Math.floor(Math.random() * chars.length));
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
