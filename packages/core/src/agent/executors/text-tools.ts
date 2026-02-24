/**
 * Text processing tool executors
 *
 * Executors: parse_json, format_json, text_stats, text_transform, search_replace,
 *            markdown_to_html, strip_markdown, json_to_csv, csv_to_json,
 *            compare_texts, test_regex, count_words, find_and_replace_bulk
 */

import type { ToolExecutor } from '../types.js';
import { getErrorMessage } from '../../services/error-utils.js';

export const TEXT_EXECUTORS: Record<string, ToolExecutor> = {
  parse_json: async (args) => {
    const jsonStr = args.json as string;
    const jsonPath = args.path as string | undefined;

    try {
      const parsed = JSON.parse(jsonStr);

      if (jsonPath) {
        // Extract value at path
        const parts = jsonPath.replace(/\[(\d+)\]/g, '.$1').split('.');
        let value: unknown = parsed;
        for (const part of parts) {
          if (value && typeof value === 'object') {
            value = (value as Record<string, unknown>)[part];
          } else {
            return { content: `Error: Path not found: ${jsonPath}`, isError: true };
          }
        }
        return { content: JSON.stringify(value, null, 2) };
      }

      return { content: JSON.stringify(parsed, null, 2) };
    } catch (error) {
      return {
        content: `Error parsing JSON: ${getErrorMessage(error, 'Invalid JSON')}`,
        isError: true,
      };
    }
  },

  format_json: async (args) => {
    const jsonStr = args.json as string;
    const indent = (args.indent as number) ?? 2;

    try {
      const parsed = JSON.parse(jsonStr);
      return { content: JSON.stringify(parsed, null, indent) };
    } catch (error) {
      return {
        content: `Error formatting JSON: ${getErrorMessage(error, 'Invalid JSON')}`,
        isError: true,
      };
    }
  },

  text_stats: async (args) => {
    const text = args.text as string;

    const chars = text.length;
    const charsNoSpaces = text.replace(/\s/g, '').length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text.split('\n').length;
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim()).length;
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim()).length;

    return {
      content: `\u{1F4CA} Text Statistics:
\u2022 Characters: ${chars.toLocaleString()}
\u2022 Characters (no spaces): ${charsNoSpaces.toLocaleString()}
\u2022 Words: ${words.toLocaleString()}
\u2022 Lines: ${lines.toLocaleString()}
\u2022 Sentences: ${sentences.toLocaleString()}
\u2022 Paragraphs: ${paragraphs.toLocaleString()}`,
    };
  },

  text_transform: async (args) => {
    const text = args.text as string;
    const operation = (args.operation as string).toLowerCase();

    let result: string;
    switch (operation) {
      case 'uppercase':
        result = text.toUpperCase();
        break;
      case 'lowercase':
        result = text.toLowerCase();
        break;
      case 'titlecase':
        result = text.replace(
          /\w\S*/g,
          (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
        );
        break;
      case 'reverse':
        result = text.split('').reverse().join('');
        break;
      case 'trim':
        result = text.trim();
        break;
      case 'slug':
        result = text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        break;
      default:
        return { content: `Error: Unknown operation: ${operation}`, isError: true };
    }

    return { content: result };
  },

  search_replace: async (args) => {
    const text = args.text as string;
    const search = args.search as string;
    const replace = args.replace as string;
    const useRegex = args.regex as boolean;
    const global = args.global !== false;

    try {
      let result: string;
      if (useRegex) {
        const flags = global ? 'g' : '';
        const regex = new RegExp(search, flags);
        result = text.replace(regex, replace);
      } else {
        if (global) {
          result = text.split(search).join(replace);
        } else {
          result = text.replace(search, replace);
        }
      }

      const count =
        (text.length - result.length + replace.length * (text.split(search).length - 1)) /
        search.length;
      return { content: `Replaced ${Math.max(0, Math.round(count))} occurrence(s):\n\n${result}` };
    } catch (error) {
      return {
        content: `Error: ${getErrorMessage(error, 'Invalid regex')}`,
        isError: true,
      };
    }
  },

  markdown_to_html: async (args) => {
    const md = args.markdown as string;

    // Simple markdown to HTML conversion
    let html = md
      // Headers
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      // Bold and italic
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Lists
      .replace(/^\* (.*$)/gm, '<li>$1</li>')
      .replace(/^- (.*$)/gm, '<li>$1</li>')
      // Paragraphs
      .replace(/\n\n/g, '</p><p>')
      // Line breaks
      .replace(/\n/g, '<br>');

    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');

    return { content: html };
  },

  strip_markdown: async (args) => {
    const md = args.markdown as string;

    const plain = md
      // Remove headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic
      .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/___(.*?)___/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      // Remove code
      .replace(/`([^`]+)`/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      // Remove links
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      // Remove list markers
      .replace(/^\* /gm, '')
      .replace(/^- /gm, '')
      .replace(/^\d+\. /gm, '')
      // Remove blockquotes
      .replace(/^> /gm, '')
      // Remove horizontal rules
      .replace(/^---+$/gm, '');

    return { content: plain.trim() };
  },

  json_to_csv: async (args) => {
    const jsonStr = args.json as string;
    const delimiter = (args.delimiter as string) ?? ',';

    try {
      const data = JSON.parse(jsonStr);
      if (!Array.isArray(data)) {
        return { content: 'Error: JSON must be an array', isError: true };
      }
      if (data.length === 0) {
        return { content: 'Error: Array is empty', isError: true };
      }

      const headers = Object.keys(data[0]);
      const rows = data.map((obj) =>
        headers
          .map((h) => {
            const val = String(obj[h] ?? '');
            return val.includes(delimiter) || val.includes('"') || val.includes('\n')
              ? `"${val.replace(/"/g, '""')}"`
              : val;
          })
          .join(delimiter)
      );

      return { content: [headers.join(delimiter), ...rows].join('\n') };
    } catch (error) {
      return { content: `Error: ${getErrorMessage(error, 'Invalid JSON')}`, isError: true };
    }
  },

  csv_to_json: async (args) => {
    const csv = args.csv as string;
    const delimiter = (args.delimiter as string) ?? ',';
    const hasHeaders = args.headers !== false;

    const lines = csv.trim().split('\n');
    const firstLine = lines[0];
    if (lines.length === 0 || !firstLine) {
      return { content: 'Error: CSV is empty', isError: true };
    }

    const parseRow = (row: string): string[] => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') {
          if (inQuotes && row[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          values.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current);
      return values;
    };

    const headers = hasHeaders
      ? parseRow(firstLine)
      : parseRow(firstLine).map((_, i) => `column${i + 1}`);
    const dataLines = hasHeaders ? lines.slice(1) : lines;

    const result = dataLines.map((line) => {
      const values = parseRow(line);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = values[i] ?? '';
      });
      return obj;
    });

    return { content: JSON.stringify(result, null, 2) };
  },

  compare_texts: async (args) => {
    const text1 = args.text1 as string;
    const text2 = args.text2 as string;
    const mode = (args.mode as string) ?? 'lines';

    let units1: string[];
    let units2: string[];

    switch (mode) {
      case 'words':
        units1 = text1.split(/\s+/);
        units2 = text2.split(/\s+/);
        break;
      case 'chars':
        units1 = text1.split('');
        units2 = text2.split('');
        break;
      default:
        units1 = text1.split('\n');
        units2 = text2.split('\n');
    }

    const added = units2.filter((u) => !units1.includes(u));
    const removed = units1.filter((u) => !units2.includes(u));
    const same = units1.filter((u) => units2.includes(u));

    return {
      content: `\u{1F4CA} Text Comparison (${mode}):

\u2705 Same: ${same.length}
\u2795 Added: ${added.length}
\u2796 Removed: ${removed.length}

${
  added.length > 0
    ? `\n\u2795 Added:\n${added
        .slice(0, 10)
        .map((u) => `  + ${u}`)
        .join('\n')}${added.length > 10 ? `\n  ... and ${added.length - 10} more` : ''}`
    : ''
}
${
  removed.length > 0
    ? `\n\u2796 Removed:\n${removed
        .slice(0, 10)
        .map((u) => `  - ${u}`)
        .join('\n')}${removed.length > 10 ? `\n  ... and ${removed.length - 10} more` : ''}`
    : ''
}`,
    };
  },

  test_regex: async (args) => {
    const pattern = args.pattern as string;
    const text = args.text as string;
    const flags = (args.flags as string) ?? 'g';

    try {
      const regex = new RegExp(pattern, flags);
      const matches = text.match(regex);

      if (!matches || matches.length === 0) {
        return { content: '\u274C No matches found' };
      }

      return {
        content: `\u2705 Found ${matches.length} match(es):

Pattern: /${pattern}/${flags}

Matches:
${matches.map((m, i) => `${i + 1}. "${m}"`).join('\n')}`,
      };
    } catch (error) {
      return {
        content: `Error: Invalid regex - ${getErrorMessage(error)}`,
        isError: true,
      };
    }
  },

  count_words: async (args) => {
    const text = args.text as string;
    const top = (args.top as number) ?? 10;
    const minLength = (args.min_length as number) ?? 1;

    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    const freq: Record<string, number> = {};

    for (const word of words) {
      if (word.length >= minLength) {
        freq[word] = (freq[word] || 0) + 1;
      }
    }

    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, top);

    const total = words.filter((w) => w.length >= minLength).length;
    const unique = Object.keys(freq).length;

    return {
      content: `\u{1F4CA} Word Frequency Analysis:

Total words: ${total}
Unique words: ${unique}

Top ${Math.min(top, sorted.length)} words:
${sorted.map(([word, count], i) => `${i + 1}. "${word}" - ${count} times`).join('\n')}`,
    };
  },

  find_and_replace_bulk: async (args) => {
    const text = args.text as string;
    const replacements = args.replacements as Array<{ find: string; replace: string }>;

    let result = text;
    let totalReplacements = 0;

    for (const { find, replace } of replacements) {
      const before = result;
      result = result.split(find).join(replace);
      totalReplacements +=
        (before.length - result.length + replace.length * (before.split(find).length - 1)) /
        find.length;
    }

    return {
      content: `Made ${Math.max(0, Math.round(totalReplacements))} replacements:\n\n${result}`,
    };
  },
};
