/**
 * Tests for CORE_EXECUTORS — pure/deterministic tool executors.
 *
 * Skips all filesystem-dependent tools (create_folder, write_file, read_file,
 * list_files, delete_file, move_file, create_task, list_tasks, complete_task,
 * create_note, search_notes, create_bookmark, list_bookmarks).
 */

import { describe, it, expect } from 'vitest';
import { CORE_EXECUTORS } from './core-tool-executors.js';
import type { ToolContext } from './types.js';

// Helper to invoke an executor with minimal boilerplate.
const exec = (name: string, args: Record<string, unknown> = {}) =>
  CORE_EXECUTORS[name]!(args, {} as ToolContext);

// ───────────────────────────────────────────────────────
// get_current_time
// ───────────────────────────────────────────────────────
describe('get_current_time', () => {
  it('returns current time with default UTC timezone', async () => {
    const result = await exec('get_current_time');
    expect(result.content).toContain('Current time');
    expect(result.isError).toBeUndefined();
  });

  it('accepts a valid timezone', async () => {
    const result = await exec('get_current_time', { timezone: 'America/New_York' });
    expect(result.content).toContain('Current time in America/New_York');
    expect(result.isError).toBeUndefined();
  });

  it('falls back to UTC ISO for invalid timezone', async () => {
    const result = await exec('get_current_time', { timezone: 'Invalid/Zone' });
    expect(result.content).toContain('Current time (UTC)');
    expect(result.content).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

// ───────────────────────────────────────────────────────
// calculate
// ───────────────────────────────────────────────────────
describe('calculate', () => {
  it('evaluates simple addition', async () => {
    const result = await exec('calculate', { expression: '2 + 3' });
    expect(result.content).toBe('5');
  });

  it('evaluates division', async () => {
    const result = await exec('calculate', { expression: '10 / 3' });
    expect(parseFloat(result.content)).toBeCloseTo(3.3333, 3);
  });

  it('evaluates sqrt function', async () => {
    const result = await exec('calculate', { expression: 'sqrt(16)' });
    expect(result.content).toBe('4');
  });

  it('evaluates power expressions', async () => {
    const result = await exec('calculate', { expression: '2 ^ 10' });
    expect(result.content).toBe('1024');
  });

  it('returns error for invalid expression', async () => {
    const result = await exec('calculate', { expression: 'foo bar baz' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error');
  });

  it('handles pi constant', async () => {
    const result = await exec('calculate', { expression: 'pi' });
    expect(parseFloat(result.content)).toBeCloseTo(Math.PI, 10);
  });
});

// ───────────────────────────────────────────────────────
// generate_uuid
// ───────────────────────────────────────────────────────
describe('generate_uuid', () => {
  it('returns a valid UUID v4', async () => {
    const result = await exec('generate_uuid');
    expect(result.content).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('returns a different UUID on each call', async () => {
    const a = await exec('generate_uuid');
    const b = await exec('generate_uuid');
    expect(a.content).not.toBe(b.content);
  });
});

// ───────────────────────────────────────────────────────
// parse_json
// ───────────────────────────────────────────────────────
describe('parse_json', () => {
  it('parses valid JSON and pretty-prints it', async () => {
    const result = await exec('parse_json', { json: '{"a":1}' });
    expect(result.content).toBe('{\n  "a": 1\n}');
  });

  it('extracts a nested path via dot notation', async () => {
    const result = await exec('parse_json', {
      json: '{"a":{"b":1}}',
      path: 'a.b',
    });
    expect(result.content).toBe('1');
  });

  it('supports array index path notation', async () => {
    const result = await exec('parse_json', {
      json: '{"items":[{"name":"test"}]}',
      path: 'items[0].name',
    });
    expect(result.content).toBe('"test"');
  });

  it('returns error for missing path', async () => {
    const result = await exec('parse_json', {
      json: '{"a":1}',
      path: 'b.c.d',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Path not found');
  });

  it('returns error for invalid JSON', async () => {
    const result = await exec('parse_json', { json: '{not valid}' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error');
  });
});

// ───────────────────────────────────────────────────────
// format_json
// ───────────────────────────────────────────────────────
describe('format_json', () => {
  it('formats with default indent of 2', async () => {
    const result = await exec('format_json', { json: '{"a":1,"b":2}' });
    expect(result.content).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('formats with custom indent', async () => {
    const result = await exec('format_json', { json: '{"a":1}', indent: 4 });
    expect(result.content).toBe('{\n    "a": 1\n}');
  });

  it('returns error for invalid JSON', async () => {
    const result = await exec('format_json', { json: 'nope' });
    expect(result.isError).toBe(true);
  });
});

// ───────────────────────────────────────────────────────
// text_stats
// ───────────────────────────────────────────────────────
describe('text_stats', () => {
  it('counts characters, words, lines, sentences, paragraphs', async () => {
    const result = await exec('text_stats', { text: 'Hello world. How are you?' });
    expect(result.content).toContain('Words: 5');
    expect(result.content).toContain('Sentences: 2');
    expect(result.content).toContain('Lines: 1');
    expect(result.content).toContain('Paragraphs: 1');
  });

  it('handles empty text with 0 words', async () => {
    const result = await exec('text_stats', { text: '' });
    expect(result.content).toContain('Words: 0');
  });

  it('counts multiple lines and paragraphs', async () => {
    const result = await exec('text_stats', { text: 'Line one.\n\nLine three.' });
    expect(result.content).toContain('Lines: 3');
    expect(result.content).toContain('Paragraphs: 2');
  });
});

// ───────────────────────────────────────────────────────
// text_transform
// ───────────────────────────────────────────────────────
describe('text_transform', () => {
  it('uppercase', async () => {
    const result = await exec('text_transform', { text: 'hello', operation: 'uppercase' });
    expect(result.content).toBe('HELLO');
  });

  it('lowercase', async () => {
    const result = await exec('text_transform', { text: 'HELLO', operation: 'lowercase' });
    expect(result.content).toBe('hello');
  });

  it('titlecase', async () => {
    const result = await exec('text_transform', { text: 'hello world', operation: 'titlecase' });
    expect(result.content).toBe('Hello World');
  });

  it('reverse', async () => {
    const result = await exec('text_transform', { text: 'abc', operation: 'reverse' });
    expect(result.content).toBe('cba');
  });

  it('trim', async () => {
    const result = await exec('text_transform', { text: '  hello  ', operation: 'trim' });
    expect(result.content).toBe('hello');
  });

  it('slug', async () => {
    // "Hello World!" → lowercase → "hello world!" → replace non-alnum → "hello-world-" → strip edges → "hello-world"
    const result = await exec('text_transform', { text: 'Hello World!', operation: 'slug' });
    expect(result.content).toBe('hello-world');
  });

  it('returns error for unknown operation', async () => {
    const result = await exec('text_transform', { text: 'hi', operation: 'unknown' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown operation');
  });
});

// ───────────────────────────────────────────────────────
// search_replace
// ───────────────────────────────────────────────────────
describe('search_replace', () => {
  it('replaces all occurrences by default', async () => {
    const result = await exec('search_replace', {
      text: 'foo bar foo',
      search: 'foo',
      replace: 'baz',
    });
    expect(result.content).toContain('baz bar baz');
  });

  it('replaces first occurrence when global is false', async () => {
    const result = await exec('search_replace', {
      text: 'foo bar foo',
      search: 'foo',
      replace: 'baz',
      global: false,
    });
    expect(result.content).toContain('baz bar foo');
  });

  it('supports regex mode', async () => {
    const result = await exec('search_replace', {
      text: 'abc 123 def 456',
      search: '\\d+',
      replace: '#',
      regex: true,
    });
    expect(result.content).toContain('abc # def #');
  });

  it('returns error for invalid regex', async () => {
    const result = await exec('search_replace', {
      text: 'hello',
      search: '[invalid',
      replace: 'x',
      regex: true,
    });
    expect(result.isError).toBe(true);
  });
});

// ───────────────────────────────────────────────────────
// format_date
// ───────────────────────────────────────────────────────
describe('format_date', () => {
  it('formats a fixed date in iso format', async () => {
    const result = await exec('format_date', { date: '2024-06-15T12:00:00Z', format: 'iso' });
    expect(result.content).toBe('2024-06-15T12:00:00.000Z');
  });

  it('formats a date in long format', async () => {
    const result = await exec('format_date', { date: '2024-01-01', format: 'long' });
    expect(result.content).toContain('2024');
    expect(result.content).toContain('January');
  });

  it('handles "now" natural language date', async () => {
    const result = await exec('format_date', { date: 'now', format: 'iso' });
    expect(result.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('handles "tomorrow" as relative', async () => {
    const result = await exec('format_date', { date: 'tomorrow', format: 'relative' });
    expect(result.content).toBe('Tomorrow');
  });

  it('handles "yesterday" as relative', async () => {
    const result = await exec('format_date', { date: 'yesterday', format: 'relative' });
    expect(result.content).toBe('Yesterday');
  });

  it('returns error for invalid date string', async () => {
    const result = await exec('format_date', { date: 'not-a-date' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid date');
  });
});

// ───────────────────────────────────────────────────────
// date_diff
// ───────────────────────────────────────────────────────
describe('date_diff', () => {
  it('calculates difference in days between two dates', async () => {
    const result = await exec('date_diff', {
      date1: '2024-01-01T00:00:00Z',
      date2: '2024-01-11T00:00:00Z',
      unit: 'days',
    });
    expect(result.content).toBe('10.00 days');
  });

  it('calculates difference in hours', async () => {
    const result = await exec('date_diff', {
      date1: '2024-01-01T00:00:00Z',
      date2: '2024-01-01T06:00:00Z',
      unit: 'hours',
    });
    expect(result.content).toBe('6.00 hours');
  });

  it('returns negative difference when date2 is before date1', async () => {
    const result = await exec('date_diff', {
      date1: '2024-06-01',
      date2: '2024-01-01',
      unit: 'days',
    });
    expect(parseFloat(result.content)).toBeLessThan(0);
  });

  it('returns error for invalid date', async () => {
    const result = await exec('date_diff', { date1: 'invalid' });
    expect(result.isError).toBe(true);
  });

  it('returns error for unknown unit', async () => {
    const result = await exec('date_diff', {
      date1: '2024-01-01',
      date2: '2024-02-01',
      unit: 'fortnights',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown unit');
  });
});

// ───────────────────────────────────────────────────────
// add_to_date
// ───────────────────────────────────────────────────────
describe('add_to_date', () => {
  it('adds days to a date', async () => {
    const result = await exec('add_to_date', {
      date: '2024-01-01T00:00:00Z',
      amount: 10,
      unit: 'days',
    });
    expect(result.content).toBe('2024-01-11T00:00:00.000Z');
  });

  it('adds months via setMonth', async () => {
    const result = await exec('add_to_date', {
      date: '2024-01-15T00:00:00Z',
      amount: 2,
      unit: 'months',
    });
    expect(result.content).toContain('2024-03');
  });

  it('adds years via setFullYear', async () => {
    const result = await exec('add_to_date', {
      date: '2024-06-15T00:00:00Z',
      amount: 3,
      unit: 'years',
    });
    expect(result.content).toContain('2027');
  });

  it('returns error for unknown unit', async () => {
    const result = await exec('add_to_date', {
      date: '2024-01-01',
      amount: 1,
      unit: 'decades',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown unit');
  });

  it('returns error for invalid date', async () => {
    const result = await exec('add_to_date', {
      date: 'not-a-date',
      amount: 1,
      unit: 'days',
    });
    expect(result.isError).toBe(true);
  });
});

// ───────────────────────────────────────────────────────
// convert_units
// ───────────────────────────────────────────────────────
describe('convert_units', () => {
  it('converts km to miles', async () => {
    const result = await exec('convert_units', { value: 1, from: 'km', to: 'mi' });
    expect(result.content).toContain('0.6214');
  });

  it('converts Celsius to Fahrenheit (100C = 212F)', async () => {
    const result = await exec('convert_units', { value: 100, from: 'c', to: 'f' });
    expect(result.content).toContain('212');
  });

  it('converts 0C to 32F', async () => {
    const result = await exec('convert_units', { value: 0, from: 'c', to: 'f' });
    expect(result.content).toContain('32');
  });

  it('converts Kelvin to Celsius', async () => {
    const result = await exec('convert_units', { value: 273.15, from: 'k', to: 'c' });
    expect(result.content).toContain('0.0000');
  });

  it('converts kg to lb', async () => {
    const result = await exec('convert_units', { value: 1, from: 'kg', to: 'lb' });
    const parsed = parseFloat(result.content.split('=')[1]!.trim());
    expect(parsed).toBeCloseTo(2.2046, 3);
  });

  it('returns error for incompatible units', async () => {
    const result = await exec('convert_units', { value: 1, from: 'km', to: 'kg' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Cannot convert');
  });
});

// ───────────────────────────────────────────────────────
// convert_currency
// ───────────────────────────────────────────────────────
describe('convert_currency', () => {
  it('converts USD to EUR', async () => {
    const result = await exec('convert_currency', { amount: 100, from: 'USD', to: 'EUR' });
    expect(result.content).toContain('USD');
    expect(result.content).toContain('EUR');
    expect(result.isError).toBeUndefined();
  });

  it('returns error for unsupported currency', async () => {
    const result = await exec('convert_currency', { amount: 100, from: 'USD', to: 'XYZ' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown currency');
  });

  it('handles case-insensitive currency codes', async () => {
    const result = await exec('convert_currency', { amount: 50, from: 'usd', to: 'gbp' });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('GBP');
  });
});

// ───────────────────────────────────────────────────────
// base64_encode / base64_decode
// ───────────────────────────────────────────────────────
describe('base64_encode', () => {
  it('encodes "hello" to base64', async () => {
    const result = await exec('base64_encode', { text: 'hello' });
    expect(result.content).toBe('aGVsbG8=');
  });

  it('encodes empty string', async () => {
    const result = await exec('base64_encode', { text: '' });
    expect(result.content).toBe('');
  });
});

describe('base64_decode', () => {
  it('decodes "aGVsbG8=" to "hello"', async () => {
    const result = await exec('base64_decode', { encoded: 'aGVsbG8=' });
    expect(result.content).toBe('hello');
  });

  it('round-trips correctly', async () => {
    const original = 'The quick brown fox!';
    const encoded = await exec('base64_encode', { text: original });
    const decoded = await exec('base64_decode', { encoded: encoded.content });
    expect(decoded.content).toBe(original);
  });
});

// ───────────────────────────────────────────────────────
// url_encode
// ───────────────────────────────────────────────────────
describe('url_encode', () => {
  it('encodes special characters', async () => {
    const result = await exec('url_encode', { text: 'hello world & foo=bar' });
    expect(result.content).toBe('hello%20world%20%26%20foo%3Dbar');
  });

  it('decodes when decode=true', async () => {
    const result = await exec('url_encode', { text: 'hello%20world', decode: true });
    expect(result.content).toBe('hello world');
  });
});

// ───────────────────────────────────────────────────────
// hash_text
// ───────────────────────────────────────────────────────
describe('hash_text', () => {
  it('produces a known sha256 hash for "hello"', async () => {
    const result = await exec('hash_text', { text: 'hello' });
    expect(result.content).toBe(
      'SHA256: 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('produces md5 hash', async () => {
    const result = await exec('hash_text', { text: 'hello', algorithm: 'md5' });
    expect(result.content).toMatch(/^MD5: [0-9a-f]{32}$/);
  });

  it('produces sha1 hash', async () => {
    const result = await exec('hash_text', { text: 'hello', algorithm: 'sha1' });
    expect(result.content).toMatch(/^SHA1: [0-9a-f]{40}$/);
  });

  it('returns error for invalid algorithm', async () => {
    const result = await exec('hash_text', { text: 'hello', algorithm: 'sha999' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid algorithm');
  });
});

// ───────────────────────────────────────────────────────
// random_number
// ───────────────────────────────────────────────────────
describe('random_number', () => {
  it('returns an integer between 0 and 100 by default', async () => {
    const result = await exec('random_number');
    const num = parseInt(result.content, 10);
    expect(num).toBeGreaterThanOrEqual(0);
    expect(num).toBeLessThanOrEqual(100);
    expect(Number.isInteger(num)).toBe(true);
  });

  it('respects custom min and max', async () => {
    const result = await exec('random_number', { min: 50, max: 60 });
    const num = parseInt(result.content, 10);
    expect(num).toBeGreaterThanOrEqual(50);
    expect(num).toBeLessThanOrEqual(60);
  });

  it('returns a float when integer is false', async () => {
    const result = await exec('random_number', { min: 0, max: 1, integer: false });
    const num = parseFloat(result.content);
    expect(num).toBeGreaterThanOrEqual(0);
    expect(num).toBeLessThanOrEqual(1);
  });
});

// ───────────────────────────────────────────────────────
// random_string
// ───────────────────────────────────────────────────────
describe('random_string', () => {
  it('returns a 16-char alphanumeric string by default', async () => {
    const result = await exec('random_string');
    expect(result.content).toHaveLength(16);
    expect(result.content).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('respects custom length', async () => {
    const result = await exec('random_string', { length: 8 });
    expect(result.content).toHaveLength(8);
  });

  it('numeric charset produces digits only', async () => {
    const result = await exec('random_string', { length: 20, charset: 'numeric' });
    expect(result.content).toMatch(/^[0-9]+$/);
  });

  it('hex charset produces hex chars only', async () => {
    const result = await exec('random_string', { length: 32, charset: 'hex' });
    expect(result.content).toMatch(/^[0-9a-f]+$/);
  });

  it('custom charset uses provided characters', async () => {
    const result = await exec('random_string', { length: 10, charset: 'custom', custom: 'AB' });
    expect(result.content).toMatch(/^[AB]+$/);
    expect(result.content).toHaveLength(10);
  });
});

// ───────────────────────────────────────────────────────
// random_choice
// ───────────────────────────────────────────────────────
describe('random_choice', () => {
  it('returns one of the given options', async () => {
    const options = ['apple', 'banana', 'cherry'];
    const result = await exec('random_choice', { options });
    expect(options).toContain(result.content);
  });

  it('returns multiple choices when count > 1', async () => {
    const options = ['a', 'b', 'c', 'd', 'e'];
    const result = await exec('random_choice', { options, count: 3 });
    const choices = result.content.split(', ');
    expect(choices).toHaveLength(3);
    for (const c of choices) {
      expect(options).toContain(c);
    }
  });
});

// ───────────────────────────────────────────────────────
// extract_urls
// ───────────────────────────────────────────────────────
describe('extract_urls', () => {
  it('finds URLs in text', async () => {
    const result = await exec('extract_urls', {
      text: 'Visit https://example.com and http://test.org/path?q=1',
    });
    expect(result.content).toContain('https://example.com');
    expect(result.content).toContain('http://test.org/path?q=1');
    expect(result.content).toContain('2 URL(s)');
  });

  it('returns no URLs message when none found', async () => {
    const result = await exec('extract_urls', { text: 'No links here' });
    expect(result.content).toBe('No URLs found.');
  });

  it('deduplicates URLs', async () => {
    const result = await exec('extract_urls', {
      text: 'https://a.com https://a.com https://b.com',
    });
    expect(result.content).toContain('2 URL(s)');
  });
});

// ───────────────────────────────────────────────────────
// extract_emails
// ───────────────────────────────────────────────────────
describe('extract_emails', () => {
  it('finds email addresses', async () => {
    const result = await exec('extract_emails', {
      text: 'Contact user@example.com or admin@test.org',
    });
    expect(result.content).toContain('user@example.com');
    expect(result.content).toContain('admin@test.org');
    expect(result.content).toContain('2 email(s)');
  });

  it('returns no emails message when none found', async () => {
    const result = await exec('extract_emails', { text: 'no emails here' });
    expect(result.content).toBe('No email addresses found.');
  });
});

// ───────────────────────────────────────────────────────
// extract_numbers
// ───────────────────────────────────────────────────────
describe('extract_numbers', () => {
  it('extracts integers and decimals by default', async () => {
    const result = await exec('extract_numbers', { text: 'There are 3 items at $4.99 each' });
    expect(result.content).toContain('3');
    expect(result.content).toContain('4.99');
  });

  it('extracts only integers when include_decimals is false', async () => {
    const result = await exec('extract_numbers', {
      text: 'pi is 3.14 and e is 2.71',
      include_decimals: false,
    });
    // Without decimals, the regex /-?\d+/ will match just digit groups
    expect(result.content).toContain('3');
  });

  it('returns no numbers message when none found', async () => {
    const result = await exec('extract_numbers', { text: 'no numbers' });
    expect(result.content).toBe('No numbers found.');
  });

  it('extracts negative numbers', async () => {
    const result = await exec('extract_numbers', { text: 'Temperature is -5 degrees' });
    expect(result.content).toContain('-5');
  });
});

// ───────────────────────────────────────────────────────
// sort_list
// ───────────────────────────────────────────────────────
describe('sort_list', () => {
  it('sorts ascending by default', async () => {
    const result = await exec('sort_list', { items: ['c', 'a', 'b'] });
    expect(result.content).toBe('a\nb\nc');
  });

  it('sorts descending', async () => {
    const result = await exec('sort_list', { items: ['c', 'a', 'b'], order: 'desc' });
    expect(result.content).toBe('c\nb\na');
  });

  it('sorts numerically', async () => {
    const result = await exec('sort_list', { items: ['10', '2', '1'], numeric: true });
    expect(result.content).toBe('1\n2\n10');
  });

  it('sorts numerically descending', async () => {
    const result = await exec('sort_list', {
      items: ['10', '2', '1'],
      numeric: true,
      order: 'desc',
    });
    expect(result.content).toBe('10\n2\n1');
  });
});

// ───────────────────────────────────────────────────────
// deduplicate
// ───────────────────────────────────────────────────────
describe('deduplicate', () => {
  it('removes duplicate items (case-sensitive)', async () => {
    const result = await exec('deduplicate', { items: ['a', 'b', 'a'] });
    expect(result.content).toContain('a\nb');
    expect(result.content).toContain('Removed 1 duplicate');
  });

  it('removes duplicates case-insensitively', async () => {
    const result = await exec('deduplicate', {
      items: ['Hello', 'hello', 'HELLO'],
      case_sensitive: false,
    });
    expect(result.content).toContain('Removed 2 duplicate');
    expect(result.content).toContain('Hello');
  });

  it('handles no duplicates', async () => {
    const result = await exec('deduplicate', { items: ['a', 'b', 'c'] });
    expect(result.content).toContain('Removed 0 duplicate');
  });
});

// ───────────────────────────────────────────────────────
// create_table
// ───────────────────────────────────────────────────────
describe('create_table', () => {
  const headers = ['Name', 'Age'];
  const rows = [['Alice', '30'], ['Bob', '25']];

  it('creates a markdown table by default', async () => {
    const result = await exec('create_table', { headers, rows });
    expect(result.content).toContain('| Name');
    expect(result.content).toContain('| ---');
    expect(result.content).toContain('| Alice');
  });

  it('creates a CSV table', async () => {
    const result = await exec('create_table', { headers, rows, format: 'csv' });
    expect(result.content).toBe('Name,Age\nAlice,30\nBob,25');
  });

  it('creates a JSON table', async () => {
    const result = await exec('create_table', { headers, rows, format: 'json' });
    const parsed = JSON.parse(result.content);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ Name: 'Alice', Age: '30' });
  });
});

// ───────────────────────────────────────────────────────
// validate_email
// ───────────────────────────────────────────────────────
describe('validate_email', () => {
  it('validates a correct email', async () => {
    const result = await exec('validate_email', { email: 'user@example.com' });
    expect(result.content).toContain('Valid');
    expect(result.content).toContain('user');
    expect(result.content).toContain('example.com');
    expect(result.isError).toBeUndefined();
  });

  it('rejects an invalid email', async () => {
    const result = await exec('validate_email', { email: 'not-an-email' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid');
  });

  it('rejects email without domain', async () => {
    const result = await exec('validate_email', { email: 'user@' });
    expect(result.isError).toBe(true);
  });
});

// ───────────────────────────────────────────────────────
// validate_url
// ───────────────────────────────────────────────────────
describe('validate_url', () => {
  it('validates a correct URL', async () => {
    const result = await exec('validate_url', { url: 'https://example.com/path?q=1#section' });
    expect(result.content).toContain('Valid URL');
    expect(result.content).toContain('https:');
    expect(result.content).toContain('example.com');
    expect(result.content).toContain('/path');
    expect(result.isError).toBeUndefined();
  });

  it('rejects an invalid URL', async () => {
    const result = await exec('validate_url', { url: 'not a url' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid URL');
  });
});

// ───────────────────────────────────────────────────────
// convert_color
// ───────────────────────────────────────────────────────
describe('convert_color', () => {
  it('converts hex red to all formats', async () => {
    const result = await exec('convert_color', { color: '#ff0000' });
    expect(result.content).toContain('rgb(255, 0, 0)');
    expect(result.content).toContain('#ff0000');
    expect(result.content).toContain('hsl(0, 100%, 50%)');
  });

  it('converts rgb green to hex', async () => {
    const result = await exec('convert_color', { color: 'rgb(0, 128, 0)', to: 'hex' });
    expect(result.content).toBe('#008000');
  });

  it('converts shorthand hex', async () => {
    const result = await exec('convert_color', { color: '#fff', to: 'rgb' });
    expect(result.content).toBe('rgb(255, 255, 255)');
  });

  it('converts HSL to hex', async () => {
    const result = await exec('convert_color', { color: 'hsl(0, 100%, 50%)', to: 'hex' });
    expect(result.content).toBe('#ff0000');
  });

  it('returns error for unrecognized format', async () => {
    const result = await exec('convert_color', { color: 'magenta' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unrecognized color format');
  });

  it('returns error for invalid RGB format', async () => {
    const result = await exec('convert_color', { color: 'rgb(abc)' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid RGB format');
  });

  it('returns error for invalid HSL format', async () => {
    const result = await exec('convert_color', { color: 'hsl(abc)' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid HSL format');
  });
});

// ───────────────────────────────────────────────────────
// compare_texts
// ───────────────────────────────────────────────────────
describe('compare_texts', () => {
  it('compares by lines (default)', async () => {
    const result = await exec('compare_texts', {
      text1: 'a\nb\nc',
      text2: 'a\nc\nd',
    });
    expect(result.content).toContain('Same: 2');
    expect(result.content).toContain('Added: 1');
    expect(result.content).toContain('Removed: 1');
  });

  it('compares by words', async () => {
    const result = await exec('compare_texts', {
      text1: 'hello world foo',
      text2: 'hello world bar',
      mode: 'words',
    });
    expect(result.content).toContain('Same: 2');
    expect(result.content).toContain('Added: 1');
    expect(result.content).toContain('Removed: 1');
  });

  it('compares by chars', async () => {
    const result = await exec('compare_texts', {
      text1: 'abc',
      text2: 'abd',
      mode: 'chars',
    });
    expect(result.content).toContain('Same: 2');
    expect(result.content).toContain('Added: 1');
    expect(result.content).toContain('Removed: 1');
  });
});

// ───────────────────────────────────────────────────────
// test_regex
// ───────────────────────────────────────────────────────
describe('test_regex', () => {
  it('finds matches with global flag', async () => {
    const result = await exec('test_regex', {
      pattern: '\\d+',
      text: 'abc 123 def 456',
    });
    expect(result.content).toContain('2 match(es)');
    expect(result.content).toContain('"123"');
    expect(result.content).toContain('"456"');
  });

  it('reports no matches', async () => {
    const result = await exec('test_regex', {
      pattern: '\\d+',
      text: 'no numbers here',
    });
    expect(result.content).toContain('No matches found');
  });

  it('returns error for invalid regex', async () => {
    const result = await exec('test_regex', {
      pattern: '[invalid',
      text: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid regex');
  });
});

// ───────────────────────────────────────────────────────
// count_words
// ───────────────────────────────────────────────────────
describe('count_words', () => {
  it('counts word frequency', async () => {
    const result = await exec('count_words', {
      text: 'the cat sat on the mat the cat',
    });
    expect(result.content).toContain('Total words: 8');
    expect(result.content).toContain('"the" - 3 times');
    expect(result.content).toContain('"cat" - 2 times');
  });

  it('respects min_length filter', async () => {
    const result = await exec('count_words', {
      text: 'a bb ccc dddd',
      min_length: 3,
    });
    expect(result.content).toContain('Total words: 2');
    expect(result.content).toContain('"ccc"');
    expect(result.content).toContain('"dddd"');
  });

  it('limits results to top N', async () => {
    const result = await exec('count_words', {
      text: 'a b c d e f g h i j k l m',
      top: 3,
    });
    expect(result.content).toContain('Top 3 words');
  });
});

// ───────────────────────────────────────────────────────
// find_and_replace_bulk
// ───────────────────────────────────────────────────────
describe('find_and_replace_bulk', () => {
  it('applies multiple replacements sequentially', async () => {
    const result = await exec('find_and_replace_bulk', {
      text: 'Hello World! Hello Earth!',
      replacements: [
        { find: 'Hello', replace: 'Hi' },
        { find: 'World', replace: 'Universe' },
      ],
    });
    expect(result.content).toContain('Hi Universe! Hi Earth!');
  });

  it('handles no matches', async () => {
    const result = await exec('find_and_replace_bulk', {
      text: 'no match',
      replacements: [{ find: 'xyz', replace: 'abc' }],
    });
    expect(result.content).toContain('no match');
  });
});

// ───────────────────────────────────────────────────────
// markdown_to_html
// ───────────────────────────────────────────────────────
describe('markdown_to_html', () => {
  it('converts headers', async () => {
    const result = await exec('markdown_to_html', { markdown: '# Title' });
    expect(result.content).toContain('<h1>Title</h1>');
  });

  it('converts bold and italic', async () => {
    const result = await exec('markdown_to_html', { markdown: '**bold** *italic*' });
    expect(result.content).toContain('<strong>bold</strong>');
    expect(result.content).toContain('<em>italic</em>');
  });

  it('converts inline code', async () => {
    const result = await exec('markdown_to_html', { markdown: 'Use `code` here' });
    expect(result.content).toContain('<code>code</code>');
  });

  it('converts links', async () => {
    const result = await exec('markdown_to_html', { markdown: '[text](https://example.com)' });
    expect(result.content).toContain('<a href="https://example.com">text</a>');
  });

  it('converts list items', async () => {
    const result = await exec('markdown_to_html', { markdown: '- item1\n- item2' });
    expect(result.content).toContain('<li>item1</li>');
    expect(result.content).toContain('<li>item2</li>');
  });
});

// ───────────────────────────────────────────────────────
// strip_markdown
// ───────────────────────────────────────────────────────
describe('strip_markdown', () => {
  it('removes all markdown formatting', async () => {
    const result = await exec('strip_markdown', {
      markdown: '# Title\n\n**bold** and *italic* with `code`',
    });
    expect(result.content).not.toContain('#');
    expect(result.content).not.toContain('**');
    expect(result.content).not.toContain('`');
    expect(result.content).toContain('Title');
    expect(result.content).toContain('bold');
    expect(result.content).toContain('italic');
    expect(result.content).toContain('code');
  });

  it('removes links but keeps text', async () => {
    const result = await exec('strip_markdown', { markdown: '[click here](http://example.com)' });
    expect(result.content).toBe('click here');
  });

  it('removes list markers', async () => {
    const result = await exec('strip_markdown', { markdown: '- item1\n- item2' });
    expect(result.content).toBe('item1\nitem2');
  });
});

// ───────────────────────────────────────────────────────
// json_to_csv
// ───────────────────────────────────────────────────────
describe('json_to_csv', () => {
  it('converts a JSON array to CSV', async () => {
    const json = JSON.stringify([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
    const result = await exec('json_to_csv', { json });
    expect(result.content).toBe('name,age\nAlice,30\nBob,25');
  });

  it('returns error for non-array JSON', async () => {
    const result = await exec('json_to_csv', { json: '{"key":"value"}' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('must be an array');
  });

  it('returns error for empty array', async () => {
    const result = await exec('json_to_csv', { json: '[]' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('empty');
  });

  it('handles values containing delimiters', async () => {
    const json = JSON.stringify([{ name: 'Smith, John', age: 40 }]);
    const result = await exec('json_to_csv', { json });
    expect(result.content).toContain('"Smith, John"');
  });

  it('supports custom delimiter', async () => {
    const json = JSON.stringify([{ a: '1', b: '2' }]);
    const result = await exec('json_to_csv', { json, delimiter: ';' });
    expect(result.content).toBe('a;b\n1;2');
  });
});

// ───────────────────────────────────────────────────────
// csv_to_json
// ───────────────────────────────────────────────────────
describe('csv_to_json', () => {
  it('converts CSV with headers to JSON', async () => {
    const csv = 'name,age\nAlice,30\nBob,25';
    const result = await exec('csv_to_json', { csv });
    const parsed = JSON.parse(result.content);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ name: 'Alice', age: '30' });
  });

  it('generates column names when headers=false', async () => {
    const csv = 'Alice,30\nBob,25';
    const result = await exec('csv_to_json', { csv, headers: false });
    const parsed = JSON.parse(result.content);
    expect(parsed[0]).toEqual({ column1: 'Alice', column2: '30' });
  });

  it('handles quoted values with commas', async () => {
    const csv = 'name,city\n"Smith, John",NYC';
    const result = await exec('csv_to_json', { csv });
    const parsed = JSON.parse(result.content);
    expect(parsed[0].name).toBe('Smith, John');
  });

  it('returns error for empty CSV', async () => {
    const result = await exec('csv_to_json', { csv: '' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('empty');
  });

  it('roundtrips with json_to_csv', async () => {
    const original = [{ x: 'hello', y: 'world' }];
    const csvResult = await exec('json_to_csv', { json: JSON.stringify(original) });
    const jsonResult = await exec('csv_to_json', { csv: csvResult.content });
    const parsed = JSON.parse(jsonResult.content);
    expect(parsed).toEqual(original);
  });
});

// ───────────────────────────────────────────────────────
// calculate_percentage
// ───────────────────────────────────────────────────────
describe('calculate_percentage', () => {
  it('calculates X% of Y', async () => {
    const result = await exec('calculate_percentage', {
      operation: 'of',
      value1: 50,
      value2: 200,
    });
    expect(result.content).toContain('100.00');
  });

  it('calculates what % X is of Y', async () => {
    const result = await exec('calculate_percentage', {
      operation: 'is',
      value1: 50,
      value2: 200,
    });
    expect(result.content).toContain('25.00%');
  });

  it('calculates percentage change', async () => {
    const result = await exec('calculate_percentage', {
      operation: 'change',
      value1: 100,
      value2: 150,
    });
    expect(result.content).toContain('+50.00%');
  });

  it('calculates negative percentage change', async () => {
    const result = await exec('calculate_percentage', {
      operation: 'change',
      value1: 200,
      value2: 100,
    });
    expect(result.content).toContain('-50.00%');
  });

  it('returns error for unknown operation', async () => {
    const result = await exec('calculate_percentage', {
      operation: 'unknown',
      value1: 1,
      value2: 2,
    });
    expect(result.isError).toBe(true);
  });
});

// ───────────────────────────────────────────────────────
// calculate_statistics
// ───────────────────────────────────────────────────────
describe('calculate_statistics', () => {
  it('calculates correct statistics for [1,2,3,4,5]', async () => {
    const result = await exec('calculate_statistics', { numbers: [1, 2, 3, 4, 5] });
    expect(result.content).toContain('Count: 5');
    expect(result.content).toContain('Sum: 15.00');
    expect(result.content).toContain('Mean: 3.00');
    expect(result.content).toContain('Median: 3.00');
    expect(result.content).toContain('Min: 1');
    expect(result.content).toContain('Max: 5');
    expect(result.content).toContain('Range: 4');
  });

  it('calculates median for even-length array', async () => {
    const result = await exec('calculate_statistics', { numbers: [1, 2, 3, 4] });
    expect(result.content).toContain('Median: 2.50');
  });

  it('returns error for empty array', async () => {
    const result = await exec('calculate_statistics', { numbers: [] });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('empty');
  });

  it('computes std dev and variance', async () => {
    const result = await exec('calculate_statistics', { numbers: [2, 4, 4, 4, 5, 5, 7, 9] });
    // Mean = 5, Variance = 4, StdDev = 2
    expect(result.content).toContain('Mean: 5.00');
    expect(result.content).toContain('Variance: 4.00');
    expect(result.content).toContain('Std Dev: 2.00');
  });
});

// ───────────────────────────────────────────────────────
// truncate_text
// ───────────────────────────────────────────────────────
describe('truncate_text', () => {
  it('returns text unchanged if under limit', async () => {
    const result = await exec('truncate_text', { text: 'short' });
    expect(result.content).toBe('short');
  });

  it('truncates long text with default suffix', async () => {
    const longText = 'a'.repeat(200);
    const result = await exec('truncate_text', { text: longText, length: 50 });
    expect(result.content).toHaveLength(50);
    expect(result.content).toMatch(/\.\.\.$/);
  });

  it('uses custom suffix', async () => {
    const result = await exec('truncate_text', {
      text: 'a'.repeat(200),
      length: 20,
      suffix: '>>',
    });
    expect(result.content).toMatch(/>>$/);
  });

  it('respects word boundary', async () => {
    const result = await exec('truncate_text', {
      text: 'The quick brown fox jumps over the lazy dog near the river bank',
      length: 30,
      word_boundary: true,
    });
    // Should not break in the middle of a word
    expect(result.content).toMatch(/\.\.\.$|[a-z]\.\.\.$/);
    expect(result.content.length).toBeLessThanOrEqual(30);
  });
});

// ───────────────────────────────────────────────────────
// wrap_text
// ───────────────────────────────────────────────────────
describe('wrap_text', () => {
  it('wraps text at specified width', async () => {
    const text = 'The quick brown fox jumps over the lazy dog near the river bank';
    const result = await exec('wrap_text', { text, width: 20 });
    const lines = result.content.split('\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });

  it('does not wrap short text', async () => {
    const result = await exec('wrap_text', { text: 'short text', width: 80 });
    expect(result.content).toBe('short text');
  });
});

// ───────────────────────────────────────────────────────
// to_slug
// ───────────────────────────────────────────────────────
describe('to_slug', () => {
  it('converts text to a URL slug', async () => {
    const result = await exec('to_slug', { text: 'Hello World!' });
    expect(result.content).toBe('hello-world');
  });

  it('uses custom separator', async () => {
    const result = await exec('to_slug', { text: 'Hello World', separator: '_' });
    expect(result.content).toBe('hello_world');
  });

  it('normalizes unicode characters', async () => {
    const result = await exec('to_slug', { text: 'Caf\u00e9 R\u00e9sum\u00e9' });
    expect(result.content).toBe('cafe-resume');
  });

  it('removes special characters', async () => {
    const result = await exec('to_slug', { text: 'foo@bar#baz$qux' });
    expect(result.content).toBe('foobarbazqux');
  });
});

// ───────────────────────────────────────────────────────
// change_case
// ───────────────────────────────────────────────────────
describe('change_case', () => {
  it('converts to camelCase', async () => {
    const result = await exec('change_case', { text: 'hello world', case_type: 'camel' });
    expect(result.content).toBe('helloWorld');
  });

  it('converts to PascalCase', async () => {
    const result = await exec('change_case', { text: 'hello world', case_type: 'pascal' });
    expect(result.content).toBe('HelloWorld');
  });

  it('converts to snake_case', async () => {
    const result = await exec('change_case', { text: 'hello world', case_type: 'snake' });
    expect(result.content).toBe('hello_world');
  });

  it('converts to kebab-case', async () => {
    const result = await exec('change_case', { text: 'hello world', case_type: 'kebab' });
    expect(result.content).toBe('hello-world');
  });

  it('converts to CONSTANT_CASE', async () => {
    const result = await exec('change_case', { text: 'hello world', case_type: 'constant' });
    expect(result.content).toBe('HELLO_WORLD');
  });

  it('converts camelCase input to snake_case', async () => {
    const result = await exec('change_case', { text: 'helloWorld', case_type: 'snake' });
    expect(result.content).toBe('hello_world');
  });

  it('converts kebab-case input to camelCase', async () => {
    const result = await exec('change_case', { text: 'my-component-name', case_type: 'camel' });
    expect(result.content).toBe('myComponentName');
  });

  it('returns error for unknown case type', async () => {
    const result = await exec('change_case', { text: 'hello', case_type: 'unknown' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown case type');
  });
});

// ───────────────────────────────────────────────────────
// generate_password
// ───────────────────────────────────────────────────────
describe('generate_password', () => {
  it('generates a password with default length', async () => {
    const result = await exec('generate_password', {});
    expect(result.content).toContain('Generated Password');
    expect(result.content).toContain('Length: 16');
    expect(result.content).toContain('Strong');
  });

  it('generates a password with custom length', async () => {
    const result = await exec('generate_password', { length: 8 });
    expect(result.content).toContain('Length: 8');
    expect(result.content).toContain('Weak');
  });

  it('returns error if all character types disabled', async () => {
    const result = await exec('generate_password', {
      uppercase: false,
      lowercase: false,
      numbers: false,
      symbols: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('At least one character type');
  });
});

// ───────────────────────────────────────────────────────
// generate_lorem_ipsum
// ───────────────────────────────────────────────────────
describe('generate_lorem_ipsum', () => {
  it('generates paragraphs by default', async () => {
    const result = await exec('generate_lorem_ipsum', {});
    // Default is 3 paragraphs separated by \n\n
    const paragraphs = result.content.split('\n\n');
    expect(paragraphs.length).toBe(3);
  });

  it('generates words', async () => {
    const result = await exec('generate_lorem_ipsum', { type: 'words', count: 5 });
    const words = result.content.split(' ');
    expect(words).toHaveLength(5);
  });

  it('generates sentences', async () => {
    const result = await exec('generate_lorem_ipsum', { type: 'sentences', count: 2 });
    // Each sentence ends with a period
    expect(result.content).toContain('.');
  });
});
