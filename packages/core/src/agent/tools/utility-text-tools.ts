/**
 * Utility Text Tools
 *
 * - Text counting (words, characters, sentences)
 * - Pattern extraction (URLs, emails, phones, dates)
 * - String transformation (case, slugify, camelCase)
 * - Text comparison/diff
 * - Regex operations
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../types.js';
import { getErrorMessage } from '../../services/error-utils.js';

// =============================================================================
// TEXT COUNTING
// =============================================================================

export const countTextTool: ToolDefinition = {
  name: 'count_text',
  brief: 'Count words, characters, sentences, lines in text',
  description: 'Count characters, words, sentences, lines, and paragraphs in text. Call this when the user asks "how many words", "character count", word count, or needs text length stats. Also estimates reading time.',
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to analyze',
      },
    },
    required: ['text'],
  },
};

export const countTextExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;

    const chars = text.length;
    const charsNoSpaces = text.replace(/\s/g, '').length;
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
    const lines = text.split('\n').length;

    // Estimate reading time (average 200 words per minute)
    const readingTimeMinutes = Math.ceil(words / 200);

    return {
      content: JSON.stringify({
        characters: chars,
        charactersNoSpaces: charsNoSpaces,
        words,
        sentences,
        paragraphs,
        lines,
        readingTimeMinutes,
      }),
    };
  } catch (error) {
    return {
      content: `Error counting text: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// PATTERN EXTRACTION
// =============================================================================

export const extractFromTextTool: ToolDefinition = {
  name: 'extract_from_text',
  brief: 'Extract URLs, emails, phones, dates from text',
  description: 'Extract structured data from text: URLs, email addresses, phone numbers, dates, numbers, hashtags, or @mentions. Call this when the user pastes text and wants to pull out specific data points.',
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to extract from',
      },
      pattern: {
        type: 'string',
        enum: ['urls', 'emails', 'phones', 'dates', 'numbers', 'hashtags', 'mentions'],
        description: 'What to extract',
      },
    },
    required: ['text', 'pattern'],
  },
};

export const extractFromTextExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;
    const pattern = args.pattern as string;

    const patterns: Record<string, RegExp> = {
      urls: /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi,
      emails: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
      phones: /[\+]?[(]?[0-9]{1,4}[)]?[-\s\./0-9]{7,}/g,
      dates: /\b\d{1,4}[-/.\s]\d{1,2}[-/.\s]\d{1,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/gi,
      numbers: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      hashtags: /#[a-zA-Z0-9_]+/g,
      mentions: /@[a-zA-Z0-9_]+/g,
    };

    const regex = patterns[pattern];
    if (!regex) {
      return {
        content: JSON.stringify({ error: `Unknown pattern: ${pattern}` }),
        isError: true,
      };
    }

    const matches = text.match(regex) || [];
    const unique = [...new Set(matches)];

    return {
      content: JSON.stringify({
        pattern,
        matches: unique,
        count: unique.length,
        totalOccurrences: matches.length,
      }),
    };
  } catch (error) {
    return {
      content: `Error extracting from text: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// STRING TRANSFORMATION
// =============================================================================

export const transformTextTool: ToolDefinition = {
  name: 'transform_text',
  brief: 'Transform text case, slugify, camelCase, trim, reverse',
  description: `Transform text format. Call this when the user wants to convert text case (uppercase, lowercase, title case), create URL slugs, convert naming conventions (camelCase, snake_case, kebab-case, PascalCase), trim whitespace, reverse text, remove accents/diacritics, or truncate text.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to transform',
      },
      operation: {
        type: 'string',
        enum: [
          'uppercase', 'lowercase', 'capitalize', 'title_case',
          'trim', 'trim_start', 'trim_end',
          'slugify', 'camel_case', 'snake_case', 'kebab_case', 'pascal_case',
          'reverse', 'remove_whitespace', 'normalize_whitespace',
          'remove_diacritics', 'truncate'
        ],
        description: 'The transformation to apply',
      },
      options: {
        type: 'object',
        properties: {
          maxLength: { type: 'number', description: 'Max length for truncate operation' },
          suffix: { type: 'string', description: 'Suffix for truncate (default: "...")' },
        },
        description: 'Additional options for certain operations',
      },
    },
    required: ['text', 'operation'],
  },
};

export const transformTextExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;
    const operation = args.operation as string;
    const options = (args.options as Record<string, unknown>) || {};

    let result: string;

    switch (operation) {
      case 'uppercase':
        result = text.toUpperCase();
        break;
      case 'lowercase':
        result = text.toLowerCase();
        break;
      case 'capitalize':
        result = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
        break;
      case 'title_case':
        result = text.replace(/\w\S*/g, (txt) =>
          txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
        );
        break;
      case 'trim':
        result = text.trim();
        break;
      case 'trim_start':
        result = text.trimStart();
        break;
      case 'trim_end':
        result = text.trimEnd();
        break;
      case 'slugify':
        result = text
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        break;
      case 'camel_case':
        result = text
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase());
        break;
      case 'snake_case':
        result = text
          .replace(/([a-z])([A-Z])/g, '$1_$2')
          .replace(/[\s-]+/g, '_')
          .toLowerCase();
        break;
      case 'kebab_case':
        result = text
          .replace(/([a-z])([A-Z])/g, '$1-$2')
          .replace(/[\s_]+/g, '-')
          .toLowerCase();
        break;
      case 'pascal_case':
        result = text
          .toLowerCase()
          .replace(/(^|[^a-zA-Z0-9])([a-z])/g, (_, __, chr) => chr.toUpperCase());
        break;
      case 'reverse':
        result = [...text].reverse().join('');
        break;
      case 'remove_whitespace':
        result = text.replace(/\s+/g, '');
        break;
      case 'normalize_whitespace':
        result = text.replace(/\s+/g, ' ').trim();
        break;
      case 'remove_diacritics':
        result = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        break;
      case 'truncate':
        const maxLength = (options.maxLength as number) || 100;
        const suffix = (options.suffix as string) ?? '...';
        result = text.length > maxLength
          ? text.slice(0, maxLength - suffix.length) + suffix
          : text;
        break;
      default:
        return {
          content: JSON.stringify({ error: `Unknown operation: ${operation}` }),
          isError: true,
        };
    }

    return {
      content: JSON.stringify({
        operation,
        input: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        output: result,
        inputLength: text.length,
        outputLength: result.length,
      }),
    };
  } catch (error) {
    return {
      content: `Transform error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// TEXT COMPARISON
// =============================================================================

export const compareTextTool: ToolDefinition = {
  name: 'compare_text',
  brief: 'Diff two texts and show similarity percentage',
  description: `Compare two texts and show differences. Call this when the user wants to diff two versions, check similarity, or find what changed between texts. Compares by lines, words, or characters and shows added/removed/common parts.`,
  category: 'Utilities',
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
        enum: ['lines', 'words', 'chars'],
        description: 'Comparison mode (default: lines)',
      },
    },
    required: ['text1', 'text2'],
  },
};

export const compareTextExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text1 = args.text1 as string;
    const text2 = args.text2 as string;
    const mode = (args.mode as string) || 'lines';

    const split = (text: string): string[] => {
      switch (mode) {
        case 'lines': return text.split('\n');
        case 'words': return text.split(/\s+/);
        case 'chars': return text.split('');
        default: return text.split('\n');
      }
    };

    const units1 = split(text1);
    const units2 = split(text2);

    // Simple LCS-based diff
    const set1 = new Set(units1);
    const set2 = new Set(units2);

    const added = units2.filter(u => !set1.has(u));
    const removed = units1.filter(u => !set2.has(u));
    const common = units1.filter(u => set2.has(u));

    const identical = text1 === text2;
    const similarity = identical ? 100 :
      (common.length / Math.max(units1.length, units2.length)) * 100;

    return {
      content: JSON.stringify({
        identical,
        similarity: Number(similarity.toFixed(2)),
        mode,
        text1Stats: { count: units1.length },
        text2Stats: { count: units2.length },
        added: added.slice(0, 20),
        removed: removed.slice(0, 20),
        addedCount: added.length,
        removedCount: removed.length,
        commonCount: common.length,
      }),
    };
  } catch (error) {
    return {
      content: `Compare error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// REGEX
// =============================================================================

export const runRegexTool: ToolDefinition = {
  name: 'run_regex',
  brief: 'Test, match, replace, or split text with regex',
  description: `Test, match, or replace text using regular expressions. Call this when you need pattern matching, find-and-replace, text splitting by pattern, or when the user asks to extract data matching a specific pattern. Supports test, match, match_all, replace, and split operations.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to search in',
      },
      pattern: {
        type: 'string',
        description: 'Regular expression pattern',
      },
      operation: {
        type: 'string',
        enum: ['test', 'match', 'match_all', 'replace', 'split'],
        description: 'Operation to perform',
      },
      replacement: {
        type: 'string',
        description: 'Replacement string (for replace operation)',
      },
      flags: {
        type: 'string',
        description: 'Regex flags (e.g., "gi" for global, case-insensitive)',
      },
    },
    required: ['text', 'pattern', 'operation'],
  },
};

export const runRegexExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;
    const pattern = args.pattern as string;
    const operation = args.operation as string;
    const replacement = args.replacement as string;
    const flags = (args.flags as string) || '';

    // Guard against excessively long patterns that could cause ReDoS
    if (pattern.length > 1000) {
      return {
        content: JSON.stringify({ error: 'Regex pattern too long (max 1000 characters)' }),
        isError: true,
      };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch (e) {
      return {
        content: JSON.stringify({ error: `Invalid regex: ${getErrorMessage(e)}` }),
        isError: true,
      };
    }

    let result: unknown;

    switch (operation) {
      case 'test':
        result = regex.test(text);
        break;
      case 'match': {
        const match = text.match(regex);
        result = match ? { match: match[0], groups: match.slice(1), index: match.index } : null;
        break;
      }
      case 'match_all': {
        const globalRegex = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
        const matches = [...text.matchAll(globalRegex)];
        result = matches.map(m => ({ match: m[0], groups: m.slice(1), index: m.index }));
        break;
      }
      case 'replace':
        result = text.replace(regex, replacement || '');
        break;
      case 'split':
        result = text.split(regex);
        break;
      default:
        return { content: JSON.stringify({ error: `Unknown operation: ${operation}` }), isError: true };
    }

    return {
      content: JSON.stringify({
        operation,
        pattern,
        flags,
        result,
      }),
    };
  } catch (error) {
    return {
      content: `Regex error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};
