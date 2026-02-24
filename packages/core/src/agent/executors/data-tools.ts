/**
 * Data/list tool executors
 *
 * Executors: sort_list, deduplicate, create_table, extract_urls, extract_emails,
 *            extract_numbers, validate_email, validate_url
 */

import type { ToolExecutor } from '../types.js';

export const DATA_EXECUTORS: Record<string, ToolExecutor> = {
  sort_list: async (args) => {
    const items = args.items as string[];
    const order = (args.order as string) ?? 'asc';
    const numeric = args.numeric as boolean;

    const sorted = [...items].sort((a, b) => {
      if (numeric) {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        return order === 'desc' ? numB - numA : numA - numB;
      }
      return order === 'desc' ? b.localeCompare(a) : a.localeCompare(b);
    });

    return { content: sorted.join('\n') };
  },

  deduplicate: async (args) => {
    const items = args.items as string[];
    const caseSensitive = args.case_sensitive !== false;

    let unique: string[];
    if (caseSensitive) {
      unique = [...new Set(items)];
    } else {
      const seen = new Set<string>();
      unique = items.filter((item) => {
        const lower = item.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      });
    }

    const removed = items.length - unique.length;
    return { content: `Removed ${removed} duplicate(s):\n${unique.join('\n')}` };
  },

  create_table: async (args) => {
    const headers = args.headers as string[];
    const rows = args.rows as string[][];
    const format = (args.format as string) ?? 'markdown';

    if (format === 'csv') {
      const csvRows = [headers.join(','), ...rows.map((r) => r.join(','))];
      return { content: csvRows.join('\n') };
    }

    if (format === 'json') {
      const jsonRows = rows.map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = row[i] ?? '';
        });
        return obj;
      });
      return { content: JSON.stringify(jsonRows, null, 2) };
    }

    // Markdown table
    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] || '').length))
    );

    const headerRow =
      '| ' + headers.map((h, i) => h.padEnd(colWidths[i] ?? h.length)).join(' | ') + ' |';
    const separator = '| ' + colWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
    const dataRows = rows.map(
      (r) => '| ' + headers.map((_, i) => (r[i] || '').padEnd(colWidths[i] ?? 0)).join(' | ') + ' |'
    );

    return { content: [headerRow, separator, ...dataRows].join('\n') };
  },

  extract_urls: async (args) => {
    const text = args.text as string;
    const urlRegex = /https?:\/\/[^\s<>\"{}|\\^`[\]]+/g;
    const urls = text.match(urlRegex) || [];

    if (urls.length === 0) {
      return { content: 'No URLs found.' };
    }

    const unique = [...new Set(urls)];
    return { content: `Found ${unique.length} URL(s):\n${unique.join('\n')}` };
  },

  extract_emails: async (args) => {
    const text = args.text as string;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = text.match(emailRegex) || [];

    if (emails.length === 0) {
      return { content: 'No email addresses found.' };
    }

    const unique = [...new Set(emails)];
    return { content: `Found ${unique.length} email(s):\n${unique.join('\n')}` };
  },

  extract_numbers: async (args) => {
    const text = args.text as string;
    const includeDecimals = args.include_decimals !== false;

    const regex = includeDecimals ? /-?\d+\.?\d*/g : /-?\d+/g;
    const numbers = text.match(regex) || [];

    if (numbers.length === 0) {
      return { content: 'No numbers found.' };
    }

    return { content: `Found ${numbers.length} number(s): ${numbers.join(', ')}` };
  },

  validate_email: async (args) => {
    const email = args.email as string;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValid = emailRegex.test(email);

    if (isValid) {
      const [local, domain] = email.split('@');
      return {
        content: `\u2705 Valid email address
\u{1F4E7} Email: ${email}
\u{1F464} Local part: ${local}
\u{1F310} Domain: ${domain}`,
      };
    }
    return { content: `\u274C Invalid email address: ${email}`, isError: true };
  },

  validate_url: async (args) => {
    const url = args.url as string;
    try {
      const parsed = new URL(url);
      return {
        content: `\u2705 Valid URL
\u{1F517} Full URL: ${url}
\u{1F4CB} Protocol: ${parsed.protocol}
\u{1F310} Host: ${parsed.host}
\u{1F4C1} Path: ${parsed.pathname}
\u{1F50D} Search: ${parsed.search || '(none)'}
#\uFE0F\u20E3 Hash: ${parsed.hash || '(none)'}`,
      };
    } catch {
      return { content: `\u274C Invalid URL: ${url}`, isError: true };
    }
  },
};
